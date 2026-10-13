from pathlib import Path

import pytest

from agrisim.config import SimConfig, load

DEMO = Path(__file__).resolve().parents[1] / "configs" / "demo.yaml"


@pytest.fixture
def cfg() -> SimConfig:
    return load(DEMO)


@pytest.fixture
def demo_path() -> Path:
    return DEMO
