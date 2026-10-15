"""Path following: turn in place to face the segment, then pure pursuit along it.

If the segment points behind the rover (heading error > 90 deg + reverse_margin), the rover
reverses along it instead of turning around: a 180 deg turn in place inside a lane would sweep
the footprint's corners into the canopies.
"""

import math
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

from agrisim.config import RoverConfig
from agrisim.rover import RoverState, step, wrap_angle


@dataclass(frozen=True)
class PurePursuit:
    rover: RoverConfig
    lookahead: float = 0.3  # m
    turn_tol: float = 0.15  # rad; above this heading error, turn in place
    goal_tol: float = 0.01  # m; segment done when this close to (or past) the end
    k_turn: float = 3.0  # yaw-rate gain while turning in place
    k_slow: float = 1.5  # 1/s; v <= k_slow * remaining distance near the end
    v_min: float = 0.05  # m/s floor so the rover always reaches the end
    reverse_margin: float = 0.3  # rad beyond 90 deg before choosing to reverse

    def command(
        self,
        state: RoverState,
        start: tuple[float, float],
        end: tuple[float, float],
        dt: float = 0.0,
    ) -> tuple[float, float]:
        """(v, w) for following the straight segment start -> end. With `dt`, a turn in place
        never rotates past the target heading in one step (long steps would oscillate forever)."""
        sx, sy = start
        dx, dy = end[0] - sx, end[1] - sy
        seg = math.hypot(dx, dy)
        if seg < 1e-9:
            return 0.0, 0.0
        ux, uy = dx / seg, dy / seg
        err = wrap_angle(math.atan2(dy, dx) - state.theta)
        reverse = abs(err) > math.pi / 2 + self.reverse_margin
        eff = state.theta + math.pi if reverse else state.theta  # direction of travel
        err = wrap_angle(math.atan2(dy, dx) - eff)
        if abs(err) > self.turn_tol:
            w = self.k_turn * err
            if dt > 0:
                w = math.copysign(min(abs(w), abs(err) / dt), w)
            return 0.0, w
        along = (state.x - sx) * ux + (state.y - sy) * uy
        remaining = seg - along
        s = min(along + self.lookahead, seg)
        tx, ty = sx + ux * s - state.x, sy + uy * s - state.y
        ld = math.hypot(tx, ty)
        if ld < 1e-9:
            return 0.0, 0.0
        alpha = wrap_angle(math.atan2(ty, tx) - eff)
        v = min(self.rover.max_speed, max(self.v_min, self.k_slow * remaining))
        w = v * 2 * math.sin(alpha) / ld
        if abs(w) > self.rover.max_yaw_rate:  # keep curvature, slow down
            v *= self.rover.max_yaw_rate / abs(w)
            w = math.copysign(self.rover.max_yaw_rate, w)
        return (-v, w) if reverse else (v, w)

    def done(self, state: RoverState, start: tuple[float, float], end: tuple[float, float]) -> bool:
        dx, dy = end[0] - start[0], end[1] - start[1]
        seg = math.hypot(dx, dy)
        if seg < 1e-9:
            return True
        along = ((state.x - start[0]) * dx + (state.y - start[1]) * dy) / seg
        return seg - along <= self.goal_tol


def drive_segment(
    state: RoverState,
    start: tuple[float, float],
    end: tuple[float, float],
    follower: PurePursuit,
    dt: float,
    max_steps: int = 100_000,
) -> list[RoverState]:
    """States after each dt step until the segment end is reached (excludes the input state)."""
    out: list[RoverState] = []
    for _ in range(max_steps):
        if follower.done(state, start, end):
            return out
        v, w = follower.command(state, start, end, dt)
        state = step(state, v, w, dt, follower.rover)
        out.append(state)
    raise RuntimeError(f"segment {start} -> {end} not reached in {max_steps} steps")


def densify(
    p: npt.ArrayLike, ds: float = 0.05, dth: float = 0.05
) -> tuple[npt.NDArray[np.float64], npt.NDArray[np.intp]]:
    """Poses filled in so consecutive ones are at most `ds` m and `dth` rad apart, and the index
    of the original pose each one starts from. Checks on sampled poses (plant contacts, lane
    coverage) would otherwise miss what happens between two far-apart samples."""
    p = np.atleast_2d(np.asarray(p, dtype=np.float64))
    if len(p) < 2:
        return p, np.arange(len(p))
    step = np.diff(p, axis=0)
    step[:, 2] = (step[:, 2] + np.pi) % (2 * np.pi) - np.pi
    n = np.maximum(
        1,
        np.ceil(np.maximum(np.hypot(step[:, 0], step[:, 1]) / ds, np.abs(step[:, 2]) / dth) - 1e-9),
    ).astype(np.intp)
    src = np.repeat(np.arange(len(step)), n)
    frac = np.concatenate([np.arange(k) / k for k in n])
    out = p[src] + step[src] * frac[:, None]
    out[:, 2] = (out[:, 2] + np.pi) % (2 * np.pi) - np.pi
    return np.vstack([out, p[-1:]]), np.append(src, len(p) - 1)


def poses(states: list[RoverState]) -> np.ndarray:
    """(S, 3) array of x, y, theta."""
    return np.array([(s.x, s.y, s.theta) for s in states], dtype=np.float64).reshape(-1, 3)
