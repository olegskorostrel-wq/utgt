"""Собирает статический сайт в папку _site: site/* + data/* + status.json.

    python build_site.py                  # обычная сборка
    python build_site.py --scrape-failed  # отметить, что проверка замен упала
"""
import argparse
import datetime as dt
import json
import shutil
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent


def build(out=ROOT / "_site", scrape_ok=True):
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(ROOT / "site", out)
    shutil.copytree(ROOT / "data", out / "data")
    zameny = out / "data" / "zameny"
    zameny.mkdir(exist_ok=True)
    if not (zameny / "index.json").exists():
        (zameny / "index.json").write_text('{"days": []}', encoding="utf-8")
    status = {"checked_at": dt.datetime.now(ZoneInfo("Europe/Moscow")).isoformat(timespec="minutes"),
              "ok": scrape_ok}
    (out / "status.json").write_text(json.dumps(status), encoding="utf-8")
    (out / ".nojekyll").write_text("")
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--scrape-failed", action="store_true")
    print("собрано в", build(scrape_ok=not ap.parse_args().scrape_failed))
