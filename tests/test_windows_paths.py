from datetime import UTC, datetime, timedelta, timezone

from agrisim.io import run_dir_name

INVALID = set(r'<>:"/\|?*')


def test_run_dir_name_is_windows_safe() -> None:
    name = run_dir_name(7, datetime(2026, 10, 13, 10, 15, 0, tzinfo=UTC))
    assert name == "20261013T101500Z_seed7"
    assert not INVALID & set(name)


def test_run_dir_name_converts_to_utc() -> None:
    ist = timezone(timedelta(hours=5, minutes=30))
    assert run_dir_name(0, datetime(2026, 10, 13, 15, 45, tzinfo=ist)).startswith(
        "20261013T101500Z"
    )
    assert not INVALID & set(run_dir_name(3))
