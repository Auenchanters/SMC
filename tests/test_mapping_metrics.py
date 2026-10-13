import numpy as np
import pytest

from agrisim.config import SimConfig
from agrisim.field import FieldLayout
from agrisim.mapping import GlobalMeanMapper, GridSpec, IDWMapper, KrigingMapper
from agrisim.metrics import lane_coverage, map_metrics
from agrisim.sensor import ProbeReading


def _smooth(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    return 0.25 + 0.05 * np.sin(x / 5.0) * np.cos(y / 4.0)


def _feed(mapper: object, xy: np.ndarray) -> None:
    for x, y in xy:
        mapper.update(ProbeReading(x, y, 0.0, float(_smooth(x, y)), True))  # type: ignore[attr-defined]


def test_kriging_beats_global_mean_on_smooth_field(cfg: SimConfig) -> None:
    grid = GridSpec.for_field(cfg.field, cfg.mapping.output_resolution)
    gx, gy = np.meshgrid(grid.x_centres, grid.y_centres)
    truth = _smooth(gx, gy)
    xy = np.random.default_rng(0).uniform([0, 0], [30, 20], (80, 2))
    scores = {}
    for name, m in {
        "krige": KrigingMapper(cfg.mapping),
        "mean": GlobalMeanMapper(),
        "idw": IDWMapper(),
    }.items():
        _feed(m, xy)
        mean, var = m.estimate(grid)
        assert mean.shape == (grid.ny, grid.nx)
        scores[name] = map_metrics(truth, mean, var, 0.2)
    assert scores["krige"].rmse < scores["mean"].rmse
    assert scores["krige"].rmse < 0.25 * scores["mean"].rmse
    assert np.isnan(scores["idw"].calibration_95)


def test_kriging_falls_back_with_few_readings(cfg: SimConfig) -> None:
    grid = GridSpec(4, 3, 1.0)
    m = KrigingMapper(cfg.mapping)
    m.update(ProbeReading(1.0, 1.0, 0.0, 0.2, True))
    m.update(ProbeReading(2.0, 1.0, 0.0, None, False))  # failed probe ignored
    m.update(ProbeReading(3.0, 2.0, 0.0, 0.3, True))
    mean, var = m.estimate(grid)
    assert np.allclose(mean, 0.25)
    assert np.allclose(var, np.var([0.2, 0.3], ddof=1))


def test_identical_arrays_are_perfect() -> None:
    t = np.random.default_rng(0).uniform(0.1, 0.4, (10, 12))
    m = map_metrics(t, t.copy(), np.full_like(t, 1e-4), 0.18)
    assert m.rmse == 0 and m.mae == 0 and m.r2 == 1
    assert m.dry_precision == 1 and m.dry_recall == 1 and m.dry_f1 == 1
    assert m.calibration_95 == 1


def test_dry_metrics_hand_example() -> None:
    truth = np.array([[0.10, 0.10, 0.30, 0.30]])
    pred = np.array([[0.10, 0.30, 0.10, 0.30]])
    m = map_metrics(truth, pred, np.full_like(truth, np.nan), 0.18)
    # TP = 1 (cell 0), FP = 1 (cell 2), FN = 1 (cell 1).
    assert m.dry_precision == pytest.approx(0.5)
    assert m.dry_recall == pytest.approx(0.5)
    assert m.dry_f1 == pytest.approx(0.5)
    assert m.truth_dry_fraction == pytest.approx(0.5)
    none_pred = map_metrics(truth, np.full_like(truth, 0.3), truth, 0.18)
    assert np.isnan(none_pred.dry_precision) and none_pred.dry_recall == 0


def test_lane_coverage(cfg: SimConfig) -> None:
    lay = FieldLayout.generate(cfg.field, np.random.default_rng(0))
    (x0, _), (x1, _) = lay.lanes[0].coords
    xs = np.arange(x0, x1, 0.05)
    one_lane = np.column_stack([xs, np.full(len(xs), lay.lane_y[0]), np.zeros(len(xs))])
    assert lane_coverage(one_lane, lay) == pytest.approx(1 / len(lay.lanes), rel=0.02)
