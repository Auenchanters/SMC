"""agribench: the frozen benchmark suite behind `agrisim suite` and `agrisim gate`.

Protocol and the reasons for every rule: benchmarks/README.md. In short:
- Worlds (field, soil, probe, rover) are frozen files under a hash lock; only our entry
  (benchmarks/solution.yaml: a strategy and optional mapper settings) is free to change.
- Each task has a probe budget and a deadline: the map is scored at the deadline from the
  readings taken by then, against the truth at that moment. Driving costs time, so it counts.
- Scores are normalised per task metric: 0 = random probing, 100 = the clairvoyant oracle.
- Gates are decided on fresh fields, drawn from the key of the run (CI: the commit), that
  nobody can have tuned on. Fixed public fields track regressions against baseline.json.
- Statistics are paired by field: one-sided Wilcoxon signed-rank tests, Holm-corrected, and
  bootstrap intervals; the headline is the interquartile mean (Agarwal et al., NeurIPS 2021).
"""

import csv
import dataclasses
import hashlib
import json
import math
import multiprocessing
import os
import time
import warnings
from collections.abc import Callable, Iterable, Sequence
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Any, Literal, Self

import numpy as np
import numpy.typing as npt
import yaml
from pydantic import BaseModel, ConfigDict, Field, PositiveFloat, PositiveInt, model_validator
from scipy import stats

from agrisim.bench import full_speed, mean_ci95, parse_seeds
from agrisim.config import SimConfig, load
from agrisim.metrics import ORACLES, crps_gaussian, dry_f1, truth_on_grid
from agrisim.policies import LEARNED, STRATEGIES
from agrisim.sim import RunResult, map_now, run_survey

FloatArray = npt.NDArray[np.float64]
Tier = Literal["quick", "full"]
CANDIDATE = "candidate"  # rows of our entry carry this label
METRICS = ("rmse", "bias", "ubrmse", "crps", "coverage95", "dry_f1")
MAPPING_OVERRIDES = {"method", "variogram_model", "min_readings"}  # never the scoring settings
FAIL_ON = {  # statuses that fail each --fail-on level
    "hard": {"hard_fail", "regression"},
    "sota": {"hard_fail", "regression", "below_sota"},
    "saturation": {"hard_fail", "regression", "below_sota", "below_saturation"},
}
REFERENCES = (  # external accuracy levels for soil moisture (sources in benchmarks/README.md)
    ("SMAP mission requirement", "ubrmse", 0.04),
    ("factory-calibrated probe (TEROS 12 generic)", "rmse", 0.03),
    ("soil-calibrated probe (TEROS 12 specific)", "rmse", 0.02),
)
LOCKED = ("suite.yaml", "worlds")  # files under the hash lock (baseline.json is not)


class _Spec(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)


class TaskSpec(_Spec):
    name: str
    world: str  # path relative to the suite folder
    budget: PositiveInt
    deadline_s: PositiveFloat
    quick: bool = False  # also in the quick tier (every push)


class SuiteSpec(_Spec):
    version: PositiveInt
    saturation_target: float
    alpha: Annotated[float, Field(gt=0.0, lt=1.0)]
    regression_tolerance: Annotated[float, Field(ge=0.0)]
    bootstrap: PositiveInt
    floor: str
    oracles: tuple[str, ...]
    baselines: tuple[str, ...]
    ppo_model: str | None = None  # relative to the suite folder
    metrics: dict[str, Literal["lower", "higher"]]  # the gated metrics and their direction
    public_seeds: dict[Tier, str]
    fresh_seeds: dict[Tier, PositiveInt]
    tasks: tuple[TaskSpec, ...]

    @model_validator(mode="after")
    def _check(self) -> Self:
        known = {*STRATEGIES, LEARNED}
        bad = [s for s in (*self.baselines, self.floor) if s not in known]
        bad += [s for s in self.oracles if s not in ORACLES]
        if bad:
            raise ValueError(f"unknown strategies {bad}")
        if self.floor not in self.baselines:
            raise ValueError("the floor strategy must also be a baseline")
        if not self.oracles:
            raise ValueError("at least one oracle is needed for the ceiling")
        if unknown := set(self.metrics) - set(METRICS):
            raise ValueError(f"unknown metrics {sorted(unknown)}")
        if len({t.name for t in self.tasks}) != len(self.tasks):
            raise ValueError("task names must be unique")
        return self


