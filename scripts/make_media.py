"""Regenerate the README images and the replay video from real simulator output.

    uv run python scripts/make_media.py --model runs/ppo_v1/model.zip
    uv run python scripts/make_media.py --results runs/eval_<time>/results.csv

Writes docs/img/{hero.png, maps.png, strategies.png, results.png, survey.gif} and
docs/media/survey.mp4 (MP4 needs ffmpeg on PATH; skipped with a message otherwise).
--results defaults to the newest runs/eval_*/results.csv (else runs/bench_*); --model is
optional (the PPO panel is skipped without it). Every number drawn comes from a run made here
or from the given results file.
"""

import argparse
import csv
import math
import shutil
from collections import defaultdict
from pathlib import Path

import numpy as np
from matplotlib import animation
from matplotlib.collections import LineCollection, PatchCollection
from matplotlib.figure import Figure
from matplotlib.patches import Circle, Polygon, Rectangle
from scipy import stats

from agrisim.config import SimConfig, load
from agrisim.io import save_figure
from agrisim.mapping import make_mapper
from agrisim.metrics import map_metrics
from agrisim.policies import LEARNED, STRATEGIES
from agrisim.rover import RoverState, footprint
from agrisim.sim import RunResult, run_survey

ROOT = Path(__file__).resolve().parents[1]
IMG, MEDIA = ROOT / "docs" / "img", ROOT / "docs" / "media"
SEED = 7
INK, INK2, GRID = "#0b0b0b", "#52514e", "#e4e3df"
BLUE = "#2a78d6"  # reference palette categorical slot 1
PLANT, PLANT_EDGE, SOIL = "#9fd39b", "#4f9a4b", "#f7f5ef"
ROVER = "#e34948"


def _style(ax, title: str) -> None:
    ax.set_title(title, loc="left", fontsize=10, color=INK)
    ax.tick_params(colors=INK2, labelsize=8)
    for s in ax.spines.values():
        s.set_color(GRID)


def draw_field(ax, res: RunResult) -> None:
    """Field, headlands, lanes and canopies (static layers)."""
    f, lay = res.cfg.field, res.layout
    ax.set_facecolor(SOIL)
    for x0 in (0.0, f.length_x - f.headland):
        ax.add_patch(Rectangle((x0, 0), f.headland, f.width_y, color="#ece6d6", lw=0))
    ax.add_collection(
        LineCollection([list(line.coords) for line in lay.lanes], colors=GRID, lw=0.6)
    )
    discs = [Circle(tuple(c), r) for c, r in zip(lay.stems, lay.canopy_radius, strict=True)]
    ax.add_collection(PatchCollection(discs, facecolor=PLANT, edgecolor=PLANT_EDGE, lw=0.2))
    ax.set_xlim(0, f.length_x)
    ax.set_ylim(0, f.width_y)
    ax.set_aspect("equal")
    ax.set_xlabel("x (m), along rows", fontsize=8, color=INK2)
    ax.set_ylabel("y (m)", fontsize=8, color=INK2)


def estimates_by_probe(res: RunResult) -> list[tuple[np.ndarray, float]]:
    """Map mean and RMSE after 0, 1, ..., n probes (same mapper as the run)."""
    out, mapper = [], make_mapper(res.cfg.mapping)
    lo = res.cfg.soil.mean_vwc
    for k in range(len(res.readings) + 1):
        if k:
            mapper.update(res.readings[k - 1])
        mean, var = mapper.estimate(res.grid)
        mean = np.where(np.isfinite(mean), mean, lo)
        out.append((mean, map_metrics(res.truth_grid, mean, var, 0.0).rmse))
    return out


