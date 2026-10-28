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