class Solution(_Spec):
    """Our entry (benchmarks/solution.yaml): the strategy and optional mapper settings."""

    strategy: str
    mapping: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check(self) -> Self:
        if self.strategy in ORACLES:
            raise ValueError("an oracle reads the truth; it cannot be the entry")
        if self.strategy not in {*STRATEGIES, LEARNED}:
            raise ValueError(f"unknown strategy {self.strategy!r}")
        if bad := set(self.mapping) - MAPPING_OVERRIDES:
            raise ValueError(f"mapping may only set {sorted(MAPPING_OVERRIDES)}, not {bad}")
        return self


def _yaml(path: Path) -> Any:
    with path.open(encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


def load_suite(root: Path) -> SuiteSpec:
    return SuiteSpec.model_validate(_yaml(root / "suite.yaml"))


def load_solution(path: Path) -> Solution:
    return Solution.model_validate(_yaml(path))


# --- The lock: the frozen files and their hashes ---------------------------------------------


def lock_digest(root: Path) -> dict[str, str]:
    """sha256 of every locked file (line endings normalised, so Windows and Linux agree)."""
    files = [root / "suite.yaml", *sorted((root / "worlds").glob("*.yaml"))]
    return {
        f.relative_to(root).as_posix(): hashlib.sha256(
            f.read_bytes().replace(b"\r\n", b"\n")
        ).hexdigest()
        for f in files
    }


def lock_problems(root: Path) -> list[str]:
    lock = root / "LOCK.json"
    if not lock.is_file():
        return ["LOCK.json missing"]
    want: dict[str, str] = json.loads(lock.read_text(encoding="utf-8"))
    have = lock_digest(root)
    out = []
    for name in sorted(set(want) | set(have)):
        if name not in have:
            out.append(f"{name}: missing")
        elif name not in want:
            out.append(f"{name}: not in LOCK")
        elif want[name] != have[name]:
            out.append(f"{name}: changed")
    return out


def write_lock(root: Path) -> Path:
    path = root / "LOCK.json"
    path.write_text(json.dumps(lock_digest(root), indent=2) + "\n", encoding="utf-8")
    return path


# --- Planning and running the jobs -----------------------------------------------------------


def fresh_seeds(key: str, task: str, n: int) -> list[int]:
    """Seeds nobody has seen: from a hash of the key, at or above 2**31, so never a training
    seed (env.py draws those below 2**31 - 1) nor a public, development or paper seed."""
    return [
        2**31 + int.from_bytes(hashlib.sha256(f"{key}|{task}|{i}".encode()).digest()[:4], "big")
        for i in range(n)
    ]


def entry_config(world: SimConfig, sol: Solution) -> SimConfig:
    """The world with our entry's mapper settings (validated like any config)."""
    if not sol.mapping:
        return world
    data = world.model_dump()
    data["mapping"] = {**data["mapping"], **sol.mapping}
    return SimConfig.model_validate(data)


Job = tuple[str, str, int, str, SimConfig, int, float, float, Path | None]


@dataclass(frozen=True)
class Plan:
    jobs: list[Job]
    seeds: dict[str, dict[str, list[int]]]  # task -> split -> seeds
    notes: list[str]


def plan_jobs(
    spec: SuiteSpec,
    root: Path,
    sol: Solution,
    tier: Tier,
    key: str,
    ppo_ok: Callable[[Path, SimConfig], bool] | None = None,
    only: Sequence[str] = (),
) -> Plan:
    """Every (task, split, seed, strategy) run. Labels: CANDIDATE for our entry, else the name.

    `ppo_ok(model, cfg)` says whether the learned model fits a world (it loads torch, so the
    CLI passes it in); without it, ppo is skipped. `only`: run just these tasks of the tier
    (CI runs the full tier as one job per task).
    """
    if unknown := set(only) - {t.name for t in spec.tasks}:
        raise ValueError(f"unknown tasks {sorted(unknown)}")
    public = parse_seeds(spec.public_seeds[tier])
    model = (root / spec.ppo_model).resolve() if spec.ppo_model else None
    jobs: list[Job] = []
    seeds: dict[str, dict[str, list[int]]] = {}
    notes: list[str] = []
    for task in spec.tasks:
        if (tier == "quick" and not task.quick) or (only and task.name not in only):
            continue
        world = load(root / task.world)
        entry = entry_config(world, sol)
        threshold = world.mapping.dry_threshold  # scoring uses the frozen world's threshold
        seeds[task.name] = {
            "public": public,
            "fresh": fresh_seeds(key, task.name, spec.fresh_seeds[tier]),
        }
        runs: list[tuple[str, str, SimConfig]] = [(CANDIDATE, sol.strategy, entry)]
        for name in (*spec.baselines, *spec.oracles):
            if name == sol.strategy and not sol.mapping:
                continue  # the same runs as our entry
            if name == LEARNED and not (model and ppo_ok and ppo_ok(model, world)):
                notes.append(f"{task.name}: ppo skipped (no model fits this world)")
                continue
            runs.append((name, name, world))
        if sol.strategy == LEARNED and not (model and ppo_ok and ppo_ok(model, entry)):
            raise ValueError(f"{task.name}: the entry is ppo but no model fits this world")
        for split, split_seeds in seeds[task.name].items():
            for seed in split_seeds:
                for label, strategy, cfg in runs:
                    m = model if strategy == LEARNED else None
                    jobs.append(
                        (
                            task.name,
                            split,
                            seed,
                            f"{label}:{strategy}",
                            cfg,
                            task.budget,
                            task.deadline_s,
                            threshold,
                            m,
                        )
                    )
    if not jobs:
        raise ValueError(f"no task to run in the {tier} tier")
    return Plan(jobs, seeds, notes)


@dataclass(frozen=True)
class SuiteRow:
    task: str
    split: str  # "public" (fixed seeds) or "fresh" (drawn from the run's key)
    seed: int
    strategy: str  # CANDIDATE for our entry
    rmse: float
    bias: float
    ubrmse: float
    crps: float
    coverage95: float
    dry_f1: float
    probes_by_deadline: int
    valid_by_deadline: int
    mission_time_s: float  # the whole mission, even past the deadline
    path_length_m: float
    plant_contacts: int  # over the whole mission
    compute_s: float  # wall clock; not deterministic
    error: str = ""


def score_at_deadline(res: RunResult, deadline: float, threshold: float) -> dict[str, float]:
    """The map from the readings taken by the deadline, scored against the truth then."""
    cfg = res.cfg
    readings = [r for r in res.readings if r.t <= deadline]
    mean, var = map_now(cfg, res.grid, readings, deadline)
    mean = np.where(np.isfinite(mean), mean, cfg.soil.mean_vwc)  # no readings: the prior
    var = np.where(np.isfinite(var), var, cfg.soil.std_vwc**2)
    truth = truth_on_grid(res.truth_at(deadline), res.grid)
    err = mean - truth
    rmse, bias = float(np.sqrt((err**2).mean())), float(err.mean())
    return {
        "rmse": rmse,
        "bias": bias,
        "ubrmse": math.sqrt(max(rmse**2 - bias**2, 0.0)),  # SMAP / ISMN convention
        "crps": crps_gaussian(truth, mean, var),
        "coverage95": float((np.abs(err) <= 1.96 * np.sqrt(var)).mean()),
        "dry_f1": dry_f1(truth, mean, threshold),
        "probes_by_deadline": len(readings),
        "valid_by_deadline": sum(r.valid for r in readings),
    }


def suite_job(job: Job) -> SuiteRow:
    """Top-level so it pickles for Windows `spawn` workers. A crash becomes an error row."""
    task, split, seed, label_strategy, cfg, budget, deadline, threshold, model = job
    label, strategy = label_strategy.split(":", 1)
    start = time.perf_counter()
    try:
        res = run_survey(cfg, seed, strategy, budget=budget, model=model, deadline=deadline)
        s = score_at_deadline(res, deadline, threshold)
        r = res.run_metrics
        return SuiteRow(
            task=task,
            split=split,
            seed=seed,
            strategy=label,
            rmse=s["rmse"],
            bias=s["bias"],
            ubrmse=s["ubrmse"],
            crps=s["crps"],
            coverage95=s["coverage95"],
            dry_f1=s["dry_f1"],
            probes_by_deadline=int(s["probes_by_deadline"]),
            valid_by_deadline=int(s["valid_by_deadline"]),
            mission_time_s=r.mission_time_s,
            path_length_m=r.path_length_m,
            plant_contacts=r.plant_contacts,
            compute_s=time.perf_counter() - start,
        )
    except Exception as exc:  # recorded, and the status becomes hard_fail
        nan = math.nan
        return SuiteRow(
            task,
            split,
            seed,
            label,
            nan,
            nan,
            nan,
            nan,
            nan,
            nan,
            0,
            0,
            nan,
            nan,
            0,
            time.perf_counter() - start,
            f"{type(exc).__name__}: {exc}",
        )


THREAD_VARS = ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS")


def run_jobs(
    jobs: Sequence[Job], workers: int = 1, progress: Callable[[int, int], None] | None = None
) -> list[SuiteRow]:
    """All jobs, in order. `progress(done, total)` is called as results come in."""

    def collect(results: Iterable[SuiteRow]) -> list[SuiteRow]:
        out = []
        for row in results:
            out.append(row)
            if progress:
                progress(len(out), len(jobs))
        return out

    if workers <= 1:
        return collect(suite_job(j) for j in jobs)
    # One BLAS / torch thread per worker: otherwise every worker grabs every core and the
    # matrix-heavy strategies (mi_greedy, ppo) run 10x slower. Workers inherit this at spawn.
    saved = {v: os.environ.get(v) for v in THREAD_VARS}
    os.environ.update(dict.fromkeys(THREAD_VARS, "1"))
    try:
        ctx = multiprocessing.get_context("spawn")  # same behaviour on Windows and Linux
        with ProcessPoolExecutor(
            max_workers=workers, mp_context=ctx, initializer=full_speed
        ) as pool:
            return collect(pool.map(suite_job, jobs, chunksize=4))
    finally:
        for v, old in saved.items():
            if old is None:
                os.environ.pop(v, None)
            else:
                os.environ[v] = old


def write_rows(rows: Sequence[SuiteRow], path: Path) -> None:
    with path.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=[f.name for f in dataclasses.fields(SuiteRow)])
        w.writeheader()
        w.writerows(dataclasses.asdict(r) for r in rows)


