# ruff: noqa: E501
"""Time-lapse of the hidden soil over two days: drip irrigation each morning, an afternoon
cloudburst, and the sun drying the field. Shows the physical soil-water model at work without
the rover (a survey lasts half an hour; wetting and drying play out over hours and days).

    uv run python scripts/soil_timelapse.py --out runs/timelapse

Writes frames/*.png, soil_timelapse.png (the summary figure) and, when ffmpeg is on PATH,
soil_timelapse.mp4. The scenario is configs/scenarios/drip_irrigation.yaml with a two-day
schedule; every soil number in it is a placeholder until measured.
"""

import argparse
import shutil
import subprocess
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import LinearSegmentedColormap

from agrisim.config import SimConfig, load
from agrisim.field import FieldLayout
from agrisim.sim import world_rngs
from agrisim.soil import SoilTruth
from agrisim.weather import SoilDynamics, et0_rate, rain_mm

REPO = Path(__file__).resolve().parents[1]
HOURS = 48
FRAME_S = 600  # one frame per 10 minutes of field time
# The 3D replay's moisture colours: red-brown dry, yellow at the dry line, blue wet.
STOPS = [(0.05, "#7c2a0a"), (0.12, "#d0612a"), (0.18, "#f0b84a"), (0.24, "#b9d3e3"),
         (0.30, "#6aa6dc"), (0.37, "#2f6cb8"), (0.45, "#173c82")]  # fmt: skip
CMAP = LinearSegmentedColormap.from_list("moist", [((v - 0.05) / 0.40, c) for v, c in STOPS])


