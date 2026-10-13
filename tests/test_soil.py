import numpy as np
import pytest

from agrisim.config import SimConfig, SoilConfig
from agrisim.field import FieldLayout
from agrisim.soil import SoilTruth


def _truth(cfg: SimConfig, seed: int, soil: SoilConfig | None = None) -> SoilTruth:
    rng = np.random.default_rng(seed)
    layout = FieldLayout.generate(cfg.field, rng)
    return SoilTruth.generate(soil or cfg.soil, layout, rng)


def test_deterministic(cfg: SimConfig) -> None:
    a, b = _truth(cfg, 5), _truth(cfg, 5)
    assert np.array_equal(a.grid, b.grid)
    assert a.anomalies == b.anomalies
    assert not np.array_equal(a.grid, _truth(cfg, 6).grid)


def test_shape_dtype_and_clip(cfg: SimConfig) -> None:
    lo, hi = cfg.soil.vwc_clip
    for seed in range(5):
        t = _truth(cfg, seed)
        assert t.grid.dtype == np.float32
        assert t.grid.shape == (80, 120)
        assert t.grid.min() >= np.float32(lo)
        assert t.grid.max() <= np.float32(hi)


def _lag_corr(grid: np.ndarray, lag: int) -> float:
    a, b = grid[:, :-lag].ravel(), grid[:, lag:].ravel()
    return float(np.corrcoef(a, b)[0, 1])


def test_longer_corr_length_is_smoother(cfg: SimConfig) -> None:
    plain = {"drip_stripe_amplitude": 0.0, "dry_patch_count": (0, 0), "wet_patch_count": (0, 0)}
    short = cfg.soil.model_copy(update={**plain, "corr_length_range": (4.0, 4.0)})
    long = cfg.soil.model_copy(update={**plain, "corr_length_range": (25.0, 25.0)})
    lag = round(1.0 / cfg.soil.grid_resolution)  # 1 m along x
    c_short = np.mean([_lag_corr(_truth(cfg, s, short).grid, lag) for s in range(20)])
    c_long = np.mean([_lag_corr(_truth(cfg, s, long).grid, lag) for s in range(20)])
    assert c_long > c_short
    # Exponential covariance: rho(1 m) = exp(-1/L).
    assert c_short == pytest.approx(np.exp(-1 / 4), abs=0.08)


def test_dry_patch_lowers_mean(cfg: SimConfig) -> None:
    soil = cfg.soil.model_copy(update={"dry_patch_count": (1, 1), "wet_patch_count": (0, 0)})
    diffs = []
    for seed in range(10):
        t = _truth(cfg, seed, soil)
        (a,) = t.anomalies
        gx, gy = np.meshgrid(t.x_centres, t.y_centres)
        inside = np.hypot(gx - a.x, gy - a.y) < a.radius / 2
        if inside.any():
            diffs.append(t.grid[inside].mean() - t.grid[~inside].mean())
    assert np.mean(diffs) < 0


def test_value_at_and_disc(cfg: SimConfig) -> None:
    t = _truth(cfg, 0)
    xc, yc = t.x_centres, t.y_centres
    assert t.value_at(xc[10], yc[7]) == pytest.approx(t.grid[7, 10], abs=1e-6)
    mid = t.value_at((xc[10] + xc[11]) / 2, yc[7])
    assert mid == pytest.approx((t.grid[7, 10] + t.grid[7, 11]) / 2, abs=1e-6)
    v = t.mean_over_disc(15.0, 10.0, 0.05)
    assert v == pytest.approx(float(t.value_at(15.0, 10.0)), abs=0.01)
    # Edge clamp: outside the grid returns the edge value, never raises.
    assert np.isfinite(t.value_at(-1.0, 100.0))
