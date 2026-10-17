import dataclasses

import numpy as np
import pytest

from agrisim.config import HardSoilConfig, SimConfig
from agrisim.field import FieldLayout
from agrisim.sensor import MoistureProbe, ProbeReading
from agrisim.soil import SoilTruth

N = 4000


def _setup(cfg: SimConfig) -> tuple[SoilTruth, np.random.Generator]:
    rng = np.random.default_rng(0)
    layout = FieldLayout.generate(cfg.field, rng)
    return SoilTruth.generate(cfg.soil, layout, rng), rng


def test_error_converges_to_bias_and_noise(cfg: SimConfig) -> None:
    truth, rng = _setup(cfg)
    probe = MoistureProbe(cfg.probe.model_copy(update={"failure_prob": 0.0}))
    x, y = 15.0, float(truth.y_centres[40])
    true = truth.mean_over_disc(x, y, cfg.probe.footprint_radius)
    vals = np.array([probe.read(truth, x, y, 0.0, rng).value for _ in range(N)], dtype=float)
    err = vals - true
    se = cfg.probe.noise_std / np.sqrt(N)
    assert err.mean() == pytest.approx(cfg.probe.bias, abs=4 * se + cfg.probe.resolution)
    assert err.std() == pytest.approx(cfg.probe.noise_std, rel=0.05)
    # Quantised to the sensor resolution.
    assert np.allclose(np.round(vals / cfg.probe.resolution) * cfg.probe.resolution, vals)


def test_failure_rate(cfg: SimConfig) -> None:
    truth, rng = _setup(cfg)
    probe = MoistureProbe(cfg.probe.model_copy(update={"failure_prob": 0.1}))
    reads = [probe.read(truth, 10.0, 5.0, 0.0, rng) for _ in range(N)]
    fails = [r for r in reads if not r.valid]
    assert all(r.value is None for r in fails)
    assert len(fails) / N == pytest.approx(0.1, abs=4 * np.sqrt(0.1 * 0.9 / N))


def test_reading_has_no_truth_field() -> None:
    names = {f.name for f in dataclasses.fields(ProbeReading)}
    assert names == {"x", "y", "t", "value", "valid", "sensor_id"}


def _flat(truth: SoilTruth, vwc: float) -> SoilTruth:
    return dataclasses.replace(truth, grid=np.full_like(truth.grid, vwc))


def test_hard_dry_soil_fails_and_reads_low_more_often(cfg: SimConfig) -> None:
    truth, rng = _setup(cfg)
    hard = HardSoilConfig(
        hard_below=0.2, width=0.01, fail_prob=0.6, partial_prob=0.5, partial_drop=0.05
    )
    c = cfg.probe.model_copy(update={"failure_prob": 0.01, "noise_std": 0.0, "bias": 0.0})
    probe = MoistureProbe(c.model_copy(update={"hard_soil": hard}))
    for vwc, fail_rate, low_rate in ((0.35, 0.01, 0.0), (0.10, 0.6, 0.5)):
        reads = [probe.read(_flat(truth, vwc), 10.0, 5.0, 0.0, rng) for _ in range(N)]
        ok = [r.value for r in reads if r.valid and r.value is not None]
        assert 1 - len(ok) / N == pytest.approx(fail_rate, abs=0.03)
        assert np.mean(np.array(ok) < vwc - 0.01) == pytest.approx(low_rate, abs=0.04)


def test_soil_dependent_failures_off_by_default(cfg: SimConfig) -> None:
    truth, _ = _setup(cfg)
    assert cfg.probe.hard_soil is None
    got = MoistureProbe(cfg.probe).read(truth, 10.0, 5.0, 0.0, np.random.default_rng(3))
    rng = np.random.default_rng(3)
    u, noise = rng.random(), rng.normal(0.0, cfg.probe.noise_std)  # the same two draws
    raw = truth.mean_over_disc(10.0, 5.0, cfg.probe.footprint_radius) + cfg.probe.bias + noise
    res = cfg.probe.resolution
    assert u >= cfg.probe.failure_prob  # this draw is a success, so the value is comparable
    assert got.value == pytest.approx(round(raw / res) * res)


def test_along_row_position_error(cfg: SimConfig) -> None:
    from agrisim.sim import run_survey

    exact = run_survey(cfg, 2, budget=10).readings
    rover = cfg.rover.model_copy(update={"along_row_error_std": 0.3})
    noisy = run_survey(cfg.model_copy(update={"rover": rover}), 2, budget=10).readings
    dx = np.array([b.x - a.x for a, b in zip(exact, noisy, strict=True)])
    assert [a.y for a in exact] == [b.y for b in noisy]  # the lane is known exactly
    assert [a.value for a in exact] == [b.value for b in noisy]  # same probe, same soil
    assert 0.1 < dx.std() < 0.6
