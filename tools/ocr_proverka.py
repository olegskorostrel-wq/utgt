"""Проверка распознавания замен: заново распознать сохранённые картинки распоряжений (data/zameny)
и сравнить с тем, что лежит в данных (проверено по картинкам). Запускать после любых правок OCR в scraper.py.

    python tools/ocr_proverka.py                 # все сохранённые дни
    python tools/ocr_proverka.py 2026-11-02      # выбранные дни
"""
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import scraper  # noqa: E402

Z = ROOT / "data" / "zameny"


def key(group, r):
    return group, tuple(r["lessons"]), r["room"] or "", r["subject"][:25]


def main(days):
    vocab = scraper.subject_vocab()
    total = wrong = silent = 0
    for path in sorted(Z.glob("????-??-??.json")):
        date = path.stem
        if days and date not in days:
            continue
        z = json.loads(path.read_text(encoding="utf-8"))
        if not z["images"]:
            continue
        t0 = time.time()
        truth = {key(g, r) for g, rows in z["all_changes"].items() for r in rows}
        tables = [scraper.ocr_table(Z / i["file"], vocab) for i in z["images"]]
        scraper.check_with_schedule(tables, date, next((t["title"] for t in tables if t.get("title")), ""))
        got = [(key(r["group"], r), r["uncertain"]) for t in tables for r in t["rows"] if r["group"]]
        extra = [(k, u) for k, u in got if k not in truth]
        miss = truth - {k for k, _ in got}
        total += len(truth)
        wrong += len(miss)
        silent += sum(1 for _, u in extra if not u)
        print(f"{date}: строк {len(truth)}, не совпало {len(miss)} ({time.time() - t0:.0f} с)")
        for k, u in extra:
            print("    ", "неуверенно" if u else "БЕЗ ПОМЕТКИ", k)
    print(f"ИТОГО: строк {total}, не совпало {wrong}, из них без пометки «неуверенно» {silent}")
    return 1 if silent else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
