"""Survey simulation: drive, probe, map, score."""

from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import numpy.typing as npt

from agrisim.config import SimConfig
from agrisim.control import PurePursuit, drive_segment, poses
from agrisim.field import FieldLayout
from agrisim.mapping import GridSpec, make_mapper
from agrisim.metrics import MapMetrics, RunMetrics, map_metrics, run_metrics, truth_on_grid
from agrisim.planning import LaneGraph, LanePlanner, Waypoint
from agrisim.policies import FIXED, Context, make_policy
from agrisim.rover import RoverState
from agrisim.safety import PlantContact, contacts
from agrisim.sensor import MoistureProbe, ProbeReading
from agrisim.soil import Anomaly, SoilTruth

FloatArray = npt.NDArray[np.float64]


@dataclass(frozen=True, eq=False)
class RunResult:
    cfg: SimConfig
    seed: int
    policy: str
    layout: FieldLayout
    grid: GridSpec
    truth_grid: FloatArray  # truth resampled to the output grid (for scoring and display only)
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

    def maps(self) -> dict[str, FloatArray]:
        return {
            "truth": self.truth_grid,
            "estimate": self.mean,
            "abs_error": np.abs(self.mean - self.truth_grid),
            "variance": self.var,
        }


def world_rngs(seed: int) -> tuple[np.random.Generator, ...]:
    """Independent streams for layout, soil, probe noise and policy.

    Separate streams mean every policy sees the same field and soil for a given seed.
    """
    return tuple(np.random.default_rng(s) for s in np.random.SeedSequence(seed).spawn(4))


def _adaptive_legs(
    policy_name: str,
    cfg: SimConfig,
    layout: FieldLayout,
    budget: int,
    readings: list[ProbeReading],
    rng: np.random.Generator,
) -> Iterator[list[Waypoint]]:
    """One leg per probe: lane-graph path from the current site to the chosen one.

    `readings` is the live list the driver appends to, so each choice sees every earlier probe.
    """
    policy = make_policy(policy_name, cfg, rng)
    graph = LaneGraph.from_layout(layout)
    sites = tuple(layout.candidate_probe_sites(cfg.survey.candidate_spacing))
    site_xy = np.array([(s.x, s.y) for s in sites])
    visited = np.zeros(len(sites), dtype=bool)
    here = graph.start_site()
    for _ in range(min(budget, len(sites))):
        k = policy.choose(Context(here, sites, site_xy, visited.copy(), tuple(readings), graph))
        visited[k] = True
        wps, _ = graph.shortest_path(here, sites[k])
        yield [*wps[:-1], Waypoint(wps[-1].x, wps[-1].y, probe=True)]
        here = sites[k]


def run_survey(
    cfg: SimConfig,
    seed: int,
    policy: str = FIXED,
    rerun: bool = False,
    *,
    budget: int | None = None,
    rrd_path: Path | None = None,
    spawn: bool = True,
) -> RunResult:
    """Simulate one survey. `policy` is one of policies.STRATEGIES ("full_coverage" = fixed)."""
    policy = FIXED if policy == "full_coverage" else policy
    budget = cfg.survey.probe_budget if budget is None else budget
    rng_field, rng_soil, rng_probe, rng_policy = world_rngs(seed)
    layout = FieldLayout.generate(cfg.field, rng_field)
    truth = SoilTruth.generate(cfg.soil, layout, rng_soil)
    grid = GridSpec.for_field(cfg.field, cfg.mapping.output_resolution)
    truth_grid = truth_on_grid(truth, grid)
    mapper = make_mapper(cfg.mapping)
    probe = MoistureProbe(cfg.probe)
    follower = PurePursuit(cfg.rover)
    readings: list[ProbeReading] = []

    legs: Iterator[list[Waypoint]]
    if policy == FIXED:
        legs = iter([list(LanePlanner.plan_full_coverage(layout, cfg, budget).waypoints)])
    else:
        legs = _adaptive_legs(policy, cfg, layout, budget, readings, rng_policy)

    viz = None
    if rerun:
        from agrisim.viz import RerunLogger

        viz = RerunLogger(cfg, layout, seed, rrd_path, spawn)

    start = LaneGraph.from_layout(layout).start_site()
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
            reading = probe.read(truth, here.x, here.y, t, rng_probe)
            readings.append(reading)
            mapper.update(reading)
            states.append(here)
            times.append(t)
            if viz:
                viz.log_probe(reading)
                m, v = mapper.estimate(grid)
                maps = {"truth": truth_grid, "estimate": m, "abs_error": np.abs(m - truth_grid)}
                maps["variance"] = v
                viz.log_maps(t, maps, map_metrics(truth_grid, m, v, cfg.mapping.dry_threshold).rmse)

    p = poses(states)
    hits = tuple(contacts(p, cfg.rover, layout))
    mean, var = mapper.estimate(grid)
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
        corr_length=truth.corr_length,
        anomalies=truth.anomalies,
    )
