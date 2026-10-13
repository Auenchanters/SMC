"""Procedural tomato-field layout: rows, plants, lanes, headlands and free space.

World frame: origin at the south-west corner, x along rows, y across rows.
Rows are centred in y so the outer lanes (beyond the first and last rows) are full-width lanes.
"""

import math
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
import shapely
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
    free_space: shapely.Geometry  # boundary minus canopy discs

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
        boundary = box(0.0, 0.0, cfg.length_x, cfg.width_y)
        canopies = shapely.union_all(shapely.buffer(shapely.points(stems), radii))
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
            boundary=boundary,
            free_space=boundary.difference(canopies),
        )

    def candidate_probe_sites(self, spacing: float) -> list[ProbeSite]:
        """Points every `spacing` m along each lane centreline, at least stem_keepout from stems."""
        sites = []
        for lane, line in enumerate(self.lanes):
            (x0, y), (x1, _) = line.coords
            for x in np.arange(x0, x1 + _EPS, spacing):
                sites.append(ProbeSite(float(x), float(y), lane))
        if not sites or len(self.stems) == 0:
            return sites
        xy = np.array([(s.x, s.y) for s in sites])
        d = np.linalg.norm(xy[:, None, :] - self.stems[None, :, :], axis=2).min(axis=1)
        return [s for s, ok in zip(sites, d >= self.cfg.stem_keepout, strict=True) if ok]
