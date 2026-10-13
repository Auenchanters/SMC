"""Typer command-line interface: run, bench, train, eval (added milestone by milestone)."""

import typer

from agrisim import __version__

app = typer.Typer(no_args_is_help=True, add_completion=False)


@app.callback()
def main() -> None:
    """agrisim: soil-moisture survey simulator."""


@app.command()
def version() -> None:
    """Print the agrisim version."""
    typer.echo(__version__)


if __name__ == "__main__":
    app()
