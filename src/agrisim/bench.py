"""Benchmark: every strategy on every seed with the same probe budget."""

import csv
import dataclasses
import math
import multiprocessing
import sys
from collections.abc import Sequence
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy import stats

from agrisim.config import SimConfig
from agrisim.mapping import GlobalMeanMapper, IDWMapper, Mapper
from agrisim.metrics import map_metrics
from agrisim.policies import FIXED, STRATEGIES
from agrisim.sim import RunResult, run_survey
from agrisim.weather import current_view

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
    cfg = result.cfg
    end = result.run_metrics.mission_time_s
    for r in current_view(result.readings, cfg.weather, end, cfg.soil.vwc_clip):
        mapper.update(r)
    mean, var = mapper.estimate(result.grid)
    return map_metrics(result.truth_grid, mean, var, result.cfg.mapping.dry_threshold).rmse


def bench_one(job: tuple[SimConfig, int, str, int, Path | None]) -> BenchRow:
    """Top-level so it pickles for Windows `spawn` workers."""
    cfg, seed, strategy, budget, model = job
    res = run_survey(cfg, seed, strategy, budget=budget, model=model)
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


def full_speed() -> bool:
    """Pool initializer: opt this process out of Windows 11 EcoQoS throttling, which otherwise
    gives workers of a run started from a background terminal 0.3-0.45 of a core each.
    Best effort: True if Windows accepted it, False otherwise (other OS, older Windows)."""
    if sys.platform != "win32":
        return False
    try:
        import ctypes
        from ctypes import wintypes

        k32 = ctypes.WinDLL("kernel32")
        k32.GetCurrentProcess.restype = wintypes.HANDLE
        k32.SetProcessInformation.argtypes = (
            wintypes.HANDLE,
            ctypes.c_int,
            ctypes.c_void_p,
            wintypes.DWORD,
        )
        # PROCESS_POWER_THROTTLING_STATE: Version 1, ControlMask EXECUTION_SPEED, StateMask 0 (off)
        state = (wintypes.ULONG * 3)(1, 1, 0)
        process_power_throttling = 4
        ok = k32.SetProcessInformation(
            k32.GetCurrentProcess(), process_power_throttling, state, ctypes.sizeof(state)
        )
        return bool(ok)
    except Exception:  # never crash a run over speed
        return False


def run_benchmark(
    cfg: SimConfig,
    seeds: Sequence[int],
    budget: int,
    strategies: Sequence[str] = STRATEGIES,
    workers: int = 1,
    model: Path | None = None,
) -> list[BenchRow]:
    """Rows in strategy-major order. `model` is needed only for the "ppo" strategy."""
    strategies = [FIXED if s == "full_coverage" else s for s in strategies]
    jobs = [(cfg, s, name, budget, model) for name in strategies for s in seeds]
    if workers <= 1:
        return [bench_one(j) for j in jobs]
    ctx = multiprocessing.get_context("spawn")  # same behaviour on Windows and Linux
    with ProcessPoolExecutor(max_workers=workers, mp_context=ctx, initializer=full_speed) as pool:
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
    """'0-49' -> [0..49]; '1,5,9' -> [1, 5, 9]; mixtures like '0-2,7' work too.

    Raises ValueError for anything else, including reversed ranges such as '5-3'.
    """
    seeds: list[int] = []
    for part in text.split(","):
        lo, _, hi = part.strip().partition("-")
        try:
            a, b = int(lo), int(hi or lo)
        except ValueError:
            raise ValueError(f"bad seed range {part.strip()!r}; use e.g. 0-49 or 1,5,9") from None
        if a < 0 or b < a:
            raise ValueError(f"bad seed range {part.strip()!r}; use e.g. 0-49 or 1,5,9")
        seeds += range(a, b + 1)
    repeated = sorted({s for s in seeds if seeds.count(s) > 1})
    if repeated:  # a seed run twice would be counted twice in the mean and interval
        raise ValueError(f"seed(s) {repeated} listed more than once in {text!r}")
    return seeds
