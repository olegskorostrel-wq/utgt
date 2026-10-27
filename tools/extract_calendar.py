"""Извлекает календарный учебный график (КУГ) всех групп очного отделения из PDF
техникума: праздники, каникулы, сессию, практику, учебные сборы.

    python tools/extract_calendar.py kug.pdf             # -> data/calendar.json
    python tools/extract_calendar.py kug.pdf --print 11-А

В графике столбец = учебная неделя (вторник–понедельник), строки ВТ..ПН = дни.
Обозначения в клетках: «=» каникулы, «::» промежуточная аттестация, «СБ» учебные
сборы, «8»/«X»/«0…» практика, «˄» подготовка к демоэкзамену, «э» демоэкзамен,
«В» выходной (в будний день — праздник).
"""
import argparse
import collections
import datetime as dt
import json
import re
import sys
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
SOURCE = "https://utgt-pgups.ru/images/Svodnyj%20KUG%20ocnoe%20otdelenie%202026-2027%20ucebnyj%20god.pdf"
YEAR_START = dt.date(2026, 9, 1)  # вторник — первый день недели №1
DAYS = ["ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС", "ПН"]
GROUP_RE = re.compile(r"^[1-4]1-[А-ЯЁ]$")
HOLIDAY_NAMES = {(11, 4): "День народного единства", (2, 23): "День защитника Отечества",
                 (3, 8): "Международный женский день", (5, 1): "Праздник Весны и Труда",
                 (5, 9): "День Победы", (5, 10): "День Победы (перенос с 9 мая)", (6, 12): "День России",
                 (1, 1): "Новогодние каникулы", (1, 7): "Рождество Христово"}

KINDS = {"=": "kanikuly", "::": "sessiya", "СБ": "sbory", "8": "praktika", "X": "praktika", "Х": "praktika",
         "˄": "demo_prep", "^": "demo_prep", "э": "demo", "Э": "demo"}
NAMES = {"sessiya": "Сессия", "sbory": "Учебные сборы (юноши)", "praktika": "Практика",
         "demo_prep": "Подготовка к демоэкзамену", "demo": "Демоэкзамен"}
SEASON = ["Зимние", "Весенние", "Летние", "Осенние"]  # по месяцу начала: 12–2, 3–5, 6–8, 9–11
NO_CLASSES = {"kanikuly", "sbory", "praktika", "demo_prep", "demo"}


def kind_of(text):
    if text in KINDS:
        return KINDS[text]
    if re.match(r"^0[а-яё]", text):  # учебная практика: 0мсцб, 0эмр, …
        return "praktika"
    return None


class Page:
    def __init__(self, page):
        self.page = page
        self.words = page.extract_words()
        self._weeks()
        self._groups()

    def _weeks(self):
        """x-центры столбцов недель 1..52 — по строке с номерами недель."""
        rows = collections.defaultdict(list)
        for w in self.words:
            if w["text"].isdigit():
                rows[round(w["top"] / 4)].append(w)
        best = max(rows.values(), key=lambda r: len({w["text"] for w in r if 1 <= int(w["text"]) <= 52}))
        xs = {}
        for w in sorted(best, key=lambda w: w["x0"]):
            n = int(w["text"])
            if 1 <= n <= 52 and n not in xs:
                xs[n] = (w["x0"] + w["x1"]) / 2
        assert len(xs) == 52, f"нашлось недель: {len(xs)}"
        self.week_x = xs
        self.step = (xs[52] - xs[1]) / 51
        self.weeks_top = best[0]["top"]
        # колонки «ЭКЗАМЕНЫ: 1 семестр | 2 семестр» — между тремя последними вертикальными линиями таблицы
        borders = []
        for x in sorted(e["x0"] for e in self.page.vertical_edges if e["x0"] > xs[52] and e["height"] > 100):
            if not borders or x - borders[-1] > 3:
                borders.append(x)
        a, b, c = borders[-3:]
        self.exam_cols = [(a, b), (b, c)]

    def _groups(self):
        labels = sorted([w for w in self.words if w["text"] in DAYS and w["top"] > self.weeks_top
                         and w["x0"] < self.week_x[1]], key=lambda w: w["top"])
        heads = [w for w in self.words if GROUP_RE.match(w["text"]) and w["x0"] < self.week_x[1]]
        self.groups = {}
        for h in heads:
            # 7 строк дней, середина которых ближе всего к подписи группы
            rows = [l for l in labels if abs(l["top"] - h["top"]) < 200]
            rows.sort(key=lambda l: l["top"])
            start = min(range(0, len(rows) - 6), key=lambda i: abs(rows[i + 3]["top"] - h["top"]))
            block = rows[start:start + 7]
            assert [l["text"] for l in block] == DAYS, (h["text"], [l["text"] for l in block])
            self.groups[h["text"]] = [l["top"] for l in block]

    def exams(self, group):
        """[[экзамены 1 семестра], [экзамены 2 семестра]] из правой части графика."""
        tops = self.groups[group]
        rowh = (tops[-1] - tops[0]) / 6
        y0, y1 = tops[0] - rowh / 2, tops[-1] + rowh / 2
        out = []
        for x0, x1 in self.exam_cols:
            lines = collections.defaultdict(list)
            for w in self.words:
                if x0 <= w["x0"] < x1 and y0 <= w["top"] < y1:
                    lines[round(w["top"] / 3)].append(w)
            text = " ".join(" ".join(x["text"] for x in sorted(ws, key=lambda x: x["x0"]))
                            for _, ws in sorted(lines.items()))
            items = [" ".join(t.split()).strip(" .") for t in text.split(";")]
            out.append([t for t in items if len(t) > 2])
        return out

    def cells(self, group):
        """{дата: обозначение} для группы."""
        tops = self.groups[group]
        rowh = (tops[-1] - tops[0]) / 6
        out = {}
        for w in self.words:
            cx, cy = (w["x0"] + w["x1"]) / 2, (w["top"] + w["bottom"]) / 2
            if cx < self.week_x[1] - self.step / 2 or cx > self.week_x[52] + self.step / 2:
                continue
            day = min(range(7), key=lambda i: abs(tops[i] - w["top"]))
            if abs(tops[day] - w["top"]) > rowh / 2:
                continue
            week = min(self.week_x, key=lambda n: abs(self.week_x[n] - cx))
            if abs(self.week_x[week] - cx) > self.step / 2:
                continue
            date = YEAR_START + dt.timedelta(days=7 * (week - 1) + day)
            out[date] = w["text"]
        return out


