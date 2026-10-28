"""Последние новости с сайта УТЖТ -> data/news.json (заголовок, дата, ссылка).

    python tools/news.py
    python tools/news.py --html сохранённая_страница.html
"""
import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

URL = "https://utgt-pgups.ru/novosti.html"
OUT = Path(__file__).resolve().parent.parent / "data" / "news.json"
LIMIT = 10
# Новости про СВО, беспилотники и военную службу на сайт не попадают (проверяются заголовок и текст)
BLOCK = re.compile(r"\bСВО\b|специальн\w*\s+военн\w*\s+операц|беспилот|\bБПЛА\b|\bБАС\b|\bдрон|"
                   r"военн\w*\s+служб\w*\s+по\s+контракт|контрактн\w*\s+служб|мобилизац|Минобороны|"
                   r"Министерств\w*\s+обороны|участник\w*\s+СВО|зон\w*\s+СВО", re.I)
UA = {"User-Agent": "Mozilla/5.0 (utgt schedule bot; +https://github.com/raspisanie-utgt/raspisanie-utgt.github.io)"}


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


def article_text(url):
    r = requests.get(url, timeout=60, headers=UA)
    r.raise_for_status()
    r.encoding = "utf-8"
    soup = BeautifulSoup(r.text, "html.parser")
    body = soup.select_one(".com-content-article, .item-page, article") or soup
    return " ".join(body.get_text(" ").split())


def blocked(item, text):
    return bool(BLOCK.search(item["title"]) or BLOCK.search(text or ""))


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
    # текст каждой новости проверяется один раз: решения хранятся в news.json (hidden / checked)
    old = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    hidden, checked = set(old.get("hidden", [])), set(old.get("checked", []))
    for it in items:
        if it["url"] in checked or args.html:
            continue
        try:
            text = article_text(it["url"])
        except requests.RequestException:
            text = ""  # не открылась — решаем по заголовку, проверим текст в следующий раз
        else:
            checked.add(it["url"])
        if blocked(it, text):
            hidden.add(it["url"])
    for it in items:
        if blocked(it, ""):
            hidden.add(it["url"])
    shown = [it for it in items if it["url"] not in hidden]
    urls = {it["url"] for it in items}
    new = json.dumps({"source": URL, "items": shown, "hidden": sorted(hidden & urls), "checked": sorted(checked & urls)},
                     ensure_ascii=False, indent=1)
    if not OUT.exists() or OUT.read_text(encoding="utf-8") != new:
        OUT.write_text(new, encoding="utf-8")
    print(f"новостей: {len(shown)} (скрыто: {len(hidden & urls)}), последняя: {shown[0]['date'] if shown else '—'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
