"""SMC app: the Simulator and Console pages (web/) and the JSON routes they call, on gr.Server.

Laptop, from the repository root (then open http://127.0.0.1:7860):

    uv run --with gradio==6.32.0 python huggingface_space/app.py

Runs are kept in the run store (`runs/` on the laptop, or the folder in SMC_RUNS): one folder per
run plus `runs.sqlite`. The verdict is decided in code (agrisim.verdict), never by a model.
"""

import csv
import hmac
import json
import mimetypes
import os
import random
import sys
import threading
import uuid
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
ROOT = HERE if (HERE / "configs").is_dir() else HERE.parent  # Space layout, else the repository
sys.path.insert(0, str(HERE))  # on the Space the deploy script puts agrisim/ next to this file

from fastapi import Header, HTTPException  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from gradio import Server  # noqa: E402
from pydantic import BaseModel, Field, ValidationError  # noqa: E402

from agrisim.config import load  # noqa: E402
from agrisim.io import new_dir, run_dir_name, save_run  # noqa: E402
from agrisim.policies import STRATEGIES  # noqa: E402
from agrisim.sim import run_survey  # noqa: E402
from agrisim.store import RunStore  # noqa: E402
from agrisim.verdict import Rules, RulesFile, load_rules, save_rules  # noqa: E402
from agrisim.view3d import VIEWER, write_scene  # noqa: E402

# Some Windows registries map .js to text/plain, which browsers refuse to run as a module.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")

WEB = HERE / "web"
CONFIGS = ROOT / "configs"
FIELDS = sorted(
    p.relative_to(CONFIGS).as_posix()
    for p in CONFIGS.rglob("*.yaml")
    if p.name != "verdict_rules.yaml"
)
STORE = RunStore(Path(os.environ.get("SMC_RUNS", ROOT / "runs")))
SAVED_RULES = STORE.root / "verdict_rules.yaml"
ADMIN_PASSWORD = os.environ.get("SMC_ADMIN_PASSWORD", "")
ON_SPACE = "SPACE_ID" in os.environ

JOBS: dict[str, dict[str, Any]] = {}
ONE_AT_A_TIME = threading.Lock()  # a survey takes most of a CPU and a few hundred MB


def rules() -> RulesFile:
    """The admin's saved rules, else the defaults in configs/."""
    return load_rules(SAVED_RULES if SAVED_RULES.is_file() else CONFIGS / "verdict_rules.yaml")


STORE.backfill(rules())


class SurveyRequest(BaseModel):
    field: str
    policy: str
    stops: int = Field(ge=10, le=100)
    seed: int | None = Field(default=None, ge=0, le=2**31 - 1)


class RulesRequest(BaseModel):
    rules: dict[str, Any]
    by: str = Field(min_length=1, max_length=80)
    note: str = Field(default="", max_length=500)


def _survey(job: str, req: SurveyRequest, seed: int) -> None:
    """Worker thread: run, save, write the 3D scene, store with the current rules."""
    try:
        with ONE_AT_A_TIME:
            JOBS[job]["state"] = "running"
            result = run_survey(load(CONFIGS / req.field), seed, req.policy, budget=req.stops)
            out_dir = new_dir(STORE.root / "app", run_dir_name(seed))
            save_run(result, out_dir)
            write_scene(result, out_dir)
            JOBS[job].update(state="done", run=STORE.add(out_dir, rules(), field=req.field))
    except Exception as exc:  # the page must hear about any failure, not poll forever
        JOBS[job].update(state="error", error=f"{type(exc).__name__}: {exc}")


def _folder(run_id: str) -> Path:
    folder = STORE.folder(run_id)
    if folder is None:
        raise HTTPException(404, "No such run.")
    return folder


def _file(run_id: str, name: str, download: str | None = None) -> FileResponse:
    path = _folder(run_id) / name
    if not path.is_file():
        raise HTTPException(404, f"This run has no {name}.")
    return FileResponse(path, filename=download, headers={"Cache-Control": "no-cache"})


app = Server(title="SMC soil survey", docs_url=None, redoc_url=None)
app.mount("/web", StaticFiles(directory=WEB), name="web")
app.mount("/viewer", StaticFiles(directory=VIEWER, html=True), name="viewer")


