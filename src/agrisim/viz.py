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
        """Field view (rover, plants, probes) beside the four maps, RMSE below; plays at 30x."""
        whole_run = rr.encodings.TimeRange(
            start=rrb.TimeRangeBoundary.infinite(), end=rrb.TimeRangeBoundary.infinite()
        )
        maps = (rrb.Spatial2DView(origin=f"maps/{n}", name=n) for n in map_ranges(self.cfg))
        return rrb.Blueprint(
            rrb.Horizontal(
                rrb.Vertical(
                    rrb.Spatial2DView(origin="/", contents="/field/**", name="field (north up)"),
                    rrb.TimeSeriesView(
                        origin="metrics",
                        name="map RMSE vs truth",
                        axis_x=rrb.TimeAxis(view_range=whole_run),
                    ),
                    row_shares=[3, 1],
                ),
                rrb.Grid(*maps),
                column_shares=[3, 2],
            ),
            rrb.TimePanel(state="collapsed", timeline="sim_time", playback_speed=30.0),
            collapse_panels=True,
        )

    def _log_static(self, layout: FieldLayout) -> None:
        f, log = self.cfg.field, self.rec.log
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
        self.rec.log("metrics/rmse", rr.Scalars(rmse))

    def close(self) -> None:
        self.rec.flush()
        self.rec.disconnect()
