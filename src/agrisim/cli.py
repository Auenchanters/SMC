"""Typer command-line interface: run, bench, train, eval (added milestone by milestone)."""

from pathlib import Path
from typing import TYPE_CHECKING, Annotated, cast

import typer

from agrisim import __version__

if TYPE_CHECKING:
    from agrisim.config import SimConfig

app = typer.Typer(no_args_is_help=True, add_completion=False)

ConfigOpt = Annotated[
    Path, typer.Option("--config", exists=True, dir_okay=False, help="YAML config")
]


def _load(config: Path) -> "SimConfig":
    """Load a config; report validation problems as one clean CLI error, not a traceback."""
    import yaml
    from pydantic import ValidationError

    from agrisim.config import load

    try:
        return load(config)
    except ValidationError as exc:
        msgs = "; ".join(_issue(e["loc"], e["msg"]) for e in exc.errors())
        raise typer.BadParameter(f"{config}: {msgs}", param_hint="--config") from None
    except yaml.YAMLError as exc:
        msg = f"{config} is not valid YAML: {exc}"
        raise typer.BadParameter(msg, param_hint="--config") from None
    except UnicodeDecodeError:
        raise typer.BadParameter(f"{config} is not UTF-8 text", param_hint="--config") from None
    except (OSError, TypeError, AttributeError) as exc:  # missing extends: file, non-mapping YAML
        raise typer.BadParameter(f"{config}: {exc}", param_hint="--config") from None


def _issue(loc: tuple[int | str, ...], msg: str) -> str:
    msg = msg.removeprefix("Value error, ")
    return f"{'.'.join(map(str, loc))}: {msg}" if loc else msg


def _out_root(out: Path) -> Path:
    if out.exists() and not out.is_dir():
        raise typer.BadParameter(f"{out} is a file, not a folder", param_hint="--out")
    return out


def _check_model(model: Path, cfg: "SimConfig") -> None:
    from agrisim.env import LearnedPolicy

    try:
        LearnedPolicy.load(model, cfg)
    except ValueError as exc:
        raise typer.BadParameter(str(exc), param_hint="--model") from None


def _serve(run_dir: Path, browser: bool, port: int) -> None:
    from agrisim.view3d import serve

    try:
        serve(run_dir, open_browser=browser, port=port)
    except OSError as exc:  # port taken or not allowed
        msg = f"cannot listen on port {port}: {exc}"
        raise typer.BadParameter(msg, param_hint="--port") from None


def _seeds(text: str) -> list[int]:
    from agrisim.bench import parse_seeds

    try:
        return parse_seeds(text)
    except ValueError as exc:
        raise typer.BadParameter(str(exc), param_hint="--seeds") from None


@app.callback()
def main() -> None:
    """agrisim: soil-moisture survey simulator."""


@app.command()
def version() -> None:
    """Print the agrisim version."""
    typer.echo(__version__)


