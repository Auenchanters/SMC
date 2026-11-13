# 🚀 Project Pitch: AI-Driven Autonomous Soil-Moisture Survey System

## The Problem
Traditional soil moisture monitoring is either too coarse (satellite) or too labor-intensive (handheld). Current robotic solutions are expensive and often fail to map "dry-zone" anomalies accurately, leading to uneven irrigation and crop loss.

## Our Solution: `agrisim` + AI Agronomist
We have developed a full-stack software prototype that simulates a precision rover mission. The system doesn't just collect data; it **analyzes it using a local Large Language Model (LLM)** to provide actionable agricultural advice.

### Core Innovations (The "Proof of Concept")
1. **Safe-Path Simulation**: A pure-Python simulator that ensures zero plant contacts.
2. **Decision-Focused Probing**: Using `planned_survey` to target the most uncertain dry zones.
3. **AI Mission Debrief**: An AI Agronomist that transforms raw telemetry (RMSE, VWC) into a professional executive report for farm managers.

## The "ROI" for the College
By funding the hardware phase, the college will transition this from a **Simulation** to a **Physical Prototype**:
- **Academic Impact**: Research on "Information-Driven Path Planning" and "On-Device Agricultural AI."
- **Resource Efficiency**: The planning and mapping are tested in simulation, where our planner has the highest overall score against re-implemented published methods. Every soil number is still a placeholder, so the next step is real field readings, then hardware.
- **Industry Relevance**: Directly applies to Precision Agriculture and AgTech.

## Prototype Demo Workflow
1. **Simulation**: Rover executes a lane-constrained survey.
2. **Telemetry**: Logs `metrics.json` and `probes.csv`.
3. **AI Analysis**: Local Qwen/Llama model generates a `debrief.md`.
4. **Visualization**: 3D Replay of the mission.

**Current Status**: Software prototype working in simulation | AI analyst integrated (with a rule-based verdict) | Hardware designed, not built
**Needed**: Rover Chassis, Raspberry Pi 5, Moisture Probes.
