from typer.testing import CliRunner

import agrisim
from agrisim.cli import app


def test_import() -> None:
    assert agrisim.__version__


def test_cli_version() -> None:
    result = CliRunner().invoke(app, ["version"])
    assert result.exit_code == 0
    assert agrisim.__version__ in result.output
