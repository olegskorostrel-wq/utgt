"""Скачивает страницу «Замена уроков» УТЖТ, сохраняет картинки замен
(очное отделение) и распознаёт в них строки для группы 11-А.

Результат: data/zameny/<YYYY-MM-DD>.json + картинки data/zameny/<YYYY-MM-DD>-<n>.png
и сводный data/zameny/index.json, который читает сайт.

    python scraper.py                 # живой сайт
    python scraper.py --html page.html --offline   # разбор сохранённой страницы
    python scraper.py --ocr картинка.png           # распознать одну картинку
"""
import argparse
import datetime as dt
import difflib
import hashlib
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

import numpy as np
import requests
from bs4 import BeautifulSoup
from PIL import Image

URL = "https://utgt-pgups.ru/ochnoe-zaochnoe-otdelenie/58-zamena-zanyatij.html"
GROUP = "11-А"
TZ = ZoneInfo("Europe/Moscow")  # Ухта живёт по московскому времени
ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT / "data" / "zameny"
KEEP_DAYS = 21

MONTHS = {m: i + 1 for i, m in enumerate(
    "января февраля марта апреля мая июня июля августа сентября октября ноября декабря".split())}

# Все группы очного отделения из шапки расписания на семестр
KNOWN_GROUPS = ["11-П", "11-Д", "11-А", "11-С", "11-В", "11-Л",
                "21-П", "21-Д", "21-А", "21-С", "21-Л",
                "31-П", "31-Д", "31-А", "31-С",
                "41-П", "41-Д", "41-А", "41-С"]
# Как tesseract путает буквы групп. «Д» на мелких картинках часто читается как 1 или 7.
LETTER_FIX = {"п": "П", "д": "Д", "1": "Д", "7": "Д", "а": "А", "a": "А", "с": "С",
              "c": "С", "©": "С", "в": "В", "b": "В", "л": "Л"}

CANCEL = "Отменить"
EXTRA_SUBJECTS = [CANCEL, "Разговоры о важном", "Химия", "Обществознание", "Биология",
                  "Физическая культура", "Русский язык", "Литература", "История",
                  "История России", "География", "Информатика", "Математика", "Физика",
                  "Иностранный язык (английский)", "Иностранный язык (немецкий)",
                  "Основы безопасности и защиты Родины", "Индивидуальный проект"]

UA = {"User-Agent": "Mozilla/5.0 (utgt-11A schedule bot; +https://github.com/utgt-11a/utgt-11a.github.io)"}


# ---------- разбор HTML ----------

def parse_page(html, base_url=URL):
    """Возвращает [{date, section, images}] в порядке страницы."""
    soup = BeautifulSoup(html, "html.parser")
    body = soup.select_one(".com-content-article__body") or soup.select_one("[itemprop=articleBody]")
    if body is None:
        raise ValueError("на странице не найден блок статьи")
    today = dt.datetime.now(TZ).date()
    blocks, date, section = [], None, None
    for el in body.find_all(["p", "div", "h1", "h2", "h3", "h4", "img"]):
        if el.name == "img":
            if date and section:
                src = urljoin(base_url, el.get("src", "").split("#")[0])
                key = (date, section)
                if not blocks or (blocks[-1]["date"], blocks[-1]["section"]) != key:
                    blocks.append({"date": date, "section": section, "images": []})
                if src not in blocks[-1]["images"]:
                    blocks[-1]["images"].append(src)
            continue
        if el.find(["p", "div"]):
            continue  # берём только листовые абзацы, чтобы текст не дублировался
        text = " ".join(el.get_text(" ").split()).lower()
        m = re.search(r"на\s+(\d{1,2})\s+([а-я]+)(?:\s+(\d{4}))?", text)
        if m and m.group(2) in MONTHS:
            year = int(m.group(3)) if m.group(3) else today.year
            date = dt.date(year, MONTHS[m.group(2)], int(m.group(1))).isoformat()
            section = None
        if "заочн" in text:
            section = "zaochnoe"
        elif "очн" in text:
            section = "ochnoe"
        if "по расписанию" in text and date and section:
            # вместо картинки написано «по расписанию» — замен в этот день нет
            if not blocks or (blocks[-1]["date"], blocks[-1]["section"]) != (date, section):
                blocks.append({"date": date, "section": section, "images": []})
    return blocks