def periods_from(cells, holidays):
    """Подряд идущие дни одного вида -> периоды; воскресенья и праздники не разрывают период."""
    marks = sorted((d, kind_of(t)) for d, t in cells.items() if kind_of(t))
    out = []
    for d, kind in marks:
        last = out[-1] if out else None
        if last and last["type"] == kind:
            gap = (d - last["to"]).days
            between = [last["to"] + dt.timedelta(days=i) for i in range(1, gap)]
            if gap <= 3 and all(x.isoweekday() == 7 or x in holidays or cells.get(x) == "В" for x in between):
                last["to"] = d
                continue
        out.append({"type": kind, "from": d, "to": d})
    year_end = YEAR_START + dt.timedelta(days=7 * 52 - 1)  # понедельник последней недели графика
    for p in out:
        if p["to"] == year_end:
            p["to"] = YEAR_START.replace(year=YEAR_START.year + 1) - dt.timedelta(days=1)  # до 31 августа
        if p["type"] == "kanikuly":
            p["name"] = SEASON[(p["from"].month % 12) // 3] + " каникулы"
        else:
            p["name"] = NAMES[p["type"]]
        if p["type"] in NO_CLASSES:
            p["no_classes"] = True
    return out


def extract(pdf_path):
    pages = [Page(p) for p in pdfplumber.open(pdf_path).pages]
    all_cells = {g: pg.cells(g) for pg in pages for g in pg.groups}
    all_exams = {g: pg.exams(g) for pg in pages for g in pg.groups}
    # праздник = «В» в будний день у большинства групп
    votes = collections.Counter(d for c in all_cells.values() for d, t in c.items()
                                if t == "В" and d.isoweekday() != 7)
    holidays = sorted(d for d, n in votes.items() if n >= len(all_cells) / 2)
    groups = {}
    for g, cells in sorted(all_cells.items()):
        ps = periods_from(cells, set(holidays))
        sessions = [p for p in ps if p["type"] == "sessiya"]
        for sem, exams in enumerate(all_exams[g]):
            # 1 семестр — сессия до февраля, 2 семестр — последняя сессия года
            target = [p for p in sessions if p["from"].month >= 9 or p["from"].month <= 1] if sem == 0 else sessions[-1:]
            if exams and target:
                target[0]["exams"] = exams
        groups[g] = {"periods": [{**p, "from": p["from"].isoformat(), "to": p["to"].isoformat()} for p in ps]}
    return {
        "source": SOURCE,
        "title": "Сводный календарный учебный график на 2026-2027 учебный год (очная форма обучения)",
        "note": "Извлечено tools/extract_calendar.py. type: kanikuly / sessiya / sbory / praktika / demo_prep / demo.",
        "holidays": [{"date": d.isoformat(), "name": HOLIDAY_NAMES.get((d.month, d.day), "Праздничный день")}
                     for d in holidays],
        "groups": groups,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--print", dest="show")
    ap.add_argument("--out", default=str(ROOT / "data" / "calendar.json"))
    args = ap.parse_args()
    cal = extract(args.pdf)
    if args.show:
        print(json.dumps({"holidays": cal["holidays"], "periods": cal["groups"][args.show]["periods"]},
                         ensure_ascii=False, indent=1))
        return 0
    Path(args.out).write_text(json.dumps(cal, ensure_ascii=False, indent=1), encoding="utf-8")
    for g, v in cal["groups"].items():
        print(g, "; ".join(f"{p['name']} {p['from'][5:]}–{p['to'][5:]}" for p in v["periods"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
