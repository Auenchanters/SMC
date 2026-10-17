"""Probing strategies. They see probe readings only, never the ground truth.

FixedSpacing is the full-coverage plan (planning.LanePlanner); the adaptive strategies below
choose the next candidate site, and the rover drives there along the lane graph. Recheck may also
choose a site it has already probed, when it doubts that reading.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np
import numpy.typing as npt

from agrisim.config import SimConfig
from agrisim.field import ProbeSite
from agrisim.mapping import KrigingMapper
from agrisim.planning import LaneGraph
from agrisim.sensor import ProbeReading
from agrisim.weather import current_view, rain_mm

FloatArray = npt.NDArray[np.float64]
BoolArray = npt.NDArray[np.bool_]

FIXED = "fixed_spacing"
FIXED_PLUS = "fixed_plus_recheck"  # the fixed route, then survey.recheck_probes rechecks
RECHECK = "recheck"
STRATEGIES = (
    FIXED,
    "random",
    "greedy_variance",
    "greedy_variance_per_cost",
    RECHECK,
    FIXED_PLUS,
    "moisturemapper_a1",
    "moisturemapper_a2",
    "dov",
    "mi_greedy",
    "spatial_coverage",
)
LEARNED = "ppo"  # needs a trained model (agrisim train)


@dataclass(frozen=True, eq=False)
class Context:
    position: ProbeSite
    sites: tuple[ProbeSite, ...]
    site_xy: FloatArray  # (N, 2)
    visited: BoolArray  # (N,) sites already probed (the action mask is ~visited)
    readings: tuple[ProbeReading, ...]
    graph: LaneGraph
    budget: int  # total probes for the mission (failed probes count as used)
    t: float = 0.0  # mission time now


class Policy(Protocol):
    def choose(self, ctx: Context) -> int: ...


def uncertainty(cfg: SimConfig, ctx: Context) -> FloatArray:
    """Kriging variance at every site from the readings so far.

    Before kriging is usable (fewer than mapping.min_readings valid readings), the distance to
    the nearest probed location is used instead, so early probes spread out (maximin).
    """
    mapper = KrigingMapper(cfg.mapping)
    for r in current_view(ctx.readings, cfg.weather, ctx.t, cfg.soil.vwc_clip):
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
        cost = np.maximum(cost, self.cfg.dt)  # zero probe time at the rover's own spot: no 0/0
        return _best(uncertainty(self.cfg, ctx) / cost, ctx.visited)


def doubt(cfg: SimConfig, ctx: Context) -> FloatArray:
    """How much the rover doubts its reading at each site (VWC^2; 0 where nothing is probed).

    - Rain since the reading: the bucket model brings it forward, but not how much soaked in
      there, so its error grows with the rain (infiltration_cv x the rain's VWC change).
    - A single reading 3x further from its neighbours than readings here usually are.
      A second reading settles it, so the rover never rechecks a real local anomaly forever.
    """
    used = current_view(ctx.readings, cfg.weather, ctx.t, cfg.soil.vwc_clip)
    out = np.zeros(len(ctx.sites))
    if not used:
        return out
    xyz = np.array([(r.x, r.y, r.value) for r in used], dtype=np.float64)
    # How far each reading is from what its 6 nearest neighbours suggest (inverse distance).
    # ponytail: leave-one-out kriging would be sharper but costs a refit per reading.
    resid = np.zeros(len(xyz))
    for k, (x, y, v) in enumerate(xyz):
        others = np.delete(xyz, k, axis=0)
        if len(others):
            d = np.hypot(others[:, 0] - x, others[:, 1] - y)
            near = np.argsort(d)[:6]
            w_ = 1 / np.maximum(d[near], 1e-6) ** 2
            resid[k] = v - float((w_ * others[near, 2]).sum() / w_.sum())
    # Typical disagreement in this field (robust: a few bad readings do not inflate it). Only a
    # reading 3 times further off than that is odd.
    scale = max(cfg.probe.noise_std, 1.4826 * float(np.median(np.abs(resid))))
    half = cfg.survey.candidate_spacing / 2
    for r, (x, y, _), e in zip(used, xyz, resid, strict=True):
        d_site = np.hypot(ctx.site_xy[:, 0] - x, ctx.site_xy[:, 1] - y)
        site = int(d_site.argmin())
        if d_site[site] > half:
            continue
        stale = 0.0
        if cfg.weather is not None:
            w = cfg.weather
            stale = (w.infiltration_cv * rain_mm(w, r.t, ctx.t) / 1000 / w.layer_depth) ** 2
        times = sum(np.hypot(q.x - x, q.y - y) < half for q in ctx.readings)
        odd = max(0.0, e**2 - (3 * scale) ** 2) if times == 1 and len(xyz) >= 5 else 0.0
        out[site] = max(out[site], stale + odd)
    return out


@dataclass(frozen=True)
class Recheck:
    """Greedy max-variance over new sites and doubted readings alike: the rover goes where it is
    least sure, whether that is somewhere new or somewhere it measured before."""

    cfg: SimConfig

    def choose(self, ctx: Context) -> int:
        var = uncertainty(self.cfg, ctx)
        return int(np.argmax(np.where(ctx.visited, doubt(self.cfg, ctx), var)))


# Published methods, re-implemented on the lane graph (research.md Section 4 and WP2). They are
# the benchmark's competitor baselines; each one names its source.


@dataclass(frozen=True)
class MoistureMapper:
    """MoistureMapper (Univ. Nevada Reno / DRI, IEEE CASE 2025, arXiv 2507.12716).

    A1 = var * (1 - d / d_max); A2 = (var + 1 - d / d_max) / 2; the next site is drawn at random
    among the top five. Their GP has signal variance 1, so the kriging variance is scaled to
    [0, 1]; d is lane-graph distance (they used straight lines, which a rover in rows cannot
    drive) and d_max the longest lane-graph distance in the field.
    """

    cfg: SimConfig
    rng: np.random.Generator
    additive: bool

    def choose(self, ctx: Context) -> int:
        var = uncertainty(self.cfg, ctx)
        var = var / max(float(var.max()), 1e-12)
        g = ctx.graph
        d_max = (g.x_east - g.x_west) + float(g.lane_y[-1] - g.lane_y[0])
        near = 1 - ctx.graph.distances(ctx.position, ctx.sites) / d_max
        score = 0.5 * (var + near) if self.additive else var * near
        score = np.where(ctx.visited, -np.inf, score)
        top = np.argsort(-score, kind="stable")[: min(5, int((~ctx.visited).sum()))]
        return int(self.rng.choice(top))


@dataclass(frozen=True)
class DistanceOverVariance:
    """Distance Over Variance bid (Roberts-Elliott, Das & Cielniak, Robotics 14(6):77, 2025):
    the site with the least lane-graph distance per unit of kriging variance. The exact bid form
    is unverified (research.md Section 11), so treat it as DOV-style."""

    cfg: SimConfig

    def choose(self, ctx: Context) -> int:
        d = np.maximum(ctx.graph.distances(ctx.position, ctx.sites), 1e-6)
        return _best(uncertainty(self.cfg, ctx) / d, ctx.visited)


@dataclass(frozen=True)
class MutualInformation:
    """Greedy mutual-information placement (Krause, Singh & Guestrin, JMLR 9, 2008): maximise
    var(s | probed) / var(s | every other unprobed site), with the fitted variogram's covariance.
    Before kriging is usable it spreads out like greedy_variance."""

    cfg: SimConfig

    def choose(self, ctx: Context) -> int:
        mapper = KrigingMapper(self.cfg.mapping)
        used = current_view(ctx.readings, self.cfg.weather, ctx.t, self.cfg.soil.vwc_clip)
        for r in used:
            mapper.update(r)
        cov = mapper.covariance()
        free = np.flatnonzero(~ctx.visited)
        if cov is None or len(free) < 2:
            return _best(uncertainty(self.cfg, ctx), ctx.visited)
        a = mapper.xyz[:, :2]
        u = ctx.site_xy[free]

        def k(p: FloatArray, q: FloatArray) -> FloatArray:
            return cov(np.linalg.norm(p[:, None, :] - q[None, :, :], axis=2))

        k_ua = k(u, a)
        sol = np.linalg.lstsq(k(a, a), k_ua.T, rcond=None)[0]
        given_probed = np.maximum(cov(np.zeros(1))[0] - (k_ua * sol.T).sum(axis=1), 0.0)
        k_uu = k(u, u)
        prec = np.linalg.inv(k_uu + 1e-6 * float(k_uu[0, 0]) * np.eye(len(u)))
        given_rest = 1.0 / np.maximum(np.diag(prec), 1e-12)  # Schur complement
        return int(free[np.argmax(given_probed / given_rest)])


class SpatialCoverage:
    """Spatial coverage sampling (Walvoort, Brus & de Gruijter, Computers & Geosciences 2010),
    a standard soil-survey design: k-means centres of the field, one per probe, snapped to the
    nearest free candidate sites, then visited nearest first along the lane graph. Not adaptive."""

    def __init__(self, cfg: SimConfig, rng: np.random.Generator) -> None:
        self.cfg, self.rng = cfg, rng
        self._targets: list[int] | None = None

    def _plan(self, ctx: Context) -> list[int]:
        f = self.cfg.field
        gx, gy = np.meshgrid(np.arange(0.25, f.length_x, 0.5), np.arange(0.25, f.width_y, 0.5))
        pts = np.column_stack([gx.ravel(), gy.ravel()])
        k = min(ctx.budget, len(ctx.sites))
        centres = pts[self.rng.choice(len(pts), k, replace=False)]
        for _ in range(30):  # Lloyd iterations
            label = np.linalg.norm(pts[:, None, :] - centres[None, :, :], axis=2).argmin(axis=1)
            centres = np.array(
                [
                    pts[label == j].mean(axis=0) if (label == j).any() else centres[j]
                    for j in range(k)
                ]
            )
        taken = ctx.visited.copy()
        targets = []
        for c in centres:
            d = np.where(taken, np.inf, np.linalg.norm(ctx.site_xy - c, axis=1))
            j = int(np.argmin(d))
            taken[j] = True
            targets.append(j)
        return targets

    def choose(self, ctx: Context) -> int:
        if self._targets is None:
            self._targets = self._plan(ctx)
        todo = [j for j in self._targets if not ctx.visited[j]]
        if not todo:  # all centres probed (or lost to failures): nearest free site
            return _best(-ctx.graph.distances(ctx.position, ctx.sites), ctx.visited)
        d = ctx.graph.distances(ctx.position, [ctx.sites[j] for j in todo])
        return todo[int(np.argmin(d))]


def make_policy(
    name: str, cfg: SimConfig, rng: np.random.Generator, model: Path | None = None
) -> Policy:
    if name == LEARNED:
        if model is None:
            raise ValueError("policy 'ppo' needs a model path")
        from agrisim.env import LearnedPolicy  # torch is imported only when needed

        return LearnedPolicy.load(model, cfg)
    if name == "random":
        return Random(rng)
    if name == "greedy_variance":
        return GreedyMaxVariance(cfg)
    if name == "greedy_variance_per_cost":
        return GreedyVariancePerCost(cfg)
    if name in (RECHECK, FIXED_PLUS):
        return Recheck(cfg)
    if name in ("moisturemapper_a1", "moisturemapper_a2"):
        return MoistureMapper(cfg, rng, additive=name.endswith("a2"))
    if name == "dov":
        return DistanceOverVariance(cfg)
    if name == "mi_greedy":
        return MutualInformation(cfg)
    if name == "spatial_coverage":
        return SpatialCoverage(cfg, rng)
    raise ValueError(f"unknown policy {name!r}; choose from {(*STRATEGIES, LEARNED)}")
