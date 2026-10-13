"""Differential-drive rover kinematics and footprint."""

import math
from dataclasses import dataclass

import numpy as np
from shapely.geometry import Polygon

from agrisim.config import RoverConfig


@dataclass(frozen=True)
class RoverState:
    x: float
    y: float
    theta: float  # heading, rad, counter-clockwise from +x


def wrap_angle(a: float) -> float:
    return (a + math.pi) % (2 * math.pi) - math.pi


def step(state: RoverState, v: float, w: float, dt: float, cfg: RoverConfig) -> RoverState:
    """Advance one step with speed and yaw-rate limits (midpoint heading integration)."""
    v = float(np.clip(v, -cfg.max_speed, cfg.max_speed))
    w = float(np.clip(w, -cfg.max_yaw_rate, cfg.max_yaw_rate))
    mid = state.theta + 0.5 * w * dt
    return RoverState(
        state.x + v * math.cos(mid) * dt,
        state.y + v * math.sin(mid) * dt,
        wrap_angle(state.theta + w * dt),
    )


def footprint(state: RoverState, cfg: RoverConfig) -> Polygon:
    """Rectangle: `length` along the heading, `width` across it, centred on the pose."""
    c, s = math.cos(state.theta), math.sin(state.theta)
    hl, hw = cfg.length / 2, cfg.width / 2
    corners = [(hl, hw), (-hl, hw), (-hl, -hw), (hl, -hw)]
    return Polygon([(state.x + c * u - s * v, state.y + s * u + c * v) for u, v in corners])
