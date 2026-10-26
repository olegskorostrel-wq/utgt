"""
Склеивает: базовое расписание 11-А + время звонков + (если доступно)
ссылку на картинку замены за сегодня. Выводит агенду на день.

Запуск: python today_agenda.py
"""

import json
import datetime
from pathlib import Path

from scraper import fetch_page, parse_zamena_entries, get_ochnoe_entries, find_entry_for_date

DATA_DIR = Path(__file__).parent / "data"

WEEKDAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", None]  # вс = None


def load_json(name: str) -> dict:
    with open(DATA_DIR / name, encoding="utf-8") as f:
        return json.load(f)


def print_today(group_data: dict, bells: dict, zamena_image: str | None, no_zamena: bool):
    today = datetime.date.today()
    weekday_idx = today.weekday()  # 0=пн ... 6=вс
    day_key = WEEKDAY_KEYS[weekday_idx]

    print(f"Расписание на {today:%d.%m.%Y} ({group_data['group']})")

    if day_key is None:
        print("Сегодня воскресенье — занятий нет.")
        return

    bell_set = bells["monday"] if day_key == "monday" else bells["tue_wed_thu_fri_sat"]

    if day_key == "monday":
        zp = bell_set["zero_period"]
        print(f"  {zp['start']}-{zp['end']}  {zp['label']}")

    pairs = group_data["days"].get(day_key, [])
    if not pairs:
        print("  Пар нет (по базовому расписанию).")

    for p in pairs:
        t = bell_set["pairs"].get(str(p["pair"]))
        time_str = f"{t['start']}-{t['end']}" if t else "??:??-??:??"
        if "lessons" in p:
            names = " / ".join(f"{l['subject']} ({l['teacher']}, {l['room']})" for l in p["lessons"])
            print(f"  {time_str}  {names}")
        else:
            subj = p["subject"] or "—"
            teacher = p["teacher"] or ""
            room = p["room"] or ""
            print(f"  {time_str}  {subj} ({teacher}, {room})")

    print()
    if no_zamena:
        print("Замены: не опубликованы — сайт ещё не выложил изменения на сегодня.")
    elif zamena_image:
        print(f"⚠ Есть замены на сегодня, сверь картинку: {zamena_image}")
    else:
        print("Замен нет — занятия по расписанию выше.")


if __name__ == "__main__":
    schedule = load_json("schedule_11A.json")
    bells = load_json("bells.json")

    zamena_image = None
    no_zamena = True
    try:
        html = fetch_page()
        entries = get_ochnoe_entries(parse_zamena_entries(html))
        today = datetime.date.today()
        entry = find_entry_for_date(entries, today.day, today.month, today.year)
        if entry is not None:
            no_zamena = False
            zamena_image = entry.image_url  # None если "по расписанию"
    except Exception as e:
        print(f"[не удалось получить замены: {e}]\n")

    print_today(schedule, bells, zamena_image, no_zamena)
