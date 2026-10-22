import subprocess
import os
from pathlib import Path
import webbrowser
import time

# CONFIGURATION
RUN_DIR = "runs/demo_pitch_run"
CONFIG_FILE = "configs/demo.yaml"
MODEL_NAME = "qwen2.5:1.5b" # Change to qwen2.5:7b if you have it

def run_cmd(cmd, description):
    print(f"\n[Step] {description}...")
    process = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if process.returncode != 0:
        print(f"Error during {description}: {process.stderr}")
        return False
    print(f"Done: {description}")
    return True

def main():
    print("====================================================")
    print("🌱 AGRISIM: AI-DRIVEN MISSION PROTOTYPE DEMO")
    print("====================================================\n")

    # 1. Run Simulation
    # We use a fixed seed for a consistent demo
    sim_cmd = f"uv run agrisim run --config {CONFIG_FILE} --seed 7 --view"
    if not run_cmd(sim_cmd, "Simulating Rover Mission"):
        return

    # Find the run folder that was just created
    runs_dir = Path("runs")
    latest_run = sorted(runs_dir.glob("2026*"), key=os.path.getmtime)[-1]
    print(f"Mission Data Saved to: {latest_run}")

    # 2. Run AI Analysis
    # This uses the script we just built
    analysis_cmd = f"uv run python scripts/agri_advisor.py {latest_run} --model {MODEL_NAME}"
    if not run_cmd(analysis_cmd, "Generating AI Agronomist Debrief"):
        return

    # 3. Open the Results
    print("\n====================================================")
    print("🚀 DEMO COMPLETE")
    print("====================================================")
    
    # Open the AI Report
    report_path = latest_run / "debrief.md"
    if report_path.exists():
        print(f"Opening AI Report: {report_path}")
        # This opens the file in the default text editor/browser
        os.startfile(report_path) 

    # Open the 3D Replay (usually starts a local server)
    print("Opening 3D Mission Replay in browser...")
    # We assume agrisim view was triggered or we can trigger it now
    view_cmd = f"uv run agrisim view {latest_run}"
    subprocess.Popen(view_cmd, shell=True)
    
    print("\nPRO TIP: Show the 'debrief.md' first, then the 3D Replay to prove the AI is correct.")

if __name__ == "__main__":
    main()
