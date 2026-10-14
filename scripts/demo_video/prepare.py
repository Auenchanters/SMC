"""Demo video, step 1: run the CLI demo commands for real and record seed 7 to an .rrd file.

Writes everything into runs/demo_video/ (gitignored). Run from the repository root:
    uv run python scripts/demo_video/prepare.py
"""

import json
import os
import shlex
import shutil
import subprocess
import time
from pathlib import Path

from agrisim.config import load
from agrisim.sim import run_survey
from agrisim.view3d import write_scene

REPO = Path(__file__).resolve().parents[2]
PAGES = Path(__file__).resolve().parent / "pages"
WORK = REPO / "runs" / "demo_video"

# (command, caption title, caption detail, seconds to hold the result on screen)
STEPS = [
    (
        "uv run agrisim --help",
        "The agrisim command line",
        "run one survey · bench every strategy · train and evaluate a learned probing policy",
        3.5,
    ),
    (
        "uv run agrisim run --config configs/demo.yaml --seed 7",
        "One survey on seed 7: full-coverage plan, 60 probes, kriging map",
        "Same seed, same numbers every time. The rover drives only on lane centrelines: "
        "0 plant contacts.",
        6,
    ),
    (
        "uv run agrisim run --config configs/demo.yaml --seed 7 --policy greedy_variance "
        "--budget 30",
        "Adaptive probing: drive to where the map is most uncertain",
        "greedy_variance with a 30-probe budget on the same field",
        5,
    ),
    (
        "uv run agrisim run --config configs/demo.yaml --seed 7 --policy ppo "
        "--model models/ppo_v1/model.zip --budget 30",
        "The trained policy: MaskablePPO shipped in models/ppo_v1",
        "Chooses each next probe site from the current map; same field, same 30-probe budget",
        5,
    ),
    (
        "uv run agrisim bench --config configs/demo.yaml --seeds 0-9 --budget 30 --workers 4",
        "Benchmark: 4 strategies x 10 seeds, 4 worker processes",
        "Mean ± 95% interval per metric; every strategy keeps plant contacts at 0",
        9,
    ),
    (
        "uv run agrisim bench --config configs/demo.yaml --seeds 5-3",
        "Bad input fails cleanly",
        "A reversed seed range is a usage error (exit 2), not a traceback; nothing is written",
        4,
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


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    for page in PAGES.iterdir():
        shutil.copy(page, WORK / page.name)

    session = [run_timed(cmd) for cmd, *_ in STEPS]
    caps = [
        {"n": str(i + 1), "title": title, "sub": sub, "hold": hold}
        for i, (_, title, sub, hold) in enumerate(STEPS)
    ]
    term = (PAGES / "term.html").read_text(encoding="utf-8")
    term = term.replace("__CAPS__", json.dumps(caps)).replace("__SESSION__", json.dumps(session))
    (WORK / "term.html").write_text(term, encoding="utf-8")

    # The outputs slide shows the run folder and maps.png written by the seed-7 survey above.
    lines = session[1]["lines"]
    assert isinstance(lines, list)
    run_dir = next(text.split(maxsplit=2)[2] for _, text in lines if text.startswith("run folder"))
    shutil.copy(REPO / run_dir / "maps.png", WORK / "maps.png")
    outputs = (PAGES / "outputs.html").read_text(encoding="utf-8")
    outputs = outputs.replace("__RUN__", run_dir + os.sep)
    (WORK / "outputs.html").write_text(outputs, encoding="utf-8")

    rrd = WORK / "seed7.rrd"
    rrd.unlink(missing_ok=True)
    result = run_survey(
        load(REPO / "configs" / "demo.yaml"), 7, rerun=True, rrd_path=rrd, spawn=False
    )
    write_scene(result, WORK)  # for the 3D replay segment
    print(f"wrote {WORK}")


if __name__ == "__main__":
    main()
