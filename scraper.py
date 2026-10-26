"""
Скрапер страницы "Замена уроков" УТЖТ-филиала ПГУПС.

ВАЖНО: замены на сайте публикуются КАРТИНКАМИ (PNG), не текстом.
Этот скрипт вытаскивает только: дату, тип отделения (очное/заочное)
и ссылку на картинку замены (или "по расписанию", если замен нет).
Он НЕ читает содержимое картинки — для этого нужен отдельный шаг
с OCR или vision-моделью (см. README.md, раздел "V2").

Запускать с обычным доступом в интернет (не из песочницы Claude —
у неё нет доступа к utgt-pgups.ru).

pip install requests beautifulsoup4
"""

import re
import requests
from bs4 import BeautifulSoup
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urljoin

URL = "https://utgt-pgups.ru/ochnoe-zaochnoe-otdelenie/58-zamena-zanyatij.html"

MONTHS = {
    "января": 1, "февраля": 2, "марта": 3, "апреля": 4,
    "мая": 5, "июня": 6, "июля": 7, "августа": 8,
    "сентября": 9, "октября": 10, "ноября": 11, "декабря": 12,
}


@dataclass
class ZamenaEntry:
    day: int
    month: int
    year: int
    department: str  # "очное" | "заочное"
    image_url: Optional[str]  # None если "по расписанию" (замен нет)
    raw_text: str

    @property
    def date_str(self) -> str:
        return f"{self.day:02d}.{self.month:02d}.{self.year}"


def fetch_page(url: str = URL) -> str:
    resp = requests.get(url, timeout=15, headers={
        "User-Agent": "Mozilla/5.0 (schedule-bot for 11-A)"
    })
    resp.raise_for_status()
    return resp.text


def parse_zamena_entries(html: str, base_url: str = URL) -> list[ZamenaEntry]:
    """
    Ищет блоки вида:
      "Изменение в расписании занятий"
      "на 26 октября 2026 года"
      "очное отделение"
      <картинка ИЛИ текст "по расписанию">

    Сайт — Joomla, разметка внутри статьи обычно состоит из <p>/<img>
    подряд, без строгих контейнеров на каждый блок. Поэтому парсим
    последовательность текстовых узлов + картинок внутри основного
    контента и сопоставляем дату -> отделение -> картинку по порядку.
    """
    soup = BeautifulSoup(html, "html.parser")

    # Основной контент статьи Joomla обычно в itemprop="articleBody"
    # или в div.article-content / div.item-page — пробуем по очереди.
    content = (
        soup.find(attrs={"itemprop": "articleBody"})
        or soup.find("div", class_=re.compile("item-page|article-content"))
        or soup.find("article")
        or soup
    )

    # Собираем плоскую последовательность "кусков" текста и картинок
    # в порядке появления.
    pieces = []
    for el in content.descendants:
        if getattr(el, "name", None) == "img":
            pieces.append(("img", el.get("src", "")))
        elif isinstance(el, str):
            text = el.strip()
            if text:
                pieces.append(("text", text))

    entries: list[ZamenaEntry] = []
    date_re = re.compile(
        r"на\s+(\d{1,2})\s+(" + "|".join(MONTHS) + r")\s+(\d{4})\s+года",
        re.IGNORECASE,
    )

    pending_date = None  # (day, month, year)
    pending_dept = None

    for kind, value in pieces:
        if kind == "text":
            m = date_re.search(value)
            if m:
                day = int(m.group(1))
                month = MONTHS[m.group(2).lower()]
                year = int(m.group(3))
                pending_date = (day, month, year)
                pending_dept = None
                continue

            low = value.lower()
            if "очное отделение" in low and "заочное" not in low:
                pending_dept = "очное"
            elif "заочное отделение" in low:
                pending_dept = "заочное"
            elif "по расписанию" in low and pending_date and pending_dept:
                day, month, year = pending_date
                entries.append(ZamenaEntry(
                    day=day, month=month, year=year,
                    department=pending_dept,
                    image_url=None,
                    raw_text=value,
                ))
                pending_dept = None  # сброс, ждём следующий блок
        else:  # kind == "img"
            if pending_date and pending_dept:
                day, month, year = pending_date
                entries.append(ZamenaEntry(
                    day=day, month=month, year=year,
                    department=pending_dept,
                    image_url=urljoin(base_url, value),
                    raw_text="",
                ))
                pending_dept = None  # сброс, ждём следующий блок

    return entries


def get_ochnoe_entries(entries: list[ZamenaEntry]) -> list[ZamenaEntry]:
    """Только очное отделение — то, что нужно для 11-А."""
    return [e for e in entries if e.department == "очное"]


def find_entry_for_date(entries: list[ZamenaEntry], day: int, month: int, year: int) -> Optional[ZamenaEntry]:
    for e in entries:
        if (e.day, e.month, e.year) == (day, month, year):
            return e
    return None


if __name__ == "__main__":
    import datetime
    html = fetch_page()
    entries = get_ochnoe_entries(parse_zamena_entries(html))

    print(f"Найдено блоков замен (очное отделение): {len(entries)}")
    for e in entries:
        status = e.image_url if e.image_url else "ПО РАСПИСАНИЮ (замен нет)"
        print(f"  {e.date_str}: {status}")

    today = datetime.date.today()
    today_entry = find_entry_for_date(entries, today.day, today.month, today.year)
    if today_entry:
        print(f"\nНа сегодня ({today_entry.date_str}):")
        print(f"  {today_entry.image_url or 'замен нет, занятия по расписанию'}")
    else:
        print(f"\nНа сегодня ({today:%d.%m.%Y}) замена ещё не опубликована на сайте.")
