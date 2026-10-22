# 📖 Demo Guide: How to present this to your professors

Follow these steps exactly to show the "Magic" of the project.

## Step 1: The "Black Box" (The Simulation)
Run the simulation. This shows that you have a working, deterministic model of the field.
```powershell
uv run agrisim run --config configs/demo.yaml --seed 7
```
**What to say**: *"We have built a high-fidelity simulator that models soil moisture and rover kinematics. It allows us to test strategies without risking expensive hardware."*

## Step 2: The "Brain" (The AI Agronomist)
Run the AI advisor on the run folder that was just created.
```powershell
# Replace <folder> with the actual run folder name (e.g., runs/2026...)
uv run python scripts/agri_advisor.py <folder> --model qwen2.5:1.5b
```
**What to say**: *"Instead of just giving a farmer a spreadsheet of numbers, we use a local AI Agronomist to interpret the telemetry and generate an executive action plan."*

## Step 3: The "Evidence" (The 3D Replay)
Open the 3D view to show the rover actually driving.
```powershell
uv run agrisim view <folder>
```
**What to say**: *"This 3D replay allows us to verify the AI's report against the actual movement of the rover in the field."*

## Step 4: The "Pitch" (The Document)
Open `PITCH.md` and show them the roadmap.
**What to say**: *"We have completed the software prototype. We are now seeking college support for the physical rover to validate these results in a real field."*
