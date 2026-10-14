"""Coverage planning on lane centrelines.

The rover may only travel along lane centrelines (constant y) and along the two headland
centrelines (x = headland/2 and x = length_x - headland/2), so it never crosses a plant row.
"""

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

from agrisim.config import SimConfig
from agrisim.field import FieldLayout, ProbeSite

FloatArray = npt.NDArray[np.float64]


@dataclass(frozen=True)
class Waypoint:
    x: float
    y: float
    probe: bool = False  # stop and probe on arrival


@dataclass(frozen=True)
class Plan:
    waypoints: tuple[Waypoint, ...]

    @property
    def stops(self) -> tuple[Waypoint, ...]:
        return tuple(w for w in self.waypoints if w.probe)

    @property
    def length(self) -> float:
        xy = np.array([(w.x, w.y) for w in self.waypoints])
        return float(np.linalg.norm(np.diff(xy, axis=0), axis=1).sum()) if len(xy) > 1 else 0.0


def _dedupe(points: list[Waypoint]) -> tuple[Waypoint, ...]:
    """Merge consecutive waypoints at the same spot, keeping the probe flag."""
    out: list[Waypoint] = []
    for p in points:
        if out and abs(out[-1].x - p.x) < 1e-9 and abs(out[-1].y - p.y) < 1e-9:
            out[-1] = Waypoint(p.x, p.y, out[-1].probe or p.probe)
        else:
            out.append(p)
    return tuple(out)


class LanePlanner:
    @staticmethod
    def plan_full_coverage(layout: FieldLayout, cfg: SimConfig, budget: int | None = None) -> Plan:
        """Boustrophedon over every lane, turning in place on the headland centrelines.

        Probe stops are placed every `survey.probe_spacing` m along each lane (snapped to the
        nearest candidate site). If that gives more stops than `budget` (default
        `survey.probe_budget`), stops are thinned evenly along the route.
        """
        budget = cfg.survey.probe_budget if budget is None else budget
        sites = layout.candidate_probe_sites(cfg.survey.candidate_spacing)
        route: list[tuple[float, float, bool]] = []  # x, y, is_candidate_stop
        for lane, line in enumerate(layout.lanes):
            (xw, y), (xe, _) = line.coords
            start, end = (xw, xe) if lane % 2 == 0 else (xe, xw)
            lane_x = np.array([s.x for s in sites if s.lane == lane])
            n_targets = int(abs(end - start) // cfg.survey.probe_spacing) + 1
            targets = start + np.sign(end - start) * cfg.survey.probe_spacing * np.arange(n_targets)
            snapped = {float(lane_x[np.abs(lane_x - t).argmin()]) for t in targets if len(lane_x)}
            stop_x = sorted(snapped, reverse=end < start)
            route += [(start, y, False), *((x, y, True) for x in stop_x), (end, y, False)]

        stop_idx = [i for i, r in enumerate(route) if r[2]]
        if len(stop_idx) > budget:
            keep = set(np.round(np.linspace(0, len(stop_idx) - 1, budget)).astype(int).tolist())
            chosen = {stop_idx[k] for k in keep}
        else:
            chosen = set(stop_idx)
        points = [Waypoint(x, y, i in chosen) for i, (x, y, _) in enumerate(route)]
        # Drop non-probe candidate points: they lie on the straight lane segment anyway.
        points = [p for i, p in enumerate(points) if p.probe or not route[i][2]]
        return Plan(_dedupe(points))


@dataclass(frozen=True, eq=False)
class LaneGraph:
    """Shortest paths restricted to lane and headland centrelines (exact, closed form)."""

    lane_y: FloatArray
    x_west: float
    x_east: float

    @classmethod
    def from_layout(cls, layout: FieldLayout) -> "LaneGraph":
        (xw, _), (xe, _) = layout.lanes[0].coords
        return cls(layout.lane_y, xw, xe)

    def start_site(self) -> ProbeSite:
        """Mission start: west end of the southmost lane."""
        return ProbeSite(self.x_west, float(self.lane_y[0]), 0)

    def distances(self, a: ProbeSite, sites: Sequence[ProbeSite]) -> FloatArray:
        """Path length from `a` to each site."""
        x = np.array([s.x for s in sites], dtype=np.float64)
        y = np.array([s.y for s in sites], dtype=np.float64)
        lane = np.array([s.lane for s in sites])
        via_w = (a.x - self.x_west) + np.abs(y - a.y) + (x - self.x_west)
        via_e = (self.x_east - a.x) + np.abs(y - a.y) + (self.x_east - x)
        return np.where(lane == a.lane, np.abs(x - a.x), np.minimum(via_w, via_e))

    def shortest_path(self, a: ProbeSite, b: ProbeSite) -> tuple[list[Waypoint], float]:
        """Waypoints from a to b (inclusive) and the path length."""
        if a.lane == b.lane:
            return [Waypoint(a.x, a.y), Waypoint(b.x, b.y)], abs(b.x - a.x)
        dy = abs(b.y - a.y)
        via_w = (a.x - self.x_west) + dy + (b.x - self.x_west)
        via_e = (self.x_east - a.x) + dy + (self.x_east - b.x)
        xs = self.x_west if via_w <= via_e else self.x_east
        pts = _dedupe(
            [Waypoint(a.x, a.y), Waypoint(xs, a.y), Waypoint(xs, b.y), Waypoint(b.x, b.y)]
        )
        return list(pts), min(via_w, via_e)
