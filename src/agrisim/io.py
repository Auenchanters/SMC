"""Run-folder naming and writing. Names are Windows-safe (no ':'); runs are never overwritten."""

import csv
import dataclasses
import json
import math
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np
import yaml
from matplotlib.figure import Figure

if TYPE_CHECKING:
    from agrisim.sim import RunResult


def run_dir_name(seed: int, now: datetime | None = None) -> str:
    """Return e.g. '20261013T101500Z_seed7' for a UTC timestamp."""
    now = now or datetime.now(UTC)
    return f"{now.astimezone(UTC):%Y%m%dT%H%M%SZ}_seed{seed}"


def new_dir(root: Path, name: str) -> Path:
    """Create root/name, or root/name_1, name_2, ... if it already exists."""
    root.mkdir(parents=True, exist_ok=True)
    for i in range(1000):
        path = root / (name if i == 0 else f"{name}_{i}")
        try:
            path.mkdir()
            return path
        except FileExistsError:
            continue
    raise FileExistsError(f"could not create a new folder for {name} under {root}")


def _jsonable(obj: Any) -> Any:
    """NaN/inf -> None so the output is strict JSON."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, list | tuple):
        return [_jsonable(v) for v in obj]
    return obj


def metrics_dict(result: "RunResult") -> dict[str, Any]:
    out: dict[str, Any] = _jsonable(
        {
            "seed": result.seed,
            "policy": result.policy,
            "map": dataclasses.asdict(result.map_metrics),
            "run": dataclasses.asdict(result.run_metrics),
            "soil": {
                "corr_length_m": result.corr_length,
                "anomalies": [dataclasses.asdict(a) for a in result.anomalies],
            },
        }
    )
    return out


def save_figure(result: "RunResult", path: Path) -> None:
    from agrisim.viz import map_ranges  # local import keeps io free of rerun at import time

    f = result.cfg.field
    fig = Figure(figsize=(12, 8), layout="constrained")
    axes = fig.subplots(2, 2)
    maps = result.maps()
    for ax, (name, (cmap, lo, hi)) in zip(axes.flat, map_ranges(result.cfg).items(), strict=True):
        im = ax.imshow(
            maps[name],
            origin="lower",
            extent=(0, f.length_x, 0, f.width_y),
            cmap=cmap,
            vmin=lo,
            vmax=hi,
        )
        fig.colorbar(im, ax=ax, shrink=0.8)
        ax.set_title(name)
        ax.set_xlabel("x (m)")
        ax.set_ylabel("y (m)")
    xy = np.array([(r.x, r.y) for r in result.readings]).reshape(-1, 2)
    axes[0, 1].scatter(xy[:, 0], xy[:, 1], s=6, c="white", edgecolors="black", linewidths=0.3)
    m = result.map_metrics
    fig.suptitle(
        f"seed {result.seed}, {result.policy}: RMSE {m.rmse:.4f}, R2 {m.r2:.3f}, "
        f"probes {result.run_metrics.valid_probes}/{result.run_metrics.probes_used}, "
        f"contacts {result.run_metrics.plant_contacts} (soil parameters are placeholders)"
    )
    fig.savefig(path, dpi=110)


def save_run(result: "RunResult", out_dir: Path) -> None:
    """Write config, metrics, grids, probes, path and a 2x2 figure into an existing folder."""
    with (out_dir / "config.yaml").open("w", encoding="utf-8") as fh:
        yaml.safe_dump(result.cfg.model_dump(mode="json"), fh, sort_keys=False)
    with (out_dir / "metrics.json").open("w", encoding="utf-8") as fh:
        json.dump(metrics_dict(result), fh, indent=2)
    np.save(out_dir / "truth.npy", result.truth_grid)
    np.save(out_dir / "estimate.npy", result.mean)
    np.save(out_dir / "variance.npy", result.var)
    with (out_dir / "probes.csv").open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["t_s", "x_m", "y_m", "value_vwc", "valid", "sensor_id"])
        for r in result.readings:
            w.writerow([r.t, r.x, r.y, "" if r.value is None else r.value, r.valid, r.sensor_id])
    with (out_dir / "path.csv").open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["t_s", "x_m", "y_m", "theta_rad"])
        w.writerows(np.column_stack([result.times, result.poses]).tolist())
    save_figure(result, out_dir / "maps.png")