@app.command()
def run(
    config: ConfigOpt,
    seed: Annotated[int, typer.Option(min=0, help="Run seed")] = 0,
    rerun: Annotated[bool, typer.Option("--rerun", help="Open a Rerun viewer, save .rrd")] = False,
    budget: Annotated[int | None, typer.Option(help="Probe budget (default: config)")] = None,
    policy: Annotated[
        str,
        typer.Option(help="fixed_spacing, random, greedy_variance, greedy_variance_per_cost, ppo"),
    ] = "fixed_spacing",
    model: Annotated[
        Path | None, typer.Option(exists=True, dir_okay=False, help="model.zip for --policy ppo")
    ] = None,
    out: Annotated[Path, typer.Option(help="Root folder for run outputs")] = Path("runs"),
    view: Annotated[
        bool, typer.Option("--view", help="Replay the survey in 3D in your browser afterwards")
    ] = False,
) -> None:
    """Run one survey and write runs/<UTC timestamp>_seed<seed>/."""
    from agrisim.io import new_dir, run_dir_name, save_run
    from agrisim.policies import LEARNED, STRATEGIES
    from agrisim.sim import run_survey

    valid = (*STRATEGIES, LEARNED, "full_coverage")
    if policy not in valid:
        raise typer.BadParameter(f"unknown policy {policy!r}; choose from {valid}")
    if policy == LEARNED and model is None:
        raise typer.BadParameter("--policy ppo needs --model <model.zip>")
    if policy != LEARNED and model is not None:
        raise typer.BadParameter("--model is only used with --policy ppo")
    if budget is not None and budget < 1:
        raise typer.BadParameter("--budget must be at least 1")
    cfg = _load(config)
    if model is not None:
        _check_model(model, cfg)
    out_dir = new_dir(_out_root(out), run_dir_name(seed))
    rrd = out_dir / "recording.rrd"
    result = run_survey(cfg, seed, policy, rerun=rerun, budget=budget, rrd_path=rrd, model=model)
    save_run(result, out_dir)
    m, r = result.map_metrics, result.run_metrics
    typer.echo(f"run folder     {out_dir}")
    typer.echo(f"policy         {result.policy}")
    typer.echo(f"RMSE / MAE     {m.rmse:.4f} / {m.mae:.4f} m3/m3   R2 {m.r2:.3f}")
    typer.echo(
        f"dry cells      precision {m.dry_precision:.3f}  recall {m.dry_recall:.3f}  "
        f"F1 {m.dry_f1:.3f}  (truth dry fraction {m.truth_dry_fraction:.3f})"
    )
    typer.echo(f"calibration95  {m.calibration_95:.3f}")
    typer.echo(f"probes         {r.valid_probes} valid / {r.probes_used} used")
    typer.echo(f"path / time    {r.path_length_m:.1f} m / {r.mission_time_s:.0f} s")
    typer.echo(f"lane coverage  {r.lane_coverage:.3f}")
    typer.echo(f"plant contacts {r.plant_contacts}")
    typer.echo("Note: soil and probe parameters are placeholders until calibrated.")
    if view:
        from agrisim.view3d import write_scene

        write_scene(result, out_dir)
        _serve(out_dir, True, 0)


@app.command()
def view(
    run_dir: Annotated[
        Path, typer.Argument(exists=True, file_okay=False, help="A run folder made with --view")
    ],
    port: Annotated[
        int, typer.Option(min=0, max=65535, help="Port on 127.0.0.1 (0 = any free port)")
    ] = 0,
    browser: Annotated[bool, typer.Option(help="Open the page in your browser")] = True,
) -> None:
    """Replay a finished survey in 3D in your browser (needs the run's scene.json)."""
    from agrisim.view3d import SCENE

    if not (run_dir / SCENE).is_file():
        raise typer.BadParameter(
            f"{run_dir} has no {SCENE}; make one with: agrisim run ... --view",
            param_hint="RUN_DIR",
        )
    _serve(run_dir, browser, port)


@app.command()
def bench(
    config: ConfigOpt,
    seeds: Annotated[str, typer.Option(help="Seeds, e.g. 0-49 or 1,5,9")] = "0-49",
    budget: Annotated[int, typer.Option(help="Probe budget, same for every strategy")] = 30,
    strategies: Annotated[str, typer.Option(help="Comma-separated; default all")] = "",
    workers: Annotated[int, typer.Option(min=1, help="Worker processes (1 = serial)")] = 1,
    out: Annotated[Path, typer.Option(help="Root folder for outputs")] = Path("runs"),
) -> None:
    """Run every strategy on every seed; write runs/bench_<timestamp>/results.csv and summary.md."""
    from datetime import UTC, datetime

    from agrisim.bench import run_benchmark, summary_markdown, write_results
    from agrisim.io import new_dir
    from agrisim.policies import STRATEGIES

    names = [s.strip() for s in strategies.split(",") if s.strip()] or list(STRATEGIES)
    unknown = set(names) - {*STRATEGIES, "full_coverage"}
    if unknown:
        raise typer.BadParameter(f"unknown strategies {sorted(unknown)}; choose from {STRATEGIES}")
    if budget < 1:
        raise typer.BadParameter("--budget must be at least 1")
    seed_list = _seeds(seeds)
    cfg = _load(config)
    out_dir = new_dir(_out_root(out), f"bench_{datetime.now(UTC):%Y%m%dT%H%M%SZ}")
    rows = run_benchmark(cfg, seed_list, budget, names, workers)
    write_results(rows, out_dir)
    text = summary_markdown(rows, f"agrisim bench: {config.name}, budget {budget}")
    (out_dir / "summary.md").write_text(text, encoding="utf-8")
    typer.echo(text)
    typer.echo(f"wrote {out_dir}")


