"""Бот обратной связи: сообщения Telegram -> задачи GitHub (без сети)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import tg_feedback as T  # noqa: E402


def msg(text, mid=1, chat=100, first="Аня", last=None, username="anya_secret"):
    return {"message_id": mid, "text": text, "chat": {"id": chat, "type": "private"},
            "from": {"first_name": first, "last_name": last, "username": username}}


def test_spam_rules():
    assert T.spam_reason("Заработок от 5000 в день, пиши") == "рекламные слова"
    assert T.spam_reason("заходи https://example.com") == "есть ссылка"
    assert T.spam_reason("ПОДПИСЫВАЙТЕСЬ СРОЧНО НА МЕНЯ ВСЕ") == "КАПСЛОК"
    assert T.spam_reason("ааааааааааааааааааа") == "повтор символов"
    assert T.spam_reason("В пятницу у 21-С стоит физика, а по факту химия") is None
    assert T.spam_reason("на сайте не та аудитория у 11-А, должна быть 2-18") is None


def test_issue_keeps_text_and_name_but_not_username_or_chat():
    title, body, labels = T.issue_for(msg("У 11-А завтра история в 2-10, а не в 2-18", chat=987654))
    assert title == "Telegram: У 11-А завтра история в 2-10, а не в 2-18"
    assert "> У 11-А завтра история в 2-10, а не в 2-18" in body and "Аня" in body
    assert "anya_secret" not in body and "987654" not in body
    assert labels == ["telegram"]


def test_issue_long_title_and_spam_label():
    title, body, labels = T.issue_for(msg("Крипта! " + "очень длинный текст " * 10))
    assert title.endswith("…") and len(title) <= len("Telegram: ") + 61
    assert labels == ["telegram", "возможно спам"] and "похоже на спам" in body


def test_commands_and_empty_messages_are_not_issues():
    assert T.issue_for(msg("/start")) is None
    assert T.issue_for({"message_id": 1, "chat": {"id": 1, "type": "private"}, "photo": [{}]}) is None


class FakeBot:
    def __init__(self, updates):
        self.updates, self.calls = updates, []

    def call(self, method, **p):
        self.calls.append((method, p))
        return self.updates if method == "getUpdates" and "offset" not in p else True


class FakeRepo:
    def __init__(self):
        self.issues = []

    def ensure_labels(self):
        pass

    def create_issue(self, title, body, labels):
        self.issues.append((title, labels))
        self.bodies = getattr(self, "bodies", []) + [body]
        return len(self.issues)

    def comment(self, number, text):
        self.comments = getattr(self, "comments", []) + [(number, text)]


def test_run_creates_issues_replies_and_acknowledges():
    updates = [
        {"update_id": 10, "message": msg("/start", mid=1, chat=1)},
        {"update_id": 11, "message": msg("Ошибка в расписании 31-А в среду", mid=2, chat=2)},
        {"update_id": 12, "message": msg("Пассивный доход, инвестиции t.me/xxx", mid=3, chat=3)},
        {"update_id": 13, "message": {"message_id": 4, "chat": {"id": 4, "type": "group"}, "text": "привет всем"}},
    ]
    bot, repo = FakeBot(updates), FakeRepo()
    assert T.run(bot, repo, log=lambda *_: None) == 2
    assert repo.issues == [("Telegram: Ошибка в расписании 31-А в среду", ["telegram"]),
                           ("Telegram: Пассивный доход, инвестиции t.me/xxx", ["telegram", "возможно спам"])]
    sent = [(p["chat_id"], p["text"]) for m, p in bot.calls if m == "sendMessage"]
    assert sent == [(1, T.GREETING), (2, T.THANKS)]  # спамеру не отвечаем, группы игнорируем
    assert "в течение дня" in T.THANKS.lower()
    assert bot.calls[-1] == ("getUpdates", {"offset": 14, "timeout": 0})


def test_run_without_updates_does_nothing():
    bot, repo = FakeBot([]), FakeRepo()
    assert T.run(bot, repo, log=lambda *_: None) == 0
    assert repo.issues == [] and len(bot.calls) == 1


def test_main_without_token_is_noop(monkeypatch, capsys):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    assert T.main() == 0
    assert "не задан" in capsys.readouterr().out


def test_failure_midway_acknowledges_only_processed():
    class Boom(FakeRepo):
        def create_issue(self, title, body, labels):
            if "второе" in title:
                raise RuntimeError("GitHub недоступен")
            return super().create_issue(title, body, labels)
    updates = [{"update_id": 20, "message": msg("первое сообщение", chat=1)},
               {"update_id": 21, "message": msg("второе сообщение", chat=2)}]
    bot, repo = FakeBot(updates), Boom()
    try:
        T.run(bot, repo, log=lambda *_: None)
    except RuntimeError:
        pass
    assert repo.issues == [("Telegram: первое сообщение", ["telegram"])]
    assert bot.calls[-1] == ("getUpdates", {"offset": 21, "timeout": 0})  # второе придёт снова


SEALER = T.Sealer("123:test-token")


def test_chat_id_is_stored_encrypted():
    title, body, _ = T.issue_for(msg("ошибка у 21-С", chat=555777), SEALER)
    assert "555777" not in body
    assert SEALER.open(T.CHAT_TAG.search(body).group(1)) == 555777
    assert T.Sealer("другой токен").open(T.CHAT_TAG.search(body).group(1)) is None  # без токена не прочитать


def issue_event(state_reason="completed", labels=("telegram",), chat=42, title="Telegram: у 11-А не та аудитория"):
    body = "> текст" + (f"\n<!-- tg-chat {SEALER.seal(chat)} -->" if chat else "")
    return {"action": "closed", "issue": {"number": 7, "title": title, "body": body, "state_reason": state_reason,
                                          "labels": [{"name": n} for n in labels]}}


def test_closed_as_completed_thanks_author():
    bot, repo = FakeBot([]), FakeRepo()
    assert T.notify("issues", issue_event(), bot, repo, SEALER, log=lambda *_: None)
    (method, p), = bot.calls
    assert method == "sendMessage" and p["chat_id"] == 42
    assert "«у 11-А не та аудитория»" in p["text"] and "Спасибо" in p["text"]
    assert repo.comments[0][0] == 7


def test_spam_or_not_planned_or_foreign_issue_is_silent():
    for ev in (issue_event(state_reason="not_planned"), issue_event(labels=("bug",))):
        bot, repo = FakeBot([]), FakeRepo()
        assert not T.notify("issues", ev, bot, repo, SEALER, log=lambda *_: None)
        assert bot.calls == []


def test_old_issue_without_chat_explains_in_comment():
    bot, repo = FakeBot([]), FakeRepo()
    assert not T.notify("issues", issue_event(chat=None), bot, repo, SEALER, log=lambda *_: None)
    assert bot.calls == [] and "не получилось" in repo.comments[0][1].lower()


def comment_event(text, assoc="OWNER"):
    ev = issue_event()
    ev.update(action="created", comment={"body": text, "author_association": assoc})
    return ev


def test_reply_command_from_owner_is_forwarded():
    bot, repo = FakeBot([]), FakeRepo()
    assert T.notify("issue_comment", comment_event("/ответ Уточните, пожалуйста, какой день?"), bot, repo, SEALER,
                    log=lambda *_: None)
    assert bot.calls[0][1]["text"] == "Ответ на ваше сообщение «у 11-А не та аудитория»:\n\nУточните, пожалуйста, какой день?"


def test_reply_ignored_from_strangers_and_plain_comments():
    for ev in (comment_event("/ответ привет", assoc="NONE"), comment_event("просто заметка")):
        bot, repo = FakeBot([]), FakeRepo()
        assert not T.notify("issue_comment", ev, bot, repo, SEALER, log=lambda *_: None)
        assert bot.calls == []
