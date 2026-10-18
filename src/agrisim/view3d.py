"""3D replay of one survey in the browser (three.js page in viewer3d/).

`write_scene` turns a finished run into scene.json: the field, the plants, the rover's path, every
probe reading, and the map after each reading. `serve` hosts the viewer page and that file on
127.0.0.1 and opens the browser. The page only replays what the simulator produced.
"""

import json
import socket
import sys
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np
import numpy.typing as npt

from agrisim.io import metrics_dict
from agrisim.metrics import map_metrics, truth_on_grid
from agrisim.sim import map_now
from agrisim.weather import rain_mm

if TYPE_CHECKING:
    from agrisim.sim import RunResult

VIEWER = Path(__file__).resolve().parent / "viewer3d"
SCENE = "scene.json"
PATH_EVERY = 4  # keep every 4th drive step (0.2 s at dt = 0.05 s), plus every stop and start


def _milli(values: npt.ArrayLike) -> list[Any]:
    """Grid values as integer thousandths (VWC 0.213 -> 213); NaN -> None. Keeps the JSON small."""
    v = np.asarray(values, dtype=np.float64).ravel()
    return [None if not np.isfinite(x) else round(float(x) * 1000) for x in v]


def _path_samples(times: npt.NDArray[np.float64], dt: float) -> npt.NDArray[np.intp]:
    """Indices to keep: every PATH_EVERY-th step, both ends, and both sides of every pause."""
    n = len(times)
    keep = np.zeros(n, dtype=bool)
    keep[::PATH_EVERY] = True
    keep[[0, -1]] = True
    gap = np.diff(times) > 1.5 * dt  # the rover stood still here (probing)
    keep[:-1] |= gap
    keep[1:] |= gap
    return np.flatnonzero(keep)


def scene_dict(result: "RunResult") -> dict[str, Any]:
    """Everything the 3D page needs, from one finished run."""
    cfg, lay = result.cfg, result.layout
    idx = _path_samples(result.times, cfg.dt)
    p = result.poses[idx]

    # The map as it stood after each reading, rebuilt from the readings in order. With weather,
    # the truth changes too: truth_k[k] is the real moisture when reading k was taken.
    readings = result.readings
    est, sd, rmse, truth_k = [], [], [], []
    for k in range(len(readings) + 1):
        t = readings[k - 1].t if k else 0.0
        mean, var = map_now(cfg, result.grid, readings[:k], t)
        tg = truth_on_grid(result.truth_at(t), result.grid) if cfg.weather else result.truth_grid
        est.append(_milli(mean))
        sd.append(_milli(np.sqrt(var)))
        e = map_metrics(tg, mean, var, cfg.mapping.dry_threshold).rmse
        rmse.append(round(e, 5) if np.isfinite(e) else None)
        truth_k.append(_milli(tg))
    # A reading taken beside an earlier one is a recheck; say why the rover went back.
    again: list[str | None] = []
    near = cfg.survey.candidate_spacing / 2
    for k, r in enumerate(readings):
        before = [q for q in readings[:k] if np.hypot(q.x - r.x, q.y - r.y) < near]
        if not before:
            again.append(None)
            continue
        wet = cfg.weather is not None and rain_mm(cfg.weather, before[-1].t, r.t) > 0.5
        again.append("rain" if wet else "check")

    return {
        "version": 2,
        "seed": result.seed,
        "policy": result.policy,
        "field": cfg.field.model_dump(),
        "rover": cfg.rover.model_dump(),
        "probe_time_s": cfg.probe.insertion_time_s,
        "dry_threshold": cfg.mapping.dry_threshold,
        "vwc_range": list(cfg.soil.vwc_clip),
        "std_vwc": cfg.soil.std_vwc,
        "stems": np.round(lay.stems, 3).tolist(),
        "canopy": np.round(lay.canopy_radius, 3).tolist(),
        "rows_y": np.round(lay.row_y, 3).tolist(),
        "lanes_y": np.round(lay.lane_y, 3).tolist(),
        "path": {
            "t": np.round(result.times[idx], 2).tolist(),
            "x": np.round(p[:, 0], 3).tolist(),
            "y": np.round(p[:, 1], 3).tolist(),
            "th": np.round(p[:, 2], 4).tolist(),
        },
        "probes": [
            {"t": round(r.t, 2), "x": round(r.x, 3), "y": round(r.y, 3), "v": r.value, "again": a}
            for r, a in zip(readings, again, strict=True)
        ],
        "grid": {"nx": result.grid.nx, "ny": result.grid.ny, "res": result.grid.resolution},
        "truth": _milli(result.truth_grid),  # at the end of the mission
        "truth_k": truth_k if cfg.weather else None,
        "rain": [e.model_dump() for e in cfg.weather.rain] if cfg.weather else [],
        "estimate": est,  # estimate[k] = map after k readings
        "sd": sd,  # kriging standard deviation after k readings (None where undefined)
        "rmse": rmse,
        "metrics": metrics_dict(result),
        "contacts": [
            {"t": round(float(result.times[c.step]), 2), "x": c.x, "y": c.y}
            for c in result.contacts
        ],
    }


def write_scene(result: "RunResult", out_dir: Path) -> Path:
    path = out_dir / SCENE
    path.write_text(json.dumps(scene_dict(result), separators=(",", ":")), encoding="utf-8")
    return path


class _Handler(SimpleHTTPRequestHandler):
    """Serves the viewer files; /run/<file> comes from the run folder instead."""

    def __init__(self, *args: Any, run_dir: Path, **kwargs: Any) -> None:
        self.run_dir = run_dir
        # Explicit types: some Windows registries map .js to text/plain, which browsers refuse
        # to run as a module.
        self.extensions_map = {
            ".html": "text/html",
            ".js": "text/javascript",
            ".mjs": "text/javascript",
            ".json": "application/json",
            ".css": "text/css",
            ".txt": "text/plain",
        }
        super().__init__(*args, directory=str(VIEWER), **kwargs)

    def end_headers(self) -> None:
        # /run/scene.json is the same URL for every run: without this the browser can replay a
        # cached older survey, or mix new viewer files with old ones.
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def translate_path(self, path: str) -> str:
        if path.split("?")[0] == "/run/" + SCENE:
            return str(self.run_dir / SCENE)
        return super().translate_path(path)

    def log_message(self, format: str, *args: Any) -> None:
        pass


class _Server(ThreadingHTTPServer):
    # On Windows SO_REUSEADDR lets a second server bind a port that is already in use (and the
    # two then share requests). Claim the port exclusively there instead.
    allow_reuse_address = sys.platform != "win32"

    def server_bind(self) -> None:
        if sys.platform == "win32":
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def make_server(run_dir: Path, port: int = 0) -> ThreadingHTTPServer:
    """A server on 127.0.0.1 (port 0 = any free port); call serve_forever() to run it."""
    return _Server(("127.0.0.1", port), partial(_Handler, run_dir=run_dir))


def serve(run_dir: Path, open_browser: bool = True, port: int = 0) -> None:
    """Host the 3D viewer for one run folder until Ctrl+C."""
    server = make_server(run_dir, port)
    url = f"http://127.0.0.1:{server.server_address[1]}/"
    print(f"3D viewer: {url}  (press Ctrl+C to stop)", flush=True)
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
