"""Данные расписаний без явных ошибок: пустых предметов, накладок, странных кабинетов и имён, опечаток."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import check_data  # noqa: E402


def test_schedules_have_no_errors():
    groups = check_data.load_groups()
    errors, _, subjects = check_data.check_schedules(groups, set())
    assert errors == []
    assert check_data.typo_words(subjects) == []


def test_typo_detector_finds_letter_swaps():
    assert check_data.typo_words(["Безопасность жизнедеятельности", "Техническая безопансость"]) == [
        ("безопансость", "безопасность")]
