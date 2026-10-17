"""Survey simulation: drive, probe, map, score."""

import dataclasses
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from itertools import chain
from pathlib import Path

import numpy as np
import numpy.typing as npt

from agrisim.config import SimConfig
from agrisim.control import PurePursuit, drive_segment, poses
from agrisim.field import FieldLayout, ProbeSite
from agrisim.mapping import GridSpec, make_mapper
from agrisim.metrics import (
    ORACLES,
    ClairvoyantOracle,
    MapMetrics,
    RunMetrics,
    map_metrics,
    run_metrics,
    truth_on_grid,
)
from agrisim.planning import LaneGraph, LanePlanner, Waypoint
from agrisim.policies import FIXED, FIXED_PLUS, Context, Policy, Recheck, make_policy
from agrisim.rover import RoverState
from agrisim.safety import PlantContact, path_contacts
from agrisim.sensor import MoistureProbe, ProbeReading
from agrisim.soil import Anomaly, SoilTruth
from agrisim.weather import SoilDynamics, current_view

FloatArray = npt.NDArray[np.float64]


@dataclass(frozen=True, eq=False)
class RunResult:
    cfg: SimConfig
    seed: int
    policy: str
    layout: FieldLayout
    grid: GridSpec
    truth_grid: FloatArray  # truth at the end of the mission on the output grid (scoring, display)
    mean: FloatArray
    var: FloatArray
    readings: tuple[ProbeReading, ...]
    poses: FloatArray  # (S, 3)
    times: FloatArray  # (S,)
    contacts: tuple[PlantContact, ...]
    map_metrics: MapMetrics
    run_metrics: RunMetrics
    corr_length: float
    anomalies: tuple[Anomaly, ...]
    truth_at: "Truth"  # the truth at any mission time (scoring and display only)

    def maps(self) -> dict[str, FloatArray]:
        return {
            "truth": self.truth_grid,
            "estimate": self.mean,
            "abs_error": np.abs(self.mean - self.truth_grid),
            "variance": self.var,
        }


class Truth:
    """Hidden soil truth at mission time t: fixed, or changing with the weather."""

    def __init__(self, start: SoilTruth, dynamics: SoilDynamics | None) -> None:
        self.start, self.dynamics = start, dynamics

    def __call__(self, t: float) -> SoilTruth:
        return self.dynamics.at(t) if self.dynamics else self.start


def world_rngs(seed: int) -> tuple[np.random.Generator, ...]:
    """Independent streams for layout, soil, probe noise, policy, weather and positioning.

    Separate streams mean every policy sees the same field and soil for a given seed. Spawned
    children do not depend on how many are spawned, so adding a stream changes no other one.
    """
    return tuple(np.random.default_rng(s) for s in np.random.SeedSequence(seed).spawn(6))


def map_now(
    cfg: SimConfig, grid: GridSpec, readings: Sequence[ProbeReading], t: float
) -> tuple[FloatArray, FloatArray]:
    """The rover's map at time t from the readings so far (see weather.current_view)."""
    mapper = make_mapper(cfg.mapping)
    for r in current_view(readings, cfg.weather, t, cfg.soil.vwc_clip):
        mapper.update(r)
    return mapper.estimate(grid)


def _adaptive_legs(
    policy: Policy,
    cfg: SimConfig,
    layout: FieldLayout,
    budget: int,
    probes: int,
    readings: list[ProbeReading],
    here: ProbeSite,
) -> Iterator[list[Waypoint]]:
    """One leg per probe: lane-graph path from the current site to the chosen one.

    `readings` is the live list the driver appends to, so each choice sees every earlier probe.
    A site counts as visited once a reading was taken within half a site spacing of it. Going
    back to a visited site, the rover probes 0.15 m further along the lane, beside the old hole.
    """
    graph = LaneGraph.from_layout(layout)
    spacing = cfg.survey.candidate_spacing
    sites = tuple(layout.candidate_probe_sites(spacing))
    site_xy = np.array([(s.x, s.y) for s in sites])
    mid_x = (graph.x_west + graph.x_east) / 2
    for _ in range(probes):
        times = np.zeros(len(sites), dtype=int)
        for r in readings:
            d = np.hypot(site_xy[:, 0] - r.x, site_xy[:, 1] - r.y)
            if d.min() < spacing / 2:
                times[d.argmin()] += 1
        visited = times > 0
        if visited.all() and not isinstance(policy, Recheck):
            return
        t = readings[-1].t if readings else 0.0
        k = policy.choose(Context(here, sites, site_xy, visited, tuple(readings), graph, budget, t))
        site = sites[k]
        if times[k]:
            step = 0.15 * int(times[k]) * (1 if site.x < mid_x else -1)
            site = ProbeSite(site.x + step, site.y, site.lane)
        wps, _ = graph.shortest_path(here, site)
        yield [*wps[:-1], Waypoint(wps[-1].x, wps[-1].y, probe=True)]
        here = site