# --- Statistics ------------------------------------------------------------------------------


def normalised(cand: FloatArray, floor: FloatArray, ceil: FloatArray, lower: bool) -> FloatArray:
    """100 * (how far from the floor) / (floor-to-ceiling gap), on means over the last axis.
    NaN where the ceiling is not better than the floor (the metric says nothing there)."""
    c, f, o = cand.mean(axis=-1), floor.mean(axis=-1), ceil.mean(axis=-1)
    gap, got = (f - o, f - c) if lower else (o - f, c - f)
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(gap > 0, 100 * got / gap, np.nan)


def holm(p: Sequence[float]) -> list[float]:
    """Holm-Bonferroni adjusted p-values (step-down, monotone)."""
    order = np.argsort(p, kind="stable")
    adj, run = [1.0] * len(p), 0.0
    for rank, i in enumerate(order):
        run = max(run, min(1.0, (len(p) - rank) * float(p[i])))
        adj[i] = run
    return adj


def one_sided_p(a: FloatArray, b: FloatArray, lower: bool) -> float:
    """Wilcoxon signed-rank p that `a` is better than `b` (paired by field); 1 if no evidence."""
    try:
        with warnings.catch_warnings():  # ties: scipy warns, and the p it returns is still valid
            warnings.simplefilter("ignore", RuntimeWarning)
            p = stats.wilcoxon(a, b, alternative="less" if lower else "greater").pvalue
    except ValueError:  # every difference is zero
        return 1.0
    return float(p) if math.isfinite(p) else 1.0