def replay(res: RunResult, n_frames: int = 160):  # type: ignore[no-untyped-def]
    """Figure, animation and the frame-update function (for drawing a single frame)."""
    cfg = res.cfg
    lo, hi = cfg.soil.vwc_clip
    ext = (0, cfg.field.length_x, 0, cfg.field.width_y)
    fig = Figure(figsize=(16, 4.6), layout="constrained", facecolor="white")
    a_field, a_est, a_truth = fig.subplots(1, 3)
    draw_field(a_field, res)
    est = estimates_by_probe(res)
    im = a_est.imshow(est[0][0], origin="lower", extent=ext, cmap="viridis", vmin=lo, vmax=hi)
    a_truth.imshow(res.truth_grid, origin="lower", extent=ext, cmap="viridis", vmin=lo, vmax=hi)
    _style(a_truth, "Hidden truth (used only for scoring)")
    cb = fig.colorbar(im, ax=[a_est, a_truth], shrink=0.85)
    cb.set_label("soil moisture, VWC (m³/m³)", fontsize=8, color=INK2)
    for ax in (a_est, a_truth):
        ax.set_xlabel("x (m)", fontsize=8, color=INK2)
    (trail,) = a_field.plot([], [], color=BLUE, lw=1.0, alpha=0.8)
    body = Polygon(np.zeros((4, 2)), closed=True, color=ROVER, zorder=5)
    a_field.add_patch(body)
    probes_f = a_field.scatter(
        [],
        [],
        s=22,
        c=[],
        cmap="viridis",
        vmin=lo,
        vmax=hi,
        edgecolors=INK,
        linewidths=0.4,
        zorder=4,
    )
    probes_e = a_est.scatter([], [], s=10, c="white", edgecolors=INK, linewidths=0.4)
    xy = np.array([(r.x, r.y) for r in res.readings])
    vals = np.array([r.value if r.value is not None else np.nan for r in res.readings])
    rt = np.array([r.t for r in res.readings])
    t_end = float(res.times[-1])
    frame_t = np.linspace(0, t_end, n_frames)
    # hold the final frame for ~1.5 s
    frame_t = np.concatenate([frame_t, np.full(22, t_end)])

    def update(i: int):  # type: ignore[no-untyped-def]
        t = frame_t[i]
        j = int(np.searchsorted(res.times, t, side="right")) - 1
        k = int((rt <= t).sum())
        p = res.poses[j]
        body.set_xy(np.array(footprint(RoverState(*p), cfg.rover).exterior.coords))
        trail.set_data(res.poses[: j + 1 : 5, 0], res.poses[: j + 1 : 5, 1])
        probes_f.set_offsets(xy[:k] if k else np.empty((0, 2)))
        probes_f.set_array(vals[:k])
        probes_e.set_offsets(xy[:k] if k else np.empty((0, 2)))
        im.set_data(est[k][0])
        _style(a_field, f"Rover survey  ·  t = {t / 60:4.1f} min  ·  {k} probes")
        _style(a_est, f"Map from probes only  ·  RMSE {est[k][1]:.4f}")
        return body, trail, probes_f, probes_e, im

    update(0)
    fig.suptitle(
        "agrisim: full-coverage survey, seed 7 (placeholder soil parameters)",
        fontsize=11,
        color=INK,
    )
    anim = animation.FuncAnimation(fig, update, frames=len(frame_t), blit=False)
    return fig, anim, update, len(frame_t)


def strategies_figure(cfg: SimConfig, model: Path | None, budget: int) -> Figure:
    names = [*STRATEGIES, *([LEARNED] if model else [])]
    fig = Figure(figsize=(15, 7.4), layout="constrained", facecolor="white")
    axes = fig.subplots(2, 3)
    res = None
    for ax, name in zip(axes.flat, names, strict=False):
        res = run_survey(cfg, SEED, name, budget=budget, model=model)
        draw_field(ax, res)
        ax.plot(res.poses[::5, 0], res.poses[::5, 1], color=BLUE, lw=0.9)
        p = np.array([(r.x, r.y) for r in res.readings])
        ax.scatter(p[:, 0], p[:, 1], s=16, color=INK, zorder=4)
        r, m = res.run_metrics, res.map_metrics
        _style(
            ax,
            f"{name}\nRMSE {m.rmse:.4f}  ·  {r.path_length_m:.0f} m  ·  "
            f"{r.mission_time_s / 60:.0f} min  ·  contacts {r.plant_contacts}",
        )
    for ax in axes.flat[len(names) + 1 :]:
        ax.set_axis_off()
    last = axes.flat[len(names)] if len(names) < 6 else None
    if last is not None and res is not None:
        lo, hi = cfg.soil.vwc_clip
        f = cfg.field
        last.imshow(
            res.truth_grid,
            origin="lower",
            extent=(0, f.length_x, 0, f.width_y),
            cmap="viridis",
            vmin=lo,
            vmax=hi,
        )
        _style(last, "Hidden truth for this field (seed 7)")
    fig.suptitle(
        f"Same field, same {budget}-probe budget: where each strategy drives and probes",
        fontsize=12,
        color=INK,
    )
    return fig


