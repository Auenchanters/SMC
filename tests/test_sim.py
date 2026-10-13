import json
from pathlib import Path

from typer.testing import CliRunner

from agrisim.cli import app
from agrisim.config import SimConfig
from agrisim.io import metrics_dict, new_dir, save_run
from agrisim.sim import run_survey

FILES = {
    "config.yaml",
    "metrics.json",
    "truth.npy",
    "estimate.npy",
    "variance.npy",
    "probes.csv",
    "path.csv",
    "maps.png",
}


def test_cli_run_headless_writes_all_files(tmp_path: Path, demo_path: Path) -> None:
    args = ["run", "--config", str(demo_path), "--seed", "7", "--out", str(tmp_path)]
    res = CliRunner().invoke(app, args)
    assert res.exit_code == 0, res.output
    (run_dir,) = tmp_path.iterdir()
    assert run_dir.name.endswith("_seed7")
    assert {p.name for p in run_dir.iterdir()} >= FILES
    metrics = json.loads((run_dir / "metrics.json").read_text(encoding="utf-8"))
    assert metrics["run"]["plant_contacts"] == 0
    assert metrics["run"]["lane_coverage"] == 1.0
    assert metrics["run"]["probes_used"] == 60  # demo.yaml probe_budget
    # A second run with the same seed gets its own folder and identical metrics.
    assert CliRunner().invoke(app, args).exit_code == 0
    a, b = sorted(tmp_path.iterdir())
    assert a.name != b.name
    assert (a / "metrics.json").read_bytes() == (b / "metrics.json").read_bytes()


def test_same_seed_same_metrics(cfg: SimConfig) -> None:
    a, b = run_survey(cfg, 3, budget=20), run_survey(cfg, 3, budget=20)
    assert metrics_dict(a) == metrics_dict(b)
    assert metrics_dict(a) != metrics_dict(run_survey(cfg, 4, budget=20))


def test_rerun_recording_written(cfg: SimConfig, tmp_path: Path) -> None:
    out = new_dir(tmp_path, "rr")
    result = run_survey(cfg, 1, rerun=True, budget=8, rrd_path=out / "recording.rrd", spawn=False)
    save_run(result, out)
    rrd = out / "recording.rrd"
    assert rrd.exists() and rrd.stat().st_size > 10_000