def win_rate(a: FloatArray, b: FloatArray, lower: bool) -> float:
    """Share of fields where `a` beats `b` (ties count half): rliable's probability of
    improvement on a paired design."""
    better = a < b if lower else a > b
    return float((better + 0.5 * (a == b)).mean())


# --- Analysis --------------------------------------------------------------------------------

Arrays = dict[str, dict[str, FloatArray]]  # label -> metric -> per-seed values (sorted by seed)
EXTRA = ("plant_contacts", "probes_by_deadline", "mission_time_s", "path_length_m", "seed")


def _arrays(rows: Sequence[SuiteRow], task: str, split: str) -> Arrays:
    by: dict[str, list[SuiteRow]] = {}
    for r in rows:
        if r.task == task and r.split == split:
            by.setdefault(r.strategy, []).append(r)
    return {
        label: {
            m: np.array([float(getattr(r, m)) for r in sorted(rs, key=lambda r: r.seed)])
            for m in (*METRICS, *EXTRA)
        }
        for label, rs in by.items()
    }


def _ceiling(arr: Arrays, oracles: Sequence[str], metric: str, lower: bool) -> str:
    means = {o: float(np.nanmean(arr[o][metric])) for o in oracles if o in arr}
    return (min if lower else max)(means, key=lambda o: means[o])