@app.get("/", include_in_schema=False)
def simulator_page() -> FileResponse:
    return FileResponse(WEB / "simulator.html")


@app.get("/console", include_in_schema=False)
def console_page() -> FileResponse:
    return FileResponse(WEB / "console.html")


@app.post("/api/runs")
def start_run(req: SurveyRequest) -> dict[str, str]:
    """Start one survey in the background; poll /api/jobs/<job> for its progress."""
    if req.field not in FIELDS or req.policy not in STRATEGIES:
        raise HTTPException(422, "Unknown field or strategy.")
    seed = random.randrange(100) if req.seed is None else req.seed  # 0-99: development seeds
    job = uuid.uuid4().hex
    JOBS[job] = {"state": "queued", "seed": seed}
    threading.Thread(target=_survey, args=(job, req, seed), daemon=True).start()
    return {"job": job}


@app.get("/api/jobs/{job}")
def job_progress(job: str) -> dict[str, Any]:
    """queued, running, done (with the run id) or error (with the reason)."""
    if job not in JOBS:
        raise HTTPException(404, "No such job.")
    return JOBS[job]


@app.get("/api/runs")
def list_runs() -> dict[str, Any]:
    """Every stored run, newest first, with the verdict it was given when it was stored."""
    return {"runs": STORE.runs(), "fields": FIELDS, "busy": ONE_AT_A_TIME.locked()}


@app.get("/api/run")
def one_run(id: str) -> dict[str, Any]:
    """One run, its probe stops in order ([t_s, x_m, y_m, value or null]) and what files it has."""
    row = STORE.get(id)
    folder = _folder(id)
    stops = []
    probes = folder / "probes.csv"
    if probes.is_file():
        with probes.open(encoding="utf-8", newline="") as fh:
            rows = list(csv.reader(fh))[1:]
        for t, x, y, value, valid, *_ in rows:
            ok = valid == "True" and value != ""
            stops.append([float(t), float(x), float(y), float(value) if ok else None])
    debrief = next(
        (f for f in ("debrief.md", "executive_report.md") if (folder / f).is_file()), None
    )
    scene = folder / "scene.json"
    return {
        **(row or {}),
        "stops": stops,
        "scene": scene.is_file(),
        # map error after each reading, for the live readout; the scene holds it
        "rmse": json.loads(scene.read_text(encoding="utf-8"))["rmse"] if scene.is_file() else [],
        "maps": (folder / "maps.png").is_file(),
        "debrief": (folder / debrief).read_text(encoding="utf-8") if debrief else None,
    }


@app.get("/api/run/readings.csv")
def readings_csv(id: str) -> FileResponse:
    return _file(id, "probes.csv", download=f"readings_{id.replace('/', '_')}.csv")


@app.get("/api/run/scene.json")
def scene_json(id: str) -> FileResponse:
    return _file(id, "scene.json")


@app.get("/api/run/maps.png")
def maps_png(id: str) -> FileResponse:
    return _file(id, "maps.png")


@app.get("/api/rules")
def get_rules() -> dict[str, Any]:
    """The verdict rules new runs are judged with, their version and change log."""
    current = rules()
    return {
        **current.model_dump(),
        "version": current.version,
        "locked": _locked(),
        "password": bool(ADMIN_PASSWORD),
    }


def _locked() -> bool:
    """Rule changes need the admin password on a public Space; the laptop is local only."""
    return ON_SPACE and not ADMIN_PASSWORD


@app.post("/api/rules")
def set_rules(req: RulesRequest, x_admin_password: str = Header(default="")) -> dict[str, Any]:
    """Save new verdict rules; they apply to runs started after this, never to stored runs."""
    if _locked() or (ADMIN_PASSWORD and not hmac.compare_digest(x_admin_password, ADMIN_PASSWORD)):
        raise HTTPException(403, "Changing the rules needs the admin password.")
    try:
        new = Rules(**req.rules)
    except ValidationError as exc:
        raise HTTPException(422, exc.errors(include_url=False)) from exc
    with ONE_AT_A_TIME:  # not while a run is being judged
        save_rules(SAVED_RULES, rules(), new, req.by, req.note)
    return get_rules()


demo = app  # the Hugging Face runtime looks for `demo`
if __name__ == "__main__":
    demo.launch(ssr_mode=False)
