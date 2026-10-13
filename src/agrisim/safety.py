"""Plant-contact detection: rover footprint rectangle vs canopy circles (analytic, vectorised)."""

from dataclasses import dataclass
from typing import cast

import numpy as np
import numpy.typing as npt
from scipy.spatial import KDTree

from agrisim.config import RoverConfig
from agrisim.field import FieldLayout


@dataclass(frozen=True)
class PlantContact:
    step: int  # index into the poses array
    plant: int  # index into layout.stems
    x: float
    y: float
    depth: float  # canopy radius minus distance from footprint to stem (> 0)


def contacts(
    poses: npt.ArrayLike, rover: RoverConfig, layout: FieldLayout, tree: KDTree | None = None
) -> list[PlantContact]:
    """Contacts for every pose in an (S, 3) array of x, y, theta.

    A contact is any overlap between the footprint rectangle and a canopy disc. Candidate stems
    come from a KD-tree query within the footprint's circumradius plus the largest canopy radius.
    """
    p = np.atleast_2d(np.asarray(poses, dtype=np.float64))
    if len(p) == 0 or len(layout.stems) == 0:
        return []
    tree = tree or KDTree(layout.stems)
    reach = rover.turn_radius + float(layout.canopy_radius.max())
    pairs = cast(list[list[int]], list(tree.query_ball_point(p[:, :2], reach)))
    steps = np.repeat(np.arange(len(p)), [len(c) for c in pairs])
    if len(steps) == 0:
        return []
    plants = np.concatenate([np.asarray(c, dtype=np.intp) for c in pairs])
    d = layout.stems[plants] - p[steps, :2]
    c, s = np.cos(p[steps, 2]), np.sin(p[steps, 2])
    u, v = c * d[:, 0] + s * d[:, 1], -s * d[:, 0] + c * d[:, 1]  # stem in rover frame
    hl, hw = rover.length / 2, rover.width / 2
    dist = np.hypot(u - np.clip(u, -hl, hl), v - np.clip(v, -hw, hw))
    depth = layout.canopy_radius[plants] - dist
    hit = np.flatnonzero(depth > 0)
    return [
        PlantContact(
            int(steps[i]),
            int(plants[i]),
            float(layout.stems[plants[i], 0]),
            float(layout.stems[plants[i], 1]),
            float(depth[i]),
        )
        for i in hit
    ]