def _split_report(
    spec: SuiteSpec, arr: Arrays, rng: np.random.Generator, twin: str | None
) -> tuple[dict[str, Any], dict[str, FloatArray]]:
    """Strategy table, normalised scores and competitor tests for one task and split.
    Also returns the bootstrap replicates of each normalised score (for the overall IQM).
    `twin`: a baseline that is our entry itself (same strategy, no mapper change), not run twice.
    """
    cand = arr[CANDIDATE]
    table = {
        label: {m: list(mean_ci95(v[m].tolist())[:2]) for m in (*METRICS, *EXTRA[:-1])}
        for label, v in arr.items()
    }
    if twin:
        arr = {**arr, twin: cand}
    n = len(cand["seed"])
    idx = rng.integers(0, n, size=(spec.bootstrap, n))  # the same fields for every strategy
    baselines = [b for b in arr if b not in (CANDIDATE, twin, *spec.oracles)]
    scores: dict[str, Any] = {}
    sota: dict[str, Any] = {}
    reps: dict[str, FloatArray] = {}
    for metric, direction in spec.metrics.items():
        lower = direction == "lower"
        top = _ceiling(arr, spec.oracles, metric, lower)
        c, f, o = cand[metric], arr[spec.floor][metric], arr[top][metric]
        point = float(normalised(c, f, o, lower))
        boot = normalised(c[idx], f[idx], o[idx], lower)
        # A ceiling counts only if it is clearly above the floor on these fields; a tiny gap
        # would turn noise into huge normalised scores.
        ceiling_p = one_sided_p(o, f, lower)
        informative = math.isfinite(point) and ceiling_p < spec.alpha
        lo, hi = (
            (float(np.nanpercentile(boot, 2.5)), float(np.nanpercentile(boot, 97.5)))
            if informative
            else (math.nan, math.nan)
        )
        scores[metric] = {
            "score": point,
            "lo": lo,
            "hi": hi,
            "informative": informative,
            "ceiling_vs_floor_p": ceiling_p,
            "saturated": informative and lo >= spec.saturation_target,
            "floor": spec.floor,
            "ceiling": top,
        }
        if informative:
            reps[metric] = boot
        p = [one_sided_p(c, arr[b][metric], lower) for b in baselines]
        adj = holm(p)
        sota[metric] = {
            "beats_all": all(a < spec.alpha for a in adj),
            "vs": {
                b: {
                    "p_holm": adj[k],
                    "win_rate": win_rate(c, arr[b][metric], lower),
                    "mean_diff": float(np.nanmean(c - arr[b][metric])),
                }
                for k, b in enumerate(baselines)
            },
        }
    lower_of = {m: d == "lower" for m, d in spec.metrics.items()}
    board = {  # every strategy's normalised score on this split, as if it were the entry
        label: {
            m: float(normalised(v[m], arr[spec.floor][m], arr[sc["ceiling"]][m], lower_of[m]))
            for m, sc in scores.items()
            if sc["informative"]
        }
        for label, v in arr.items()
        if label != twin
    }
    return {"seeds": n, "strategies": table, "scores": scores, "sota": sota, "board": board}, reps


def _regression(
    spec: SuiteSpec,
    rows: Sequence[SuiteRow],
    baseline: dict[str, Any] | None,
    twin: str | None,
) -> dict[str, Any]:
    """Our entry on the public fields against the recorded baseline, per task metric:
    a regression drops by more than the tolerance AND is significant after Holm."""
    if not baseline or baseline.get("suite_version") != spec.version:
        return {"checked": False, "reason": "no baseline.json for this suite version", "items": []}
    items: list[dict[str, Any]] = []
    for task, old in baseline.get("tasks", {}).items():
        arr = _arrays(rows, task, "public")
        if CANDIDATE not in arr:
            continue
        if twin:
            arr[twin] = arr[CANDIDATE]
        seeds = arr[CANDIDATE]["seed"]
        common = np.isin(seeds, old["seeds"])
        if common.sum() < 5:
            continue
        pos = {s: k for k, s in enumerate(old["seeds"])}
        take = [pos[int(s)] for s in seeds[common]]
        for metric, direction in spec.metrics.items():
            lower = direction == "lower"
            new, was = arr[CANDIDATE][metric][common], np.array(old[metric])[take]
            top = _ceiling(arr, spec.oracles, metric, lower)
            f, o = arr[spec.floor][metric][common], arr[top][metric][common]
            delta = float(normalised(new, f, o, lower) - normalised(was, f, o, lower))
            unit = "points"
            if not math.isfinite(delta):  # no usable ceiling here: percent of the old mean
                change = float(new.mean() - was.mean()) * (-1 if lower else 1)
                delta, unit = 100 * change / max(abs(float(was.mean())), 1e-12), "% of old mean"
            items.append(
                {
                    "task": task,
                    "metric": metric,
                    "delta": delta,
                    "unit": unit,
                    "p": one_sided_p(was, new, lower),  # small p: the old entry was better
                    "seeds": int(common.sum()),
                }
            )
    for item, adj in zip(items, holm([i["p"] for i in items]), strict=True):
        item["p_holm"] = adj
        item["regressed"] = (
            math.isfinite(item["delta"])
            and item["delta"] < -spec.regression_tolerance
            and adj < spec.alpha
        )
    return {"checked": bool(items), "reason": "" if items else "no common seeds", "items": items}


