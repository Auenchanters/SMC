"""Rerun logging (written against rerun-sdk 0.39.0) and shared colour mapping."""

from pathlib import Path

import numpy as np
import numpy.typing as npt
import rerun as rr
import rerun.blueprint as rrb
from matplotlib import colormaps

from agrisim.config import SimConfig
from agrisim.field import FieldLayout
from agrisim.rover import RoverState, footprint
from agrisim.sensor import ProbeReading

FloatArray = npt.NDArray[np.float64]
U8Array = npt.NDArray[np.uint8]


def map_ranges(cfg: SimConfig) -> dict[str, tuple[str, float, float]]:
    """Fixed colour map and value range per map image, so frames and runs are comparable."""
    lo, hi = cfg.soil.vwc_clip
    s = cfg.soil.std_vwc
    return {
        "truth": ("viridis", lo, hi),
        "estimate": ("viridis", lo, hi),
        "abs_error": ("magma", 0.0, 2 * s),
        "variance": ("cividis", 0.0, (2 * s) ** 2),
    }


MAP_NAMES = {
    "truth": "Real moisture (the robot never sees this)",
    "estimate": "Robot's moisture map",
    "abs_error": "Map error: how wrong the map is",
    "variance": "Uncertainty: how unsure the robot is",
}
# Markdown: a single line break inside a paragraph or list item is just a space.
GUIDE = """
A robot drives between rows of tomato plants and stops to push a probe into the soil.
From those few readings it draws a moisture map of the whole field.

**Press play** (bottom left) or **drag the time bar** to replay the survey (30x speed).

- **The field from above:** the red box is the robot, green dots are plants, grey lines are
  the paths it may drive. Round dots are its readings: purple = dry, yellow = wet,
  red = the probe failed.
- **Real moisture:** the truth, which exists only in the simulation. Dark = dry, yellow = wet.
- **Robot's moisture map:** its guess for every spot, from its readings so far. Same colours.
- **Map error:** dark = about right, bright = wrong.
- **Uncertainty:** dark = sure (near a reading), yellow = unsure (far from any reading).
- **Average map error over time:** falls as readings come in. 0.03 means the map is off by
  about 3 percentage points of water on average.

Scroll to zoom any view; double-click to reset it. The soil numbers are placeholders until
calibrated. For a 3D replay, run `agrisim run ... --view`.
"""


def colorize(values: npt.ArrayLike, cmap: str, vmin: float, vmax: float) -> U8Array:
    """RGB uint8 colours; NaN maps to mid grey."""
    v = np.asarray(values, dtype=np.float64)
    rgb = colormaps[cmap](np.clip((v - vmin) / (vmax - vmin), 0, 1))[..., :3]
    rgb[~np.isfinite(v)] = 0.5
    return np.asarray(np.round(rgb * 255), dtype=np.uint8)