def run_survey(
    cfg: SimConfig,
    seed: int,
    policy: str = FIXED,
    rerun: bool = False,
    *,
    budget: int | None = None,
    rrd_path: Path | None = None,
    spawn: bool = True,
    model: Path | None = None,
) -> RunResult:
    """Simulate one survey. `policy`: one of policies.STRATEGIES ("full_coverage" = fixed) or
    "ppo" with `model` = path to a trained MaskablePPO zip."""
    policy = FIXED if policy == "full_coverage" else policy
    budget = cfg.survey.probe_budget if budget is None else budget
    rng_field, rng_soil, rng_probe, rng_policy, rng_weather, rng_pos = world_rngs(seed)
    layout = FieldLayout.generate(cfg.field, rng_field)
    start_soil = SoilTruth.generate(cfg.soil, layout, rng_soil)
    dynamics = None
    if cfg.weather is not None:
        dynamics = SoilDynamics(start_soil, cfg.weather, cfg.soil.vwc_clip, rng_weather)
    truth = Truth(start_soil, dynamics)
    grid = GridSpec.for_field(cfg.field, cfg.mapping.output_resolution)
    probe = MoistureProbe(cfg.probe)
    follower = PurePursuit(cfg.rover)
    readings: list[ProbeReading] = []
    graph = LaneGraph.from_layout(layout)

    legs: Iterator[list[Waypoint]]
    if policy in (FIXED, FIXED_PLUS):
        again = min(cfg.survey.recheck_probes, budget - 1) if policy == FIXED_PLUS else 0
        route = list(LanePlanner.plan_full_coverage(layout, cfg, budget - again).waypoints)
        legs = iter([route])
        if again:
            end = route[-1]
            lane = int(np.abs(layout.lane_y - end.y).argmin())
            chooser = make_policy(policy, cfg, rng_policy)
            end_site = ProbeSite(end.x, end.y, lane)
            legs = chain(
                legs, _adaptive_legs(chooser, cfg, layout, budget, again, readings, end_site)
            )
    else:
        if policy in ORACLES:  # the benchmark ceiling: reads the truth (reference only)
            chooser = ClairvoyantOracle(cfg, truth, policy)
        else:
            chooser = make_policy(policy, cfg, rng_policy, model)
        legs = _adaptive_legs(chooser, cfg, layout, budget, budget, readings, graph.start_site())

    viz = None
    if rerun:
        from agrisim.viz import RerunLogger

        viz = RerunLogger(cfg, layout, seed, rrd_path, spawn)

    start = graph.start_site()
    prev = Waypoint(start.x, start.y)
    states, times = [RoverState(start.x, start.y, 0.0)], [0.0]
    t = 0.0
    for leg in legs:
        for b in leg:
            seg = drive_segment(states[-1], (prev.x, prev.y), (b.x, b.y), follower, cfg.dt)
            seg_times = [t + cfg.dt * (k + 1) for k in range(len(seg))]
            t = seg_times[-1] if seg else t
            states += seg
            times += seg_times
            prev = b
            if viz:
                viz.log_drive(seg_times, seg)
            if not b.probe:
                continue
            t += cfg.probe.insertion_time_s
            here = states[-1]
            reading = probe.read(truth(t), here.x, here.y, t, rng_probe)
            if cfg.rover.along_row_error_std > 0:  # logged where the rover thinks it is
                err = float(rng_pos.normal(0.0, cfg.rover.along_row_error_std))
                reading = dataclasses.replace(reading, x=reading.x + err)
            readings.append(reading)
            states.append(here)
            times.append(t)
            if viz:
                viz.log_probe(reading)
                m, v = map_now(cfg, grid, readings, t)
                tg = truth_on_grid(truth(t), grid)
                maps = {"truth": tg, "estimate": m, "abs_error": np.abs(m - tg), "variance": v}
                viz.log_maps(t, maps, map_metrics(tg, m, v, cfg.mapping.dry_threshold).rmse)

    p = poses(states)
    hits = tuple(path_contacts(p, cfg.rover, layout))
    mean, var = map_now(cfg, grid, readings, t)
    truth_grid = truth_on_grid(truth(t), grid)
    if viz:
        viz.close()
    return RunResult(
        cfg=cfg,
        seed=seed,
        policy=policy,
        layout=layout,
        grid=grid,
        truth_grid=truth_grid,
        mean=mean,
        var=var,
        readings=tuple(readings),
        poses=p,
        times=np.array(times),
        contacts=hits,
        map_metrics=map_metrics(truth_grid, mean, var, cfg.mapping.dry_threshold),
        run_metrics=run_metrics(
            probes_used=len(readings),
            valid_probes=sum(r.valid for r in readings),
            poses=p,
            mission_time_s=t,
            layout=layout,
            plant_contacts=len(hits),
        ),
        corr_length=start_soil.corr_length,
        anomalies=start_soil.anomalies,
        truth_at=truth,
    )
