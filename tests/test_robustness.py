"""Regression tests for the robustness review (HANDOVER section 5, ExecPlan Surprises, M11+).

Each test names the finding it covers (#n in the review's table).
"""

import copy
import math
import re
import socket
from pathlib import Path
from typing import Any

import numpy as np
import pytest
import yaml
from pydantic import ValidationError
from typer.testing import CliRunner

from agrisim.bench import parse_seeds
from agrisim.cli import app
from agrisim.config import RoverConfig, SimConfig
from agrisim.control import densify
from agrisim.field import FieldLayout
from agrisim.metrics import lane_coverage
from agrisim.sim import run_survey
from agrisim.view3d import make_server
from agrisim.viz import colorize, map_ranges

DEMO = Path(__file__).resolve().parents[1] / "configs" / "demo.yaml"
MODEL = Path(__file__).resolve().parents[1] / "models" / "ppo_v1" / "model.zip"


def demo(**changes: Any) -> dict[str, Any]:
    """The demo config as a dict, with `section__key=value` changes (or `dt=...`)."""
    d: dict[str, Any] = copy.deepcopy(yaml.safe_load(DEMO.read_text(encoding="utf-8")))
    for path, v in changes.items():
        sec, _, key = path.partition("__")
        if key:
            d[sec][key] = v
        else:
            d[sec] = v
    return d


def invalid(d: dict[str, Any], text: str) -> None:
    with pytest.raises(ValidationError, match=text):
        SimConfig.model_validate(d)


def test_1_clearance_includes_the_tracking_allowance() -> None:
    # Validation used to accept this; the rover then touched plants 34 times on seed 7.
    tight = demo(rover__length=0.8, rover__safety_margin=0.0, field__row_spacing=1.0)
    invalid({**tight, "field": {**tight["field"], "headland": 1.5}}, "tracking allowance")
    assert RoverConfig.model_validate(demo()["rover"]).tracking_allowance == pytest.approx(
        0.0435, abs=5e-4
    )


def test_1_rover_at_the_new_limit_touches_nothing() -> None:
    d = demo(rover__length=0.8, rover__safety_margin=0.0)
    slack = RoverConfig.model_validate(d["rover"]).tracking_allowance
    r, f = d["rover"], d["field"]
    f["row_spacing"] = r["width"] + 2 * slack + 2 * f["canopy_radius_max"] + 1e-6
    f["headland"] = 2 * (math.hypot(0.2, 0.4) + slack + f["canopy_radius_max"]) + 1e-6
    for seed in (0, 7):
        assert run_survey(SimConfig.model_validate(d), seed, budget=10).contacts == ()


def test_2_long_time_steps_are_refused_and_turns_never_overshoot() -> None:
    invalid({**demo(), "dt": 1.0}, "dt 1.0 s is too long")
    from agrisim.control import PurePursuit
    from agrisim.rover import RoverState

    pp = PurePursuit(RoverConfig.model_validate(demo()["rover"]))
    v, w = pp.command(RoverState(0, 0, 0), (0, 0), (0, 1), dt=1.0)  # needs +90 deg
    assert v == 0 and w * 1.0 <= math.pi / 2 + 1e-9


def test_3_coverage_and_contacts_see_between_samples() -> None:
    lay = FieldLayout.generate(SimConfig.model_validate(demo()).field, np.random.default_rng(0))
    (x0, y), (x1, _) = lay.lanes[0].coords
    sparse = np.array([(x, y, 0.0) for x in np.arange(x0, x1 + 1e-9, 0.25)])  # 0.25 m apart
    assert lane_coverage(sparse, lay) < 1 / len(lay.lanes) + 1e-9
    assert lane_coverage(sparse, lay) > 0.99 / len(lay.lanes)
    dense, src = densify(sparse)
    assert np.hypot(*np.diff(dense[:, :2], axis=0).T).max() <= 0.05 + 1e-9
    assert src[0] == 0 and src[-1] == len(sparse) - 1


def test_4_grids_need_two_cells() -> None:
    invalid(demo(soil__grid_resolution=30.0), "too coarse")
    invalid(demo(mapping__output_resolution=30.0), "too coarse")


def test_5_huge_correlation_lengths_are_refused() -> None:
    invalid(demo(soil__corr_length_range=[1000.0, 2000.0]), "soil grid too large")


def test_6_18_env_actions_fixed_by_config_and_masked_near_plants() -> None:
    from agrisim.env import AdaptiveProbingEnv

    cfg = SimConfig.model_validate(demo(field__stem_keepout=0.7))
    env = AdaptiveProbingEnv(cfg, budget=5)
    for s in (1, 2, 3):
        env.reset(seed=s)
        mask = env.action_masks()
        assert len(mask) == env.n_sites and 0 < mask.sum() < env.n_sites
    blocked = int(np.flatnonzero(~env.action_masks())[0])
    with pytest.raises(ValueError, match="masked"):
        env.step(np.int64(blocked))
    with pytest.raises(ValueError, match="out of range"):
        env.step(np.int64(-1))  # 15


def test_18_config_with_no_usable_site_is_a_clean_error() -> None:
    from agrisim.env import AdaptiveProbingEnv

    env = AdaptiveProbingEnv(SimConfig.model_validate(demo(field__stem_keepout=5.0)), budget=5)
    with pytest.raises(ValueError, match="no probe site"):
        env.reset(seed=0)


