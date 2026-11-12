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
    # allow_inf_nan=False: YAML .nan / .inf would otherwise pass and poison readings or crash.
    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)


# The path follower is not perfect: it stops up to ~1 cm short of a corner and enters a lane with
# up to ~0.12 rad of heading error, which swings the footprint's corners sideways. Clearance
# checks add this on top of safety_margin (measured on 1,000 fuzzed configs at the limits).
TRACKING_SLACK = 0.015  # m
TRACKING_HEADING = 0.12  # rad
MAX_FFT_CELLS = 25_000_000  # soil generator grid incl. padding (~0.4 GB of complex128)


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
    # Positioning error along the row (no RTK): each reading is logged this far (1 sd) from where
    # the probe really went in. The lane itself is known, so there is no error across rows.
    along_row_error_std: NonNegative = 0.0

    @property
    def turn_radius(self) -> float:
        """Radius of the circle swept when turning in place (half the footprint diagonal)."""
        return math.hypot(self.width / 2, self.length / 2)

    @property
    def tracking_allowance(self) -> float:
        """Extra sideways room the real path needs beyond the ideal centreline (m)."""
        hl, hw = self.length / 2, self.width / 2
        swing = hl * math.sin(TRACKING_HEADING) + hw * math.cos(TRACKING_HEADING) - hw
        return TRACKING_SLACK + swing


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
        if self.vwc_clip[0] < 0 or self.vwc_clip[1] > 1:
            raise ValueError(
                f"vwc_clip must lie within [0, 1] (VWC is a fraction), got {list(self.vwc_clip)}"
            )
        return self


class HardSoilConfig(_Model):
    """Dry soil is hard: the drier the spot, the more often the probe fails or stops short.

    Trouble ramps up as a logistic in the true VWC, half-strength at `hard_below`.
    """

    hard_below: float  # VWC
    width: PositiveFloat  # VWC scale of the ramp
    fail_prob: Fraction  # failure probability in very dry soil (failure_prob in wet soil)
    partial_prob: Fraction  # probability of a short insertion in very dry soil
    partial_drop: NonNegative  # a short insertion reads low by partial_drop x U(0.5, 1)


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
    hard_soil: HardSoilConfig | None = None  # None: failures do not depend on the soil


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


# Soil hydraulic properties by USDA texture class: porosity, saturated conductivity (mm/h),
# air-entry suction (cm) and Campbell's b. Means of 1,845 soils (Clapp & Hornberger 1978,
# Water Resources Research 14(4), Table 2).
SOIL_TEXTURES: dict[str, tuple[float, float, float, float]] = {
    "sand": (0.395, 634.0, 12.1, 4.05),
    "loamy_sand": (0.410, 562.0, 9.0, 4.38),
    "sandy_loam": (0.435, 125.0, 21.8, 4.90),
    "silt_loam": (0.485, 25.9, 78.6, 5.30),
    "loam": (0.451, 25.0, 47.8, 5.39),
    "sandy_clay_loam": (0.420, 22.7, 29.9, 7.12),
    "silty_clay_loam": (0.477, 6.12, 35.6, 7.75),
    "clay_loam": (0.476, 8.82, 63.0, 8.52),
    "sandy_clay": (0.426, 7.82, 15.3, 10.4),
    "silty_clay": (0.492, 3.71, 49.0, 10.4),
    "clay": (0.482, 4.61, 40.5, 11.4),
}
FIELD_CAPACITY_CM = 330.0  # suction at field capacity (33 kPa)
WILTING_POINT_CM = 15000.0  # suction at the permanent wilting point (1500 kPa)


class IrrigationEvent(_Model):
    """One drip-irrigation run: every emitter on every plant row drips for duration_s."""

    start_s: NonNegative  # mission time
    duration_s: PositiveFloat
    emitter_l_per_h: PositiveFloat  # flow of one emitter
    emitter_spacing: PositiveFloat  # m between emitters along the drip line
    strip_half_width: PositiveFloat  # m: the wetted strip reaches this far each side of the row