def analyse(
    spec: SuiteSpec,
    sol: Solution,
    tier: Tier,
    plan: Plan,
    rows: Sequence[SuiteRow],
    baseline: dict[str, Any] | None,
    meta: dict[str, Any],
) -> dict[str, Any]:
    """Everything the report says, as plain data (written to report.json)."""
    rng = np.random.default_rng(spec.version)  # the same intervals on every rerun
    twin = sol.strategy if sol.strategy in spec.baselines and not sol.mapping else None
    errors = [f"{r.task}/{r.split}/{r.seed}/{r.strategy}: {r.error}" for r in rows if r.error]
    contacts = [
        f"{r.task}/{r.split}/{r.seed}/{r.strategy}: {r.plant_contacts} plant contacts"
        for r in rows
        if r.plant_contacts > 0
    ]
    tasks: dict[str, Any] = {}
    reps: list[FloatArray] = []
    points: list[float] = []
    for t in spec.tasks:
        if t.name not in plan.seeds:
            continue
        entry: dict[str, Any] = {
            "world": t.world,
            "budget": t.budget,
            "deadline_s": t.deadline_s,
            "splits": {},
        }
        for split in ("public", "fresh"):
            out, boot = _split_report(spec, _arrays(rows, t.name, split), rng, twin)
            entry["splits"][split] = out
            if split == "fresh":
                for metric, b in boot.items():
                    reps.append(b)
                    points.append(out["scores"][metric]["score"])
        gaps = {}
        for metric in spec.metrics:
            pub, fre = (entry["splits"][s]["scores"][metric] for s in ("public", "fresh"))
            gaps[metric] = {
                "public_minus_fresh": pub["score"] - fre["score"],
                "suspect": bool(pub["lo"] > fre["hi"]),  # intervals apart: tuned to public?
            }
        entry["generalisation"] = gaps
        tasks[t.name] = entry
    overall: dict[str, Any] = {"iqm": math.nan, "lo": math.nan, "hi": math.nan, "n": len(points)}
    boards = [t["splits"]["fresh"]["board"] for t in tasks.values()]
    labels = [lb for lb in boards[0] if all(lb in b for b in boards)] if boards else []
    leaderboard = {  # IQM of each strategy's task-metric scores, fresh fields
        lb: float(stats.trim_mean([x for b in boards for x in b[lb].values()], 0.25))
        for lb in labels
        if any(b[lb] for b in boards)
    }
    leaderboard = dict(sorted(leaderboard.items(), key=lambda kv: -kv[1]))
    if points:
        boot_iqm = stats.trim_mean(np.column_stack(reps), 0.25, axis=1)
        overall |= {
            "iqm": float(stats.trim_mean(points, 0.25)),
            "lo": float(np.nanpercentile(boot_iqm, 2.5)),
            "hi": float(np.nanpercentile(boot_iqm, 97.5)),
        }
    fresh = [(n, e["splits"]["fresh"]) for n, e in tasks.items()]
    every = [(n, m, s) for n, f in fresh for m, s in f["scores"].items()]
    sota_items = [(n, m, s) for n, f in fresh for m, s in f["sota"].items()]
    regression = _regression(spec, rows, baseline, twin)
    regressed = [i for i in regression["items"] if i["regressed"]]
    gates = {
        "hard": {
            "passed": not (errors or contacts or meta.get("lock_problems")),
            "errors": errors[:50],
            "plant_contacts": contacts[:50],
            "lock_problems": meta.get("lock_problems", []),
        },
        "regression": {"passed": not regressed, **regression},
        "sota": {
            "passed": sum(s["beats_all"] for _, _, s in sota_items),
            "total": len(sota_items),
        },
        "saturation": {  # a metric whose ceiling is not clearly above the floor never passes
            "passed": sum(s["saturated"] for _, _, s in every),
            "total": len(every),
            "uninformative": [f"{n}/{m}" for n, m, s in every if not s["informative"]],
        },
    }
    if not gates["hard"]["passed"]:
        status = "hard_fail"
    elif regressed:
        status = "regression"
    elif gates["sota"]["passed"] < gates["sota"]["total"]:
        status = "below_sota"
    elif not every or gates["saturation"]["passed"] < gates["saturation"]["total"]:
        status = "below_saturation"
    else:
        status = "saturated"
    return {
        "suite": f"agribench v{spec.version}",
        "tier": tier,
        "status": status,
        "entry": {"strategy": sol.strategy, "mapping": sol.mapping},
        "saturation_target": spec.saturation_target,
        "alpha": spec.alpha,
        **meta,
        "seeds": {"public": spec.public_seeds[tier], "fresh_per_task": spec.fresh_seeds[tier]},
        "overall": overall,
        "leaderboard": leaderboard,
        "gates": gates,
        "tasks": tasks,
        "notes": plan.notes,
    }


