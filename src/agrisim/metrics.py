"""Scoring against ground truth. This module (and the reward in env.py) may read SoilTruth."""

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from scipy.spatial import KDTree

from agrisim.control import densify
from agrisim.field import FieldLayout
from agrisim.mapping import GridSpec
from agrisim.soil import SoilTruth

FloatArray = npt.NDArray[np.float64]


@dataclass(frozen=True)
class MapMetrics:
    rmse: float
    mae: float
    r2: float
    dry_precision: float  # NaN when no cell is predicted dry
    dry_recall: float  # NaN when no cell is truly dry
    dry_f1: float  # NaN when precision or recall is NaN
    calibration_95: float  # fraction of cells with |truth - mean| <= 1.96 sd; NaN if no variance
    truth_dry_fraction: float


@dataclass(frozen=True)
class RunMetrics:
    probes_used: int
    valid_probes: int
    path_length_m: float
    mission_time_s: float
    lane_coverage: float  # fraction of lane centreline length driven
    plant_contacts: int


def truth_on_grid(truth: SoilTruth, grid: GridSpec) -> FloatArray:
    """Truth sampled (bilinear) at output-grid cell centres."""
    gx, gy = np.meshgrid(grid.x_centres, grid.y_centres)
    return truth.value_at(gx, gy)


def _div(a: float, b: float) -> float:
    return a / b if b else float("nan")


def map_metrics(
    truth: FloatArray, mean: FloatArray, var: FloatArray, dry_threshold: float
) -> MapMetrics:
    err = mean - truth
    ss_tot = float(((truth - truth.mean()) ** 2).sum())
    true_dry, pred_dry = truth < dry_threshold, mean < dry_threshold
    tp = float((true_dry & pred_dry).sum())
    precision = _div(tp, float(pred_dry.sum()))
    recall = _div(tp, float(true_dry.sum()))
    if np.isnan(precision) or np.isnan(recall):
        f1 = float("nan")
    else:
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    finite = np.isfinite(var)
    calib = (
        float((np.abs(err[finite]) <= 1.96 * np.sqrt(var[finite])).mean())
        if finite.any()
        else float("nan")
    )
    return MapMetrics(
        rmse=float(np.sqrt((err**2).mean())),
        mae=float(np.abs(err).mean()),
        r2=1.0 - float((err**2).sum()) / ss_tot if ss_tot else float("nan"),
        dry_precision=precision,
        dry_recall=recall,
        dry_f1=f1,
        calibration_95=calib,
        truth_dry_fraction=float(true_dry.mean()),
    )


def lane_coverage(poses: npt.ArrayLike, layout: FieldLayout, tol: float = 0.1) -> float:
    """Fraction of lane-centreline sample points (every 0.1 m) within `tol` of the driven path
    (filled in between poses, so a fast rover's widely spaced samples still count)."""
    p = np.atleast_2d(np.asarray(poses, dtype=np.float64))
    pts = []
    for line in layout.lanes:
        (x0, y), (x1, _) = line.coords
        xs = np.arange(x0, x1 + 1e-9, 0.1)
        pts.append(np.column_stack([xs, np.full(len(xs), y)]))
    samples = np.concatenate(pts)
    if len(p) == 0:
        return 0.0
    d, _ = KDTree(densify(p)[0][:, :2]).query(samples)
    return float((d <= tol).mean())


def run_metrics(
    probes_used: int,
    valid_probes: int,
    poses: npt.ArrayLike,
    mission_time_s: float,
    layout: FieldLayout,
    plant_contacts: int,
) -> RunMetrics:
    p = np.atleast_2d(np.asarray(poses, dtype=np.float64))
    path = float(np.linalg.norm(np.diff(p[:, :2], axis=0), axis=1).sum()) if len(p) > 1 else 0.0
    return RunMetrics(
        probes_used=probes_used,
        valid_probes=valid_probes,
        path_length_m=path,
        mission_time_s=mission_time_s,
        lane_coverage=lane_coverage(p, layout),
        plant_contacts=plant_contacts,
    )
