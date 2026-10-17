"""agribench: the scoring maths, the anti-cheating checks and an end-to-end smoke run."""

import ast
import dataclasses
import json
import shutil
from pathlib import Path

import numpy as np
import pytest
import yaml
from scipy import integrate, stats
from typer.testing import CliRunner

import agrisim.sim as sim
from agrisim import mapping, policies
from agrisim.cli import app
from agrisim.config import SimConfig
from agrisim.metrics import ORACLES, crps_gaussian, dry_f1
from agrisim.sensor import MoistureProbe
from agrisim.soil import SoilTruth
from agrisim.suite import (
    CANDIDATE,
    FAIL_ON,
    Solution,
    SuiteRow,
    _regression,
    fails,
    fresh_seeds,
    holm,
    load_suite,
    lock_problems,
    normalised,
    win_rate,
)

SUITE = Path(__file__).resolve().parents[1] / "benchmarks" / "v1"


# --- Scoring maths ---------------------------------------------------------------------------


@pytest.mark.parametrize(("mu", "sd", "y"), [(0.2, 0.03, 0.25), (0.3, 0.01, 0.3), (0.1, 0.1, -0.2)])
def test_crps_matches_its_definition(mu: float, sd: float, y: float) -> None:
    """CRPS = integral of (F(x) - 1{x >= y})^2 over x (Gneiting & Raftery 2007)."""

    def integrand(x: float) -> float:
        return float((stats.norm.cdf(x, mu, sd) - (x >= y)) ** 2)

    lo, hi = min(mu, y) - 12 * sd, max(mu, y) + 12 * sd
    want = (
        integrate.quad(integrand, lo, y, limit=200)[0]
        + integrate.quad(integrand, y, hi, limit=200)[0]
    )
    got = crps_gaussian(np.array([y]), np.array([mu]), np.array([sd**2]))
    assert got == pytest.approx(want, rel=1e-6, abs=1e-9)


def test_wide_bands_do_not_buy_a_better_score() -> None:
    """Coverage can be gamed by a huge variance; CRPS cannot."""
    rng = np.random.default_rng(0)
    truth = rng.normal(0.25, 0.05, 2000)
    mean = truth + rng.normal(0, 0.02, truth.size)
    honest = crps_gaussian(truth, mean, np.full(truth.size, 0.02**2))
    inflated = crps_gaussian(truth, mean, np.full(truth.size, 0.2**2))
    assert inflated > 2 * honest
    point = crps_gaussian(truth, mean, np.full(truth.size, np.nan))  # no variance: |error|
    assert point == pytest.approx(float(np.abs(truth - mean).mean()))


def test_dry_f1_is_defined_on_every_field() -> None:
    t = np.array([0.1, 0.3, 0.3])
    assert dry_f1(t, np.array([0.1, 0.3, 0.3]), 0.18) == 1.0
    assert dry_f1(t, np.array([0.3, 0.3, 0.3]), 0.18) == 0.0  # missed the dry cell: 0, not NaN
    assert dry_f1(np.full(3, 0.3), np.full(3, 0.3), 0.18) == 1.0  # nothing dry, none claimed
    assert dry_f1(np.full(3, 0.3), np.array([0.1, 0.3, 0.3]), 0.18) == 0.0
    assert dry_f1(t, np.array([0.1, 0.1, 0.3]), 0.18) == pytest.approx(2 / 3)


def test_normalised_score() -> None:
    floor, ceil = np.array([0.04, 0.04]), np.array([0.02, 0.02])
    assert float(normalised(np.array([0.03, 0.03]), floor, ceil, lower=True)) == pytest.approx(50)
    assert float(normalised(ceil, floor, ceil, lower=True)) == pytest.approx(100)
    assert float(normalised(floor, floor, ceil, lower=True)) == 0.0
    higher = normalised(np.array([0.6]), np.array([0.2]), np.array([1.0]), lower=False)
    assert float(higher) == pytest.approx(50)
    assert np.isnan(normalised(floor, floor, floor, lower=True))  # no gap: says nothing
    boot = normalised(np.ones((3, 4)), np.full((3, 4), 2.0), np.zeros((3, 4)), lower=True)
    assert boot.shape == (3,)


def test_holm_and_win_rate() -> None:
    assert holm([0.01, 0.04, 0.03]) == pytest.approx([0.03, 0.06, 0.06])
    assert holm([0.5]) == [0.5]
    a, b = np.array([1.0, 2.0, 3.0, 4.0]), np.array([2.0, 2.0, 1.0, 5.0])
    assert win_rate(a, b, lower=True) == pytest.approx((1 + 0.5 + 0 + 1) / 4)


def test_fail_levels_are_ordered() -> None:
    assert FAIL_ON["hard"] < FAIL_ON["sota"] < FAIL_ON["saturation"]
    assert fails("below_saturation", "saturation")
    assert not fails("below_saturation", "sota")
    assert not fails("saturated", "saturation")


# --- Anti-cheating ---------------------------------------------------------------------------


