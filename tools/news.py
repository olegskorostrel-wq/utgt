"""Последние новости с сайта УТЖТ -> data/news.json (заголовок, дата, ссылка).

    python tools/news.py
    python tools/news.py --html сохранённая_страница.html
"""
import argparse
import json
import sys
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

URL = "https://utgt-pgups.ru/novosti.html"
OUT = Path(__file__).resolve().parent.parent / "data" / "news.json"
LIMIT = 10
UA = {"User-Agent": "Mozilla/5.0 (utgt schedule bot; +https://github.com/utgt-11a/utgt-11a.github.io)"}


def parse(html, base=URL):
    soup = BeautifulSoup(html, "html.parser")
    items = []
    for it in soup.select(".com-content-category-blog__item, .blog-item")[:LIMIT]:
        h = it.select_one(".page-header h2, h2")
        link = it.select_one("p.readmore a, .page-header a, figure a, h2 a")
        if not h or not link:
            continue
        t = it.select_one("time")
        date = " ".join(t.get_text(" ").replace("Создано:", "").split()) if t else ""
        items.append({"title": " ".join(h.get_text(" ").split()), "date": date,
                      "url": urljoin(base, link.get("href", ""))})
    return items


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--html")
    args = ap.parse_args()
    if args.html:
        html = Path(args.html).read_text(encoding="utf-8")
    else:
        r = requests.get(URL, timeout=60, headers=UA)
        r.raise_for_status()
        r.encoding = "utf-8"
        html = r.text
    items = parse(html)
    if not items:
        print("ВНИМАНИЕ: новости не найдены — возможно, поменялась вёрстка", file=sys.stderr)
        return 1
    new = json.dumps({"source": URL, "items": items}, ensure_ascii=False, indent=1)
    if not OUT.exists() or OUT.read_text(encoding="utf-8") != new:
        OUT.write_text(new, encoding="utf-8")
    print(f"новостей: {len(items)}, последняя: {items[0]['date']} — {items[0]['title']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
