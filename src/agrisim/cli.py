"""Typer command-line interface: run, bench, train, eval (added milestone by milestone)."""

from pathlib import Path
from typing import Annotated

import typer

from agrisim import __version__

app = typer.Typer(no_args_is_help=True, add_completion=False)

ConfigOpt = Annotated[
    Path, typer.Option("--config", exists=True, dir_okay=False, help="YAML config")
]


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
    seed: Annotated[int, typer.Option(help="Run seed")] = 0,
    rerun: Annotated[bool, typer.Option("--rerun", help="Open a Rerun viewer, save .rrd")] = False,
    budget: Annotated[int | None, typer.Option(help="Probe budget (default: config)")] = None,
    policy: Annotated[
        str, typer.Option(help="fixed_spacing, random, greedy_variance, greedy_variance_per_cost")
    ] = "fixed_spacing",
    out: Annotated[Path, typer.Option(help="Root folder for run outputs")] = Path("runs"),
) -> None:
    """Run one survey and write runs/<UTC timestamp>_seed<seed>/."""
    from agrisim.config import load
    from agrisim.io import new_dir, run_dir_name, save_run
    from agrisim.sim import run_survey

    cfg = load(config)
    out_dir = new_dir(out, run_dir_name(seed))
    rrd = out_dir / "recording.rrd"
    result = run_survey(cfg, seed, policy, rerun=rerun, budget=budget, rrd_path=rrd)
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


@app.command()
def bench(
    config: ConfigOpt,
    seeds: Annotated[str, typer.Option(help="Seeds, e.g. 0-49 or 1,5,9")] = "0-49",
    budget: Annotated[int, typer.Option(help="Probe budget, same for every strategy")] = 30,
    strategies: Annotated[str, typer.Option(help="Comma-separated; default all")] = "",
    workers: Annotated[int, typer.Option(help="Worker processes (1 = serial)")] = 1,
    out: Annotated[Path, typer.Option(help="Root folder for outputs")] = Path("runs"),
) -> None:
    """Run every strategy on every seed; write runs/bench_<timestamp>/results.csv and summary.md."""
    from datetime import UTC, datetime

    from agrisim.bench import parse_seeds, run_benchmark, summary_markdown, write_results
    from agrisim.config import load
    from agrisim.io import new_dir
    from agrisim.policies import STRATEGIES

    names = [s.strip() for s in strategies.split(",") if s.strip()] or list(STRATEGIES)
    unknown = set(names) - set(STRATEGIES)
    if unknown:
        raise typer.BadParameter(f"unknown strategies {sorted(unknown)}; choose from {STRATEGIES}")
    cfg = load(config)
    out_dir = new_dir(out, f"bench_{datetime.now(UTC):%Y%m%dT%H%M%SZ}")
    rows = run_benchmark(cfg, parse_seeds(seeds), budget, names, workers)
    write_results(rows, out_dir)
    text = summary_markdown(rows, f"agrisim bench: {config.name}, budget {budget}")
    (out_dir / "summary.md").write_text(text, encoding="utf-8")
    typer.echo(text)
    typer.echo(f"wrote {out_dir}")


@app.command()
def train(
    config: ConfigOpt,
    timesteps: Annotated[int, typer.Option(help="Total environment steps")] = 200_000,
    seed: Annotated[int, typer.Option(help="Training seed")] = 0,
    budget: Annotated[int, typer.Option(help="Probe budget per episode")] = 30,
    n_envs: Annotated[int, typer.Option(help="Parallel envs (>1 uses spawn subprocesses)")] = 1,
    out: Annotated[Path, typer.Option(help="Output folder")] = Path("runs/ppo_v1"),
) -> None:
    """Train a MaskablePPO probing policy (episodes use seeds >= 1000)."""
    from agrisim.config import load
    from agrisim.env import train as train_ppo

    path = train_ppo(load(config), timesteps, seed, out, budget, n_envs)
    typer.echo(f"saved {path}")


@app.command(name="eval")
def evaluate(
    model: Annotated[Path, typer.Option(exists=True, dir_okay=False, help="model.zip")],
    config: ConfigOpt,
    seeds: Annotated[str, typer.Option(help="Held-out seeds (< 1000)")] = "100-149",
    budget: Annotated[int, typer.Option(help="Probe budget, same for every strategy")] = 30,
    workers: Annotated[int, typer.Option(help="Worker processes (1 = serial)")] = 1,
    out: Annotated[Path, typer.Option(help="Root folder for outputs")] = Path("runs"),
) -> None:
    """Evaluate a trained model and every baseline on the same held-out seeds and budget."""
    from datetime import UTC, datetime

    from agrisim.bench import parse_seeds, run_benchmark, summary_markdown, write_results
    from agrisim.config import load
    from agrisim.env import TRAIN_SEED_OFFSET
    from agrisim.io import new_dir
    from agrisim.policies import LEARNED, STRATEGIES

    seed_list = parse_seeds(seeds)
    if max(seed_list) >= TRAIN_SEED_OFFSET:
        raise typer.BadParameter(f"evaluation seeds must be < {TRAIN_SEED_OFFSET} (held out)")
    cfg = load(config)
    out_dir = new_dir(out, f"eval_{datetime.now(UTC):%Y%m%dT%H%M%SZ}")
    names = [*STRATEGIES, LEARNED]
    rows = run_benchmark(cfg, seed_list, budget, names, workers, model=model.resolve())
    write_results(rows, out_dir)
    text = summary_markdown(rows, f"agrisim eval: {model}, {config.name}, budget {budget}")
    (out_dir / "summary.md").write_text(text, encoding="utf-8")
    typer.echo(text)
    typer.echo(f"wrote {out_dir}")


if __name__ == "__main__":
    app()