def scenario() -> SimConfig:
    d = load(REPO / "configs" / "scenarios" / "drip_irrigation.yaml").model_dump()
    w = d["weather"]
    w["step_s"] = 300
    w["rain"] = [{"start_s": 9 * 3600, "duration_s": 1500, "rate_mm_per_h": 45}]  # 15:00, day 1
    drip = {
        "duration_s": 2400,
        "emitter_l_per_h": 2.0,
        "emitter_spacing": 0.4,
        "strip_half_width": 0.15,
    }
    w["physical"]["start_hour"] = 6.0
    w["physical"]["irrigation"] = [{"start_s": (1 + 24 * day) * 3600, **drip} for day in (0, 1)]
    return SimConfig.model_validate(d)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=Path("runs/timelapse"))
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--no-frames", action="store_true", help="only the summary figure")
    a = ap.parse_args()
    cfg = scenario()
    w = cfg.weather
    assert w is not None and w.physical is not None
    rng_field, rng_soil, _, _, rng_weather, _ = world_rngs(a.seed)
    layout = FieldLayout.generate(cfg.field, rng_field)
    start = SoilTruth.generate(cfg.soil, layout, rng_soil)
    dyn = SoilDynamics(start, w, cfg.soil.vwc_clip, rng_weather, layout)

    gy = start.y_centres
    planted = (start.x_centres > cfg.field.headland) & (
        start.x_centres < cfg.field.length_x - cfg.field.headland
    )
    on_row = np.abs(gy[:, None] - layout.row_y).min(axis=1) < 0.13
    in_lane = np.abs(gy[:, None] - layout.lane_y).min(axis=1) < 0.13
    times = np.arange(0, HOURS * 3600 + 1, FRAME_S)
    rows, lanes, dry, et, rain, drip = [], [], [], [], [], []
    for t in times:
        g = dyn.at(float(t)).grid[:, planted]
        rows.append(float(g[on_row].mean()))
        lanes.append(float(g[in_lane].mean()))
        dry.append(float((g < cfg.mapping.dry_threshold).mean()))
        et.append(et0_rate(w.physical, float(t)) * w.physical.crop_coefficient)
        rain.append(rain_mm(w, float(t), float(t) + FRAME_S) * 3600 / FRAME_S)
        drip.append(any(e.start_s <= t < e.start_s + e.duration_s for e in w.physical.irrigation))
    hours = times / 3600
    _wp, fc = w.physical.limits()
    extent = (0, cfg.field.length_x, 0, cfg.field.width_y)

    def clock(t: float) -> str:
        h = (w.physical.start_hour + t / 3600) % 24  # type: ignore[union-attr]
        return f"day {int((w.physical.start_hour + t / 3600) // 24) + 1}, {int(h):02d}:{int(h % 1 * 60):02d}"  # type: ignore[union-attr]

    def draw(i: int, path: Path) -> None:
        t = float(times[i])
        fig = plt.figure(figsize=(12.8, 7.2), dpi=100, facecolor="#0f1419")
        ax = fig.add_axes((0.045, 0.30, 0.52, 0.60))
        im = ax.imshow(
            dyn.at(t).grid,
            origin="lower",
            extent=extent,
            cmap=CMAP,
            vmin=0.05,
            vmax=0.45,
            interpolation="bilinear",
        )
        ax.set_title(
            f"The real soil moisture, from above   ·   {clock(t)}",
            color="w",
            fontsize=13,
            loc="left",
            pad=10,
        )
        ax.set_xlabel("m along the rows", color="#aab5bd")
        ax.set_ylabel("m across the rows", color="#aab5bd")
        ax.tick_params(colors="#aab5bd")
        cb = fig.colorbar(
            im, cax=fig.add_axes((0.045, 0.16, 0.52, 0.025)), orientation="horizontal"
        )
        cb.set_label(
            f"volumetric water content, m³/m³   (too dry below {cfg.mapping.dry_threshold:.2f})",
            color="#aab5bd",
        )
        cb.ax.tick_params(colors="#aab5bd")
        cb.ax.axvline(cfg.mapping.dry_threshold, color="w", lw=1.5)
        state = (
            f"Cloudburst: {rain[i]:.0f} mm an hour. Part of it runs off."
            if rain[i]
            else (
                "Drip irrigation on: the strips along the plant rows soak."
                if drip[i]
                else (
                    "Night: no drying. Water keeps draining and spreading."
                    if et[i] == 0
                    else f"Sun and plants are drying the soil at {et[i]:.2f} mm an hour."
                )
            )
        )
        fig.text(
            0.045,
            0.06,
            state,
            color="#f0b84a" if not (rain[i] or drip[i]) else "#6aa6dc",
            fontsize=13,
        )

        ax2 = fig.add_axes((0.64, 0.56, 0.33, 0.34), facecolor="#171d24")
        ax2.plot(
            hours[: i + 1], rows[: i + 1], color="#6aa6dc", lw=2.2, label="under the drip lines"
        )
        ax2.plot(
            hours[: i + 1],
            lanes[: i + 1],
            color="#f0b84a",
            lw=2.2,
            label="lane centres (where the rover probes)",
        )
        ax2.axhline(fc, color="#aab5bd", lw=0.8, ls="--")
        ax2.text(HOURS, fc + 0.004, "field capacity", color="#aab5bd", fontsize=8, ha="right")
        ax2.axhline(cfg.mapping.dry_threshold, color="#d0612a", lw=0.8, ls="--")
        ax2.text(
            HOURS,
            cfg.mapping.dry_threshold + 0.004,
            "too dry",
            color="#d0612a",
            fontsize=8,
            ha="right",
        )
        ax2.set_xlim(0, HOURS)
        ax2.set_ylim(0.14, 0.42)
        ax2.set_title("Soil moisture", color="w", fontsize=11, loc="left")
        ax2.legend(loc="upper right", fontsize=8, frameon=False, labelcolor="w")
        ax3 = fig.add_axes((0.64, 0.16, 0.33, 0.28), facecolor="#171d24")
        ax3.fill_between(
            hours[: i + 1], et[: i + 1], color="#f0b84a", alpha=0.7, label="drying (ET), mm/h"
        )
        ax3.bar(
            hours[: i + 1],
            np.array(rain[: i + 1]) / 50,
            width=FRAME_S / 3600,
            color="#2f6cb8",
            label="rain, 50 mm/h",
        )
        ax3.bar(
            hours[: i + 1],
            np.array(drip[: i + 1]) * 0.25,
            width=FRAME_S / 3600,
            color="#2f8f83",
            label="drip running",
        )
        ax3.set_xlim(0, HOURS)
        ax3.set_ylim(0, 1.0)
        ax3.set_xlabel("hours since 06:00 on day 1", color="#aab5bd")
        ax3.set_title("Weather and irrigation", color="w", fontsize=11, loc="left")
        ax3.legend(loc="upper right", fontsize=8, frameon=False, labelcolor="w", ncols=3)
        for axis in (ax2, ax3):
            axis.tick_params(colors="#aab5bd", labelsize=8)
            for s in axis.spines.values():
                s.set_color("#2b333b")
            for night in (12, 36):  # 18:00 to 06:00
                axis.axvspan(night, night + 12, color="#000", alpha=0.25, lw=0)
        fig.text(0.64, 0.06, f"Soil: {w.physical.texture.replace('_', ' ')} (Clapp & Hornberger 1978). Placeholder field.",  # type: ignore[union-attr]
                 color="#aab5bd", fontsize=9)  # fmt: skip
        fig.savefig(path, facecolor=fig.get_facecolor())
        plt.close(fig)

    a.out.mkdir(parents=True, exist_ok=True)
    draw(len(times) - 1, a.out / "soil_timelapse.png")
    print(
        f"rows {rows[0]:.3f} -> peak {max(rows):.3f} -> {rows[-1]:.3f}; lanes {lanes[0]:.3f} -> peak {max(lanes):.3f} -> {lanes[-1]:.3f}"
    )
    if a.no_frames:
        return
    frames = a.out / "frames"
    frames.mkdir(exist_ok=True)
    for i in range(len(times)):
        draw(i, frames / f"f_{i:04d}.png")
    if shutil.which("ffmpeg"):
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-framerate", "24", "-i", str(frames / "f_%04d.png"),
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", str(a.out / "soil_timelapse.mp4")],
            check=True,
        )  # fmt: skip
    print("wrote", a.out)


if __name__ == "__main__":
    main()
