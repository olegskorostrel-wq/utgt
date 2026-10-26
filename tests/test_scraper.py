"""Тесты на сохранённых с сайта страницах и картинках замен (октябрь 2026).

    python -m pytest tests -q
"""
import json
import shutil
from pathlib import Path

import pytest

import scraper

FIX = Path(__file__).parent / "fixtures"
needs_tesseract = pytest.mark.skipif(shutil.which("tesseract") is None, reason="нет tesseract")


def test_parse_page_finds_ochnoe_block():
    blocks = scraper.parse_page((FIX / "zamena_page_2026-10-26.html").read_text(encoding="utf-8"))
    assert [(b["date"], b["section"]) for b in blocks] == [("2026-10-27", "ochnoe"), ("2026-10-27", "zaochnoe")]
    assert blocks[0]["images"] == ["https://utgt-pgups.ru/images/27.10.2026.png"]
    assert blocks[1]["images"] == ["https://utgt-pgups.ru/images/27.10_26Z.png"]


@pytest.mark.parametrize("text,expected", [
    ("11-А", ("11-А", True)), ("2]1-А", ("21-А", True)), ("11-7", ("11-Д", True)),
    ("21-С©", ("21-С", True)), ("11", (None, False)), ("и", (None, True)), ("", (None, True)),
])
def test_normalize_group(text, expected):
    assert scraper.normalize_group(text) == expected


@pytest.mark.parametrize("text,expected", [
    ("5-6", ([5, 6], None)), ("8-30", ([0], "08:30")), ("14-50", ([], "14:50")),
    ("3—", ([3, 4], None)), ("5-10", ([5, 6, 7, 8, 9, 10], None)),
])
def test_parse_lessons(text, expected):
    assert scraper.parse_lessons(text) == expected


# Что на картинках на самом деле (проверено глазами)
EXPECTED_11A = {
    "27.10.2026.png": [],
    "26.10.2026.png": [([0], "Разговоры о важном", "1-25")],
    "24.10.2026.png": [([1, 2], "Математика", "1-8"), ([5, 6], "Химия", "2-7"), ([7, 8], "Биология", "2-7")],
    "23.10.2026.png": [([7, 8], "География", "2-7")],
    "19.10.2026.png": [([0], "Разговоры о важном", "1-25"), ([7, 8], "Физика", "2-5")],
}


@needs_tesseract
@pytest.mark.parametrize("name", sorted(EXPECTED_11A))
def test_ocr_finds_11A(name):
    t = scraper.ocr_table(FIX / name, scraper.subject_vocab())
    assert t["ok"]
    got = [(c["lessons"], c["subject"], c["room"]) for c in scraper.group_changes(t)]
    assert got == EXPECTED_11A[name]
    assert not t["uncertain_course1"]


@needs_tesseract
def test_ocr_reads_all_groups_27_10():
    t = scraper.ocr_table(FIX / "27.10.2026.png", scraper.subject_vocab())
    groups = []
    for r in t["rows"]:
        if not groups or groups[-1] != r["group"]:
            groups.append(r["group"])
    assert groups == ["11-В", "11-Л", "21-Д", "21-С", "31-Д", "41-П", "41-А", "41-С"]
    assert t["title"] == "Вторник, 2-я неделя"


@needs_tesseract
def test_process_block_writes_json_and_skips_unchanged(tmp_path):
    png = (FIX / "24.10.2026.png").read_bytes()

    class Resp:
        content = png
        def raise_for_status(self):
            pass

    class Session:
        calls = 0
        def get(self, url, **kw):
            Session.calls += 1
            return Resp()

    block = {"date": "2026-10-24", "section": "ochnoe", "images": ["https://utgt-pgups.ru/images/24.10.2026.png"]}
    logs = []
    assert scraper.process_block(block, Session(), scraper.subject_vocab(), tmp_path, logs.append)
    meta = json.loads((tmp_path / "2026-10-24.json").read_text(encoding="utf-8"))
    assert meta["ocr_ok"] and len(meta["changes"]) == 3
    assert (tmp_path / "2026-10-24-1.png").read_bytes() == png
    # та же картинка — повторно не распознаём и файл не трогаем
    assert not scraper.process_block(block, Session(), scraper.subject_vocab(), tmp_path, logs.append)
    import datetime as dt
    scraper.write_index(tmp_path, today=dt.date(2026, 10, 26))
    assert json.loads((tmp_path / "index.json").read_text(encoding="utf-8"))["days"] == ["2026-10-24"]
    scraper.write_index(tmp_path, today=dt.date(2026, 12, 1))  # старше 21 дня — удаляется
    assert not (tmp_path / "2026-10-24.json").exists()
