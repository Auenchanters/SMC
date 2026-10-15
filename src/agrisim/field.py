"""Procedural tomato-field layout: rows, plants, lanes, headlands and free space.

World frame: origin at the south-west corner, x along rows, y across rows.
Rows are centred in y so the outer lanes (beyond the first and last rows) are full-width lanes.
"""

import math
from dataclasses import dataclass
from functools import cached_property

import numpy as np
import numpy.typing as npt
import shapely
from scipy.spatial import KDTree
from shapely.geometry import LineString, Polygon, box

from agrisim.config import FieldConfig

FloatArray = npt.NDArray[np.float64]
_EPS = 1e-9


@dataclass(frozen=True)
class ProbeSite:
    """A candidate probe location on a lane centreline."""

    x: float
    y: float
    lane: int


@dataclass(frozen=True, eq=False)
class FieldLayout:
    cfg: FieldConfig
    row_y: FloatArray  # (R,) row y-positions
    stems: FloatArray  # (P, 2) stem x, y
    canopy_radius: FloatArray  # (P,)
    lane_y: FloatArray  # (R + 1,) lane centreline y-positions, south to north
    lanes: tuple[LineString, ...]  # lane centrelines, x from headland/2 to length_x - headland/2
    headlands: tuple[Polygon, Polygon]  # west, east
    boundary: Polygon

    @classmethod
    def generate(cls, cfg: FieldConfig, rng: np.random.Generator) -> "FieldLayout":
        rs, h = cfg.row_spacing, cfg.headland
        n_rows = math.floor(cfg.width_y / rs + _EPS) - 1
        offset = (cfg.width_y - (n_rows + 1) * rs) / 2
        row_y = offset + rs * np.arange(1, n_rows + 1, dtype=np.float64)
        lane_y = offset + rs * (np.arange(n_rows + 1, dtype=np.float64) + 0.5)

        n_per_row = math.floor((cfg.length_x - 2 * h) / cfg.plant_spacing + _EPS) + 1
        xs = h + cfg.plant_spacing * np.arange(n_per_row)
        gx, gy = np.meshgrid(xs, row_y)
        stems_all = np.column_stack([gx.ravel(), gy.ravel()])
        keep = rng.random(len(stems_all)) >= cfg.plant_dropout_prob
        stems = stems_all[keep]
        radii = rng.uniform(cfg.canopy_radius_min, cfg.canopy_radius_max, len(stems))

        x0, x1 = h / 2, cfg.length_x - h / 2
        lanes = tuple(LineString([(x0, y), (x1, y)]) for y in lane_y)
        return cls(
            cfg=cfg,
            row_y=row_y,
            stems=stems,
            canopy_radius=radii,
            lane_y=lane_y,
            lanes=lanes,
            headlands=(
                box(0.0, 0.0, h, cfg.width_y),
                box(cfg.length_x - h, 0.0, cfg.length_x, cfg.width_y),
            ),
            boundary=box(0.0, 0.0, cfg.length_x, cfg.width_y),
        )

    @cached_property
    def free_space(self) -> shapely.Geometry:
        """Field minus canopy discs. Lazy: the union of ~900 discs is the slowest step here."""
        canopies = shapely.buffer(shapely.points(self.stems), self.canopy_radius)
        return self.boundary.difference(shapely.union_all(canopies))

    def lane_sites(self, spacing: float) -> list[ProbeSite]:
        """Points every `spacing` m along each lane centreline (the same list for every field
        with this config)."""
        (x0, _), (x1, _) = self.lanes[0].coords
        return lane_sites(self.lane_y, x0, x1, spacing)

    def site_ok(self, sites: list[ProbeSite]) -> npt.NDArray[np.bool_]:
        """True where a site is at least stem_keepout from every stem."""
        if not sites or len(self.stems) == 0:
            return np.ones(len(sites), dtype=bool)
        d, _ = KDTree(self.stems).query(np.array([(s.x, s.y) for s in sites]))
        return np.asarray(d >= self.cfg.stem_keepout)

    def candidate_probe_sites(self, spacing: float) -> list[ProbeSite]:
        """Points every `spacing` m along each lane centreline, at least stem_keepout from stems."""
        sites = self.lane_sites(spacing)
        return [s for s, ok in zip(sites, self.site_ok(sites), strict=True) if ok]


def lane_sites(lane_y: FloatArray, x0: float, x1: float, spacing: float) -> list[ProbeSite]:
    """Every `spacing` m from x0 to x1 on each lane centreline y."""
    xs = np.arange(x0, x1 + _EPS, spacing)
    return [ProbeSite(float(x), float(y), lane) for lane, y in enumerate(lane_y) for x in xs]
