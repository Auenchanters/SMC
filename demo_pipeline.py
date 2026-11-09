"""One-command demo: survey, AI debrief, then the report and the 3D replay.

The simulator runs with `--scene` (write scene.json and exit) rather than `--view`, because
`--view` serves a web page until Ctrl+C and would never return to this script.
"""

import os
import re
import subprocess
import sys
from pathlib import Path

# CONFIGURATION
CONFIG_FILE = "configs/demo.yaml"
MODEL_NAME = "qwen2.5:1.5b"  # Change to qwen2.5:7b if you have it
ADVISOR = "scripts/agri_advisor.py"
CLI = "src/agrisim/cli.py"


def run_cmd(cmd: list[str], description: str) -> str | None:
    """Run a command to completion and return its stdout, or None if it failed."""
    print(f"\n[Step] {description}...")
    process = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if process.returncode != 0:
        print(f"Error during {description}:\n{process.stderr}")
        return None
    if process.stdout:
        print(process.stdout)
    print(f"Done: {description}")
    return process.stdout


def main() -> int:
    print("================================================")
    print("🌱 AGRISIM: AI-DRIVEN MISSION PROTOTYPE DEMO")
    print("================================================\n")

    # 1. Run the simulation (fixed seed for a consistent demo)
    output = run_cmd(
        [
            "uv",
            "run",
            "python",
            CLI,
            "run",
            "--config",
            CONFIG_FILE,
            "--seed",
            "7",
            "--scene",
        ],
        "Simulating Rover Mission",
    )
    if output is None:
        return 1
    match = re.search(r"run folder\s+([^\r\n]+)", output)
    if not match:
        print("Could not determine the run folder from the simulator output.")
        return 1
    run_dir = Path(match.group(1).strip()).resolve()
    print(f"Mission Data Saved to: {run_dir}")

    # 2. Run AI analysis
    if (
        run_cmd(
            ["uv", "run", "python", ADVISOR, str(run_dir), "--model", MODEL_NAME],
            "Generating AI Agronomist Debrief",
        )
        is None
    ):
        return 1

    print("\n================================================")
    print("🚀 DEMO COMPLETE")
    print("================================================")

    report_path = run_dir / "debrief.md"
    if report_path.is_file():
        print(f"Opening AI Report: {report_path}")
        if sys.platform == "win32":
            os.startfile(report_path)

    # 3. Start the 3D replay in the background; it serves until the user stops it.
    print("Starting 3D Mission Replay...")
    subprocess.Popen(["uv", "run", "python", CLI, "view", str(run_dir)])

    print("\nPRO TIP: Show the debrief first, then the 3D replay to show the AI is correct.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
