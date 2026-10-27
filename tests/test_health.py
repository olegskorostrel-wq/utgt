"""Мониторинг автопроверки: задача о сбое после 3 неудач подряд и закрытие после успеха."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import health as H  # noqa: E402

OK, BAD = {"scrape": True, "news": True}, {"scrape": False, "news": True}


def run(results_seq):
    state, actions = {}, []
    for i, r in enumerate(results_seq):
        state, a = H.update(state, r, f"t{i}")
        actions.append(a)
    return state, actions


def test_single_failures_do_not_alert():
    _, actions = run([BAD, OK, BAD, BAD, OK])
    assert actions == [None] * 5


def test_three_in_a_row_opens_once_then_closes():
    state, actions = run([BAD, BAD, BAD, BAD, BAD, OK, OK])
    assert actions == [None, None, "open", None, None, "close", None]
    assert state["failures"] == 0 and not state["issue_open"]


def test_state_remembers_since_and_what_failed():
    state, _ = run([OK, BAD, {"scrape": False, "news": False}])
    assert state["failures"] == 2 and state["since"] == "t1" and state["failing"] == ["scrape", "news"]