# ---------- распознавание таблицы ----------

def _runs(mask):
    out, start = [], None
    for i, v in enumerate(list(mask) + [False]):
        if v and start is None:
            start = i
        elif not v and start is not None:
            out.append((start, i))
            start = None
    return out


def _tesseract(img, psm):
    with tempfile.NamedTemporaryFile(suffix=".png") as f:
        img.save(f.name)
        r = subprocess.run(["tesseract", f.name, "-", "-l", "rus", "--psm", str(psm)],
                           capture_output=True, text=True, check=True)
    return " ".join(r.stdout.split())


def normalize_group(text):
    """'11-А' / '11-7' / '21-С©' -> ('11-А'|..., ok). None, если в ячейке нет группы."""
    s = re.sub(r"[\]\[|)(}{'\".,]", "", text)
    s = re.sub(r"[\s—–_]+", "-", s.strip())
    m = re.search(r"([1-4])1-*(\S)", s)
    if not m:
        return None, not re.search(r"\d", text)
    letter = LETTER_FIX.get(m.group(2), LETTER_FIX.get(m.group(2).lower(), m.group(2).upper()))
    group = f"{m.group(1)}1-{letter}"
    return (group, True) if group in KNOWN_GROUPS else (group, False)


def parse_lessons(text):
    """'5-6' -> ([5, 6], None); '8-30' -> ([0], '08:30') ; '3' -> ([3], None)."""
    t = text.replace("—", "-").replace("–", "-").replace(":", "-")
    nums = [int(n) for n in re.findall(r"\d{1,2}", t)]
    if len(nums) >= 2:
        a, b = nums[0], nums[1]
        if b > 10:  # это время начала, а не номера уроков
            time = f"{a:02d}:{b:02d}"
            return ([0] if time == "08:30" else []), time
        if 1 <= a <= b <= 10:
            return list(range(a, b + 1)), None
    if len(nums) == 1 and re.search(r"\d\s*-\s*$", t) and nums[0] % 2 == 1:
        return [nums[0], nums[0] + 1], None  # «3-» — вторая цифра не распозналась
    if len(nums) == 1 and 1 <= nums[0] <= 10:
        return [nums[0]], None
    return [], None


def snap_subject(text, vocab):
    if not text:
        return text, True
    best = difflib.get_close_matches(text, vocab, n=1, cutoff=0.75)
    if best:
        return best[0], True
    if difflib.SequenceMatcher(None, text.lower()[:9], CANCEL.lower()).ratio() > 0.7:
        return CANCEL, True
    if text.lower().startswith(("разгов", "разтов", "разговоры")):
        return "Разговоры о важном", True
    return text, False