def _ppo_fits(model: Path, cfg: "SimConfig") -> bool:
    from agrisim.env import LearnedPolicy

    try:
        LearnedPolicy.load(model, cfg)
    except (ValueError, OSError):
        return False
    return True


def _commit() -> str:
    import subprocess

    try:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True, timeout=10
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return out.stdout.strip()


@app.command()
def suite(
    tier: Annotated[str, typer.Option(help="quick (every push) or full")] = "quick",
    tasks: Annotated[str, typer.Option(help="Comma-separated tasks; default: the whole tier")] = "",
    suite_dir: Annotated[
        Path, typer.Option("--suite", file_okay=False, help="Frozen suite folder")
    ] = Path("benchmarks/v1"),
    solution: Annotated[Path, typer.Option(dir_okay=False, help="Our entry")] = Path(
        "benchmarks/solution.yaml"
    ),
    workers: Annotated[int, typer.Option(min=1, help="Worker processes (1 = serial)")] = 1,
    fresh_key: Annotated[
        str, typer.Option(help="Key for the fresh fields (CI: the commit); default: random")
    ] = "",
    out: Annotated[Path, typer.Option(help="Root folder for outputs")] = Path("runs"),
    fail_on: Annotated[
        str, typer.Option(help="Exit 1 at: hard, sota or saturation (strictest)")
    ] = "saturation",
    update_baseline: Annotated[
        bool, typer.Option("--update-baseline", help="Record this run as the new baseline")
    ] = False,
    write_lock: Annotated[
        bool, typer.Option("--write-lock", help="Re-hash the frozen files, then stop")
    ] = False,
) -> None:
    """Run agribench: our entry against every baseline and the oracle, on frozen worlds and on
    fresh fields; write runs/suite_<timestamp>/report.md, report.json and rows.csv."""
    import json
    import secrets
    from datetime import UTC, datetime

    from pydantic import ValidationError

    from agrisim import suite as sb
    from agrisim.io import new_dir

    if tier not in ("quick", "full"):
        raise typer.BadParameter("use quick or full", param_hint="--tier")
    tier_ = cast("sb.Tier", tier)
    if fail_on not in sb.FAIL_ON:
        raise typer.BadParameter(f"use one of {sorted(sb.FAIL_ON)}", param_hint="--fail-on")
    if not (suite_dir / "suite.yaml").is_file():
        raise typer.BadParameter(f"{suite_dir} has no suite.yaml", param_hint="--suite")
    if write_lock:
        typer.echo(f"wrote {sb.write_lock(suite_dir)}")
        return
    try:
        spec, sol = sb.load_suite(suite_dir), sb.load_solution(solution)
    except (ValidationError, OSError) as exc:
        raise typer.BadParameter(str(exc)) from None
    key = fresh_key or secrets.token_hex(8)
    try:
        only = [x.strip() for x in tasks.split(",") if x.strip()]
        plan = sb.plan_jobs(spec, suite_dir, sol, tier_, key, _ppo_fits, only)
    except ValueError as exc:
        raise typer.BadParameter(str(exc)) from None
    out_dir = new_dir(_out_root(out), f"suite_{datetime.now(UTC):%Y%m%dT%H%M%SZ}")
    typer.echo(f"agribench v{spec.version} {tier}: {len(plan.jobs)} runs on {workers} worker(s)")
    step = max(1, len(plan.jobs) // 20)

    def progress(done: int, total: int) -> None:
        if done % step == 0 or done == total:
            typer.echo(f"  {done}/{total} runs", err=True)

    rows = sb.run_jobs(plan.jobs, workers, progress)
    base_path = suite_dir / "baseline.json"
    old = json.loads(base_path.read_text(encoding="utf-8")) if base_path.is_file() else None
    meta = {
        "commit": _commit(),
        "fresh_key": key,
        "created_utc": f"{datetime.now(UTC):%Y-%m-%dT%H:%M:%SZ}",
        "lock_problems": sb.lock_problems(suite_dir),
    }
    report = sb.analyse(spec, sol, tier_, plan, rows, old, meta)
    sb.write_rows(rows, out_dir / "rows.csv")
    (out_dir / "report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    text = sb.report_markdown(report)
    (out_dir / "report.md").write_text(text, encoding="utf-8")
    typer.echo(text)
    if update_baseline:
        new = sb.baseline_from(rows, spec, sol, meta, old)
        base_path.write_text(json.dumps(new, indent=1) + "\n", encoding="utf-8")
        typer.echo(f"wrote {base_path}")
    typer.echo(f"wrote {out_dir}")
    if sb.fails(report["status"], fail_on):
        raise typer.Exit(1)


@app.command()
def gate(
    report: Annotated[Path, typer.Argument(exists=True, dir_okay=False, help="report.json")],
    fail_on: Annotated[str, typer.Option(help="hard, sota or saturation")] = "saturation",
) -> None:
    """Exit 1 if a finished agribench report fails at this level (for CI)."""
    import json

    from agrisim.suite import FAIL_ON, STATUS_TEXT, fails

    if fail_on not in FAIL_ON:
        raise typer.BadParameter(f"use one of {sorted(FAIL_ON)}", param_hint="--fail-on")
    status = json.loads(report.read_text(encoding="utf-8"))["status"]
    typer.echo(STATUS_TEXT[status])
    if fails(status, fail_on):
        raise typer.Exit(1)


@app.command()
def train(
    config: ConfigOpt,
    timesteps: Annotated[int, typer.Option(min=1, help="Total environment steps")] = 200_000,
    seed: Annotated[int, typer.Option(min=0, help="Training seed")] = 0,
    budget: Annotated[int, typer.Option(min=1, help="Probe budget per episode")] = 30,
    n_envs: Annotated[
        int, typer.Option(min=1, help="Parallel envs (>1 uses spawn subprocesses)")
    ] = 1,
    out: Annotated[Path, typer.Option(help="Output folder")] = Path("runs/ppo_v1"),
) -> None:
    """Train a MaskablePPO probing policy (episodes use seeds >= 1000)."""
    from agrisim.env import train as train_ppo

    cfg = _load(config)
    if out.exists() and not out.is_dir():
        raise typer.BadParameter(f"{out} is a file, not a folder", param_hint="--out")
    try:
        path = train_ppo(cfg, timesteps, seed, out, budget, n_envs)
    except ValueError as exc:
        raise typer.BadParameter(str(exc), param_hint="--config") from None
    typer.echo(f"saved {path}")


@app.command(name="eval")
def evaluate(
    model: Annotated[Path, typer.Option(exists=True, dir_okay=False, help="model.zip")],
    config: ConfigOpt,
    seeds: Annotated[str, typer.Option(help="Held-out seeds (< 1000)")] = "100-149",
    budget: Annotated[int, typer.Option(help="Probe budget, same for every strategy")] = 30,
    workers: Annotated[int, typer.Option(min=1, help="Worker processes (1 = serial)")] = 1,
    out: Annotated[Path, typer.Option(help="Root folder for outputs")] = Path("runs"),
) -> None:
    """Evaluate a trained model and every baseline on the same held-out seeds and budget."""
    from datetime import UTC, datetime

    from agrisim.bench import run_benchmark, summary_markdown, write_results
    from agrisim.env import TRAIN_SEED_OFFSET
    from agrisim.io import new_dir
    from agrisim.policies import LEARNED, STRATEGIES

    seed_list = _seeds(seeds)
    if budget < 1:
        raise typer.BadParameter("--budget must be at least 1")
    if max(seed_list) >= TRAIN_SEED_OFFSET:
        raise typer.BadParameter(f"evaluation seeds must be < {TRAIN_SEED_OFFSET} (held out)")
    cfg = _load(config)
    _check_model(model, cfg)
    out_dir = new_dir(_out_root(out), f"eval_{datetime.now(UTC):%Y%m%dT%H%M%SZ}")
    names = [*STRATEGIES, LEARNED]
    rows = run_benchmark(cfg, seed_list, budget, names, workers, model=model.resolve())
    write_results(rows, out_dir)
    text = summary_markdown(rows, f"agrisim eval: {model}, {config.name}, budget {budget}")
    (out_dir / "summary.md").write_text(text, encoding="utf-8")
    typer.echo(text)
    typer.echo(f"wrote {out_dir}")


if __name__ == "__main__":
    app()
