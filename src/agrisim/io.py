"""Run-folder naming and writing. Names are Windows-safe (no ':')."""

from datetime import UTC, datetime


def run_dir_name(seed: int, now: datetime | None = None) -> str:
    """Return e.g. '20261013T101500Z_seed7' for a UTC timestamp."""
    now = now or datetime.now(UTC)
    return f"{now.astimezone(UTC):%Y%m%dT%H%M%SZ}_seed{seed}"
