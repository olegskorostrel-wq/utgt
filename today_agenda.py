"""Расписание 11-А на сегодня (или на указанную дату) в консоли:
базовое расписание + звонки + замены из data/zameny (их сохраняет scraper.py).

    python today_agenda.py              # сегодня по Москве
    python today_agenda.py 2026-10-24   # любой день
    python today_agenda.py --fetch      # сначала проверить сайт замен
"""
import datetime as dt
import json
import re
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
CANCEL = "Отменить"
WEEKDAYS = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"]


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def lesson_time(bells, weekday, n):
    """Начало и конец урока n (0 = «Разговоры о важном»). Пара = 2 урока по 45 минут."""
    if n == 0:
        return tuple(bells["monday"]["razgovory"])
    day = bells["monday"] if weekday == 1 else bells["other_days"]
    start, end = day["pairs"][str((n + 1) // 2)]
    to_min = lambda t: int(t[:2]) * 60 + int(t[3:])
    fmt = lambda m: f"{m // 60:02d}:{m % 60:02d}"
    if n % 2:
        return start, fmt(to_min(start) + bells["lesson_minutes"])
    return fmt(to_min(end) - bells["lesson_minutes"]), end


def week_number(date, schedule, zamena):
    """1 или 2. Номер из распоряжения о замене («2-я неделя») важнее расчёта от опорной даты."""
    m = re.search(r"([12])\s*-?\s*я\s+недел", (zamena or {}).get("title", ""), re.I)
    if m:
        return int(m.group(1))
    anchor = schedule.get("week_anchor")
    if not anchor:
        return 1
    weeks = (date - dt.date.fromisoformat(anchor["date"])).days // 7
    return anchor["week"] if weeks % 2 == 0 else 3 - anchor["week"]


def agenda(date, schedule, bells, zamena):
    """Список (уроки, начало, конец, предмет, преподаватель, кабинет, пометка)."""
    wd = date.isoweekday()
    by_lesson = {}
    week = week_number(date, schedule, zamena)
    for i, b in enumerate(schedule["days"].get(str(wd), [])):
        if b.get("week", week) != week:
            continue
        for n in b["lessons"]:
            by_lesson[n] = (f"b{i}", b["subject"], b["teacher"], b["room"], "")
    for i, c in enumerate((zamena or {}).get("changes", [])):
        for n in c["lessons"]:
            if c["subject"] == CANCEL:
                if n in by_lesson:
                    by_lesson[n] = (f"x{i}", by_lesson[n][1], by_lesson[n][2], by_lesson[n][3], "ОТМЕНА")
            else:
                old = by_lesson.get(n)
                same = old and old[1] == c["subject"]
                by_lesson[n] = (f"z{i}", c["subject"], old[2] if same else "", c["room"] or (old[3] if same else ""),
                                "замена" + ("?" if c["uncertain"] else ""))
    rows = []
    for n in sorted(by_lesson):
        block, subj, teacher, room, mark = by_lesson[n]
        start, end = lesson_time(bells, wd, n)
        if rows and rows[-1][0] == block and rows[-1][1][-1] == n - 1:
            rows[-1][1].append(n)
            rows[-1][3] = end
        else:
            rows.append([block, [n], start, end, subj, teacher, room, mark])
    return [r[1:] for r in rows]


def main(argv):
    if "--fetch" in argv:
        import scraper
        argv = [a for a in argv if a != "--fetch"]
        sys.argv = sys.argv[:1]
        scraper.main()
    date = dt.date.fromisoformat(argv[0]) if argv else dt.datetime.now(ZoneInfo("Europe/Moscow")).date()
    schedule, bells = load(DATA / "groups" / "11a.json"), load(DATA / "bells.json")
    zpath = DATA / "zameny" / f"{date}.json"
    zamena = load(zpath) if zpath.exists() else None

    print(f"Расписание {schedule['group']} на {date:%d.%m.%Y} ({WEEKDAYS[date.weekday()]}, "
          f"{week_number(date, schedule, zamena)}-я неделя)")
    if date.isoweekday() == 7:
        print("  Воскресенье — занятий нет.")
        return 0
    for lessons, start, end, subj, teacher, room, mark in agenda(date, schedule, bells, zamena):
        who = ", ".join(x for x in (teacher, room) if x)
        print(f"  {start}-{end}  {subj}" + (f" ({who})" if who else "") + (f"  [{mark}]" if mark else ""))
    print()
    if zamena is None:
        print("Замены: на этот день пока не опубликованы (или scraper.py их ещё не скачал).")
    elif zamena.get("po_raspisaniyu"):
        print("Замены: нет, занятия по расписанию.")
    else:
        state = f"для 11-А строк: {len(zamena['changes'])}" if zamena["ocr_ok"] else "таблицу распознать не удалось"
        print(f"Замены опубликованы, {state}. Картинка: " + ", ".join(i["url"] for i in zamena["images"]))
        if zamena.get("ocr_uncertain"):
            print("  Внимание: часть текста распознана неуверенно — сверьтесь с картинкой.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
