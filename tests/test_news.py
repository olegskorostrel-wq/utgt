"""Фильтр новостей: про СВО, беспилотники и военную службу на сайт не попадают."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
from news import blocked  # noqa: E402


def test_military_news_blocked():
    assert blocked({"title": "Обучение по Эксплуатации беспилотных авиационных систем"}, "")
    assert blocked({"title": "Встреча со студентами"}, "Рассказали об участниках СВО и службе")
    assert blocked({"title": "Новость"}, "Набор на военную службу по контракту")
    assert not blocked({"title": "С Днем рождения, УТЖТ! Нам 82 года!"}, "Поздравляем всех с праздником, свободный вход")
    assert not blocked({"title": "«Строками прошедших лет: подвиг солдата»"}, "Великая Отечественная война")


def test_vk_posts():
    from news import vk_parse, vk_title, day_of
    assert day_of("05 октября 2026") == "2026-10-05"
    assert vk_title("Коротко [club214137|УТЖТ] #утжт") == "Коротко УТЖТ"
    long = "Первая строка поста\n" + "много текста " * 30
    assert vk_title(long) == "Первая строка поста"
    it = vk_parse([{"id": 7, "date": 1793350800, "text": "Привет!"}, {"id": 8, "date": 1, "text": ""}])
    assert len(it) == 1 and it[0]["url"] == "https://vk.com/wall-214137_7" and it[0]["from"] == "vk"