def fails(status: str, level: str) -> bool:
    return status in FAIL_ON[level]


def baseline_from(
    rows: Sequence[SuiteRow],
    spec: SuiteSpec,
    sol: Solution,
    meta: dict[str, Any],
    old: dict[str, Any] | None,
) -> dict[str, Any]:
    """baseline.json from this run's public fields (tasks not run keep their old entry)."""
    keep = old if old and old.get("suite_version") == spec.version else {}
    tasks = dict(keep.get("tasks", {}))
    for task in dict.fromkeys(r.task for r in rows):
        arr = _arrays(rows, task, "public").get(CANDIDATE)
        if arr is not None:
            tasks[task] = {"seeds": arr["seed"].astype(int).tolist()} | {
                m: arr[m].tolist() for m in spec.metrics
            }
    return {
        "suite_version": spec.version,
        "entry": {"strategy": sol.strategy, "mapping": sol.mapping},
        "commit": meta.get("commit", ""),
        "tasks": tasks,
    }


# --- Report ----------------------------------------------------------------------------------

STATUS_TEXT = {
    "hard_fail": "HARD FAIL: a crash, a plant contact, or edited benchmark files",
    "regression": "REGRESSION: worse than baseline.json on the public fields",
    "below_sota": "BELOW STATE OF THE ART: does not beat every published baseline yet",
    "below_saturation": "NOT SATURATED: beats every baseline, still short of the oracle",
    "saturated": "SATURATED: within reach of the clairvoyant oracle on every task (make v2)",
}


def _f(x: float, nd: int = 4) -> str:
    return "n/a" if not math.isfinite(x) else f"{x:.{nd}g}"


