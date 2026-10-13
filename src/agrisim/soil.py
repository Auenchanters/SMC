"""Hidden ground-truth soil moisture (VWC, m^3/m^3) on a regular grid.

Only metrics.py and the training reward in env.py may read SoilTruth values; the probe model
(sensor.py) samples it to produce readings, which is the only thing mappers and policies see.
"""

import math
from dataclasses import dataclass
from typing import Literal

import numpy as np
import numpy.typing as npt

from agrisim.config import SoilConfig
from agrisim.field import FieldLayout

FloatArray = npt.NDArray[np.float64]
_GOLDEN_ANGLE = math.pi * (3 - math.sqrt(5))


@dataclass(frozen=True)
class Anomaly:
    kind: Literal["dry", "wet"]
    x: float
    y: float
    radius: float
    amplitude: float  # signed VWC change at the centre


def gaussian_random_field(
    shape: tuple[int, int],
    resolution: float,
    corr_length: float,
    covariance: Literal["exponential", "gaussian"],
    rng: np.random.Generator,
) -> FloatArray:
    """Stationary GRF via FFT circulant embedding on a padded grid; zero mean, unit variance."""
    pad = math.ceil(3 * corr_length / resolution)
    my, mx = shape[0] + pad, shape[1] + pad
    ly = np.minimum(np.arange(my), my - np.arange(my)) * resolution
    lx = np.minimum(np.arange(mx), mx - np.arange(mx)) * resolution
    r = np.hypot(ly[:, None], lx[None, :]) / corr_length
    cov = np.exp(-r) if covariance == "exponential" else np.exp(-(r**2))
    # Clip small negative eigenvalues from the truncated embedding (approximation is documented).
    eig = np.clip(np.fft.fft2(cov).real, 0.0, None)
    noise = rng.standard_normal((my, mx))
    field = np.fft.ifft2(np.sqrt(eig) * np.fft.fft2(noise)).real[: shape[0], : shape[1]]
    return np.asarray((field - field.mean()) / field.std(), dtype=np.float64)


def _bump(d: FloatArray, radius: float) -> FloatArray:
    """Smooth radial bump: 1 at the centre, 0 at and beyond `radius`."""
    return np.where(d < radius, 0.5 * (1 + np.cos(np.pi * d / radius)), 0.0)


@dataclass(frozen=True, eq=False)
class SoilTruth:
    grid: npt.NDArray[np.float32]  # (ny, nx); rows = y, cols = x; cell centres at (i + 0.5) * res
    resolution: float
    corr_length: float
    anomalies: tuple[Anomaly, ...]
    origin: tuple[float, float] = (0.0, 0.0)

    @property
    def x_centres(self) -> FloatArray:
        return (
            self.origin[0]
            + (np.arange(self.grid.shape[1], dtype=np.float64) + 0.5) * self.resolution
        )

    @property
    def y_centres(self) -> FloatArray:
        return (
            self.origin[1]
            + (np.arange(self.grid.shape[0], dtype=np.float64) + 0.5) * self.resolution
        )

    @classmethod
    def generate(
        cls, cfg: SoilConfig, layout: FieldLayout, rng: np.random.Generator
    ) -> "SoilTruth":
        f = layout.cfg
        res = cfg.grid_resolution
        shape = (round(f.width_y / res), round(f.length_x / res))
        corr = float(rng.uniform(*cfg.corr_length_range))
        z = gaussian_random_field(shape, res, corr, cfg.covariance, rng)
        vwc = cfg.mean_vwc + cfg.std_vwc * z

        x = (np.arange(shape[1]) + 0.5) * res
        y = (np.arange(shape[0]) + 0.5) * res
        gx, gy = np.meshgrid(x, y)

        # Drip lines: wetter along each plant row, fading to zero at lane centres.
        if len(layout.row_y):
            d_row = np.abs(gy[..., None] - layout.row_y).min(axis=-1)
            stripe = np.where(
                d_row < f.row_spacing / 2, np.cos(np.pi * d_row / f.row_spacing) ** 2, 0.0
            )
            planted = (gx >= f.headland) & (gx <= f.length_x - f.headland)
            vwc += cfg.drip_stripe_amplitude * stripe * planted

        anomalies: list[Anomaly] = []
        specs: list[tuple[Literal["dry", "wet"], tuple[int, int], tuple[float, float], float]] = [
            ("dry", cfg.dry_patch_count, cfg.dry_patch_radius, -cfg.dry_patch_depth),
            ("wet", cfg.wet_patch_count, cfg.wet_patch_radius, cfg.wet_patch_height),
        ]
        for kind, count, radius, amp in specs:
            for _ in range(int(rng.integers(count[0], count[1] + 1))):
                a = Anomaly(
                    kind,
                    float(rng.uniform(0, f.length_x)),
                    float(rng.uniform(0, f.width_y)),
                    float(rng.uniform(*radius)),
                    amp,
                )
                vwc += a.amplitude * _bump(np.hypot(gx - a.x, gy - a.y), a.radius)
                anomalies.append(a)

        grid = np.clip(vwc, *cfg.vwc_clip).astype(np.float32)
        return cls(grid=grid, resolution=res, corr_length=corr, anomalies=tuple(anomalies))

    def value_at(self, x: npt.ArrayLike, y: npt.ArrayLike) -> FloatArray:
        """Bilinear interpolation between cell centres; clamped at the field edge."""
        ny, nx = self.grid.shape
        fx = np.clip(
            (np.asarray(x, dtype=np.float64) - self.origin[0]) / self.resolution - 0.5, 0, nx - 1
        )
        fy = np.clip(
            (np.asarray(y, dtype=np.float64) - self.origin[1]) / self.resolution - 0.5, 0, ny - 1
        )
        x0 = np.minimum(np.floor(fx).astype(int), nx - 2)
        y0 = np.minimum(np.floor(fy).astype(int), ny - 2)
        tx, ty = fx - x0, fy - y0
        g = self.grid.astype(np.float64)
        top = g[y0, x0] * (1 - tx) + g[y0, x0 + 1] * tx
        bot = g[y0 + 1, x0] * (1 - tx) + g[y0 + 1, x0 + 1] * tx
        return np.asarray(top * (1 - ty) + bot * ty, dtype=np.float64)

    def mean_over_disc(self, x: float, y: float, r: float) -> float:
        """Mean of the bilinear field over a disc, using a sunflower point pattern."""
        n = 16 + math.ceil(4 * math.pi * (r / self.resolution) ** 2)
        k = np.arange(n) + 0.5
        rad = r * np.sqrt(k / n)
        ang = k * _GOLDEN_ANGLE
        return float(self.value_at(x + rad * np.cos(ang), y + rad * np.sin(ang)).mean())
