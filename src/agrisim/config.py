"""Pydantic configuration models and YAML loading.

Physical placeholder numbers live only in config files (see configs/demo.yaml); the models here
carry no defaults for them.
"""

import math
from pathlib import Path
from typing import Annotated, Any, Literal, Self

import yaml
from pydantic import BaseModel, ConfigDict, Field, PositiveFloat, PositiveInt, model_validator

Fraction = Annotated[float, Field(ge=0.0, le=1.0)]
NonNegative = Annotated[float, Field(ge=0.0)]


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


def _ordered[T: (int, float)](pair: tuple[T, T], name: str) -> None:
    if pair[0] > pair[1]:
        raise ValueError(f"{name} must be [low, high], got {list(pair)}")


class FieldConfig(_Model):
    length_x: PositiveFloat
    width_y: PositiveFloat
    headland: PositiveFloat
    row_spacing: PositiveFloat
    plant_spacing: PositiveFloat
    canopy_radius_min: PositiveFloat
    canopy_radius_max: PositiveFloat
    stem_keepout: PositiveFloat
    plant_dropout_prob: Fraction

    @model_validator(mode="after")
    def _check(self) -> Self:
        if self.canopy_radius_min > self.canopy_radius_max:
            raise ValueError("canopy_radius_min must be <= canopy_radius_max")
        if self.length_x <= 2 * self.headland:
            raise ValueError(f"length_x {self.length_x} must exceed 2 * headland {self.headland}")
        if self.width_y < 2 * self.row_spacing:
            raise ValueError(f"width_y {self.width_y} must fit at least one row (2 * row_spacing)")
        return self


class RoverConfig(_Model):
    width: PositiveFloat
    length: PositiveFloat
    max_speed: PositiveFloat
    max_yaw_rate: PositiveFloat
    safety_margin: NonNegative

    @property
    def turn_radius(self) -> float:
        """Radius of the circle swept when turning in place (half the footprint diagonal)."""
        return math.hypot(self.width / 2, self.length / 2)


class SoilConfig(_Model):
    grid_resolution: PositiveFloat
    mean_vwc: PositiveFloat
    std_vwc: NonNegative
    corr_length_range: tuple[PositiveFloat, PositiveFloat]
    covariance: Literal["exponential", "gaussian"]
    drip_stripe_amplitude: float
    dry_patch_count: tuple[int, int]
    dry_patch_radius: tuple[PositiveFloat, PositiveFloat]
    dry_patch_depth: NonNegative
    wet_patch_count: tuple[int, int]
    wet_patch_radius: tuple[PositiveFloat, PositiveFloat]
    wet_patch_height: NonNegative
    vwc_clip: tuple[float, float]

    @model_validator(mode="after")
    def _check(self) -> Self:
        for name in (
            "corr_length_range",
            "dry_patch_count",
            "dry_patch_radius",
            "wet_patch_count",
            "wet_patch_radius",
            "vwc_clip",
        ):
            _ordered(getattr(self, name), name)
        if min(self.dry_patch_count + self.wet_patch_count) < 0:
            raise ValueError("patch counts must be >= 0")
        return self


class ProbeConfig(_Model):
    footprint_radius: PositiveFloat
    noise_std: NonNegative
    bias: float
    resolution: PositiveFloat
    failure_prob: Fraction
    insertion_time_s: NonNegative
    # Poor soil contact (an air gap, a stone, a dry crust): the probe reads drier than the soil
    # by up to bad_contact_drop and does not know it.
    bad_contact_prob: Fraction = 0.0
    bad_contact_drop: NonNegative = 0.0


class SurveyConfig(_Model):
    probe_spacing: PositiveFloat
    probe_budget: PositiveInt
    candidate_spacing: PositiveFloat
    recheck_probes: Annotated[int, Field(ge=0)] = 0  # fixed_plus_recheck: probes kept for rechecks

    @model_validator(mode="after")
    def _check(self) -> Self:
        if self.recheck_probes >= self.probe_budget:
            raise ValueError("recheck_probes must be less than probe_budget")
        return self


class RainEvent(_Model):
    start_s: NonNegative  # mission time
    duration_s: PositiveFloat
    rate_mm_per_h: NonNegative


class WeatherConfig(_Model):
    """Water balance of the soil layer the probe measures (weather.py). Optional: without it the
    soil does not change during a mission."""

    layer_depth: PositiveFloat  # m of soil the probe reads; rain spreads through it
    field_capacity: PositiveFloat  # VWC above which water drains away
    drainage_per_h: NonNegative  # fraction of the water above field capacity drained per hour
    evapotranspiration_mm_per_h: NonNegative  # sun, heat and the plants drying the soil
    infiltration_cv: NonNegative  # spatial variation of how much rain soaks in (runoff, crust)
    infiltration_corr_length: PositiveFloat  # m
    step_s: PositiveFloat
    rain: tuple[RainEvent, ...] = ()


class MappingConfig(_Model):
    method: Literal["ordinary_kriging", "idw", "global_mean"]
    variogram_model: Literal["linear", "power", "gaussian", "spherical", "exponential"]
    output_resolution: PositiveFloat
    dry_threshold: float
    min_readings: PositiveInt = 5


class SimConfig(_Model):
    field: FieldConfig
    rover: RoverConfig
    soil: SoilConfig
    probe: ProbeConfig
    survey: SurveyConfig
    mapping: MappingConfig
    weather: WeatherConfig | None = None
    dt: PositiveFloat = 0.05

    @model_validator(mode="after")
    def _check_geometry(self) -> Self:
        f, r = self.field, self.rover
        clear = f.row_spacing - 2 * f.canopy_radius_max
        need = r.width + 2 * r.safety_margin
        if clear < need:
            raise ValueError(
                f"clear lane width {clear:.3f} m (row_spacing {f.row_spacing} - 2 * "
                f"canopy_radius_max {f.canopy_radius_max}) is less than rover width {r.width} "
                f"+ 2 * safety_margin {r.safety_margin} = {need:.3f} m"
            )
        # The rover turns in place on the headland centreline (x = headland / 2).
        need_h = 2 * (r.turn_radius + r.safety_margin + f.canopy_radius_max)
        if f.headland < need_h:
            raise ValueError(
                f"headland {f.headland} m is too short to turn in place: needs >= {need_h:.3f} m "
                f"(2 * (turn radius {r.turn_radius:.3f} + safety_margin {r.safety_margin} "
                f"+ canopy_radius_max {f.canopy_radius_max}))"
            )
        return self


def _merge(base: dict[str, Any], over: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for k, v in over.items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def _read(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as fh:
        data: dict[str, Any] = yaml.safe_load(fh) or {}
    base = data.pop("extends", None)  # a scenario: another config file plus these changes
    return _merge(_read(path.parent / base), data) if base else data


def load(path: str | Path) -> SimConfig:
    """Read and validate a YAML config file (following `extends:` to its base file)."""
    return SimConfig.model_validate(_read(Path(path)))
