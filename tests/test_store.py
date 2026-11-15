"""The run store indexes run folders, keeps each run's verdict, and the rules file round-trips."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from agrisim.store import RunStore
from agrisim.verdict import Facts, Rules, load_rules, save_rules

RULES_FILE = Path(__file__).resolve().parents[1] / "configs" / "verdict_rules.yaml"


def _run(root: Path, name: str, rmse: float, seed: int = 7) -> Path:
    run_dir = root / name
    run_dir.mkdir(parents=True)
    metrics = {
        "seed": seed,
        "policy": "planned_survey",
        "map": {"rmse": rmse, "dry_f1": 0.7, "dry_recall": 0.5, "truth_dry_fraction": 0.04},
        "run": {"plant_contacts": 0, "probes_used": 20, "valid_probes": 20},
    }
    (run_dir / "metrics.json").write_text(json.dumps(metrics), encoding="utf-8")
    return run_dir


def test_defaults_are_the_former_constants() -> None:
    """The values that were constants in write_debrief.py: every stored verdict depends on them."""
    rules = load_rules(RULES_FILE)
    assert rules.rules == Rules(
        max_plant_contacts=0,
        max_rmse=0.035,
        min_dry_recall=0.30,
        min_dry_f1=0.60,
        min_probe_success=0.80,
        dry_area_to_judge=0.01,
    )
    assert rules.version == 1


def test_backfill_and_old_verdicts_survive_a_rules_change(tmp_path: Path) -> None:
    rules = load_rules(RULES_FILE)
    _run(tmp_path, "20261113T125402Z_seed7", rmse=0.030)
    _run(tmp_path, "check/20261014T163444Z_seed42", rmse=0.040, seed=42)
    (tmp_path / "bench_x").mkdir()
    (tmp_path / "bench_x" / "metrics.json").write_text("{}", encoding="utf-8")  # not a run

    store = RunStore(tmp_path)
    assert store.backfill(rules) == 2
    assert store.backfill(rules) == 0  # already indexed
    first, second = store.runs()  # newest first
    assert first["id"] == "20261113T125402Z_seed7" and first["verdict"] == "SUCCESS"
    assert first["created"] == "2026-11-13T12:54:02+00:00"
    assert second["id"] == "check/20261014T163444Z_seed42" and second["verdict"] == "PARTIAL"
    assert "map error" in second["why"] and second["seed"] == 42

    stricter = save_rules(
        tmp_path / "verdict_rules.yaml",
        rules,
        rules.rules.model_copy(update={"max_rmse": 0.025}),
        "Auenchanters",
        "tighter map",
    )
    assert stricter.version == 2 and "max_rmse 0.035 -> 0.025" in stricter.changes[-1].note
    assert load_rules(tmp_path / "verdict_rules.yaml") == stricter

    new_id = store.add(_run(tmp_path, "app/20261114T090000Z_seed7", rmse=0.030), stricter, "x")
    assert store.get(new_id)["verdict"] == "PARTIAL"  # type: ignore[index]
    assert store.get("20261113T125402Z_seed7")["verdict"] == "SUCCESS"  # type: ignore[index]
    assert store.get(new_id)["rules_version"] == 2  # type: ignore[index]


def test_unknown_ids_have_no_folder(tmp_path: Path) -> None:
    store = RunStore(tmp_path)
    assert store.get("../secrets") is None
    assert store.folder("../secrets") is None


def test_rules_are_validated() -> None:
    with pytest.raises(ValidationError):
        Rules(
            max_plant_contacts=-1,
            max_rmse=0.035,
            min_dry_recall=0.3,
            min_dry_f1=0.6,
            min_probe_success=1.5,
            dry_area_to_judge=0.01,
        )


def test_plant_contact_limit_comes_from_the_rules() -> None:
    rules = load_rules(RULES_FILE).rules
    metrics = {"map": {"rmse": 0.02}, "run": {"plant_contacts": 1}}
    assert Facts.from_metrics(rules, metrics).verdict == "FAIL"
    lenient = rules.model_copy(update={"max_plant_contacts": 1})
    assert Facts.from_metrics(lenient, metrics).verdict == "SUCCESS"
