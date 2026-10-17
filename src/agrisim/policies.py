"""Probing strategies. They see probe readings only, never the ground truth.

FixedSpacing is the full-coverage plan (planning.LanePlanner); the adaptive strategies below
choose the next candidate site, and the rover drives there along the lane graph. Recheck may also
choose a site it has already probed, when it doubts that reading.
"""

import math
from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path
from typing import Protocol

import numpy as np
import numpy.typing as npt
from scipy.linalg import solve_triangular
from scipy.special import ndtr

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
PLANNED = "planned_survey"  # time-aware coverage route, then decision-focused probes
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
    PLANNED,
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
    deadline: float = math.inf  # mission time to finish by (agribench tasks); inf = none


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


def coverage_sites(cfg: SimConfig, ctx: Context, k: int, rng: np.random.Generator) -> list[int]:
    """k free candidate sites spread over the field: k-means centres of a 0.5 m grid of the field
    (Walvoort et al. 2010), each snapped to the nearest free site."""
    f = cfg.field
    gx, gy = np.meshgrid(np.arange(0.25, f.length_x, 0.5), np.arange(0.25, f.width_y, 0.5))
    pts = np.column_stack([gx.ravel(), gy.ravel()])
    k = min(k, int((~ctx.visited).sum()))
    centres = pts[rng.choice(len(pts), k, replace=False)]
    for _ in range(30):  # Lloyd iterations
        label = np.linalg.norm(pts[:, None, :] - centres[None, :, :], axis=2).argmin(axis=1)
        centres = np.array(
            [pts[label == j].mean(axis=0) if (label == j).any() else centres[j] for j in range(k)]
        )
    taken = ctx.visited.copy()
    targets = []
    for c in centres:
        d = np.where(taken, np.inf, np.linalg.norm(ctx.site_xy - c, axis=1))
        j = int(np.argmin(d))
        taken[j] = True
        targets.append(j)
    return targets


class SpatialCoverage:
    """Spatial coverage sampling (Walvoort, Brus & de Gruijter, Computers & Geosciences 2010),
    a standard soil-survey design: k-means centres of the field, one per probe, snapped to the
    nearest free candidate sites, then visited nearest first along the lane graph. Not adaptive."""

    def __init__(self, cfg: SimConfig, rng: np.random.Generator) -> None:
        self.cfg, self.rng = cfg, rng
        self._targets: list[int] | None = None

    def choose(self, ctx: Context) -> int:
        if self._targets is None:
            self._targets = coverage_sites(self.cfg, ctx, ctx.budget, self.rng)
        todo = [j for j in self._targets if not ctx.visited[j]]
        if not todo:  # all centres probed (or lost to failures): nearest free site
            return _best(-ctx.graph.distances(ctx.position, ctx.sites), ctx.visited)
        d = ctx.graph.distances(ctx.position, [ctx.sites[j] for j in todo])
        return todo[int(np.argmin(d))]


def tour(start: ProbeSite, stops: list[ProbeSite], graph: LaneGraph) -> tuple[list[int], float]:
    """A short open route from `start` through every stop along the lane graph: nearest
    neighbour, then 2-opt. Returns the stops' indices in visiting order and the route length."""
    pts = [start, *stops]
    d = np.array([graph.distances(p, pts) for p in pts])
    order, free = [0], set(range(1, len(pts)))
    while free:
        nxt = min(free, key=lambda j: (d[order[-1], j], j))
        order.append(nxt)
        free.remove(nxt)
    n, better = len(order), True
    while better:  # reverse order[i..j] while that shortens the route (the end stays open)
        better = False
        for i in range(1, n - 1):
            for j in range(i + 1, n):
                a, b, c = order[i - 1], order[i], order[j]
                e = order[j + 1] if j + 1 < n else None
                gain = d[a, b] - d[a, c] + (d[c, e] - d[b, e] if e is not None else 0.0)
                if gain > 1e-9:
                    order[i : j + 1] = order[i : j + 1][::-1]
                    better = True
    length = float(sum(d[p, q] for p, q in pairwise(order)))
    return [k - 1 for k in order[1:]], length


