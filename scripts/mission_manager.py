"""Run one survey, ask the local AI agronomist for a debrief, and package the result.

Every stage prints a machine-readable marker line (`MISSION_RUN_DIR=...`,
`MISSION_PACKAGE_DIR=...`) so that callers such as `app.py` never have to parse prose.
The command exits non-zero as soon as a stage fails.
"""

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path


def run_command(cmd: list[str], cwd: Path | None = None) -> str | None:
    """Run a command, echo its output, and return stdout (None if it failed)."""
    print(f"Executing: {' '.join(cmd)}")
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", cwd=cwd)
    if res.stdout:
        print(res.stdout, end="" if res.stdout.endswith("\n") else "\n")
    if res.returncode != 0:
        print(f"Error (exit {res.returncode}): {res.stderr}", file=sys.stderr)
        return None
    return res.stdout


def main() -> int:
    parser = argparse.ArgumentParser(
        description="AgriRover Mission Manager: simulation, AI debrief and mission package"
    )
    parser.add_argument(
        "--config",
        type=str,
        required=True,
        help="Path to simulation config (e.g. configs/demo.yaml)",
    )
    parser.add_argument("--budget", type=int, default=20, help="Probe budget for the mission")
    parser.add_argument(
        "--strategy", type=str, default="moisture_seeker", help="Probing strategy to use"
    )
    parser.add_argument(
        "--output", type=str, default="mission_packages", help="Directory to store mission packages"
    )
    parser.add_argument("--model", type=str, default="smc-brain", help="AI model for the debrief")
    args = parser.parse_args()

    # 1. Run the simulation. --scene writes scene.json for the 3D replay without starting a
    #    server, so the mission package can be replayed later with `agrisim view <folder>`.
    run_cmd = [
        "uv",
        "run",
        "python",
        "src/agrisim/cli.py",
        "run",
        "--config",
        args.config,
        "--policy",
        args.strategy,
        "--seed",
        "42",  # Fixed seed for consistent demos
        "--budget",
        str(args.budget),
        "--scene",
    ]

    output = run_command(run_cmd)
    if output is None:
        print("Simulation failed.", file=sys.stderr)
        return 1

    # Parse the run folder from output (e.g., "run folder     runs\20261031T134604Z_seed0")
    match = re.search(r"run folder\s+([^\r\n]+)", output)
    if not match:
        print("Could not determine run folder from output.", file=sys.stderr)
        return 1
    run_folder = Path(match.group(1).strip()).resolve()
    print(f"Mission completed. Telemetry at: {run_folder}")
    print(f"MISSION_RUN_DIR={run_folder}")

    # 2. Generate the AI Agronomist Report
    print("Consulting AI Agronomist for mission debrief...")
    advisor_cmd = [
        "uv",
        "run",
        "python",
        "scripts/agri_advisor.py",
        str(run_folder),
        "--output",
        "executive_report.md",
        "--model",
        args.model,
    ]
    if run_command(advisor_cmd) is None:
        print(
            "Debrief failed; the telemetry is still saved. Is Ollama running "
            "(ollama serve) and the model pulled (ollama list)?",
            file=sys.stderr,
        )
        return 1

    # 3. Package the results
    package_dir = (Path(args.output) / f"Mission_{run_folder.name}").resolve()
    package_dir.mkdir(parents=True, exist_ok=True)

    artifacts = ["metrics.json", "probes.csv", "scene.json", "executive_report.md"]
    for art in artifacts:
        src = run_folder / art
        if src.exists():
            shutil.copy(src, package_dir / art)

    welcome_text = f"""# Welcome to your AgriRover Mission Package

## Mission Overview
- Strategy: {args.strategy}
- Budget: {args.budget} probes
- Config: {args.config}

## Contents
- **executive_report.md**: The AI-generated agronomist debrief. Open this first.
- **scene.json**: 3D scene data for the replay viewer.
- **metrics.json**: Raw performance data.
- **probes.csv**: Precise coordinates and readings of every probe.

## How to view in 3D
Run: `uv run agrisim view "{package_dir}"`

The viewer serves the page at http://127.0.0.1:<port>/ and stays up until you press Ctrl+C.
"""
    (package_dir / "START_HERE.txt").write_text(welcome_text, encoding="utf-8")

    print("\n--- Mission Package Ready ---")
    print(f"Location: {package_dir}")
    print(f"MISSION_PACKAGE_DIR={package_dir}")
    print("Open 'START_HERE.txt' to begin.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
