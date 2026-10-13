"""Benchmark: every strategy on every seed with the same probe budget."""

import csv
import dataclasses
import math
import multiprocessing
from collections.abc import Sequence
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy import stats

from agrisim.config import SimConfig
from agrisim.mapping import GlobalMeanMapper, IDWMapper, Mapper
from agrisim.metrics import map_metrics
from agrisim.policies import STRATEGIES
from agrisim.sim import RunResult, run_survey

METRICS = (
    "rmse",
    "mae",
    "r2",
    "dry_precision",
    "dry_recall",
    "dry_f1",
    "calibration_95",
    "rmse_global_mean",
    "rmse_idw",
    "probes_used",
    "valid_probes",
    "path_length_m",
    "mission_time_s",
    "lane_coverage",
    "plant_contacts",
)


@dataclass(frozen=True)
class BenchRow:
    strategy: str
    seed: int
    budget: int
    rmse: float
    mae: float
    r2: float
    dry_precision: float
    dry_recall: float
    dry_f1: float
    calibration_95: float
    rmse_global_mean: float  # same readings, global-mean map
    rmse_idw: float  # same readings, IDW map
    probes_used: int
    valid_probes: int
    path_length_m: float
    mission_time_s: float
    lane_coverage: float
    plant_contacts: int


def _baseline_rmse(result: RunResult, mapper: Mapper) -> float:
    for r in result.readings:
        mapper.update(r)
    mean, var = mapper.estimate(result.grid)
    return map_metrics(result.truth_grid, mean, var, result.cfg.mapping.dry_threshold).rmse


def bench_one(job: tuple[SimConfig, int, str, int]) -> BenchRow:
    """Top-level so it pickles for Windows `spawn` workers."""
    cfg, seed, strategy, budget = job
    res = run_survey(cfg, seed, strategy, budget=budget)
    m, r = res.map_metrics, res.run_metrics
    return BenchRow(
        strategy=strategy,
        seed=seed,
        budget=budget,
        **{f.name: getattr(m, f.name) for f in dataclasses.fields(m) if f.name in METRICS},
        rmse_global_mean=_baseline_rmse(res, GlobalMeanMapper()),
        rmse_idw=_baseline_rmse(res, IDWMapper()),
        **dataclasses.asdict(r),
    )


def run_benchmark(
    cfg: SimConfig,
    seeds: Sequence[int],
    budget: int,
    strategies: Sequence[str] = STRATEGIES,
    workers: int = 1,
) -> list[BenchRow]:
    jobs = [(cfg, s, name, budget) for name in strategies for s in seeds]
    if workers <= 1:
        return [bench_one(j) for j in jobs]
    ctx = multiprocessing.get_context("spawn")  # same behaviour on Windows and Linux
    with ProcessPoolExecutor(max_workers=workers, mp_context=ctx) as pool:
        return list(pool.map(bench_one, jobs))


def mean_ci95(values: Sequence[float]) -> tuple[float, float, int]:
    """Mean, t-interval half-width and n over the finite values."""
    v = np.asarray(values, dtype=np.float64)
    v = v[np.isfinite(v)]
    n = len(v)
    if n == 0:
        return math.nan, math.nan, 0
    if n == 1:
        return float(v[0]), math.nan, 1
    half = float(stats.t.ppf(0.975, n - 1) * v.std(ddof=1) / math.sqrt(n))
    mean = float(v.mean())
    return mean, 0.0 if half <= 1e-9 * abs(mean) else half, n


def write_results(rows: Sequence[BenchRow], out_dir: Path) -> None:
    with (out_dir / "results.csv").open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=[f.name for f in dataclasses.fields(BenchRow)])
        w.writeheader()
        w.writerows(dataclasses.asdict(r) for r in rows)


def summary_markdown(rows: Sequence[BenchRow], title: str) -> str:
    strategies = list(dict.fromkeys(r.strategy for r in rows))
    seeds = sorted({r.seed for r in rows})
    budgets = sorted({r.budget for r in rows})
    lines = [
        f"# {title}",
        "",
        f"Seeds: {len(seeds)} ({seeds[0]}-{seeds[-1]}); probe budget: {budgets}. "
        "Each cell is mean +/- 95% t-interval half-width over seeds (n shown when some values "
        "are undefined). Soil and probe parameters are placeholders until calibrated, so these "
        "numbers compare strategies inside the simulator only.",
        "",
        "| metric | " + " | ".join(strategies) + " |",
        "|---|" + "---|" * len(strategies),
    ]
    for metric in METRICS:
        cells = []
        for s in strategies:
            mean, half, n = mean_ci95([getattr(r, metric) for r in rows if r.strategy == s])
            total = sum(r.strategy == s for r in rows)
            cell = f"{mean:.4g} +/- {half:.2g}" if math.isfinite(half) else f"{mean:.4g}"
            cells.append(cell + (f" (n={n})" if n != total else ""))
        lines.append(f"| {metric} | " + " | ".join(cells) + " |")
    lines += ["", "Kriging RMSE below the global-mean RMSE (same readings):", ""]
    for s in strategies:
        mine = [r for r in rows if r.strategy == s]
        wins = sum(r.rmse < r.rmse_global_mean for r in mine)
        lines.append(f"- {s}: {wins}/{len(mine)} seeds")
    return "\n".join(lines) + "\n"


def parse_seeds(text: str) -> list[int]:
    """'0-49' -> [0..49]; '1,5,9' -> [1, 5, 9]; mixtures like '0-2,7' work too."""
    seeds: list[int] = []
    for part in text.split(","):
        lo, _, hi = part.strip().partition("-")
        seeds += range(int(lo), int(hi or lo) + 1)
    return seeds