def test_fresh_seeds_are_new_and_reproducible() -> None:
    a, b = fresh_seeds("abc", "demo_b30", 64), fresh_seeds("abd", "demo_b30", 64)
    assert a == fresh_seeds("abc", "demo_b30", 64)
    assert len(set(a)) == 64
    assert not set(a) & set(b)
    assert not set(a) & set(fresh_seeds("abc", "v2_b30", 64))
    assert min(a + b) >= 2**31  # never a training seed (env.py draws below 2**31 - 1)


def test_frozen_benchmark_matches_its_lock() -> None:
    assert lock_problems(SUITE) == []


def test_lock_catches_an_edited_world(tmp_path: Path) -> None:
    root = tmp_path / "v1"
    shutil.copytree(SUITE, root)
    world = root / "worlds" / "demo.yaml"
    world.write_text(world.read_text(encoding="utf-8").replace("0.02", "0.01"), encoding="utf-8")
    (root / "worlds" / "extra.yaml").write_text("extends: demo.yaml\n", encoding="utf-8")
    assert lock_problems(root) == ["worlds/demo.yaml: changed", "worlds/extra.yaml: not in LOCK"]


def test_entry_cannot_be_an_oracle_or_move_the_goalposts() -> None:
    for name in ORACLES:
        with pytest.raises(ValueError, match="oracle"):
            Solution(strategy=name)
    for key in ("dry_threshold", "output_resolution"):
        with pytest.raises(ValueError, match="mapping may only set"):
            Solution(strategy="random", mapping={key: 0.5})
    Solution(strategy="random", mapping={"variogram_model": "spherical"})


def _names(module: object) -> set[str]:
    tree = ast.parse(Path(str(getattr(module, "__file__", ""))).read_text(encoding="utf-8"))
    out: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            out.add(node.id)
        elif isinstance(node, ast.Attribute):
            out.add(node.attr)
        elif isinstance(node, ast.ImportFrom):
            out |= {node.module or ""} | {a.name for a in node.names}
    return out


def test_policies_and_mappers_never_name_the_truth() -> None:
    banned = {
        "SoilTruth",
        "SoilDynamics",
        "Truth",
        "truth",
        "truth_at",
        "truth_grid",
        "truth_on_grid",
        "ClairvoyantOracle",
        "agrisim.soil",
        "agrisim.metrics",
        "agrisim.sim",
    }
    for module in (policies, mapping):
        assert not _names(module) & banned, module


def _seen(res: sim.RunResult) -> tuple[list[tuple[float, float, float | None]], bytes]:
    """What a run shows of itself: its readings, and the map it made from them."""
    return [(r.x, r.y, r.value) for r in res.readings], res.mean.tobytes() + res.var.tobytes()


def _seen_with_hidden_truth_swapped(
    cfg: SimConfig, strategy: str, monkeypatch: pytest.MonkeyPatch
) -> tuple[list[tuple[float, float, float | None]], bytes]:
    """Run with the truth everyone but the probe sees replaced by noise. A strategy that reads
    the truth by any route then sees noise and chooses differently."""
    real: list[SoilTruth] = []
    generate, read = SoilTruth.generate, MoistureProbe.read

    def fake_generate(*args: object, **kwargs: object) -> SoilTruth:
        truth = generate(*args, **kwargs)  # type: ignore[arg-type]
        real.append(truth)
        noise = np.random.default_rng(99).uniform(0.05, 0.45, truth.grid.shape)
        return dataclasses.replace(truth, grid=noise.astype(np.float32))

    def honest_read(self: MoistureProbe, truth: SoilTruth, *args: object) -> object:
        return read(self, real[-1], *args)  # type: ignore[arg-type]

    monkeypatch.setattr(sim.SoilTruth, "generate", fake_generate)
    monkeypatch.setattr(MoistureProbe, "read", honest_read)
    res = sim.run_survey(cfg, 5, strategy, budget=10)
    monkeypatch.undo()
    return _seen(res)


