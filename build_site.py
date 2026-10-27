"""Собирает статический сайт в папку _site: site/* + data/* + status.json.

    python build_site.py                  # обычная сборка
    python build_site.py --scrape-failed  # отметить, что проверка замен упала
    python build_site.py --preview        # прототип для всех групп в _preview (не публикуется)
"""
import argparse
import datetime as dt
import hashlib
import json
import re
import shutil
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent


def bust_cache(out):
    """app.js -> app.js?v=<хэш содержимого>: после обновления телефон не возьмёт старый скрипт из кэша."""
    page = out / "index.html"
    html = page.read_text(encoding="utf-8")

    def versioned(m):
        name = m.group(2)
        digest = hashlib.sha1((out / name).read_bytes()).hexdigest()[:8]
        return f'{m.group(1)}="{name}?v={digest}"'

    html = re.sub(r'(src|href)="([\w.-]+\.(?:js|css))"', versioned, html)
    page.write_text(html, encoding="utf-8")


def build(out=ROOT / "_site", scrape_ok=True, preview=False):
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(ROOT / "site", out)
    # расписания всех групп пока нужны только прототипу
    shutil.copytree(ROOT / "data", out / "data", ignore=None if preview else shutil.ignore_patterns("groups"))
    if preview:
        shutil.copytree(ROOT / "prototype", out, dirs_exist_ok=True)
    zameny = out / "data" / "zameny"
    zameny.mkdir(exist_ok=True)
    if not (zameny / "index.json").exists():
        (zameny / "index.json").write_text('{"days": []}', encoding="utf-8")
    bust_cache(out)
    status = {"checked_at": dt.datetime.now(ZoneInfo("Europe/Moscow")).isoformat(timespec="minutes"),
              "ok": scrape_ok}
    (out / "status.json").write_text(json.dumps(status), encoding="utf-8")
    (out / ".nojekyll").write_text("")
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--scrape-failed", action="store_true")
    ap.add_argument("--preview", action="store_true")
    args = ap.parse_args()
    out = ROOT / ("_preview" if args.preview else "_site")
    print("собрано в", build(out, scrape_ok=not args.scrape_failed, preview=args.preview))
