"""Failed insertions as censored readings ("drier than the threshold").

Censoring is opt-in (`mapping.censored`); with it unset every run stays byte-identical, so the
first test pins that default.
"""

from pathlib import Path

import numpy as np
import pytest
from scipy.stats import truncnorm

from agrisim.config import CensoredConfig, SimConfig, load
from agrisim.mapping import GridSpec, KrigingMapper
from agrisim.sensor import ProbeReading
from agrisim.sim import run_survey

ROOT = Path(__file__).resolve().parents[1]
CENSORED = CensoredConfig(threshold=0.20, min_readings=3, sigma_floor=0.01)


def _kriging(cfg: SimConfig, censored: CensoredConfig | None) -> KrigingMapper:
    return KrigingMapper(cfg.mapping.model_copy(update={"censored": censored}))


def test_failed_probes_are_ignored_by_default(cfg: SimConfig) -> None:
    m = _kriging(cfg, None)
    m.update(ProbeReading(1.0, 1.0, 0.0, 0.30, True))
    m.update(ProbeReading(2.0, 1.0, 0.0, None, False))
    m.update(ProbeReading(3.0, 1.0, 0.0, 0.30, True))
    assert np.allclose(m.xyz[:, 2], [0.30, 0.30])


def test_censored_probe_lands_at_the_truncated_normal_mean(cfg: SimConfig) -> None:
    values = [0.28, 0.30, 0.26, 0.29]
    m = _kriging(cfg, CENSORED)
    for i, v in enumerate(values):
        m.update(ProbeReading(float(i), 1.0, 0.0, v, True))
    m.update(ProbeReading(9.0, 1.0, 0.0, None, False))
    added = float(m.xyz[-1, 2])

    mu = float(np.mean(values))
    sd = float(np.std(values, ddof=1))
    expected = truncnorm.mean(a=-np.inf, b=(CENSORED.threshold - mu) / sd, loc=mu, scale=sd)
    assert added == pytest.approx(expected, abs=1e-12)
    assert added < CENSORED.threshold  # "drier than the threshold", never wetter


def test_censored_probe_never_exceeds_the_threshold(cfg: SimConfig) -> None:
    m = _kriging(cfg, CENSORED)
    for i, v in enumerate([0.02, 0.03, 0.02]):  # a prior far below the threshold
        m.update(ProbeReading(float(i), 1.0, 0.0, v, True))
    m.update(ProbeReading(9.0, 1.0, 0.0, None, False))
    assert float(m.xyz[-1, 2]) < CENSORED.threshold


def test_too_few_readings_falls_back_one_sigma_below(cfg: SimConfig) -> None:
    m = _kriging(cfg, CENSORED)
    m.update(ProbeReading(1.0, 1.0, 0.0, None, False))
    assert float(m.xyz[0, 2]) == pytest.approx(CENSORED.threshold - CENSORED.sigma_floor)


def test_a_failure_in_a_dry_patch_moves_the_estimate_drier() -> None:
    """A dry patch nobody could probe: the failure is the only evidence there is."""
    truth = 0.13  # the patch the probe could not enter
    grid = GridSpec(20, 10, 1.0)
    readings = [
        (float(x), float(y), 0.22 + 0.005 * (x % 2) + 0.005 * (y % 2))
        for x in (5, 9, 13, 17)
        for y in (1, 5)
    ]
    out = {}
    for name, censored in (("off", None), ("on", CENSORED)):
        m = _kriging(load(ROOT / "configs" / "demo.yaml"), censored)
        for x, y, v in readings:
            m.update(ProbeReading(x, y, 0.0, v, True))
        m.update(ProbeReading(2.0, 5.0, 0.0, None, False))  # failed inside the patch
        mean, _ = m.estimate(grid)
        out[name] = float(mean[5, 2])
    assert out["on"] < out["off"]  # "drier than the threshold" pulls it down
    assert abs(out["on"] - truth) < abs(out["off"] - truth)  # and towards the truth


@pytest.mark.parametrize("seed", [0, 1])
def test_harsh_world_runs_with_censoring(seed: int) -> None:
    """The agribench harsh world (failures in dry soil) completes and stays plant-safe."""
    cfg = load(ROOT / "benchmarks" / "v1" / "worlds" / "harsh.yaml")
    assert cfg.probe.hard_soil is not None
    threshold = cfg.probe.hard_soil.hard_below
    mapping = cfg.mapping.model_copy(update={"censored": CensoredConfig(threshold=threshold)})
    censored = cfg.model_copy(update={"mapping": mapping})
    first = run_survey(cfg, seed, "moisture_seeker", budget=12)
    second = run_survey(censored, seed, "moisture_seeker", budget=12)
    assert second.run_metrics.plant_contacts == 0
    assert second.map_metrics.rmse > 0
    assert second.map_metrics.rmse != first.map_metrics.rmse  # the mode is actually used