def report_markdown(rep: dict[str, Any]) -> str:
    g, o = rep["gates"], rep["overall"]
    entry = rep["entry"]
    lines = [
        f"# {rep['suite']} ({rep['tier']} tier)",
        "",
        f"**{STATUS_TEXT[rep['status']]}**",
        "",
        f"Entry: `{entry['strategy']}`"
        + (f", mapping {entry['mapping']}" if entry["mapping"] else "")
        + f". Commit `{rep.get('commit') or 'unknown'}`, fresh key `{rep.get('fresh_key')}`.",
        f"Fields: public seeds {rep['seeds']['public']}; plus {rep['seeds']['fresh_per_task']} "
        "fresh fields per task that nobody has seen (the gates use only these).",
        "",
        f"Overall score (interquartile mean over task metrics, fresh fields): **{_f(o['iqm'], 3)}**"
        f" [95% CI {_f(o['lo'], 3)}, {_f(o['hi'], 3)}]. 0 = random probing, 100 = the "
        f"clairvoyant oracle; saturation needs every task metric's lower bound >= "
        f"{rep['saturation_target']:g}.",
        "",
        "| gate | result |",
        "|---|---|",
        f"| hard: no crash, no plant contact, benchmark files match LOCK.json | "
        f"{'pass' if g['hard']['passed'] else 'FAIL'} |",
        "| no regression against baseline.json (public fields) | "
        + (
            ("pass" if g["regression"]["passed"] else "FAIL")
            if g["regression"]["checked"]
            else f"not checked ({g['regression']['reason']})"
        )
        + " |",
        f"| beats every baseline (one-sided Wilcoxon, Holm, alpha {rep['alpha']}) | "
        f"{g['sota']['passed']}/{g['sota']['total']} task metrics |",
        f"| saturated (lower 95% bound >= {rep['saturation_target']:g}) | "
        f"{g['saturation']['passed']}/{g['saturation']['total']} task metrics |",
        "",
    ]
    for key in ("errors", "plant_contacts", "lock_problems"):
        lines += [f"- {key}: {x}" for x in g["hard"][key]]
    lines += [
        f"- regression: {i['task']}/{i['metric']} {i['delta']:+.1f} {i['unit']} (p_holm "
        f"{i['p_holm']:.3g})"
        for i in g["regression"]["items"]
        if i["regressed"]
    ]
    lines += [
        "",
        "## Leaderboard (fresh fields)",
        "",
        "Each strategy scored as if it were the entry: interquartile mean of its normalised task "
        "metric scores (point estimates; only our entry gets intervals and tests above).",
        "",
        "| rank | strategy | score |",
        "|---|---|---|",
    ]
    lines += [
        f"| {k + 1} | {'**our entry**' if lb == CANDIDATE else lb} | {_f(v, 3)} |"
        for k, (lb, v) in enumerate(rep.get("leaderboard", {}).items())
    ]
    lines += ["", "## Against external accuracy levels (our entry, fresh fields)", ""]
    lines += ["| task | RMSE | bias | ubRMSE | " + " | ".join(r[0] for r in REFERENCES) + " |"]
    lines += ["|---|---|---|---|" + "---|" * len(REFERENCES)]
    for name, t in rep["tasks"].items():
        s = t["splits"]["fresh"]["strategies"][CANDIDATE]
        hits = ["yes" if s[m][0] <= lim else "no" for _, m, lim in REFERENCES]
        lines.append(
            f"| {name} | {_f(s['rmse'][0])} | {_f(s['bias'][0])} | {_f(s['ubrmse'][0])} | "
            + " | ".join(hits)
            + " |"
        )
    lines += [
        "",
        "These are accuracy levels for a whole map, compared against single sensors or satellite "
        "pixels, so read them as orientation, not as a like-for-like ranking.",
        "",
    ]
    for name, t in rep["tasks"].items():
        fresh = t["splits"]["fresh"]
        lines += [
            f"## {name}: {t['world']}, {t['budget']} probes, deadline {t['deadline_s'] / 60:g} min",
            "",
            "Our entry's normalised score (fresh fields; public fields in brackets):",
            "",
            "| metric | score [95% CI] | public | ceiling | not yet beaten (Holm p) | flag |",
            "|---|---|---|---|---|---|",
        ]
        for metric, sc in fresh["scores"].items():
            pub = t["splits"]["public"]["scores"][metric]["score"]
            flag = "tuned to public fields?" if t["generalisation"][metric]["suspect"] else ""
            if not sc["informative"]:
                flag = f"ceiling not clearly above floor (p {sc['ceiling_vs_floor_p']:.2g})"
            vs = fresh["sota"][metric]["vs"]
            alpha = rep["alpha"]
            unbeaten = [f"{b} ({v['p_holm']:.2g})" for b, v in vs.items() if v["p_holm"] >= alpha]
            lines.append(
                f"| {metric} | {_f(sc['score'], 3)} [{_f(sc['lo'], 3)}, {_f(sc['hi'], 3)}] | "
                f"{_f(pub, 3)} | {sc['ceiling']} | {', '.join(unbeaten) or 'none'} | {flag} |"
            )
        cols = [*rep_metrics(fresh), "probes_by_deadline", "mission_time_s", "plant_contacts"]
        lines += [
            "",
            f"Every strategy on the {fresh['seeds']} fresh fields (mean +/- 95% t-interval):",
            "",
            "| strategy | " + " | ".join(cols) + " | beats ours on |",
            "|---|" + "---|" * (len(cols) + 1),
        ]
        first = next(iter(fresh["scores"]))
        for label, s in fresh["strategies"].items():
            vs = fresh["sota"][first]["vs"].get(label)
            cells = [f"{_f(s[c][0])} +/- {_f(s[c][1], 2)}" for c in cols]
            win = f"{1 - vs['win_rate']:.2f}" if vs else ""
            lines.append(f"| {label} | " + " | ".join(cells) + f" | {win} |")
        lines += ["", f"(beats ours on: share of fields where it has the better {first}.)", ""]
    if rep["notes"]:
        lines += ["## Notes", "", *[f"- {n}" for n in rep["notes"]], ""]
    return "\n".join(lines) + "\n"


def rep_metrics(split: dict[str, Any]) -> list[str]:
    return [*split["scores"], "ubrmse", "coverage95"]
