import dataclasses

import numpy as np
import pytest

from agrisim.config import SimConfig
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
