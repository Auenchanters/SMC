"""Weather during a mission: rain and evapotranspiration change the soil while the rover works.

The soil layer the probe reads is a bucket per grid cell. Each `step_s`:
    rain soaks in (more in some places than others: runoff, crusting),
    evapotranspiration (sun, heat, the plants) takes water out,
    water above field capacity drains down out of the layer.
`SoilDynamics` is the hidden truth over time (only the probe model and metrics read it).
`current_view` is the rover's side: it knows the rain gauge and the same bucket model, but not how
much rain soaked in at each spot, so readings taken before rain become less certain.

With `weather.physical` set, the bucket is replaced by soil physics (`water_balance`):
    intake is limited by a Green-Ampt capacity, so a downpour on wet or sealed soil runs off;
    drainage follows Campbell's K(theta), fast near saturation and almost nil below field capacity;
    evapotranspiration follows the sun and slows as the soil dries (FAO-56 stress coefficient);
    drip irrigation wets a strip along each plant row, and water spreads sideways.
The form is checked against two years of field data (scripts/calibrate_cookfarm.py).
"""

import dataclasses
import math
from collections.abc import Sequence

import numpy as np
import numpy.typing as npt

from agrisim.config import PhysicalSoilConfig, WeatherConfig
from agrisim.field import FieldLayout
from agrisim.sensor import ProbeReading
from agrisim.soil import SoilTruth, gaussian_random_field

FloatArray = npt.NDArray[np.float64]
SUPERSEDE_RADIUS = 0.3  # m: a newer valid reading this close replaces an older one


def rain_mm(cfg: WeatherConfig, t0: float, t1: float) -> float:
    """Rain that fell between mission times t0 and t1 (rain-gauge reading, mm)."""
    total = 0.0
    for e in cfg.rain:
        overlap = min(t1, e.start_s + e.duration_s) - max(t0, e.start_s)
        total += max(0.0, overlap) * e.rate_mm_per_h / 3600
    return total


def raining(cfg: WeatherConfig, t: float) -> float:
    """Rain rate at time t, mm/h."""
    return sum(e.rate_mm_per_h for e in cfg.rain if e.start_s <= t < e.start_s + e.duration_s)


def et0_rate(p: PhysicalSoilConfig, t: float) -> float:
    """Reference evapotranspiration at mission time t, mm/h. With `diurnal`, a half sine from
    06:00 to 18:00 solar time whose area is the day's total; otherwise the daily mean."""
    if not p.diurnal:
        return p.et0_mm_per_day / 24
    hour = (p.start_hour + t / 3600) % 24
    if not 6.0 < hour < 18.0:
        return 0.0
    return p.et0_mm_per_day * math.pi / 24 * math.sin(math.pi * (hour - 6.0) / 12)


def water_balance(
    theta: FloatArray,
    supply_mm_per_h: FloatArray | float,
    et0_mm_per_h: float,
    dt_h: float,
    depth: float,
    p: PhysicalSoilConfig,
) -> FloatArray:
    """One step of the soil layer's water balance. Pure: the same function runs the hidden truth,
    the rover's own forecast and the calibration against field data.

    1. Intake: water arriving at `supply_mm_per_h` soaks in up to the Green-Ampt capacity
       Ks (1 + psi_f (theta_s - theta) / depth), with the wetting front at the layer's depth;
       dry soil takes water faster. The rest, and anything above porosity, runs off.
    2. Drainage: gravity flow at K(theta) = Ks (theta / theta_s)^(2b + 3) (Campbell 1974),
       integrated exactly over the step, so it is stable for any step length.
    3. Evapotranspiration: Kc ET0, cut back in proportion once the soil is drier than the readily
       available water, down to zero at the wilting point (FAO-56, Allen et al. 1998, eq. 84).
    """
    ts, ks, psi_s, b = p.hydraulics()
    wp, fc = p.limits()
    layer_mm = 1000 * depth
    v = np.minimum(np.asarray(theta, dtype=np.float64), ts)
    # 1. intake
    psi_f = psi_s / 100 * (2 * b + 3) / (2 * b + 6)  # wetting-front suction, m (Rawls et al.)
    capacity = ks * p.crust_factor * (1 + psi_f * np.maximum(ts - v, 0.0) / depth)
    v = np.minimum(v + np.minimum(supply_mm_per_h, capacity) * dt_h / layer_mm, ts)
    # 2. drainage: d(theta)/dt = -a theta^n has the closed form below
    n = 2 * b + 3
    a = ks / layer_mm / ts**n
    v = (np.maximum(v, 1e-6) ** (1 - n) + (n - 1) * a * dt_h) ** (1 / (1 - n))
    # 3. evapotranspiration
    stress = np.clip((v - wp) / ((1 - p.depletion_fraction) * (fc - wp)), 0.0, 1.0)
    v = v - p.crop_coefficient * et0_mm_per_h * stress * dt_h / layer_mm
    return np.asarray(np.maximum(v, 0.0), dtype=np.float64)


