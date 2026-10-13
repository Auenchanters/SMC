"""Probing strategies. They see probe readings only, never the ground truth.

FixedSpacing is the full-coverage plan (planning.LanePlanner); the adaptive strategies below
choose the next candidate site, and the rover drives there along the lane graph.
"""

from dataclasses import dataclass
from typing import Protocol

import numpy as np
import numpy.typing as npt

from agrisim.config import SimConfig
from agrisim.field import ProbeSite
from agrisim.mapping import KrigingMapper
from agrisim.planning import LaneGraph
from agrisim.sensor import ProbeReading

FloatArray = npt.NDArray[np.float64]
BoolArray = npt.NDArray[np.bool_]

FIXED = "fixed_spacing"
STRATEGIES = (FIXED, "random", "greedy_variance", "greedy_variance_per_cost")


@dataclass(frozen=True, eq=False)
class Context:
    position: ProbeSite
    sites: tuple[ProbeSite, ...]
    site_xy: FloatArray  # (N, 2)
    visited: BoolArray  # (N,) sites already probed (the action mask is ~visited)
    readings: tuple[ProbeReading, ...]
    graph: LaneGraph


class Policy(Protocol):
    def choose(self, ctx: Context) -> int: ...


def uncertainty(cfg: SimConfig, ctx: Context) -> FloatArray:
    """Kriging variance at every site from the readings so far.

    Before kriging is usable (fewer than mapping.min_readings valid readings), the distance to
    the nearest probed location is used instead, so early probes spread out (maximin).
    """
    mapper = KrigingMapper(cfg.mapping)
    for r in ctx.readings:
        mapper.update(r)
    pred = mapper.predict_points(ctx.site_xy[:, 0], ctx.site_xy[:, 1])
    if pred is not None:
        return pred[1]
    probed = np.array([(r.x, r.y) for r in ctx.readings]).reshape(-1, 2)
    if len(probed) == 0:
        return np.ones(len(ctx.sites))
    d = np.linalg.norm(ctx.site_xy[:, None, :] - probed[None, :, :], axis=2)
    return np.asarray(d.min(axis=1), dtype=np.float64)


def _best(score: FloatArray, visited: BoolArray) -> int:
    """Argmax over unvisited sites; ties go to the lowest index."""
    return int(np.argmax(np.where(visited, -np.inf, score)))


@dataclass(frozen=True)
class Random:
    rng: np.random.Generator

    def choose(self, ctx: Context) -> int:
        return int(self.rng.choice(np.flatnonzero(~ctx.visited)))


@dataclass(frozen=True)
class GreedyMaxVariance:
    cfg: SimConfig

    def choose(self, ctx: Context) -> int:
        return _best(uncertainty(self.cfg, ctx), ctx.visited)


@dataclass(frozen=True)
class GreedyVariancePerCost:
    """Uncertainty divided by the time to get there and probe."""

    cfg: SimConfig

    def choose(self, ctx: Context) -> int:
        travel = ctx.graph.distances(ctx.position, ctx.sites) / self.cfg.rover.max_speed
        cost = travel + self.cfg.probe.insertion_time_s
        return _best(uncertainty(self.cfg, ctx) / cost, ctx.visited)


def make_policy(name: str, cfg: SimConfig, rng: np.random.Generator) -> Policy:
    if name == "random":
        return Random(rng)
    if name == "greedy_variance":
        return GreedyMaxVariance(cfg)
    if name == "greedy_variance_per_cost":
        return GreedyVariancePerCost(cfg)
    raise ValueError(f"unknown adaptive policy {name!r}; choose from {STRATEGIES}")
