"""The AI agronomist must not contradict the telemetry it is given.

`scripts/` is not an installed package, so the module is loaded from its path.
"""

import importlib.util
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

ADVISOR = Path(__file__).resolve().parents[1] / "scripts" / "agri_advisor.py"


@pytest.fixture(scope="module")
def advisor() -> ModuleType:
    spec = importlib.util.spec_from_file_location("agri_advisor", ADVISOR)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _metrics(**overrides: Any) -> dict[str, Any]:
    """A run like runs/20261031T163618Z_seed42_1 (dry F1 0.51, no plant touched)."""
    values: dict[str, Any] = {
        "policy": "moisture_seeker",
        "map": {
            "rmse": 0.0309,
            "dry_f1": 0.505,
            "dry_recall": 0.466,
            "calibration_95": 0.993,
            "truth_dry_fraction": 0.0429,
        },
        "run": {
            "plant_contacts": 0,
            "probes_used": 52,
            "valid_probes": 52,
            "path_length_m": 1250.95,
            "mission_time_s": 3290.6,  # 54.84 minutes
            "lane_coverage": 0.727,
        },
    }
    for key, value in overrides.items():
        section, field = key.split("__")
        values[section][field] = value
    return values


def test_verdict_is_computed_not_guessed(advisor: ModuleType) -> None:
    partial = advisor.Facts.from_metrics(_metrics())
    assert partial.verdict == "PARTIAL"  # no plant touched, but dry F1 is below 0.60
    assert advisor.Facts.from_metrics(_metrics(map__dry_f1=0.72, map__rmse=0.02)).verdict == (
        "SUCCESS"
    )
    assert advisor.Facts.from_metrics(_metrics(run__plant_contacts=1)).verdict == "FAIL"
    assert advisor.Facts.from_metrics(_metrics(run__plant_contacts=0)).probe_success == 1.0


def test_prompt_carries_the_verdict_and_forbids_invention(advisor: ModuleType) -> None:
    facts = advisor.Facts.from_metrics(_metrics())
    prompt = advisor.generate_prompt(facts, [{"x_m": "4.0", "y_m": "5.0", "value_vwc": "0.161"}])
    assert "Mission verdict: PARTIAL" in prompt
    assert "Plant contacts: 0" in prompt
    assert "do not invent" in prompt.lower()
    assert "Share of the lanes driven: 73%" in prompt
    assert "Pos(4.0, 5.0)" in prompt


def test_report_that_claims_a_plant_contact_is_rejected(advisor: ModuleType) -> None:
    facts = advisor.Facts.from_metrics(_metrics())
    bad = (
        "### Mission Status\n**Success**\nDespite not achieving 0 plant contacts as initially "
        "required, the mission completed."
    )
    problems = advisor.validate_report(bad, facts)
    assert any("plant contact" in p for p in problems)
    good = "### Mission Status\n**PARTIAL**\nNo plant was touched."
    assert advisor.validate_report(good, facts) == []


def test_invented_duration_is_rejected(advisor: ModuleType) -> None:
    facts = advisor.Facts.from_metrics(_metrics())
    problems = advisor.validate_report(
        "The mission took 54.84 minutes, slightly beyond the desired maximum of 40 minutes.", facts
    )
    assert problems and "40" in problems[0]
    assert advisor.validate_report("The mission took 54.84 minutes.", facts) == []


def test_render_puts_the_computed_status_first_and_flags_bad_prose(advisor: ModuleType) -> None:
    facts = advisor.Facts.from_metrics(_metrics())
    text = advisor.render_report(facts, "The field is healthy.", ["claims a plant contact"])
    assert text.startswith("# Executive Agronomist Mission Debrief")
    assert "**Mission status: PARTIAL**" in text
    assert "The field is healthy." in text
    assert "Validation notes" in text and "claims a plant contact" in text
    clean = advisor.render_report(facts, "The field is healthy.", [])
    assert "Validation notes" not in clean
