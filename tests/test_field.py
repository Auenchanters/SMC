import math

import numpy as np
import pytest
import shapely
from pydantic import ValidationError

from agrisim.config import SimConfig
from agrisim.field import FieldLayout


def _layout(cfg: SimConfig, seed: int) -> FieldLayout:
    return FieldLayout.generate(cfg.field, np.random.default_rng(seed))


def test_row_count_matches_geometry(cfg: SimConfig) -> None:
    lay = _layout(cfg, 0)
    f = cfg.field
    assert len(lay.row_y) == math.floor(f.width_y / f.row_spacing) - 1
    assert len(lay.lanes) == len(lay.row_y) + 1
    assert np.allclose(np.diff(lay.row_y), f.row_spacing)
    # Outer lanes stay inside the field.
    assert lay.lane_y[0] - cfg.rover.width / 2 >= 0
    assert lay.lane_y[-1] + cfg.rover.width / 2 <= f.width_y


@pytest.mark.parametrize("seed", range(5))
def test_lanes_clear_every_stem(cfg: SimConfig, seed: int) -> None:
    lay = _layout(cfg, seed)
    need = cfg.field.canopy_radius_max + cfg.rover.width / 2 + cfg.rover.safety_margin
    for line in lay.lanes:
        y = line.coords[0][1]
        assert np.abs(lay.stems[:, 1] - y).min() >= need - 1e-9


def test_same_seed_same_layout(cfg: SimConfig) -> None:
    a, b, c = _layout(cfg, 3), _layout(cfg, 3), _layout(cfg, 4)
    assert np.array_equal(a.stems, b.stems)
    assert np.array_equal(a.canopy_radius, b.canopy_radius)
    assert not np.array_equal(a.canopy_radius[:10], c.canopy_radius[:10])


def test_candidate_sites_respect_keepout(cfg: SimConfig) -> None:
    lay = _layout(cfg, 1)
    sites = lay.candidate_probe_sites(cfg.survey.candidate_spacing)
    assert {s.lane for s in sites} == set(range(len(lay.lanes)))
    xy = np.array([(s.x, s.y) for s in sites])
    d = np.linalg.norm(xy[:, None] - lay.stems[None], axis=2).min()
    assert d >= cfg.field.stem_keepout
    assert shapely.contains(lay.free_space, shapely.points(xy)).all()


def test_oversized_rover_rejected(cfg: SimConfig) -> None:
    data = cfg.model_dump()
    data["rover"]["width"] = 0.6
    with pytest.raises(ValidationError, match="clear lane width"):
        SimConfig.model_validate(data)


def test_short_headland_rejected(cfg: SimConfig) -> None:
    data = cfg.model_dump()
    data["field"]["headland"] = 1.0
    with pytest.raises(ValidationError, match="headland"):
        SimConfig.model_validate(data)
