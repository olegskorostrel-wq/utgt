"""Забирает новые сообщения из Telegram-бота обратной связи и создаёт по каждому
задачу (issue) в репозитории. Явный спам сразу помечается меткой.

Запускается из GitHub Actions (.github/workflows/feedback.yml). Нужны переменные:
  TELEGRAM_BOT_TOKEN — токен бота от @BotFather (секрет репозитория)
  GITHUB_TOKEN, GITHUB_REPOSITORY — выдаёт сам GitHub Actions

В задачу попадает только текст и имя отправителя — без @username и id чата,
потому что задачи в публичном репозитории видны всем.
"""
import os
import re
import sys

import requests

TG = "https://api.telegram.org/bot{token}/{method}"
LABEL = "telegram"
SPAM_LABEL = "возможно спам"
SPAM_WORDS = re.compile(
    r"(крипт|bitcoin|btc|usdt|заработ|доход|инвест|казино|ставк|выигр|бесплатн\w* деньг|"
    r"подпис\w* на канал|переходи|промокод|скидк|продаж|реклам|onlyfans|18\+)", re.I)
LINK = re.compile(r"(https?://|t\.me/|www\.|@\w{5,}bot\b)", re.I)

GREETING = ("Привет! Это бот сайта с расписанием УТЖТ.\n"
            "Напишите, если нашли ошибку в расписании или заменах, или есть идея — сообщение передадим Олегу.")
THANKS = "Спасибо! Сообщение передано Олегу."
NOT_TEXT = "Пока принимаем только текстовые сообщения — опишите, пожалуйста, словами."


def spam_reason(text):
    """Причина, по которой сообщение похоже на спам, или None."""
    if LINK.search(text):
        return "есть ссылка"
    if SPAM_WORDS.search(text):
        return "рекламные слова"
    letters = [c for c in text if c.isalpha()]
    if len(letters) >= 12 and sum(c.isupper() for c in letters) / len(letters) > 0.7:
        return "КАПСЛОК"
    if len(text) > 15 and len(set(text.replace(" ", ""))) <= 3:
        return "повтор символов"
    return None


def issue_for(msg):
    """Сообщение Telegram -> (заголовок, текст, метки) или None, если задачу не создаём."""
    text = (msg.get("text") or msg.get("caption") or "").strip()
    if not text or text.startswith("/"):
        return None
    name = " ".join(x for x in (msg.get("from", {}).get("first_name"), msg.get("from", {}).get("last_name")) if x)
    first_line = " ".join(text.split())[:60]
    title = "Telegram: " + first_line + ("…" if len(" ".join(text.split())) > 60 else "")
    quoted = "\n".join("> " + line for line in text.splitlines())
    body = (f"{quoted}\n\n— {name or 'без имени'}, сообщение в боте обратной связи\n\n"
            f"<!-- tg-update {msg.get('message_id')} -->")
    labels = [LABEL]
    reason = spam_reason(text)
    if reason:
        labels.append(SPAM_LABEL)
        body += f"\n\nАвтоматическая пометка: похоже на спам ({reason})."
    return title, body, labels


class Bot:
    def __init__(self, token, session=None):
        self.token, self.s = token, session or requests.Session()

    def call(self, method, **params):
        r = self.s.post(TG.format(token=self.token, method=method), json=params, timeout=30)
        r.raise_for_status()
        data = r.json()
        if not data.get("ok"):
            raise RuntimeError(f"Telegram {method}: {data}")
        return data["result"]


class Repo:
    def __init__(self, token, repo, session=None):
        self.repo, self.s = repo, session or requests.Session()
        self.h = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}

    def ensure_labels(self):
        for name, color in ((LABEL, "2456c7"), (SPAM_LABEL, "b3261e")):
            r = self.s.post(f"https://api.github.com/repos/{self.repo}/labels", headers=self.h,
                            json={"name": name, "color": color}, timeout=30)
            if r.status_code not in (201, 422):  # 422 — метка уже есть
                r.raise_for_status()

    def create_issue(self, title, body, labels):
        r = self.s.post(f"https://api.github.com/repos/{self.repo}/issues", headers=self.h,
                        json={"title": title, "body": body, "labels": labels}, timeout=30)
        r.raise_for_status()
        return r.json()["number"]


def run(bot, repo, log=print):
    updates = bot.call("getUpdates", timeout=0, allowed_updates=["message"])
    if not updates:
        log("новых сообщений нет")
        return 0
    repo.ensure_labels()
    created, done = 0, None
    try:
        for u in updates:
            created += handle(u.get("message"), bot, repo, log)
            done = u["update_id"]
    finally:
        # подтверждаем Telegram только то, что уже обработано, — без дублей при сбое
        if done is not None:
            bot.call("getUpdates", offset=done + 1, timeout=0)
    log(f"обработано обновлений: {len(updates)}, создано задач: {created}")
    return created


def handle(msg, bot, repo, log):
    """Одно сообщение. True, если создана задача."""
    if not msg or msg.get("chat", {}).get("type") != "private":
        return False
    chat = msg["chat"]["id"]
    if (msg.get("text") or "").startswith("/start"):
        bot.call("sendMessage", chat_id=chat, text=GREETING)
        return False
    issue = issue_for(msg)
    if issue is None:
        bot.call("sendMessage", chat_id=chat, text=NOT_TEXT)
        return False
    number = repo.create_issue(*issue)
    log(f"задача #{number}: {issue[0]}" + (" [спам?]" if SPAM_LABEL in issue[2] else ""))
    if SPAM_LABEL not in issue[2]:
        bot.call("sendMessage", chat_id=chat, text=THANKS)
    return True


def main():
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        print("TELEGRAM_BOT_TOKEN не задан — бот обратной связи ещё не настроен, пропускаю")
        return 0
    run(Bot(token), Repo(os.environ["GITHUB_TOKEN"], os.environ["GITHUB_REPOSITORY"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