def _spread(v: FloatArray, diffusivity: float, dt_h: float, resolution: float) -> FloatArray:
    """Sideways movement of water: explicit diffusion, sub-stepped to stay stable; no flow
    through the field edge."""
    number = diffusivity * dt_h / resolution**2
    steps = max(1, math.ceil(number / 0.2))
    for _ in range(steps):
        q = np.pad(v, 1, mode="edge")
        v = v + number / steps * (q[:-2, 1:-1] + q[2:, 1:-1] + q[1:-1, :-2] + q[1:-1, 2:] - 4 * v)
    return v


def irrigation_rate(
    p: PhysicalSoilConfig, t0: float, t1: float, pattern: FloatArray | None
) -> FloatArray | float:
    """Drip water arriving between t0 and t1, mm/h per cell (the mean over the step)."""
    if pattern is None or not p.irrigation:
        return 0.0
    total: FloatArray | float = 0.0
    for e in p.irrigation:
        on = max(0.0, min(t1, e.start_s + e.duration_s) - max(t0, e.start_s)) / (t1 - t0)
        if on > 0:
            # one emitter's flow over its share of the strip; `pattern` averages 1 across it
            mean_rate = e.emitter_l_per_h / (e.emitter_spacing * 2 * e.strip_half_width)
            total = total + on * mean_rate * _strip(pattern, e.strip_half_width)
    return total


def _strip(distance_to_row: FloatArray, half_width: float) -> FloatArray:
    """Cross-row profile of a drip strip: a cos^2 bump that averages 1 over its width."""
    d = np.minimum(distance_to_row, half_width)  # (inf outside the planted area)
    return np.asarray(2 * np.cos(np.pi * d / (2 * half_width)) ** 2, dtype=np.float64)


def _step(
    cfg: WeatherConfig,
    vwc: FloatArray,
    k: int,
    infiltration: FloatArray | float,
    clip: tuple[float, float],
    drip: FloatArray | float = 0.0,
    resolution: float | None = None,
) -> FloatArray:
    """The soil layer over step k (from k * step_s to (k + 1) * step_s): the physical model when
    configured, else the bucket. `drip` is the drip water for this step, mm/h per cell."""
    t0 = k * cfg.step_s
    if cfg.physical is not None:
        dt_h = cfg.step_s / 3600
        supply = rain_mm(cfg, t0, t0 + cfg.step_s) / dt_h * infiltration + drip
        et0 = et0_rate(cfg.physical, t0 + cfg.step_s / 2)
        v = water_balance(vwc, supply, et0, dt_h, cfg.layer_depth, cfg.physical)
        if resolution is not None and cfg.physical.lateral_diffusivity_m2_per_h > 0:
            v = _spread(v, cfg.physical.lateral_diffusivity_m2_per_h, dt_h, resolution)
        return np.asarray(np.clip(v, *clip), dtype=np.float64)
    fc, drain, et = cfg.field_capacity, cfg.drainage_per_h, cfg.evapotranspiration_mm_per_h
    assert fc is not None and drain is not None and et is not None  # WeatherConfig checks
    gain = rain_mm(cfg, t0, t0 + cfg.step_s) * infiltration
    loss = et * cfg.step_s / 3600
    # ponytail: constant evapotranspiration even in very dry soil; the clip floor stops it.
    v = vwc + (gain - loss) / 1000 / cfg.layer_depth
    drained = 1 - math.exp(-drain * cfg.step_s / 3600)
    v = v - np.maximum(v - fc, 0.0) * drained
    return np.asarray(np.clip(v, *clip), dtype=np.float64)


