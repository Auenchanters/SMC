"""The physical soil-water model (weather.water_balance): intake, runoff, drainage, drying, drip."""

from pathlib import Path

import numpy as np
import pytest
from pydantic import ValidationError

from agrisim.config import SOIL_TEXTURES, IrrigationEvent, PhysicalSoilConfig, WeatherConfig, load
from agrisim.field import FieldLayout
from agrisim.sim import run_survey, world_rngs
from agrisim.soil import SoilTruth
from agrisim.weather import (
    SoilDynamics,
    _spread,
    bring_forward,
    et0_rate,
    irrigation_rate,
    water_balance,
)

SCENARIOS = Path(__file__).resolve().parents[1] / "configs" / "scenarios"
DEPTH = 0.10


def soil(texture: str = "sandy_loam", **kw: object) -> PhysicalSoilConfig:
    return PhysicalSoilConfig.model_validate({"texture": texture, "et0_mm_per_day": 5.0, **kw})


@pytest.mark.parametrize("texture", sorted(SOIL_TEXTURES))
def test_every_texture_has_ordered_limits_and_drains_to_field_capacity(texture: str) -> None:
    p = soil(texture)
    wp, fc = p.limits()
    ts = p.hydraulics()[0]
    assert 0.03 < wp < fc < ts < 0.6
    v = np.array([ts])
    for _ in range(48):  # two days after saturation, no sun: the textbook meaning of capacity
        v = water_balance(v, 0.0, 0.0, 1.0, DEPTH, p)
    # The 33 kPa convention and two days of free drainage agree to within a few points of VWC.
    assert wp < float(v[0]) < fc + 0.03 and abs(float(v[0]) - fc) < 0.07


def test_sand_drains_faster_than_clay() -> None:
    left = {}
    for texture in ("sand", "clay"):
        p = soil(texture)
        ts = p.hydraulics()[0]
        left[texture] = float(water_balance(np.array([ts]), 0.0, 0.0, 1.0, DEPTH, p)[0]) / ts
    assert left["sand"] < left["clay"] - 0.2


def test_drainage_is_stable_for_any_step_and_never_goes_up() -> None:
    p = soil("sand")
    start = np.linspace(0.02, 0.395, 40)
    one_day = water_balance(start, 0.0, 0.0, 24.0, DEPTH, p)
    in_minutes = start.copy()
    for _ in range(24 * 60):
        in_minutes = water_balance(in_minutes, 0.0, 0.0, 1 / 60, DEPTH, p)
    assert np.all(one_day <= start + 1e-12) and np.all(one_day > 0)
    np.testing.assert_allclose(one_day, in_minutes, atol=1e-9)  # the closed form is exact


def test_no_water_is_created() -> None:
    rng = np.random.default_rng(0)
    for texture in SOIL_TEXTURES:
        p = soil(texture)
        v = rng.uniform(0.05, p.hydraulics()[0], 200)
        supply = rng.uniform(0, 80, 200)
        after = water_balance(v, supply, 0.0, 1 / 60, DEPTH, p)
        assert np.all(after <= v + supply / 60 / (1000 * DEPTH) + 1e-12)
        assert np.all(after <= p.hydraulics()[0])


def test_a_cloudburst_runs_off_heavy_or_crusted_soil() -> None:
    def soaked(texture: str, **kw: object) -> float:
        p = soil(texture, **kw)
        v = np.array([0.30])
        for _ in range(15):  # 15 minutes at 100 mm/h = 25 mm of rain, 0.25 VWC if it all went in
            v = water_balance(v, 100.0, 0.0, 1 / 60, DEPTH, p)
        return float(v[0]) - 0.30

    assert soaked("clay") < 0.5 * soaked("sandy_loam")
    assert soaked("sandy_clay_loam", crust_factor=0.3) < soaked("sandy_clay_loam")
    # dry soil takes water in faster than wet soil (Green-Ampt)
    p = soil("clay")
    dry = water_balance(np.array([0.30]), 100.0, 0.0, 1 / 60, DEPTH, p)[0] - 0.30
    wet = water_balance(np.array([0.45]), 100.0, 0.0, 1 / 60, DEPTH, p)[0] - 0.45
    assert dry > wet


def test_evapotranspiration_follows_the_sun_and_adds_up_to_the_day() -> None:
    p = soil(start_hour=0.0)
    hourly = [et0_rate(p, (h + 0.5) * 3600) for h in range(24)]
    assert hourly[2] == 0.0 and hourly[22] == 0.0 and max(hourly) == pytest.approx(hourly[11])
    assert sum(hourly) == pytest.approx(5.0, rel=0.01)
    flat = soil(diurnal=False)
    assert et0_rate(flat, 0.0) == pytest.approx(5.0 / 24)