class PhysicalSoilConfig(_Model):
    """Soil-water physics for the layer the probe reads (weather.py, physical model).

    Infiltration is limited by a Green-Ampt capacity (the rest runs off), drainage follows
    Campbell's K(theta), and evapotranspiration follows the FAO-56 dual limit: the reference
    rate over the day, cut back as the soil dries past the readily available water.
    Give a texture class, and override any property that has been measured or fitted.
    """

    texture: Literal[
        "sand", "loamy_sand", "sandy_loam", "silt_loam", "loam", "sandy_clay_loam",
        "silty_clay_loam", "clay_loam", "sandy_clay", "silty_clay", "clay",
    ]  # fmt: skip
    theta_s: Annotated[float, Field(gt=0.0, lt=1.0)] | None = None  # porosity
    ks_mm_per_h: PositiveFloat | None = None  # saturated hydraulic conductivity
    psi_s_cm: PositiveFloat | None = None  # air-entry suction
    b: Annotated[float, Field(ge=1.0, le=30.0)] | None = None  # Campbell exponent
    field_capacity: Annotated[float, Field(gt=0.0, lt=1.0)] | None = None  # else from the curve
    wilting_point: Annotated[float, Field(gt=0.0, lt=1.0)] | None = None  # else from the curve
    crust_factor: Annotated[float, Field(gt=0.0, le=1.0)] = 1.0  # a surface seal cuts intake
    et0_mm_per_day: NonNegative  # reference evapotranspiration of the day (FAO-56 ET0)
    crop_coefficient: NonNegative = 1.0  # FAO-56 Kc
    depletion_fraction: Annotated[float, Field(gt=0.0, lt=1.0)] = 0.4  # FAO-56 p (tomato 0.40)
    diurnal: bool = True  # ET follows the sun (zero at night); False spreads it over 24 h
    start_hour: Annotated[float, Field(ge=0.0, lt=24.0)] = 10.0  # solar time at mission t = 0
    lateral_diffusivity_m2_per_h: NonNegative = 0.0  # sideways spread of water in the layer
    irrigation: tuple[IrrigationEvent, ...] = ()

    def hydraulics(self) -> tuple[float, float, float, float]:
        """(porosity, Ks mm/h, air-entry suction cm, b): the texture class with overrides."""
        ts, ks, psi, b = SOIL_TEXTURES[self.texture]
        return (
            ts if self.theta_s is None else self.theta_s,
            ks if self.ks_mm_per_h is None else self.ks_mm_per_h,
            psi if self.psi_s_cm is None else self.psi_s_cm,
            b if self.b is None else self.b,
        )

    def retention(self, suction_cm: float) -> float:
        """VWC held at a suction, from Campbell's curve theta = theta_s (psi_s / psi)^(1/b)."""
        ts, _, psi, b = self.hydraulics()
        return float(ts * min(1.0, psi / suction_cm) ** (1.0 / b))

    def limits(self) -> tuple[float, float]:
        """(wilting point, field capacity) as VWC."""
        wp = self.retention(WILTING_POINT_CM) if self.wilting_point is None else self.wilting_point
        fc = (
            self.retention(FIELD_CAPACITY_CM)
            if self.field_capacity is None
            else self.field_capacity
        )
        return wp, fc

    @model_validator(mode="after")
    def _check(self) -> Self:
        wp, fc = self.limits()
        ts = self.hydraulics()[0]
        if not wp < fc < ts:
            raise ValueError(
                f"need wilting point < field capacity < porosity, got {wp:.3f}, {fc:.3f}, {ts:.3f}"
            )
        return self


class WeatherConfig(_Model):
    """Water balance of the soil layer the probe measures (weather.py). Optional: without it the
    soil does not change during a mission.

    With `physical:` set, the physical model replaces the simple bucket, and the bucket's three
    numbers are not needed."""

    layer_depth: PositiveFloat  # m of soil the probe reads; rain spreads through it
    # The simple bucket's three numbers; required unless `physical:` is set.
    field_capacity: PositiveFloat | None = None  # VWC above which water drains away
    drainage_per_h: NonNegative | None = None  # share of the water above capacity drained per hour
    evapotranspiration_mm_per_h: NonNegative | None = None  # sun, heat and plants drying the soil
    infiltration_cv: NonNegative  # spatial variation of how much rain soaks in (runoff, crust)
    infiltration_corr_length: PositiveFloat  # m
    step_s: Annotated[float, Field(ge=10.0)]  # shorter steps only cost memory and time
    rain: tuple[RainEvent, ...] = ()
    physical: PhysicalSoilConfig | None = None  # None: the simple bucket

    @model_validator(mode="after")
    def _check(self) -> Self:
        bucket = (self.field_capacity, self.drainage_per_h, self.evapotranspiration_mm_per_h)
        if self.physical is None and None in bucket:
            raise ValueError(
                "give field_capacity, drainage_per_h and evapotranspiration_mm_per_h, "
                "or a physical: section"
            )
        return self


class CensoredConfig(_Model):
    """Read a failed insertion as a censored sample: "drier than `threshold`".

    A probe that will not go in says something about the soil even though it returns no value,
    and in hard soil it is the dry spots that fail (research.md WP4). The mapper places such a
    reading at the truncated-normal mean of the soil moisture below `threshold`, given the
    readings so far.
    """

    threshold: float = Field(gt=0.0)  # VWC at which insertion gets hard (`hard_soil.hard_below`)
    min_readings: PositiveInt = 3  # valid readings needed before the prior mean and sd are used
    sigma_floor: PositiveFloat = 0.01  # VWC; keeps the truncated-normal formula finite


