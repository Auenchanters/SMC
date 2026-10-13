"""Survey simulation: drive, probe, map, score."""

import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import numpy.typing as npt

from agrisim.config import SimConfig
from agrisim.control import PurePursuit, drive_segment, poses
from agrisim.field import FieldLayout
from agrisim.mapping import GridSpec, make_mapper
from agrisim.metrics import MapMetrics, RunMetrics, map_metrics, run_metrics, truth_on_grid
from agrisim.planning import LanePlanner
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


def run_survey(
    cfg: SimConfig,
    seed: int,
    policy: str = "full_coverage",
    rerun: bool = False,
    *,
    budget: int | None = None,
    rrd_path: Path | None = None,
    spawn: bool = True,
) -> RunResult:
    if policy != "full_coverage":
        raise ValueError(f"unknown policy {policy!r}")
    rng_field, rng_soil, rng_probe, _ = world_rngs(seed)
    layout = FieldLayout.generate(cfg.field, rng_field)
    truth = SoilTruth.generate(cfg.soil, layout, rng_soil)
    grid = GridSpec.for_field(cfg.field, cfg.mapping.output_resolution)
    truth_grid = truth_on_grid(truth, grid)
    plan = LanePlanner.plan_full_coverage(layout, cfg, budget)
    mapper = make_mapper(cfg.mapping)
    probe = MoistureProbe(cfg.probe)
    follower = PurePursuit(cfg.rover)

    viz = None
    if rerun:
        from agrisim.viz import RerunLogger

        viz = RerunLogger(cfg, layout, seed, rrd_path, spawn)

    wps = plan.waypoints
    state = RoverState(wps[0].x, wps[0].y, math.atan2(wps[1].y - wps[0].y, wps[1].x - wps[0].x))
    states, times, readings = [state], [0.0], []
    t = 0.0
    for i, b in enumerate(wps):
        if i > 0:
            a = wps[i - 1]
            seg = drive_segment(states[-1], (a.x, a.y), (b.x, b.y), follower, cfg.dt)
            seg_times = [t + cfg.dt * (k + 1) for k in range(len(seg))]
            t = seg_times[-1] if seg else t
            states += seg
            times += seg_times
            if viz:
                viz.log_drive(seg_times, seg)
        if b.probe:
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
