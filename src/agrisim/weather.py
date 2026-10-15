"""Weather during a mission: rain and evapotranspiration change the soil while the rover works.

The soil layer the probe reads is a bucket per grid cell. Each `step_s`:
    rain soaks in (more in some places than others: runoff, crusting),
    evapotranspiration (sun, heat, the plants) takes water out,
    water above field capacity drains down out of the layer.
`SoilDynamics` is the hidden truth over time (only the probe model and metrics read it).
`current_view` is the rover's side: it knows the rain gauge and the same bucket model, but not how
much rain soaked in at each spot, so readings taken before rain become less certain.
"""

import dataclasses
import math
from collections.abc import Sequence

import numpy as np
import numpy.typing as npt

from agrisim.config import WeatherConfig
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


def _step(
    cfg: WeatherConfig,
    vwc: FloatArray,
    k: int,
    infiltration: FloatArray | float,
    clip: tuple[float, float],
) -> FloatArray:
    """The bucket over step k (from k * step_s to (k + 1) * step_s)."""
    t0 = k * cfg.step_s
    gain = rain_mm(cfg, t0, t0 + cfg.step_s) * infiltration
    loss = cfg.evapotranspiration_mm_per_h * cfg.step_s / 3600
    # ponytail: constant evapotranspiration even in very dry soil; the clip floor stops it.
    v = vwc + (gain - loss) / 1000 / cfg.layer_depth
    drained = 1 - math.exp(-cfg.drainage_per_h * cfg.step_s / 3600)
    v = v - np.maximum(v - cfg.field_capacity, 0.0) * drained
    return np.asarray(np.clip(v, *clip), dtype=np.float64)


class SoilDynamics:
    """Hidden soil truth through the mission, stepped on demand and cached."""

    def __init__(
        self,
        start: SoilTruth,
        cfg: WeatherConfig,
        clip: tuple[float, float],
        rng: np.random.Generator,
    ) -> None:
        self.cfg, self.clip = cfg, clip
        z = gaussian_random_field(
            start.grid.shape, start.resolution, cfg.infiltration_corr_length, "gaussian", rng
        )
        self.infiltration = np.maximum(1 + cfg.infiltration_cv * z, 0.0)
        self._states = [start]

    def at(self, t: float) -> SoilTruth:
        k = max(0, int(t // self.cfg.step_s))
        while len(self._states) <= k:
            prev = self._states[-1]
            grid = _step(
                self.cfg,
                prev.grid.astype(np.float64),
                len(self._states) - 1,
                self.infiltration,
                self.clip,
            )
            self._states.append(dataclasses.replace(prev, grid=grid.astype(np.float32)))
        return self._states[k]


def bring_forward(
    cfg: WeatherConfig, value: float, t0: float, t1: float, clip: tuple[float, float]
) -> float:
    """What a reading of `value` at t0 should read at t1 by the bucket model, average soak-in."""
    v = np.array(value)
    for k in range(int(t0 // cfg.step_s), int(t1 // cfg.step_s)):
        v = _step(cfg, v, k, 1.0, clip)
    return float(v)


def current_view(
    readings: Sequence[ProbeReading],
    cfg: WeatherConfig | None,
    now: float,
    clip: tuple[float, float],
) -> list[ProbeReading]:
    """The readings as the rover uses them at time `now`: failed ones dropped, each one replaced by
    a newer valid reading within SUPERSEDE_RADIUS, the rest brought forward to `now`."""
    valid = [r for r in readings if r.valid and r.value is not None]
    out = []
    for i, r in enumerate(valid):
        if any(math.hypot(q.x - r.x, q.y - r.y) < SUPERSEDE_RADIUS for q in valid[i + 1 :]):
            continue
        if cfg is not None and r.value is not None:
            r = dataclasses.replace(r, value=bring_forward(cfg, r.value, r.t, now, clip))
        out.append(r)
    return out