class SoilDynamics:
    """Hidden soil truth through the mission, stepped on demand and cached."""

    def __init__(
        self,
        start: SoilTruth,
        cfg: WeatherConfig,
        clip: tuple[float, float],
        rng: np.random.Generator,
        layout: FieldLayout | None = None,
    ) -> None:
        self.cfg, self.clip = cfg, clip
        # Distance from each cell to the nearest drip line (drip irrigation only).
        self._to_row: FloatArray | None = None
        if cfg.physical is not None and cfg.physical.irrigation:
            if layout is None:
                raise ValueError("drip irrigation needs the field layout (the plant rows)")
            f = layout.cfg
            gx, gy = np.meshgrid(start.x_centres, start.y_centres)
            d = np.abs(gy[..., None] - layout.row_y).min(axis=-1)
            planted = (gx >= f.headland) & (gx <= f.length_x - f.headland)
            self._to_row = np.where(planted, d, np.inf)
        z = gaussian_random_field(
            start.grid.shape, start.resolution, cfg.infiltration_corr_length, "gaussian", rng
        )
        self.infiltration = np.maximum(1 + cfg.infiltration_cv * z, 0.0)
        self._states = [start]

    def at(self, t: float) -> SoilTruth:
        k = max(0, int(t // self.cfg.step_s))
        while len(self._states) <= k:
            prev = self._states[-1]
            j = len(self._states) - 1
            drip: FloatArray | float = 0.0
            if self.cfg.physical is not None:
                t0 = j * self.cfg.step_s
                drip = irrigation_rate(self.cfg.physical, t0, t0 + self.cfg.step_s, self._to_row)
            grid = _step(
                self.cfg,
                prev.grid.astype(np.float64),
                j,
                self.infiltration,
                self.clip,
                drip,
                prev.resolution,
            )
            self._states.append(dataclasses.replace(prev, grid=grid.astype(np.float32)))
        return self._states[k]


def bring_forward(
    cfg: WeatherConfig, value: float, t0: float, t1: float, clip: tuple[float, float]
) -> float:
    """What a reading of `value` at t0 should read at t1 by the water-balance model, with average
    soak-in. The rover probes lane centres, outside the drip strips, so it leaves irrigation out."""
    v = np.array(value)
    for k in range(int(t0 // cfg.step_s), int(t1 // cfg.step_s)):
        v = _step(cfg, v, k, 1.0, clip)
    return float(v)


def current_view(
    readings: Sequence[ProbeReading],
    cfg: WeatherConfig | None,
    now: float,
    clip: tuple[float, float],
    *,
    keep_failed: bool = False,
) -> list[ProbeReading]:
    """The readings as the rover uses them at time `now`: each valid one replaced by a newer valid
    reading within SUPERSEDE_RADIUS, the rest brought forward to `now`.

    Failed readings are dropped unless `keep_failed`, which mappers need: a failed insertion is
    a censored sample ("drier than the threshold"), not an absence of information. Anything that
    counts probes must leave the flag off.
    """
    valid = [r for r in readings if r.valid and r.value is not None]
    out = []
    for i, r in enumerate(valid):
        if any(math.hypot(q.x - r.x, q.y - r.y) < SUPERSEDE_RADIUS for q in valid[i + 1 :]):
            continue
        if cfg is not None and r.value is not None:
            r = dataclasses.replace(r, value=bring_forward(cfg, r.value, r.t, now, clip))
        out.append(r)
    if keep_failed:
        out.extend(r for r in readings if not r.valid)
    return out