_GH_Z, _GH_W = np.polynomial.hermite_e.hermegauss(7)  # E[f(Z)], Z ~ N(0, 1), as a weighted sum
_GH_W = _GH_W / _GH_W.sum()


def acquisition(cfg: SimConfig, ctx: Context) -> tuple[FloatArray, FloatArray] | None:
    """What a reading at each candidate site is expected to do to the map, or None before the
    variogram can be fitted. A Gaussian process with the fitted variogram's covariance (the
    nugget as probe noise) gives, over a 1 m grid of cells:
    - the integrated variance reduction (the expected cut in squared error; research.md 7.3),
    - the expected misclassification reduction for the dry threshold (research.md WP3): the
      chance each cell is on the wrong side of the threshold now, minus its expectation after the
      reading, whose value is drawn from the current posterior (Gauss-Hermite quadrature).
    Both are per cell (fractions of the field)."""
    mapper = KrigingMapper(cfg.mapping)
    for reading in current_view(ctx.readings, cfg.weather, ctx.t, cfg.soil.vwc_clip):
        mapper.update(reading)
    cov = mapper.covariance()
    if cov is None:
        return None
    a, y = mapper.xyz[:, :2], mapper.xyz[:, 2]
    f = cfg.field
    gx, gy = np.meshgrid(np.arange(0.5, f.length_x, 1.0), np.arange(0.5, f.width_y, 1.0))
    cells = np.column_stack([gx.ravel(), gy.ravel()])
    psill = float(cov(np.array([1e-9]))[0])  # the smooth part of the sill
    nugget = max(float(cov(np.zeros(1))[0]) - psill, 1e-6 * psill)

    def k(p: FloatArray, q: FloatArray) -> FloatArray:
        return cov(np.maximum(np.linalg.norm(p[:, None, :] - q[None, :, :], axis=2), 1e-9))

    chol = np.linalg.cholesky(k(a, a) + nugget * np.eye(len(a)))

    def lsolve(b: FloatArray) -> FloatArray:
        return np.asarray(solve_triangular(chol, b, lower=True), dtype=np.float64)

    v_c, v_s, one = lsolve(k(a, cells)), lsolve(k(a, ctx.site_xy)), lsolve(np.ones(len(a)))
    m = float(one @ lsolve(y) / (one @ one))  # generalised least-squares mean
    mu = m + v_c.T @ lsolve(y - m)
    var = np.maximum(psill - (v_c**2).sum(axis=0), 1e-12)
    var_s = np.maximum(psill - (v_s**2).sum(axis=0), 0.0)
    r = (k(cells, ctx.site_xy) - v_c.T @ v_s) ** 2 / (var_s + nugget)  # (cells, sites)
    r = np.minimum(r, var[:, None])
    ivr = r.sum(axis=0) / (psill * len(cells))
    h = cfg.mapping.dry_threshold
    wrong = ndtr(-np.abs(mu - h) / np.sqrt(var))
    near = wrong > 1e-4  # cells far from the threshold cannot change side
    emr = np.zeros(len(ctx.sites))
    if near.any():
        # Exact only for the sites that move the doubtful cells most (the quadrature is costly).
        pull = np.where(ctx.visited, -np.inf, wrong[near] @ r[near])
        top = np.argsort(-pull, kind="stable")[:48]
        mu_n, var_n, r_n = mu[near, None], var[near, None], r[near][:, top]
        sd_after = np.sqrt(np.maximum(var_n - r_n, 1e-12))
        after = sum(
            w * ndtr(-np.abs(mu_n + np.sqrt(r_n) * z - h) / sd_after)
            for z, w in zip(_GH_Z, _GH_W, strict=True)
        )
        # never below 0 in exact arithmetic (the misclassification chance is a concave function of
        # a martingale); the max only drops quadrature noise
        emr[top] = np.maximum((wrong[near, None] - after).sum(axis=0), 0.0) / len(cells)
    return ivr, emr


