"""Moisture probe sensor model. Readings never carry the true value."""

import math
from dataclasses import dataclass

import numpy as np

from agrisim.config import ProbeConfig
from agrisim.soil import SoilTruth


@dataclass(frozen=True)
class ProbeReading:
    x: float
    y: float
    t: float
    value: float | None  # VWC, m^3/m^3; None when the probe failed
    valid: bool
    sensor_id: str = "probe0"


@dataclass(frozen=True)
class MoistureProbe:
    cfg: ProbeConfig
    sensor_id: str = "probe0"

    def read(
        self, truth: SoilTruth, x: float, y: float, t: float, rng: np.random.Generator
    ) -> ProbeReading:
        """Footprint mean + bias + Gaussian noise, quantised and clipped to [0, 1].

        With `hard_soil`, dry spots fail and read low (short insertions) more often, as real
        pushed probes do (MoistureMapper, CASE 2025; Langenscheidt et al., JFR).
        """
        c = self.cfg
        # Draw both random numbers every time so a failure does not shift later draws.
        u = rng.random()
        noise = rng.normal(0.0, c.noise_std)
        theta = truth.mean_over_disc(x, y, c.footprint_radius)
        hard = 0.0
        p_fail = c.failure_prob
        if c.hard_soil is not None:
            h = c.hard_soil
            hard = 1.0 / (1.0 + math.exp(min(50.0, (theta - h.hard_below) / h.width)))
            p_fail += (h.fail_prob - c.failure_prob) * hard
        if u < p_fail:
            return ProbeReading(x, y, t, None, False, self.sensor_id)
        raw = theta + c.bias + noise
        if c.bad_contact_prob > 0:  # extra draws only when enabled, so older runs are unchanged
            bad, drop = rng.random() < c.bad_contact_prob, rng.uniform(0.5, 1.0)
            raw -= c.bad_contact_drop * drop if bad else 0.0
        if c.hard_soil is not None:
            short, drop = rng.random() < c.hard_soil.partial_prob * hard, rng.uniform(0.5, 1.0)
            raw -= c.hard_soil.partial_drop * drop if short else 0.0
        value = float(np.clip(np.round(raw / c.resolution) * c.resolution, 0.0, 1.0))
        return ProbeReading(x, y, t, value, True, self.sensor_id)