class RerunLogger:
    """Logs one survey to a spawned viewer and/or an .rrd file, on the `sim_time` timeline."""

    def __init__(
        self, cfg: SimConfig, layout: FieldLayout, seed: int, rrd_path: Path | None, spawn: bool
    ) -> None:
        self.cfg = cfg
        self.rec = rr.RecordingStream("agrisim", recording_id=f"agrisim_seed{seed}")
        sinks: list[rr.GrpcSink | rr.FileSink] = []
        if spawn:
            self.rec.spawn(connect=False)
            sinks.append(rr.GrpcSink())
        if rrd_path is not None:
            sinks.append(rr.FileSink(rrd_path))
        self.rec.set_sinks(*sinks)
        self.rec.send_blueprint(self._blueprint())
        self._trail: list[tuple[float, float]] = []
        self._probes: list[ProbeReading] = []
        self._log_static(layout)

    def _blueprint(self) -> rrb.Blueprint:
        """A guide panel, the field, the four maps and the error over time, in plain words."""
        whole_run = rr.encodings.TimeRange(
            start=rrb.TimeRangeBoundary.infinite(), end=rrb.TimeRangeBoundary.infinite()
        )
        maps = (
            rrb.Spatial2DView(origin=f"maps/{key}", name=MAP_NAMES[key])
            for key in map_ranges(self.cfg)
        )
        return rrb.Blueprint(
            rrb.Horizontal(
                rrb.Vertical(
                    rrb.Spatial2DView(
                        origin="/", contents="/field/**", name="The field from above (north up)"
                    ),
                    rrb.TimeSeriesView(
                        origin="metrics",
                        name="Average map error over time (lower is better)",
                        axis_x=rrb.TimeAxis(view_range=whole_run),
                    ),
                    row_shares=[3, 1],
                ),
                rrb.Vertical(
                    rrb.TextDocumentView(origin="guide", name="How to read this"),
                    rrb.Grid(*maps),
                    row_shares=[2, 3],
                ),
                column_shares=[3, 2],
            ),
            rrb.TimePanel(state="collapsed", timeline="sim_time", playback_speed=30.0),
            collapse_panels=True,
        )

    def _log_static(self, layout: FieldLayout) -> None:
        f, log = self.cfg.field, self.rec.log
        log("guide", rr.TextDocument(GUIDE, media_type="text/markdown"), static=True)
        # 2D views draw y downwards; flip the field so north (high y) is up, like the maps.
        log("field", rr.Transform3D(translation=[0, f.width_y, 0], scale=[1, -1, 1]), static=True)
        outline = [(0, 0), (f.length_x, 0), (f.length_x, f.width_y), (0, f.width_y), (0, 0)]
        log("field/outline", rr.LineStrips2D([outline], colors=[200, 200, 200]), static=True)
        log(
            "field/headlands",
            rr.Boxes2D(
                mins=[(0, 0), (f.length_x - f.headland, 0)],
                sizes=[(f.headland, f.width_y)] * 2,
                colors=[120, 100, 70],
            ),
            static=True,
        )
        log(
            "field/lanes",
            rr.LineStrips2D([list(line.coords) for line in layout.lanes], colors=[90, 90, 90]),
            static=True,
        )
        log(
            "field/plants",
            rr.Points2D(layout.stems, radii=layout.canopy_radius, colors=[40, 160, 60]),
            static=True,
        )

    def log_drive(self, times: list[float], states: list[RoverState], every: int = 10) -> None:
        for t, s in list(zip(times, states, strict=True))[::every]:
            self.rec.set_time("sim_time", duration=t)
            corners = list(footprint(s, self.cfg.rover).exterior.coords)
            self.rec.log("field/rover", rr.LineStrips2D([corners], colors=[230, 60, 60]))
            self._trail.append((s.x, s.y))
        if self._trail:
            self.rec.log("field/trail", rr.LineStrips2D([self._trail], colors=[230, 140, 140]))

    def log_probe(self, reading: ProbeReading) -> None:
        self.rec.set_time("sim_time", duration=reading.t)
        self._probes.append(reading)
        _, lo, hi = map_ranges(self.cfg)["estimate"]
        vals = [r.value if r.value is not None else np.nan for r in self._probes]
        colors = colorize(vals, "viridis", lo, hi)
        colors[[not r.valid for r in self._probes]] = (255, 0, 0)
        xy = [(r.x, r.y) for r in self._probes]
        self.rec.log("field/probes", rr.Points2D(xy, radii=0.15, colors=colors))

    def log_maps(self, t: float, maps: dict[str, FloatArray], rmse: float) -> None:
        self.rec.set_time("sim_time", duration=t)
        for name, (cmap, lo, hi) in map_ranges(self.cfg).items():
            if name in maps:  # flip so north (high y) is up
                self.rec.log(
                    f"maps/{name}", rr.Image(colorize(np.flipud(maps[name]), cmap, lo, hi))
                )
        self.rec.log(r"metrics/average\ map\ error", rr.Scalars(rmse))

    def close(self) -> None:
        self.rec.flush()
        self.rec.disconnect()