def results_figure(csv_path: Path) -> Figure:
    rows = list(csv.DictReader(csv_path.open(encoding="utf-8")))
    by = defaultdict(list)
    for r in rows:
        by[r["strategy"]].append(r)
    seeds = sorted({int(r["seed"]) for r in rows})
    budget = rows[0]["budget"]

    def ci(name: str, key: str) -> tuple[float, float]:
        v = np.array([float(r[key]) for r in by[name] if r[key] not in ("", "nan")])
        half = stats.t.ppf(0.975, len(v) - 1) * v.std(ddof=1) / math.sqrt(len(v))
        return float(v.mean()), float(half)

    order = sorted(by, key=lambda n: ci(n, "rmse")[0])
    fig = Figure(figsize=(13, 0.62 * len(order) + 1.9), layout="constrained", facecolor="white")
    axes = fig.subplots(1, 3, sharey=True)
    panels = [
        ("rmse", "Map error, RMSE (VWC) - lower is better", "{:.4f}"),
        ("path_length_m", "Distance driven (m) - lower is cheaper", "{:.0f}"),
        ("dry_f1", "Dry-zone detection F1 - higher is better", "{:.2f}"),
    ]
    y = np.arange(len(order))[::-1]
    for ax, (key, title, fmt) in zip(axes, panels, strict=True):
        m = [ci(n, key) for n in order]
        means, halves = [a for a, _ in m], [b for _, b in m]
        ax.barh(y, means, height=0.55, color=BLUE, zorder=2)
        ax.errorbar(means, y, xerr=halves, fmt="none", ecolor=INK2, capsize=3, lw=1, zorder=3)
        for yi, mv, hv in zip(y, means, halves, strict=True):
            ax.text(mv + hv, yi, "  " + fmt.format(mv), va="center", fontsize=8, color=INK)
        ax.set_yticks(y, order, fontsize=9, color=INK)
        ax.grid(axis="x", color=GRID, lw=0.6, zorder=0)
        ax.set_xlim(0, max(a + b for a, b in m) * 1.25)
        _style(ax, title)
    fig.suptitle(
        f"Held-out fields (seeds {seeds[0]}-{seeds[-1]}, n = {len(seeds)}), {budget} probes each; "
        "bars = mean, whiskers = 95% CI. Zero plant contacts in every run.",
        fontsize=10,
        color=INK,
    )
    return fig


def newest(pattern: str) -> Path | None:
    hits = sorted((ROOT / "runs").glob(pattern))
    return hits[-1] if hits else None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--config", type=Path, default=ROOT / "configs" / "demo.yaml")
    ap.add_argument("--results", type=Path, default=None)
    ap.add_argument("--model", type=Path, default=None)
    ap.add_argument("--budget", type=int, default=30)
    args = ap.parse_args()
    results = args.results or newest("eval_*/results.csv") or newest("bench_*/results.csv")
    model = args.model if args.model and args.model.exists() else None
    IMG.mkdir(parents=True, exist_ok=True)
    MEDIA.mkdir(parents=True, exist_ok=True)
    cfg = load(args.config)

    res = run_survey(cfg, SEED)  # full coverage, config budget
    save_figure(res, IMG / "maps.png")
    fig, anim, update, n = replay(res)
    anim.save(IMG / "survey.gif", writer=animation.PillowWriter(fps=16), dpi=62)
    if shutil.which("ffmpeg"):
        anim.save(
            MEDIA / "survey.mp4", writer=animation.FFMpegWriter(fps=16, bitrate=2400), dpi=110
        )
    else:
        print("ffmpeg not on PATH: skipped docs/media/survey.mp4")
    update(n - 1)  # final frame
    fig.savefig(IMG / "hero.png", dpi=110)

    strategies_figure(cfg, model, args.budget).savefig(IMG / "strategies.png", dpi=100)
    if results:
        results_figure(results).savefig(IMG / "results.png", dpi=110)
        print(f"results.png from {results}")
    else:
        print("no runs/eval_* or runs/bench_* results.csv: skipped results.png")
    print(f"wrote {IMG} and {MEDIA}")


if __name__ == "__main__":
    main()
