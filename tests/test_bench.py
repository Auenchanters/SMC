from pathlib import Path

from typer.testing import CliRunner

from agrisim.bench import mean_ci95, parse_seeds, run_benchmark
from agrisim.cli import app
from agrisim.config import SimConfig
from agrisim.policies import STRATEGIES


def test_parse_seeds() -> None:
    assert parse_seeds("0-3") == [0, 1, 2, 3]
    assert parse_seeds("1,5,9") == [1, 5, 9]
    assert parse_seeds("0-1,7") == [0, 1, 7]


def test_mean_ci95() -> None:
    mean, half, n = mean_ci95([1.0, 2.0, 3.0, float("nan")])
    assert (mean, n) == (2.0, 3)
    assert 2.4 < half < 2.5  # t(0.975, 2) * 1 / sqrt(3) = 2.484


def test_bench_three_seeds(tmp_path: Path, demo_path: Path) -> None:
    args = ["bench", "--config", str(demo_path), "--seeds", "0-2", "--budget", "8"]
    res = CliRunner().invoke(app, [*args, "--out", str(tmp_path)])
    assert res.exit_code == 0, res.output
    (out,) = tmp_path.iterdir()
    rows = (out / "results.csv").read_text(encoding="utf-8").strip().splitlines()
    assert len(rows) == 1 + 3 * len(STRATEGIES)
    summary = (out / "summary.md").read_text(encoding="utf-8")
    for s in STRATEGIES:
        assert s in summary
    plant_line = next(line for line in summary.splitlines() if line.startswith("| plant_contacts"))
    assert plant_line.count("| 0 +/- 0") == len(STRATEGIES)


def test_parallel_matches_serial(cfg: SimConfig) -> None:
    jobs = (cfg, [0, 1], 6, ["fixed_spacing", "greedy_variance_per_cost"])
    assert repr(run_benchmark(*jobs, workers=1)) == repr(run_benchmark(*jobs, workers=2))