class PlannedSurvey:
    """Time-aware survey: a planned coverage route, then decision-focused probes.

    1. Plan: k-means coverage sites for a share of the budget (`cover`), routed by nearest
       neighbour + 2-opt on the lane graph. If the whole budget would not fit before the
       deadline, fewer probes are planned (orienteering by shrinking).
    2. Rain forecast before the deadline (the gauge schedule in the weather config) makes
       readings taken before it stale, because nobody knows how much soaked in where. While the
       rest of the plan still fits between the end of the rain and the deadline, the rover takes
       the farthest planned site next, so it spends that time driving rather than probing.
    3. Drive the route. Then spend the rest of the budget where a reading helps the map most:
       integrated variance reduction plus `w_dry` x expected misclassification reduction, per
       second of driving and probing (plus this probe's share of the spare time, so distance
       matters only as much as the deadline makes it), and only where the remaining probes still
       fit before the deadline.
    """

    def __init__(
        self, cfg: SimConfig, rng: np.random.Generator, cover: float = 0.8, w_dry: float = 30.0
    ) -> None:
        self.cfg, self.rng, self.cover, self.w_dry = cfg, rng, cover, w_dry
        self.speed = 0.85 * cfg.rover.max_speed  # turns and path following: ~15% slower (measured)
        self._route: list[int] | None = None
        self._rerouted = True  # False after a rain-wait hop: route again from where the rover is

    def _finish(self, ctx: Context, stops: list[int], probes: int) -> tuple[list[int], float]:
        """A route through `stops` from here, and the time to take `probes` probes: the route,
        then the rest as adaptive probes of about two route legs of driving each."""
        order, length = tour(ctx.position, [ctx.sites[j] for j in stops], ctx.graph)
        hops = max(probes - len(stops), 0) * 2 * length / max(len(stops), 1)
        need = (length + hops) / self.speed + probes * self.cfg.probe.insertion_time_s
        return [stops[i] for i in order], need

    def _plan(self, ctx: Context) -> list[int]:
        least = self.cfg.mapping.min_readings + 1
        n = ctx.budget
        while True:
            k = max(min(round(self.cover * n), n), least)
            route, need = self._finish(ctx, coverage_sites(self.cfg, ctx, k, self.rng), n)
            if ctx.t + need <= ctx.deadline or n <= least:
                return route
            n = max(int(0.9 * n), least)

    def choose(self, ctx: Context) -> int:
        if self._route is None:
            self._route = self._plan(ctx)
        todo = [j for j in self._route if not ctx.visited[j]]
        left = max(ctx.budget - len(ctx.readings), 1)
        if todo:
            w = self.cfg.weather
            rain = (
                [e.start_s + e.duration_s for e in w.rain if e.start_s < ctx.deadline] if w else []
            )
            dry_from = max(rain, default=0.0)
            if ctx.t < dry_from and dry_from + self._finish(ctx, todo, left)[1] <= ctx.deadline:
                self._rerouted = False
                far = ctx.graph.distances(ctx.position, [ctx.sites[j] for j in todo])
                return todo[int(np.argmax(far))]
            if not self._rerouted:
                self._route, self._rerouted = self._finish(ctx, todo, left)[0], True
                todo = self._route
            return todo[0]
        tau = self.cfg.probe.insertion_time_s
        cost = ctx.graph.distances(ctx.position, ctx.sites) / self.speed + tau
        spare = min(max(ctx.deadline - ctx.t - left * tau, 0.0) / left, 1e9)
        fits = ctx.t + cost + (left - 1) * tau <= ctx.deadline
        gains = acquisition(self.cfg, ctx)
        gain = uncertainty(self.cfg, ctx) if gains is None else gains[0] + self.w_dry * gains[1]
        ok = fits & ~ctx.visited
        if not ok.any():  # nothing fits any more: the cheapest site
            return _best(-cost, ctx.visited)
        return int(np.argmax(np.where(ok, gain / (cost + spare), -np.inf)))


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
    if name == PLANNED:
        return PlannedSurvey(cfg, rng)
    raise ValueError(f"unknown policy {name!r}; choose from {(*STRATEGIES, LEARNED)}")
