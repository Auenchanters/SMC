from pathlib import Path

import numpy as np

from agrisim.config import SimConfig, WeatherConfig, load
from agrisim.sensor import ProbeReading
from agrisim.sim import run_survey
from agrisim.weather import bring_forward, current_view, rain_mm

RAIN = Path(__file__).resolve().parents[1] / "configs" / "scenarios" / "rain_shower.yaml"


def test_scenario_extends_the_demo_config(cfg: SimConfig) -> None:
    rain = load(RAIN)
    assert rain.field == cfg.field and rain.rover == cfg.rover
    assert rain.weather is not None and rain.weather.rain
    assert rain.probe.bad_contact_prob > 0 and rain.probe.noise_std == cfg.probe.noise_std


def test_rain_wets_the_soil_and_sun_dries_it() -> None:
    w = load(RAIN).weather
    assert w is not None
    e = w.rain[0]
    assert rain_mm(w, e.start_s, e.start_s + e.duration_s) == e.rate_mm_per_h * e.duration_s / 3600
    clip = (0.05, 0.45)
    wet = bring_forward(w, 0.2, 0, e.start_s + e.duration_s, clip)
    assert wet > 0.2 + 0.5 * rain_mm(w, 0, e.start_s + e.duration_s) / 1000 / w.layer_depth
    dry = WeatherConfig(**{**w.model_dump(), "rain": ()})
    assert bring_forward(dry, 0.2, 0, 3600, clip) < 0.2


def test_truth_changes_with_the_weather_and_is_deterministic() -> None:
    cfg = load(RAIN)
    a = run_survey(cfg, 3, "fixed_spacing", budget=8)
    b = run_survey(cfg, 3, "fixed_spacing", budget=8)
    assert np.array_equal(a.truth_grid, b.truth_grid) and a.readings == b.readings
    before, after = a.truth_at(0).grid, a.truth_at(1300).grid
    assert (after - before).mean() > 0.01  # the shower soaked in
    assert (after - before).std() > 0.001  # but not evenly


def test_current_view_drops_superseded_and_failed_readings() -> None:
    old = ProbeReading(1.0, 1.0, 0.0, 0.20, True)
    failed = ProbeReading(5.0, 1.0, 5.0, None, False)
    new = ProbeReading(1.15, 1.0, 10.0, 0.30, True)
    assert current_view([old, failed, new], None, 10.0, (0.05, 0.45)) == [new]
    assert current_view([new, ProbeReading(1.0, 1.0, 20.0, None, False)], None, 20, (0, 1)) == [new]


def test_rover_rechecks_doubtful_spots_without_touching_plants() -> None:
    cfg = load(RAIN)
    for policy, budget in (("recheck", 30), ("fixed_plus_recheck", 60)):
        res = run_survey(cfg, 7, policy, budget=budget)
        xy = np.array([(r.x, r.y) for r in res.readings])
        again = sum(bool((np.hypot(*(xy[:i] - xy[i]).T) < 0.5).any()) for i in range(len(xy)))
        assert again >= 1, policy
        assert res.run_metrics.probes_used == budget
        assert res.run_metrics.plant_contacts == 0