def test_drying_slows_in_dry_soil_and_stops_at_the_wilting_point() -> None:
    p = soil()
    wp, fc = p.limits()

    def lost(v: float) -> float:
        return v - float(water_balance(np.array([v]), 0.0, 0.6, 1.0, DEPTH, p)[0])

    moist, stressed = (fc + wp) / 2 + 0.03, wp + 0.02
    assert lost(moist) > 2 * lost(stressed) > 0
    assert lost(wp) == pytest.approx(0.0, abs=1e-6)
    v = np.array([wp + 0.01])
    for _ in range(24 * 30):  # a month of sun: the soil approaches the wilting point, never below
        v = water_balance(v, 0.0, 0.6, 1.0, DEPTH, p)
    assert wp - 0.001 < float(v[0]) < wp + 0.002  # (a trace still drains)


def test_drip_wets_the_rows_not_the_lanes_and_delivers_the_emitters_volume() -> None:
    cfg = load(SCENARIOS / "drip_irrigation.yaml")
    assert cfg.weather is not None and cfg.weather.physical is not None
    rng_field, rng_soil, _, _, rng_weather, _ = world_rngs(3)
    layout = FieldLayout.generate(cfg.field, rng_field)
    start = SoilTruth.generate(cfg.soil, layout, rng_soil)
    dyn = SoilDynamics(start, cfg.weather, cfg.soil.vwc_clip, rng_weather, layout)
    e = cfg.weather.physical.irrigation[0]
    rate = irrigation_rate(cfg.weather.physical, e.start_s, e.start_s + 60, dyn._to_row)
    assert isinstance(rate, np.ndarray)
    litres_per_h = float(rate.sum()) * start.resolution**2  # mm/h x m^2 = L/h
    f = cfg.field
    emitters = len(layout.row_y) * (f.length_x - 2 * f.headland) / e.emitter_spacing
    assert litres_per_h == pytest.approx(emitters * e.emitter_l_per_h, rel=0.03)
    before, after = dyn.at(e.start_s).grid, dyn.at(e.start_s + e.duration_s).grid
    gy = start.y_centres
    on_row = np.abs(gy[:, None] - layout.row_y).min(axis=1) < 0.1
    in_lane = np.abs(gy[:, None] - layout.lane_y).min(axis=1) < 0.1
    planted = (start.x_centres > f.headland + 1) & (start.x_centres < f.length_x - f.headland - 1)
    gain = (after - before)[:, planted]
    assert gain[on_row].mean() > 0.03
    assert abs(gain[in_lane].mean()) < 0.005
    with pytest.raises(ValueError, match="layout"):
        SoilDynamics(start, cfg.weather, cfg.soil.vwc_clip, rng_weather)


def test_sideways_spread_conserves_water_and_stays_bounded() -> None:
    v = np.full((20, 30), 0.2)
    v[10, 15] = 0.4
    out = _spread(v, 0.5, 1.0, 0.25)  # far past the explicit limit: must sub-step
    assert out.sum() == pytest.approx(v.sum())
    assert out.min() >= 0.2 - 1e-12 and out.max() < 0.4 and out[10, 16] > 0.2


def test_physical_scenarios_run_safely_and_repeat_exactly() -> None:
    for name, seed in (("drip_irrigation", 3), ("monsoon_shower", 4), ("cookfarm_fit", 5)):
        cfg = load(SCENARIOS / f"{name}.yaml")
        a = run_survey(cfg, seed, "planned_survey", budget=12)
        b = run_survey(cfg, seed, "planned_survey", budget=12)
        assert a.readings == b.readings and np.array_equal(a.truth_grid, b.truth_grid), name
        assert a.run_metrics.plant_contacts == 0 and np.isfinite(a.map_metrics.rmse), name
        lo, hi = cfg.soil.vwc_clip
        assert lo <= a.truth_grid.min() and a.truth_grid.max() <= hi


def test_cloudburst_soaks_in_unevenly_and_the_rover_forecast_follows() -> None:
    cfg = load(SCENARIOS / "monsoon_shower.yaml")
    assert cfg.weather is not None
    res = run_survey(cfg, 4, "fixed_spacing", budget=8)
    e = cfg.weather.rain[0]
    end = e.start_s + e.duration_s
    before, after = res.truth_at(e.start_s).grid, res.truth_at(end).grid
    gain = float((after - before).mean())
    fell = e.rate_mm_per_h * e.duration_s / 3600 / 1000 / cfg.weather.layer_depth
    assert 0.02 < gain < 0.8 * fell  # it soaked in, but a good part ran off
    assert float((after - before).std()) > 0.005
    mean0 = float(before.mean())
    forecast = bring_forward(cfg.weather, mean0, e.start_s, end, cfg.soil.vwc_clip)
    assert abs(forecast - float(after.mean())) < 0.03


def test_bucket_numbers_are_required_without_the_physical_model() -> None:
    base = {
        "layer_depth": 0.1,
        "infiltration_cv": 0.1,
        "infiltration_corr_length": 2.0,
        "step_s": 60,
    }
    with pytest.raises(ValidationError, match="physical"):
        WeatherConfig.model_validate(base)
    WeatherConfig.model_validate({**base, "physical": {"texture": "loam", "et0_mm_per_day": 4}})
    with pytest.raises(ValidationError, match="wilting point"):
        soil(field_capacity=0.05)
    assert IrrigationEvent.model_fields["emitter_l_per_h"].is_required()