def ocr_table(path, vocab=EXTRA_SUBJECTS):
    """Находит сетку таблицы и распознаёт её построчно, ячейка за ячейкой."""
    im = Image.open(path).convert("L")
    ink = np.array(im) < 128
    hlines = [(s + e) // 2 for s, e in _runs(ink.mean(1) > 0.5)]
    if len(hlines) < 3:
        return {"ok": False, "error": "таблица не найдена", "rows": []}
    band = ink[hlines[0]:hlines[-1]]
    vlines = [(s + e) // 2 for s, e in _runs(band.mean(0) > 0.6)]
    if len(vlines) < 4:
        return {"ok": False, "error": "не найдены столбцы таблицы", "rows": []}
    row_h = np.median(np.diff(hlines))
    scale = max(3, int(round(66 / max(row_h, 1))))

    def cell(x0, x1, y0, y1, psm, k=None):
        c = im.crop((x0 + 2, y0 + 2, x1 - 1, y1 - 1))
        dark = (np.array(c) < 128).mean() if c.width > 4 and c.height > 4 else 0
        if dark < 0.004:
            return "", dark
        k = k or scale
        c = c.resize((c.width * k, c.height * k), Image.LANCZOS)
        return _tesseract(c, psm), dark

    title, rows, in_table, group, uncertain = "", [], False, None, False
    for y0, y1 in zip(hlines, hlines[1:]):
        if y1 - y0 < 8:
            continue
        texts = [cell(x0, x1, y0, y1, 6 if i == 2 else 7) for i, (x0, x1) in enumerate(zip(vlines, vlines[1:]))]
        raw = [t for t, _ in texts]
        joined = " ".join(raw).lower()
        if not in_table:
            if "недел" in joined:
                title = next(t for t in raw if "недел" in t.lower())
            if "урок" in joined and ("групп" in joined or "трупп" in joined):
                in_table = True
            continue
        g_text, g_dark = texts[0]
        g, g_ok = normalize_group(g_text)
        for k in (3, 5, 2):  # мелкие картинки: пробуем другой масштаб
            if g and g_ok or not g_text:
                break
            g2, ok2 = normalize_group(cell(vlines[0], vlines[1], y0, y1, 7, k)[0])
            if g2 and (ok2 or not g):
                g, g_ok = g2, ok2
        row_uncertain = False
        if g:
            group = g
            row_uncertain = not g_ok
        elif not g_ok:
            # в ячейке группы что-то написано, но прочитать не вышло:
            # не приписываем строку предыдущей группе молча
            group, row_uncertain = "?", True
        lessons, time = parse_lessons(raw[1] if len(raw) > 1 else "")
        subject = raw[2] if len(raw) > 2 else ""
        room = raw[3] if len(raw) > 3 else ""
        if not re.search(r"\d-\d", room):
            m = re.search(r"\s*[|\]]?\s*(\d-\d{1,2})\s*$", subject)
            room = m.group(1) if m else ""
            if m:
                subject = subject[:m.start()]
        subject = subject.strip(" |]")
        subject, s_ok = snap_subject(subject, vocab)
        if not lessons and not time:
            row_uncertain = True
        rows.append({"group": group, "lessons": lessons, "time": time, "subject": subject,
                     "room": room, "uncertain": row_uncertain or not s_ok, "raw": raw})
        uncertain |= row_uncertain and (group or "").startswith(("1", "?"))
    return {"ok": in_table and bool(rows), "title": title, "rows": rows,
            "uncertain_course1": uncertain,
            "error": None if in_table else "не найдена шапка таблицы"}


def group_changes(table, group=GROUP):
    return [{k: r[k] for k in ("lessons", "time", "subject", "room", "uncertain")}
            for r in table["rows"] if r["group"] == group]


def all_group_changes(tables):
    """Строки замен по всем группам: {"21-С": [...], ...}; «?» — группа не распозналась."""
    out = {}
    for t in tables:
        for r in t["rows"]:
            if r["group"]:
                out.setdefault(r["group"], []).append(
                    {k: r[k] for k in ("lessons", "time", "subject", "room", "uncertain")})
    return out


# ---------- сохранение ----------

def subject_vocab():
    names = set()
    for path in [ROOT / "data" / "schedule_11A.json", *sorted((ROOT / "data" / "groups").glob("*.json"))]:
        sched = json.loads(path.read_text(encoding="utf-8"))
        names |= {l["subject"] for day in sched.get("days", {}).values() for l in day}
    return sorted(names | set(EXTRA_SUBJECTS))


def process_block(block, session, vocab, out_dir=OUT_DIR, log=print):
    """Скачивает картинки дня, распознаёт, пишет <date>.json. True, если что-то изменилось."""
    date = block["date"]
    out_dir.mkdir(parents=True, exist_ok=True)
    meta_path = out_dir / f"{date}.json"
    old = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else None

    images, blobs = [], []
    for i, url in enumerate(block["images"], 1):
        r = session.get(url, timeout=60, headers=UA)
        r.raise_for_status()
        blobs.append(r.content)
        images.append({"url": url, "file": f"{date}-{i}.png", "sha1": hashlib.sha1(r.content).hexdigest()})
    if old and [i["sha1"] for i in old["images"]] == [i["sha1"] for i in images]:
        log(f"{date}: без изменений")
        return False

    tables, changes = [], []
    for img, blob in zip(images, blobs):
        (out_dir / img["file"]).write_bytes(blob)
        t = ocr_table(out_dir / img["file"], vocab)
        tables.append(t)
        changes += group_changes(t)
    meta = {
        "date": date,
        "group": GROUP,
        "source": URL,
        "fetched_at": dt.datetime.now(TZ).isoformat(timespec="minutes"),
        "images": images,
        "title": next((t["title"] for t in tables if t.get("title")), ""),
        "po_raspisaniyu": not images,
        "ocr_ok": all(t["ok"] for t in tables),
        "ocr_uncertain": any(t.get("uncertain_course1") for t in tables) or any(c["uncertain"] for c in changes),
        "groups_in_order": sorted({r["group"] for t in tables for r in t["rows"] if r["group"]}),
        "changes": changes,
        "all_changes": all_group_changes(tables),
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"{date}: {len(images)} картинок, для {GROUP}: {len(changes)} строк, ocr_ok={meta['ocr_ok']}")
    return True


def reprocess(out_dir=OUT_DIR, vocab=None, log=print):
    """Заново распознать уже сохранённые картинки (после улучшений OCR)."""
    vocab = vocab or subject_vocab()
    for path in sorted(out_dir.glob("????-??-??.json")):
        meta = json.loads(path.read_text(encoding="utf-8"))
        if not meta["images"]:
            continue
        tables = [ocr_table(out_dir / i["file"], vocab) for i in meta["images"]]
        changes = [c for t in tables for c in group_changes(t)]
        meta.update(title=next((t["title"] for t in tables if t.get("title")), "") or meta.get("title", ""),
                    ocr_ok=all(t["ok"] for t in tables),
                    ocr_uncertain=any(t.get("uncertain_course1") for t in tables) or any(c["uncertain"] for c in changes),
                    groups_in_order=sorted({r["group"] for t in tables for r in t["rows"] if r["group"]}),
                    changes=changes, all_changes=all_group_changes(tables))
        path.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
        log(f"{meta['date']}: групп с заменами {len(meta['all_changes'])}, для {GROUP}: {len(changes)}")


def write_index(out_dir=OUT_DIR, today=None):
    today = today or dt.datetime.now(TZ).date()
    for p in out_dir.glob("*-*-*.*"):
        d = p.name[:10]
        try:
            if (today - dt.date.fromisoformat(d)).days > KEEP_DAYS:
                p.unlink()
        except ValueError:
            pass
    days = sorted(json.loads(p.read_text(encoding="utf-8"))["date"] for p in out_dir.glob("????-??-??.json"))
    index = {"group": GROUP, "source": URL, "days": days}
    old = (out_dir / "index.json").read_text(encoding="utf-8") if (out_dir / "index.json").exists() else ""
    new = json.dumps(index, ensure_ascii=False, indent=1)
    if old != new:
        (out_dir / "index.json").write_text(new, encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--html", help="разобрать сохранённую страницу вместо скачивания")
    ap.add_argument("--offline", action="store_true", help="только показать найденные блоки")
    ap.add_argument("--ocr", help="распознать одну картинку и вывести таблицу")
    ap.add_argument("--reprocess", action="store_true", help="заново распознать сохранённые картинки")
    args = ap.parse_args()

    if args.reprocess:
        reprocess()
        return 0

    if args.ocr:
        t = ocr_table(args.ocr, subject_vocab())
        print(json.dumps({**t, "changes_11A": group_changes(t)}, ensure_ascii=False, indent=1))
        return 0

    session = requests.Session()
    if args.html:
        html = Path(args.html).read_text(encoding="utf-8")
    else:
        r = session.get(URL, timeout=60, headers=UA)
        r.raise_for_status()
        r.encoding = "utf-8"
        html = r.text
    blocks = parse_page(html)
    ochnoe = [b for b in blocks if b["section"] == "ochnoe"]
    print("на странице:", ", ".join(f"{b['date']} ({b['section']}, {len(b['images'])} карт.)" for b in blocks) or "ничего")
    if not ochnoe:
        print("ВНИМАНИЕ: замены для очного отделения не найдены — возможно, поменялась вёрстка", file=sys.stderr)
    if args.offline:
        return 0
    vocab = subject_vocab()
    for b in ochnoe:
        process_block(b, session, vocab)
    write_index()
    return 0


if __name__ == "__main__":
    sys.exit(main())
