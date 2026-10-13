import itertools
import math

import numpy as np
import pytest
import shapely
from scipy.spatial import KDTree

from agrisim.config import SimConfig
from agrisim.control import PurePursuit, drive_segment, poses
from agrisim.field import FieldLayout
from agrisim.planning import LaneGraph, LanePlanner, Plan, Waypoint
from agrisim.rover import RoverState, footprint, step
from agrisim.safety import contacts


def _layout(cfg: SimConfig, seed: int) -> FieldLayout:
    return FieldLayout.generate(cfg.field, np.random.default_rng(seed))


def _drive(plan: Plan, cfg: SimConfig) -> np.ndarray:
    wps = plan.waypoints
    heading = math.atan2(wps[1].y - wps[0].y, wps[1].x - wps[0].x)
    state = RoverState(wps[0].x, wps[0].y, heading)
    follower = PurePursuit(cfg.rover)
    states = [state]
    for a, b in itertools.pairwise(wps):
        states += drive_segment(states[-1], (a.x, a.y), (b.x, b.y), follower, cfg.dt)
    return poses(states)


def test_step_limits(cfg: SimConfig) -> None:
    s = step(RoverState(0, 0, 0), v=10.0, w=10.0, dt=1.0, cfg=cfg.rover)
    assert math.hypot(s.x, s.y) <= cfg.rover.max_speed + 1e-9
    assert abs(s.theta) == pytest.approx(cfg.rover.max_yaw_rate)


def test_full_coverage_visits_every_lane(cfg: SimConfig) -> None:
    lay = _layout(cfg, 0)
    plan = LanePlanner.plan_full_coverage(lay, cfg)
    ys = {round(w.y, 9) for w in plan.waypoints}
    assert ys == {round(float(y), 9) for y in lay.lane_y}
    # Each lane is driven end to end.
    (xw, _), (xe, _) = lay.lanes[0].coords
    for y in lay.lane_y:
        xs = [w.x for w in plan.waypoints if abs(w.y - y) < 1e-9]
        assert min(xs) == pytest.approx(xw)
        assert max(xs) == pytest.approx(xe)
    assert len(plan.stops) == cfg.survey.probe_budget
    # Unlimited budget: one stop every probe_spacing per lane.
    full = LanePlanner.plan_full_coverage(lay, cfg, budget=10_000)
    per_lane = math.floor((xe - xw) / cfg.survey.probe_spacing) + 1
    assert len(full.stops) == per_lane * len(lay.lanes)


def test_contacts_match_shapely(cfg: SimConfig) -> None:
    lay = _layout(cfg, 0)
    rng = np.random.default_rng(1)
    idx = rng.integers(0, len(lay.stems), 300)
    p = np.column_stack(
        [lay.stems[idx] + rng.normal(0, 0.4, (300, 2)), rng.uniform(-math.pi, math.pi, 300)]
    )
    hits = {(c.step, c.plant) for c in contacts(p, cfg.rover, lay)}
    discs = shapely.buffer(shapely.points(lay.stems), lay.canopy_radius, quad_segs=64)
    expected = set()
    for i, (x, y, th) in enumerate(p):
        fp = footprint(RoverState(x, y, th), cfg.rover)
        expected |= {(i, int(j)) for j in np.flatnonzero(shapely.intersects(fp, discs))}
    assert hits
    assert hits == expected


@pytest.mark.parametrize("seed", range(20))
def test_full_plan_has_zero_contacts(cfg: SimConfig, seed: int) -> None:
    lay = _layout(cfg, seed)
    p = _drive(LanePlanner.plan_full_coverage(lay, cfg), cfg)
    assert contacts(p, cfg.rover, lay, KDTree(lay.stems)) == []
    assert np.all(p[:, 0] - cfg.rover.turn_radius >= 0)
    assert np.all(p[:, 0] + cfg.rover.turn_radius <= cfg.field.length_x)


def test_shortest_path_stays_on_lanes_and_headlands(cfg: SimConfig) -> None:
    lay = _layout(cfg, 2)
    graph = LaneGraph.from_layout(lay)
    sites = lay.candidate_probe_sites(cfg.survey.candidate_spacing)
    rng = np.random.default_rng(0)
    lane_ys = set(np.round(lay.lane_y, 9))
    for _ in range(50):
        a, b = (sites[i] for i in rng.choice(len(sites), 2, replace=False))
        wps, length = graph.shortest_path(a, b)
        assert length == pytest.approx(graph.distances(a, [b])[0])
        xy = np.array([(w.x, w.y) for w in wps])
        assert length == pytest.approx(np.linalg.norm(np.diff(xy, axis=0), axis=1).sum())
        for (x0, y0), (x1, y1) in itertools.pairwise(xy):
            along_lane = abs(y0 - y1) < 1e-9 and round(y0, 9) in lane_ys
            along_headland = (
                abs(x0 - x1) < 1e-9 and min(abs(x0 - graph.x_west), abs(x0 - graph.x_east)) < 1e-9
            )
            assert along_lane or along_headland
    # Driving a cross-field path touches no plant.
    wps, _ = graph.shortest_path(sites[3], sites[-5])
    assert contacts(_drive(Plan(tuple(wps)), cfg), cfg.rover, lay) == []


def test_backtracking_in_a_lane_reverses_without_contact(cfg: SimConfig) -> None:
    lay = _layout(cfg, 0)
    y = float(lay.lane_y[3])
    wps = (Waypoint(5.0, y), Waypoint(20.0, y), Waypoint(8.0, y))
    p = _drive(Plan(wps), cfg)
    assert contacts(p, cfg.rover, lay) == []
    assert abs(p[-1, 0] - 8.0) < 0.02
    # Heading never flips: the rover reversed instead of turning around.
    assert np.abs(p[:, 2]).max() < 0.2
