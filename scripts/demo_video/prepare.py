"""Videos, step 1: run the demo commands for real, write the replay scenes, voice every beat.

Writes everything into runs/demo_video/ (gitignored). Run from the repository root:
    uv run python scripts/demo_video/prepare.py

The voice is Kokoro, run locally by voice.py in a separate Python that has kokoro-onnx and
soundfile, named by KOKORO_PYTHON (see README.md). That Python is a video tool, not an agrisim
dependency. Each beat is voiced once and cached by its text.
"""

import json
import os
import shlex
import shutil
import subprocess
import time
import wave
from pathlib import Path

from agrisim.config import load
from agrisim.sim import run_survey
from agrisim.view3d import write_scene

REPO = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
PAGES = HERE / "pages"
WORK = REPO / "runs" / "demo_video"
VOICE = "af_heart"
LEAD, TAIL = 0.35, 0.75  # s of quiet before and after each spoken beat

# Commands the demo runs for real, as (beat id, command).
COMMANDS = [
    ("d-run", "uv run agrisim run --config configs/demo.yaml --seed 7 --policy planned_survey"),
    (
        "d-bench",
        "uv run agrisim bench --config configs/demo.yaml --seeds 0-9 --budget 30 "
        "--strategies planned_survey,spatial_coverage,fixed_spacing,greedy_variance --workers 4",
    ),
]


def run_timed(cmd: str) -> dict[str, object]:
    """Run one command and keep each output line with its time since the start (asciinema-style)."""
    env = {**os.environ, "COLUMNS": "96", "NO_COLOR": "1", "TERM": "dumb", "PYTHONUNBUFFERED": "1"}
    t0 = time.perf_counter()
    proc = subprocess.Popen(
        shlex.split(cmd),
        cwd=REPO,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    assert proc.stdout is not None
    lines = [[round(time.perf_counter() - t0, 3), line.rstrip("\n")] for line in proc.stdout]
    code = proc.wait()
    total = round(time.perf_counter() - t0, 3)
    print(f"{cmd} -> exit {code}, {total:.1f} s")
    return {"cmd": cmd, "lines": lines, "exit": code, "total": total}


def wav_seconds(path: Path) -> float:
    with wave.open(str(path), "rb") as w:
        return w.getnframes() / w.getframerate()


def voice_all(lines: dict[str, str]) -> dict[str, float]:
    """Speak each line into voice/<beat id>.wav (only lines whose text changed); return lengths."""
    folder = WORK / "voice"
    todo = {
        k: text
        for k, text in lines.items()
        if not (folder / f"{k}.txt").exists()
        or (folder / f"{k}.txt").read_text(encoding="utf-8") != text
    }
    if todo:
        python = os.environ.get("KOKORO_PYTHON")
        if not python:
            raise SystemExit("set KOKORO_PYTHON to a Python with kokoro-onnx (see README.md)")
        jobs = [{"text": t, "out": str(folder / f"{k}.wav")} for k, t in todo.items()]
        spec = folder / "jobs.json"
        spec.write_text(json.dumps({"voice": VOICE, "jobs": jobs}), encoding="utf-8")
        subprocess.run([python, str(HERE / "voice.py"), str(spec)], check=True)
        for k, text in todo.items():
            (folder / f"{k}.txt").write_text(text, encoding="utf-8")
    return {k: wav_seconds(folder / f"{k}.wav") for k in lines}


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    (WORK / "voice").mkdir(exist_ok=True)
    for page in PAGES.iterdir():
        shutil.copy(page, WORK / page.name)

    # Every beat of both videos, with its voice length and the time it gets on screen.
    script = json.loads((HERE / "narration.json").read_text(encoding="utf-8"))
    every = [b for video in ("explainer", "demo") for b in script[video]]
    lengths = voice_all({b["id"]: b["say"] for b in every})
    beats = {}
    for b in every:
        secs = lengths[b["id"]]
        beats[b["id"]] = {**b, "voice": round(secs, 3), "dur": round(LEAD + secs + TAIL, 3)}
    (WORK / "beats.json").write_text(json.dumps(beats, indent=1), encoding="utf-8")

    # The demo's terminal segments: real output at real timing.
    term = (PAGES / "term.html").read_text(encoding="utf-8")
    for beat_id, cmd in COMMANDS:
        session = [run_timed(cmd)]
        b = beats[beat_id]
        caps = [{"n": "", "title": b["title"], "sub": b["sub"], "hold": 1}]
        page = term.replace("__CAPS__", json.dumps(caps))
        page = page.replace("__SESSION__", json.dumps(session))
        (WORK / f"term_{beat_id}.html").write_text(page, encoding="utf-8")

    # The replays: the same survey the first command ran (same config, seed and policy, so the
    # same numbers), and a survey with a rain shower.
    demo = run_survey(load(REPO / "configs" / "demo.yaml"), 7, "planned_survey", spawn=False)
    rain_cfg = load(REPO / "configs" / "scenarios" / "rain_shower.yaml")
    rain = run_survey(rain_cfg, 7, "planned_survey", spawn=False)
    for name, result in (("view_demo", demo), ("view_rain", rain)):
        (WORK / name).mkdir(exist_ok=True)
        write_scene(result, WORK / name)

    # The explainer's slides draw the demo field and its readings from the scene itself.
    scene = json.loads((WORK / "view_demo" / "scene.json").read_text(encoding="utf-8"))
    field = {
        "lx": scene["field"]["length_x"],
        "ly": scene["field"]["width_y"],
        "headland": scene["field"]["headland"],
        "rows": scene["rows_y"],
        "probes": [[p["x"], p["y"], p["v"]] for p in scene["probes"]],
        "dry": scene["dry_threshold"],
    }
    slides = (PAGES / "explainer.html").read_text(encoding="utf-8")
    slides = slides.replace("__FIELD__", json.dumps(field)).replace("__BEATS__", json.dumps(beats))
    (WORK / "explainer.html").write_text(slides, encoding="utf-8")
    print(f"wrote {WORK}")


if __name__ == "__main__":
    main()
