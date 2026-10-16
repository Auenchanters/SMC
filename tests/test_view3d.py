import json
import re
import threading
import urllib.request
from pathlib import Path

from typer.testing import CliRunner

from agrisim.cli import app
from agrisim.config import SimConfig
from agrisim.sim import run_survey
from agrisim.view3d import VIEWER, make_server, scene_dict, write_scene

REPO = Path(__file__).resolve().parents[1]


def test_scene_matches_the_run(cfg: SimConfig) -> None:
    res = run_survey(cfg, 3, budget=6)
    s = scene_dict(res)
    cells = res.grid.nx * res.grid.ny
    assert len(s["probes"]) == len(res.readings) == 6
    # One map per number of readings so far, 0 to 6, each covering the whole grid.
    assert len(s["estimate"]) == len(s["sd"]) == len(s["rmse"]) == 7
    assert all(len(m) == cells for m in s["estimate"]) and len(s["truth"]) == cells
    assert s["estimate"][0] == [None] * cells  # no readings, no map
    t = s["path"]["t"]
    assert t[0] == 0 and t[-1] == round(float(res.times[-1]), 2) and t == sorted(t)
    # The rover stands still while probing: both ends of every stop are kept.
    for p in s["probes"]:
        assert p["t"] in t and round(p["t"] - cfg.probe.insertion_time_s, 2) in t
    assert len(s["stems"]) == len(s["canopy"]) == len(res.layout.stems)
    json.dumps(s, allow_nan=False)  # strict JSON: NaN became null


def test_server_serves_viewer_and_scene(cfg: SimConfig, tmp_path: Path) -> None:
    write_scene(run_survey(cfg, 3, budget=5), tmp_path)
    server = make_server(tmp_path)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        with urllib.request.urlopen(base + "/") as r:
            assert "Soil-moisture survey" in r.read().decode("utf-8")
        for path in ("/app.js", "/rover-model.mjs", "/vendor/three.module.js"):
            with urllib.request.urlopen(base + path) as r:
                assert r.headers["Content-Type"] == "text/javascript"  # module scripts need it
        with urllib.request.urlopen(base + "/run/scene.json") as r:
            assert len(json.loads(r.read())["probes"]) == 5
    finally:
        server.shutdown()
        server.server_close()


def test_viewer_rover_model_is_the_hardware_model() -> None:
    copy = (VIEWER / "rover-model.mjs").read_bytes()
    assert copy == (REPO / "hardware" / "rover-v2" / "model.mjs").read_bytes(), (
        "copy hardware/rover-v2/model.mjs to src/agrisim/viewer3d/rover-model.mjs"
    )


def test_view_needs_a_scene(tmp_path: Path) -> None:
    res = CliRunner().invoke(app, ["view", str(tmp_path)])
    assert res.exit_code == 2
    # On CI (GITHUB_ACTIONS) the error box is coloured; compare the plain text.
    assert "--view" in re.sub(r"\x1b\[[0-9;]*m", "", res.output)