@pytest.mark.parametrize("strategy", [*policies.STRATEGIES, *ORACLES])
def test_strategies_see_readings_only(
    cfg: SimConfig, strategy: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    normal = _seen(sim.run_survey(cfg, 5, strategy, budget=10))
    swapped = _seen_with_hidden_truth_swapped(cfg, strategy, monkeypatch)
    if strategy in ORACLES:
        assert swapped[0] != normal[0]  # the oracle reads the truth: the check can see a leak
    else:
        assert swapped == normal  # same readings and the same map: neither saw the truth


def test_oracle_ceiling_beats_random_floor(cfg: SimConfig) -> None:
    from agrisim.suite import score_at_deadline

    def rmse(strategy: str, seed: int) -> float:
        res = sim.run_survey(cfg, seed, strategy, budget=15)
        return score_at_deadline(res, 1e9, cfg.mapping.dry_threshold)["rmse"]

    seeds = range(200, 204)
    assert np.mean([rmse("oracle_rmse", s) for s in seeds]) < np.mean(
        [rmse("random", s) for s in seeds]
    )


# --- End to end ------------------------------------------------------------------------------


def _mini_suite(tmp_path: Path) -> Path:
    root = tmp_path / "v1"
    shutil.copytree(SUITE / "worlds", root / "worlds")
    spec = yaml.safe_load((SUITE / "suite.yaml").read_text(encoding="utf-8"))
    spec |= {
        "baselines": ["fixed_spacing", "random", "greedy_variance_per_cost"],
        "oracles": ["oracle_rmse"],
        "ppo_model": None,
        "bootstrap": 50,
        "public_seeds": {"quick": "200-204", "full": "200-204"},
        "fresh_seeds": {"quick": 3, "full": 3},
        "tasks": [
            {
                "name": "tiny",
                "world": "worlds/demo.yaml",
                "budget": 6,
                "deadline_s": 400,
                "quick": True,
            },
        ],
    }
    (root / "suite.yaml").write_text(yaml.safe_dump(spec), encoding="utf-8")
    assert CliRunner().invoke(app, ["suite", "--suite", str(root), "--write-lock"]).exit_code == 0
    return root


def test_suite_end_to_end(tmp_path: Path) -> None:
    root = _mini_suite(tmp_path)
    sol = tmp_path / "solution.yaml"
    sol.write_text("strategy: greedy_variance\n", encoding="utf-8")
    base = ["suite", "--suite", str(root), "--solution", str(sol), "--fresh-key", "k"]
    res = CliRunner().invoke(app, [*base, "--out", str(tmp_path / "a"), "--update-baseline"])
    assert res.exit_code in (0, 1), res.output
    (out,) = (tmp_path / "a").iterdir()
    report = json.loads((out / "report.json").read_text(encoding="utf-8"))
    assert report["gates"]["hard"]["passed"], report["gates"]["hard"]
    assert not report["gates"]["regression"]["checked"]  # no baseline existed yet
    rows = (out / "rows.csv").read_text(encoding="utf-8").strip().splitlines()
    assert len(rows) == 1 + (5 + 3) * 5  # (public + fresh seeds) x (entry, 3 baselines, oracle)
    assert "tiny" in (out / "report.md").read_text(encoding="utf-8")
    brief = (out / "brief.md").read_text(encoding="utf-8")  # the next agent's input
    for part in ("`greedy_variance`", "## Gates still failing", "global accuracy", "--fresh-key"):
        assert part in brief
    board = report["leaderboard"]
    if board:  # empty only if no ceiling was clearly above the floor on these few fields
        assert board["random"] == 0.0  # the floor scores 0 by definition
        assert CANDIDATE in board
    assert (root / "baseline.json").is_file()

    # Same entry, same key: identical scores, and the ratchet now finds nothing to flag.
    res2 = CliRunner().invoke(app, [*base, "--out", str(tmp_path / "b"), "--fail-on", "hard"])
    assert res2.exit_code == 0, res2.output
    (out2,) = (tmp_path / "b").iterdir()
    report2 = json.loads((out2 / "report.json").read_text(encoding="utf-8"))
    assert report2["gates"]["regression"]["checked"]
    assert report2["gates"]["regression"]["passed"]
    for k in ("overall", "tasks"):
        assert report2[k] == report[k]

    gate = CliRunner().invoke(app, ["gate", str(out2 / "report.json"), "--fail-on", "hard"])
    assert gate.exit_code == 0, gate.output

    # Editing a frozen world is a hard failure until the lock is rewritten.
    world = root / "worlds" / "demo.yaml"
    world.write_text(world.read_text(encoding="utf-8") + "\n# edited\n", encoding="utf-8")
    res3 = CliRunner().invoke(app, [*base, "--out", str(tmp_path / "c"), "--fail-on", "hard"])
    assert res3.exit_code == 1
    assert "HARD FAIL" in res3.output


def _row(strategy: str, seed: int, rmse: float) -> SuiteRow:
    return SuiteRow(
        "t", "public", seed, strategy, rmse, 0, rmse, rmse, 0.95, 0.5, 10, 10, 1, 1, 0, 0
    )


@pytest.mark.parametrize("oracle_gap", [0.01, 0.0])  # a usable ceiling, and none
def test_ratchet_catches_a_real_regression(oracle_gap: float) -> None:
    spec = load_suite(SUITE).model_copy(update={"metrics": {"rmse": "lower"}})
    seeds = list(range(200, 212))
    noise = np.random.default_rng(1).normal(0, 1e-4, len(seeds))
    rows = [_row("random", s, 0.04) for s in seeds]
    rows += [_row("oracle_rmse", s, 0.04 - oracle_gap) for s in seeds]
    rows += [_row(CANDIDATE, s, 0.035 + e) for s, e in zip(seeds, noise, strict=True)]
    old = {"suite_version": spec.version, "tasks": {"t": {"seeds": seeds, "rmse": [0.03] * 12}}}
    (item,) = _regression(spec, rows, old, None)["items"]
    assert item["regressed"], item
    same = {"suite_version": spec.version, "tasks": {"t": {"seeds": seeds, "rmse": [0.035] * 12}}}
    (item,) = _regression(spec, rows, same, None)["items"]
    assert not item["regressed"], item
