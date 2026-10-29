"""Когда техникум выкладывает распоряжения о заменах: по каждому дню — когда распоряжение впервые
появилось на сайте техникума (по нашим проверкам раз в час с 6:47 до 21:47) и за сколько часов
до начала занятий (9:00). Нужно, чтобы понять, есть ли повод вежливо попросить учебную часть
выкладывать замены раньше.

    python tools/publish_times.py

Точность — около часа (между двумя проверками). Если распоряжение появилось после 21:47,
мы увидим его только утром в 6:47. Дни до запуска сайта (26.10.2026) не учитываются.
"""
import datetime as dt
import gzip
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LAUNCH = "2026-10-26T23:00"   # первые проверки сайта: всё, что увидели раньше, — уже лежало на сайте техникума
WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]


def days():
    out = {}
    for f in sorted((ROOT / "data" / "archive").glob("*.json.gz")):
        out.update(json.loads(gzip.decompress(f.read_bytes()).decode("utf-8")))
    for f in sorted((ROOT / "data" / "zameny").glob("????-??-??.json")):
        out.setdefault(f.stem, {}).update(json.loads(f.read_text(encoding="utf-8")))
    return dict(sorted(out.items()))


def verdict(hours):
    if hours >= 15:
        return "вовремя (накануне до 18:00)"
    if hours >= 11:
        return "вечером накануне"
    return "поздно (ночью или в тот же день)"


def main():
    rows = []
    for date, rec in days().items():
        seen = rec.get("first_seen") or rec.get("fetched_at")
        if not seen or rec.get("po_raspisaniyu") or seen[:16] < LAUNCH:
            continue
        t = dt.datetime.fromisoformat(seen).replace(tzinfo=None)
        start = dt.datetime.fromisoformat(date + "T09:00")
        hours = (start - t).total_seconds() / 3600
        rows.append((date, t, hours, verdict(hours)))
    if not rows:
        print("Пока нет распоряжений, появившихся после запуска сайта.")
        return
    for date, t, hours, v in rows:
        wd = WEEKDAYS[dt.date.fromisoformat(date).weekday()]
        print(f"на {date[8:10]}.{date[5:7]} ({wd}): появилось {t:%d.%m %H:%M} — за {hours:.0f} ч до 9:00 — {v}")
    late = sum(1 for r in rows if r[3].startswith("поздно"))
    evening = sum(1 for r in rows if r[3].startswith("вечером"))
    print(f"\nвсего {len(rows)}: вовремя {len(rows) - late - evening}, вечером {evening}, поздно {late}")


if __name__ == "__main__":
    main()