def test_9_repeated_seeds_are_refused() -> None:
    with pytest.raises(ValueError, match="more than once"):
        parse_seeds("0-2,1")


def test_11_17_impossible_numbers_are_refused() -> None:
    invalid(demo(soil__vwc_clip=[-0.1, 0.45]), "within \\[0, 1\\]")
    invalid(demo(probe__bias=float("nan")), "finite")
    invalid(demo(field__length_x=float("inf")), "finite")


def test_12_zero_probe_time_has_no_division_by_zero() -> None:
    cfg = SimConfig.model_validate(demo(probe__insertion_time_s=0.0))
    with np.errstate(divide="raise", invalid="raise"):
        run_survey(cfg, 1, "greedy_variance_per_cost", budget=4)


def test_13_14_flat_field_gives_finite_observations_and_colours() -> None:
    from agrisim.env import ObsBuilder
    from agrisim.mapping import GridSpec

    cfg = SimConfig.model_validate(demo(soil__std_vwc=0.0, soil__vwc_clip=[0.2, 0.2]))
    grid = GridSpec.for_field(cfg.field, cfg.mapping.output_resolution)
    z = np.zeros((grid.ny, grid.nx))
    assert np.isfinite(ObsBuilder(cfg, grid, 5).build(z, z, np.zeros((0, 2)), (1, 1), 0, 0)).all()
    for cmap, lo, hi in map_ranges(cfg).values():
        assert hi > lo
        colorize(z, cmap, lo, hi)


def test_16_large_field_sites_use_little_memory() -> None:
    cfg = SimConfig.model_validate(demo(field__length_x=300.0, field__width_y=200.0))
    lay = FieldLayout.generate(cfg.field, np.random.default_rng(0))
    assert len(lay.candidate_probe_sites(1.0)) > 40_000  # was a 70 GB distance matrix


runner = CliRunner()


def cli(*args: str) -> tuple[int, str]:
    res = runner.invoke(app, list(args), terminal_width=400)
    text = re.sub(r"\x1b\[[0-9;]*m", "", res.output)
    return res.exit_code, " ".join(re.sub("[│|]", " ", text).split())  # unwrap the box


def test_8_19_cli_reports_bad_input_cleanly(tmp_path: Path) -> None:
    bad = tmp_path / "bad.yaml"
    bad.write_text("field: [unclosed\n", encoding="utf-8")
    assert cli("run", "--config", str(bad), "--out", str(tmp_path))[0] == 2
    latin = tmp_path / "latin.yaml"
    latin.write_bytes(b"# caf\xe9\nfield: 1\n")
    code, out = cli("run", "--config", str(latin), "--out", str(tmp_path))
    assert code == 2 and "UTF-8" in out
    assert cli("run", "--config", str(DEMO), "--seed", "-1", "--out", str(tmp_path))[0] == 2
    afile = tmp_path / "afile"
    afile.write_text("x", encoding="utf-8")
    code, out = cli("run", "--config", str(DEMO), "--budget", "1", "--out", str(afile))
    assert code == 2 and "is a file" in out
    assert cli("view", str(tmp_path), "--port", "70000")[0] == 2
    for flag in ("--budget", "--n-envs", "--timesteps"):
        assert cli("train", "--config", str(DEMO), flag, "0", "--out", str(tmp_path / "t"))[0] == 2
    assert not (tmp_path / "t").exists()
    assert {p.name for p in tmp_path.iterdir()} == {"bad.yaml", "latin.yaml", "afile"}


def test_7_10_model_checks_before_anything_is_written(tmp_path: Path) -> None:
    code, out = cli("run", "--config", str(DEMO), "--model", str(MODEL), "--out", str(tmp_path))
    assert code == 2 and "only used with --policy ppo" in out
    small = tmp_path / "small.yaml"
    small.write_text(
        yaml.safe_dump(demo(field__length_x=10.0, field__width_y=4.8)), encoding="utf-8"
    )
    code, out = cli(
        "run", "--config", str(small), "--policy", "ppo", "--model", str(MODEL),
        "--out", str(tmp_path / "runs"),
    )  # fmt: skip
    assert code == 2 and "was trained for a different field" in out
    junk = tmp_path / "junk.zip"
    junk.write_bytes(b"not a model")
    code, out = cli(
        "run", "--config", str(DEMO), "--policy", "ppo", "--model", str(junk),
        "--out", str(tmp_path / "runs"),
    )  # fmt: skip
    assert code == 2 and "not a MaskablePPO model" in out
    assert not (tmp_path / "runs").exists()


def test_bench_accepts_full_coverage_alias(tmp_path: Path) -> None:
    code, out = cli(
        "bench", "--config", str(DEMO), "--seeds", "0", "--budget", "3",
        "--strategies", "full_coverage", "--out", str(tmp_path),
    )  # fmt: skip
    assert code == 0, out
    assert "fixed_spacing" in out


def test_19_busy_port_is_refused(tmp_path: Path) -> None:
    first = make_server(tmp_path)
    try:
        port = first.server_address[1]
        with pytest.raises(OSError):
            make_server(tmp_path, port)
    finally:
        first.server_close()
    with socket.socket() as s:  # and the port is free again afterwards
        s.bind(("127.0.0.1", port))
