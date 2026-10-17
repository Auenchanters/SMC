"""Scoring against ground truth. This module (and the reward in env.py) may read SoilTruth.

It also holds the clairvoyant oracle, the benchmark's ceiling: a probing strategy that reads the
truth. It is a reference only and never a candidate (suite.py refuses it).
"""

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from scipy import stats
from scipy.spatial import KDTree

from agrisim.config import SimConfig
from agrisim.control import densify
from agrisim.field import FieldLayout
from agrisim.mapping import GridSpec
from agrisim.policies import Context
from agrisim.soil import SoilTruth
from agrisim.weather import current_view

FloatArray = npt.NDArray[np.float64]
ORACLES = ("oracle_rmse", "oracle_dry")


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


def crps_gaussian(truth: FloatArray, mean: FloatArray, var: FloatArray) -> float:
    """Mean continuous ranked probability score of N(mean, var) per cell (VWC; lower is better).

    A proper score: it rewards sharp maps only when they are right, so inflating the variance
    to look calibrated does not help. Cells with no usable variance count as point forecasts.
    """
    sd = np.sqrt(np.where(np.isfinite(var), np.maximum(var, 0.0), 0.0))
    err = truth - mean
    out = np.abs(err)
    pos = sd > 0
    z = err[pos] / sd[pos]
    out[pos] = sd[pos] * (
        z * (2 * stats.norm.cdf(z) - 1) + 2 * stats.norm.pdf(z) - 1 / np.sqrt(np.pi)
    )
    return float(out.mean())


def dry_f1(truth: FloatArray, mean: FloatArray, dry_threshold: float) -> float:
    """F1 of the dry cells, defined on every field: 1 when neither truth nor map has a dry cell,
    0 when only one of them has (no field is dropped from an average for being awkward)."""
    true_dry, pred_dry = truth < dry_threshold, mean < dry_threshold
    total = int(true_dry.sum() + pred_dry.sum())
    return 1.0 if total == 0 else 2 * float((true_dry & pred_dry).sum()) / total


class ClairvoyantOracle:
    """REFERENCE ONLY. Chooses probe sites knowing the truth: the benchmark's ceiling.

    It keeps a Gaussian-process copy of the map (the field's true mean, variance and correlation
    length, and the probe's noise) and picks the site whose expected reading, the truth there,
    most improves that map per second of driving and probing: squared error ("rmse"), or the
    number of cells on the wrong side of the dry threshold, ties broken by squared error ("dry").
    The final map is made by the same mapper as every strategy, so only site choice is clairvoyant.
    """

    def __init__(self, cfg: SimConfig, truth: Callable[[float], SoilTruth], objective: str) -> None:
        self.cfg, self.truth, self.objective = cfg, truth, objective
        f = cfg.field
        xs, ys = np.arange(0.5, f.length_x, 1.0), np.arange(0.5, f.width_y, 1.0)
        gx, gy = np.meshgrid(xs, ys)
        self.cells = np.column_stack([gx.ravel(), gy.ravel()])  # 1 m grid: cheap and enough
        self._corr_cs: FloatArray | None = None  # cell-site correlation, fixed for a field

    def _kernel(self, a: FloatArray, b: FloatArray, var: float, length: float) -> FloatArray:
        r = np.linalg.norm(a[:, None, :] - b[None, :, :], axis=2) / length
        cov = np.exp(-r) if self.cfg.soil.covariance == "exponential" else np.exp(-(r**2))
        return np.asarray(var * cov, dtype=np.float64)

    def choose(self, ctx: Context) -> int:
        cfg = self.cfg
        now = self.truth(ctx.t)
        theta_c = now.value_at(self.cells[:, 0], self.cells[:, 1])
        theta_s = now.value_at(ctx.site_xy[:, 0], ctx.site_xy[:, 1])
        m, var = float(theta_c.mean()), max(float(theta_c.var()), 1e-8)
        length, noise = now.corr_length, cfg.probe.noise_std**2 + 1e-8
        if self._corr_cs is None:
            self._corr_cs = self._kernel(self.cells, ctx.site_xy, 1.0, length)
        used = current_view(ctx.readings, cfg.weather, ctx.t, cfg.soil.vwc_clip)
        mu_c, mu_s = np.full(len(theta_c), m), np.full(len(theta_s), m)
        cov_cs = var * self._corr_cs
        var_s = np.full(len(theta_s), var)
        if used:
            a = np.array([(r.x, r.y) for r in used])
            y = np.array([r.value for r in used], dtype=np.float64) - cfg.probe.bias
            chol = np.linalg.cholesky(self._kernel(a, a, var, length) + noise * np.eye(len(a)))
            v_c = np.linalg.solve(chol, self._kernel(a, self.cells, var, length))
            v_s = np.linalg.solve(chol, self._kernel(a, ctx.site_xy, var, length))
            w = np.linalg.solve(chol, y - m)
            mu_c, mu_s = m + v_c.T @ w, m + v_s.T @ w
            cov_cs = cov_cs - v_c.T @ v_s
            var_s = np.maximum(var - (v_s**2).sum(axis=0), 0.0)
        gain_vec = cov_cs / (var_s + noise)  # (cells, sites): how a reading at s moves each cell
        delta = theta_s - mu_s
        after = mu_c[:, None] + gain_vec * delta[None, :]
        sq_now = float(((mu_c - theta_c) ** 2).sum())
        gain = sq_now - ((after - theta_c[:, None]) ** 2).sum(axis=0)
        if self.objective == "oracle_dry":
            h = cfg.mapping.dry_threshold
            wrong_now = int(((mu_c < h) != (theta_c < h)).sum())
            wrong = ((after < h) != (theta_c < h)[:, None]).sum(axis=0)
            gain = (wrong_now - wrong) + 0.5 * gain / max(float(np.abs(gain).max()), 1e-12)
        gain = np.where(ctx.visited, -np.inf, gain)
        if gain.max() <= 0:  # nothing helps: take the least harmful, not the farthest
            return int(np.argmax(gain))
        travel = ctx.graph.distances(ctx.position, ctx.sites) / cfg.rover.max_speed
        cost = np.maximum(travel + cfg.probe.insertion_time_s, cfg.dt)
        return int(np.argmax(np.where(gain > 0, gain / cost, -np.inf)))