class MappingConfig(_Model):
    method: Literal["ordinary_kriging", "idw", "global_mean"]
    variogram_model: Literal["linear", "power", "gaussian", "spherical", "exponential"]
    output_resolution: PositiveFloat
    dry_threshold: float
    min_readings: PositiveInt = 5
    # None (the default) keeps every earlier run byte-identical: failed probes are ignored.
    censored: CensoredConfig | None = None


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
        slack = r.tracking_allowance
        clear = f.row_spacing - 2 * f.canopy_radius_max
        need = r.width + 2 * (r.safety_margin + slack)
        if clear < need:
            raise ValueError(
                f"clear lane width {clear:.3f} m (row_spacing {f.row_spacing} - 2 * "
                f"canopy_radius_max {f.canopy_radius_max}) is less than rover width {r.width} "
                f"+ 2 * (safety_margin {r.safety_margin} + tracking allowance {slack:.3f}) "
                f"= {need:.3f} m"
            )
        # The rover turns in place on the headland centreline (x = headland / 2).
        need_h = 2 * (r.turn_radius + r.safety_margin + slack + f.canopy_radius_max)
        if f.headland < need_h:
            raise ValueError(
                f"headland {f.headland} m is too short to turn in place: needs >= {need_h:.3f} m "
                f"(2 * (turn radius {r.turn_radius:.3f} + safety_margin {r.safety_margin} "
                f"+ tracking allowance {slack:.3f} + canopy_radius_max {f.canopy_radius_max}))"
            )
        return self

    @model_validator(mode="after")
    def _check_steps_and_grids(self) -> Self:
        r, f, s = self.rover, self.field, self.soil
        # The follower and the contact check assume small steps; long ones overshoot turns.
        if r.max_speed * self.dt > 0.1 or r.max_yaw_rate * self.dt > 0.25:
            raise ValueError(
                f"dt {self.dt} s is too long: the rover may move at most 0.1 m and turn at most "
                f"0.25 rad per step (max_speed {r.max_speed} m/s, max_yaw_rate "
                f"{r.max_yaw_rate} rad/s); use dt <= "
                f"{min(0.1 / r.max_speed, 0.25 / r.max_yaw_rate):.4g}"
            )
        short = min(f.length_x, f.width_y)
        for name, res in (
            ("soil.grid_resolution", s.grid_resolution),
            ("mapping.output_resolution", self.mapping.output_resolution),
        ):
            if round(short / res) < 2:
                raise ValueError(
                    f"{name} {res} m is too coarse: the field's short side ({short} m) needs at "
                    f"least 2 cells"
                )
        # The weather's soak-in pattern is drawn on the same padded grid, with its own length.
        longest = max(
            s.corr_length_range[1], self.weather.infiltration_corr_length if self.weather else 0.0
        )
        pad = math.ceil(3 * longest / s.grid_resolution)
        cells = (round(f.width_y / s.grid_resolution) + pad) * (
            round(f.length_x / s.grid_resolution) + pad
        )
        if cells > MAX_FFT_CELLS:
            raise ValueError(
                f"soil grid too large to generate: {cells:,} cells including the 3 x corr_length "
                f"padding (limit {MAX_FFT_CELLS:,}, about 0.4 GB); use a coarser "
                f"soil.grid_resolution or a shorter corr_length_range / infiltration_corr_length"
            )
        return self


def _merge(base: dict[str, Any], over: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for k, v in over.items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def _read(path: Path, seen: tuple[Path, ...] = ()) -> dict[str, Any]:
    here = path.resolve()
    if here in seen:  # a.yaml extends b.yaml extends a.yaml: stop, do not recurse for ever
        chain = " -> ".join(q.name for q in (*seen, here))
        raise ValueError(f"config files extend each other in a loop: {chain}")
    with path.open(encoding="utf-8") as fh:
        data: dict[str, Any] = yaml.safe_load(fh) or {}
    if not isinstance(data, dict):
        raise ValueError(f"{path.name}: a config file must be a mapping of sections")
    base = data.pop("extends", None)  # a scenario: another config file plus these changes
    if base is None:
        return data
    if not isinstance(base, str):
        raise ValueError(f"{path.name}: extends: must be one file name, got {base!r}")
    return _merge(_read(path.parent / base, (*seen, here)), data)


def load(path: str | Path) -> SimConfig:
    """Read and validate a YAML config file (following `extends:` to its base file)."""
    return SimConfig.model_validate(_read(Path(path)))
