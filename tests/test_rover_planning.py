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


def test_lanes_without_probe_sites_get_no_stops(cfg: SimConfig) -> None:
    # A stem keep-out wider than half the row spacing leaves no candidate site on any lane.
    far = cfg.model_copy(update={"field": cfg.field.model_copy(update={"stem_keepout": 5.0})})
    plan = LanePlanner.plan_full_coverage(_layout(far, 0), far)
    assert plan.stops == ()
    assert len(plan.waypoints) == 2 * len(_layout(far, 0).lanes)


def test_tour_visits_every_stop_and_beats_the_given_order(cfg: SimConfig) -> None:
    from agrisim.policies import tour

    lay = _layout(cfg, 0)
    graph = LaneGraph.from_layout(lay)
    sites = lay.candidate_probe_sites(cfg.survey.candidate_spacing)
    stops = [sites[i] for i in np.random.default_rng(0).choice(len(sites), 25, replace=False)]
    order, length = tour(graph.start_site(), stops, graph)
    assert sorted(order) == list(range(25))
    pts = [graph.start_site(), *stops]
    given = sum(graph.distances(a, [b])[0] for a, b in itertools.pairwise(pts))
    assert length < 0.6 * given  # 294 m against 588 m for this draw
    walked = [graph.start_site(), *(stops[i] for i in order)]
    assert length == pytest.approx(
        sum(graph.distances(a, [b])[0] for a, b in itertools.pairwise(walked))
    )


def test_planned_survey_fits_its_plan_to_the_deadline(cfg: SimConfig) -> None:
    from agrisim.policies import PLANNED
    from agrisim.sim import run_survey

    roomy = run_survey(cfg, 3, PLANNED, budget=30, deadline=1500.0)
    assert max(r.t for r in roomy.readings) <= 1500.0  # every probe in time
    # Too little time for 30 probes: it plans fewer, spread over the whole field, instead of
    # running out of time part-way along a route (as spatial coverage does).
    gx, gy = np.meshgrid(np.arange(0.5, 30, 1.0), np.arange(0.5, 20, 1.0))
    cells = np.column_stack([gx.ravel(), gy.ravel()])

    def in_time(strategy: str) -> np.ndarray:
        res = run_survey(cfg, 4, strategy, budget=30, deadline=600.0)
        return np.array([(r.x, r.y) for r in res.readings if r.t <= 600.0])

    def gap(p: np.ndarray) -> float:  # farthest any cell is from a reading
        return float(np.linalg.norm(cells[:, None] - p[None], axis=2).min(axis=1).max())

    ours, theirs = in_time(PLANNED), in_time("spatial_coverage")
    assert len(ours) > len(theirs) and gap(ours) < 0.8 * gap(theirs)  # 26 vs 19; 5.9 vs 7.7 m


def test_planned_survey_waits_out_the_rain() -> None:
    from pathlib import Path

    from agrisim.config import load
    from agrisim.policies import PLANNED
    from agrisim.sim import run_survey

    rain = load(Path(__file__).resolve().parents[1] / "configs" / "scenarios" / "rain_shower.yaml")
    assert rain.weather is not None
    over = max(e.start_s + e.duration_s for e in rain.weather.rain)
    res = run_survey(rain, 0, PLANNED, budget=60, deadline=3000.0)
    assert max(r.t for r in res.readings) <= 3000.0
    assert sum(r.t >= over for r in res.readings) >= 40  # spatial coverage: 15 of 60


def test_dov_bids_only_on_the_most_uncertain_cells(cfg: SimConfig) -> None:
    from agrisim.sim import run_survey

    # Bidding on every site, the nearest one always won: it crawled along one lane (about 29 m
    # for 30 probes) and mapped worse than random.
    dov = [run_survey(cfg, s, "dov", budget=30) for s in range(3)]
    rand = [run_survey(cfg, s, "random", budget=30) for s in range(3)]
    assert min(r.run_metrics.path_length_m for r in dov) > 300  # 621 to 649 m
    for d, r in zip(dov, rand, strict=True):  # 0.025 to 0.035 against 0.033 to 0.047
        assert d.map_metrics.rmse < r.map_metrics.rmse


def test_misclassification_gain_peaks_at_the_edge_of_a_dry_patch(cfg: SimConfig) -> None:
    from agrisim.policies import Context, acquisition
    from agrisim.sensor import ProbeReading

    lay = _layout(cfg, 0)
    graph = LaneGraph.from_layout(lay)
    sites = tuple(lay.candidate_probe_sites(cfg.survey.candidate_spacing))
    xy = np.array([(s.x, s.y) for s in sites])
    patch = np.array([20.0, 10.6])  # a smooth wet field with one dry patch
    d2 = ((xy - patch) ** 2).sum(axis=1)
    value = 0.27 - 0.12 * np.exp(-d2 / 18)  # 0.15 at its centre, the threshold 0.18
    taken = np.random.default_rng(1).choice(len(sites), 30, replace=False)
    readings = tuple(ProbeReading(*xy[k], 0.0, float(value[k]), True) for k in taken)
    visited = np.zeros(len(sites), dtype=bool)
    visited[taken] = True
    out = acquisition(cfg, Context(graph.start_site(), sites, xy, visited, readings, graph, 40))
    assert out is not None
    ivr, emr = out
    assert np.isfinite(ivr).all() and np.isfinite(emr).all() and (emr >= -1e-12).all()
    assert np.sqrt(d2[int(np.argmax(emr))]) < 5.0  # where the threshold is in doubt
