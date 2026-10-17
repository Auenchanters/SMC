"""Map reconstruction from probe readings. Mappers never see the ground truth."""

import logging
import warnings
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

import numpy as np
import numpy.typing as npt
from pykrige.ok import OrdinaryKriging

from agrisim.config import FieldConfig, MappingConfig
from agrisim.sensor import ProbeReading

FloatArray = npt.NDArray[np.float64]
log = logging.getLogger(__name__)


@dataclass(frozen=True)
class GridSpec:
    nx: int
    ny: int
    resolution: float
    origin: tuple[float, float] = (0.0, 0.0)

    @classmethod
    def for_field(cls, field: FieldConfig, resolution: float) -> "GridSpec":
        return cls(
            round(field.length_x / resolution), round(field.width_y / resolution), resolution
        )

    @property
    def x_centres(self) -> FloatArray:
        return self.origin[0] + (np.arange(self.nx, dtype=np.float64) + 0.5) * self.resolution

    @property
    def y_centres(self) -> FloatArray:
        return self.origin[1] + (np.arange(self.ny, dtype=np.float64) + 0.5) * self.resolution


class Mapper(Protocol):
    def update(self, reading: ProbeReading) -> None: ...

    def estimate(self, grid: GridSpec) -> tuple[FloatArray, FloatArray]:
        """(mean, variance), each of shape (grid.ny, grid.nx)."""
        ...


class _Readings:
    """Keeps the valid readings; invalid (failed) probes are ignored."""

    def __init__(self) -> None:
        self._xyz: list[tuple[float, float, float]] = []

    def update(self, reading: ProbeReading) -> None:
        if reading.valid and reading.value is not None:
            self._xyz.append((reading.x, reading.y, reading.value))

    @property
    def xyz(self) -> FloatArray:
        return np.array(self._xyz, dtype=np.float64).reshape(-1, 3)


def _global_mean(z: FloatArray, grid: GridSpec) -> tuple[FloatArray, FloatArray]:
    mean = float(z.mean()) if len(z) else np.nan
    var = float(z.var(ddof=1)) if len(z) > 1 else np.nan
    shape = (grid.ny, grid.nx)
    return np.full(shape, mean), np.full(shape, var)


class GlobalMeanMapper(_Readings):
    """Baseline: sample mean everywhere; variance = sample variance (NaN with < 2 readings)."""

    def estimate(self, grid: GridSpec) -> tuple[FloatArray, FloatArray]:
        return _global_mean(self.xyz[:, 2], grid)


class IDWMapper(_Readings):
    """Baseline: inverse-distance weighting (power 2, all readings).

    IDW has no uncertainty model, so the variance is NaN everywhere by design.
    """

    def __init__(self, power: float = 2.0) -> None:
        super().__init__()
        self.power = power

    def estimate(self, grid: GridSpec) -> tuple[FloatArray, FloatArray]:
        xyz = self.xyz
        shape = (grid.ny, grid.nx)
        if len(xyz) == 0:
            return np.full(shape, np.nan), np.full(shape, np.nan)
        gx, gy = np.meshgrid(grid.x_centres, grid.y_centres)
        d = np.hypot(gx[..., None] - xyz[:, 0], gy[..., None] - xyz[:, 1])
        w = 1.0 / np.maximum(d, 1e-9) ** self.power
        return (w * xyz[:, 2]).sum(-1) / w.sum(-1), np.full(shape, np.nan)


class KrigingMapper(_Readings):
    """Ordinary kriging (PyKrige) with an automatically fitted variogram.

    Falls back to the global mean (and its variance) with fewer than `min_readings` valid
    readings, or if PyKrige fails on a degenerate sample; it never crashes a run.
    """

    def __init__(self, cfg: MappingConfig) -> None:
        super().__init__()
        self.cfg = cfg

    def _fit(self) -> OrdinaryKriging | None:
        """The fitted kriging model, or None when the fallback applies."""
        xyz = self.xyz
        if len(xyz) < self.cfg.min_readings or np.ptp(xyz[:, 2]) == 0:
            return None
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                return OrdinaryKriging(
                    xyz[:, 0],
                    xyz[:, 1],
                    xyz[:, 2],
                    variogram_model=self.cfg.variogram_model,
                    pseudo_inv=True,
                )
        except (ValueError, np.linalg.LinAlgError) as exc:
            log.warning("kriging failed (%s); using global mean", exc)
            return None

    def covariance(self) -> Callable[[FloatArray], FloatArray] | None:
        """C(h) = sill - gamma(h) of the fitted variogram (C(0) = sill, nugget included), or None
        before kriging is usable or for a variogram with no sill (linear, power)."""
        ok = self._fit()
        if ok is None or self.cfg.variogram_model in ("linear", "power"):
            return None
        params = np.asarray(ok.variogram_model_parameters, dtype=np.float64)
        sill = float(params[0] + params[-1])  # partial sill + nugget
        fn = ok.variogram_function

        def cov(h: FloatArray) -> FloatArray:
            return np.where(h > 0, sill - fn(params, h), sill)

        return cov

    def _krige(
        self, style: str, x: FloatArray, y: FloatArray
    ) -> tuple[FloatArray, FloatArray] | None:
        """Kriging mean and variance, or None when the fallback applies."""
        ok = self._fit()
        if ok is None:
            return None
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                z, ss = ok.execute(style, x, y)
        except (ValueError, np.linalg.LinAlgError) as exc:
            log.warning("kriging failed (%s); using global mean", exc)
            return None
        mean = np.asarray(z, dtype=np.float64)
        var = np.maximum(np.asarray(ss, dtype=np.float64), 0.0)
        if not (np.isfinite(mean).all() and np.isfinite(var).all()):
            log.warning("kriging returned non-finite values; using global mean")
            return None
        return mean, var

    def estimate(self, grid: GridSpec) -> tuple[FloatArray, FloatArray]:
        out = self._krige("grid", grid.x_centres, grid.y_centres)
        return out if out is not None else _global_mean(self.xyz[:, 2], grid)

    def predict_points(self, x: FloatArray, y: FloatArray) -> tuple[FloatArray, FloatArray] | None:
        """Kriging mean and variance at points, or None if kriging is not usable yet."""
        return self._krige("points", x, y)


def make_mapper(cfg: MappingConfig) -> Mapper:
    if cfg.method == "ordinary_kriging":
        return KrigingMapper(cfg)
    if cfg.method == "idw":
        return IDWMapper()
    return GlobalMeanMapper()
