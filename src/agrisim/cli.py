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
    out: Annotated[Path, typer.Option(help="Root folder for run outputs")] = Path("runs"),
) -> None:
    """Run one survey and write runs/<UTC timestamp>_seed<seed>/."""
    from agrisim.config import load
    from agrisim.io import new_dir, run_dir_name, save_run
    from agrisim.sim import run_survey

    cfg = load(config)
    out_dir = new_dir(out, run_dir_name(seed))
    result = run_survey(cfg, seed, rerun=rerun, budget=budget, rrd_path=out_dir / "recording.rrd")
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


if __name__ == "__main__":
    app()
