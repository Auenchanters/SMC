# 🗺️ Project Roadmap: Simulation to Physical Rover

This roadmap outlines the transition from the software prototype to a physical, autonomous soil-moisture survey rover.

## Phase 1: Software Baseline (Complete ✅)
- [x] Core Simulator (`agrisim`) developed.
- [x] Precision Probing Policies implemented.
- [x] Local AI Agronomist (`agri_advisor.py`) integrated.
- [x] 3D Replay Visualization system functional.

## Phase 2: Hardware Integration (Weeks 1-3)
- **Week 1: Chassis & Locomotion**
    - Assemble aluminum chassis.
    - Implement differential drive control via Raspberry Pi 5.
    - Calibrate wheel odometry for `x, y` tracking.
- **Week 2: Sensing & Actuation**
    - Integrate capacitive soil moisture probes.
    - Build the probe-actuation mechanism (linear actuator/servo).
    - Install ultrasonic sensors for plant-contact avoidance.
- **Week 3: Local Telemetry Logging**
    - Implement Python scripts on the Pi to write `probes.csv` and `metrics.json`.
    - Validate data accuracy against manual readings.

## Phase 3: Field Validation (Weeks 4-6)
- **Week 4: Controlled Environment Test**
    - Run missions in a simulated "field" (e.g., a tray of soil).
    - Compare physical `metrics.json` with simulation predictions.
- **Week 5: The "AI Loop" Test**
    - Transfer physical logs to the Base Station.
    - Generate AI debriefs for real-world soil anomalies.
- **Week 6: Full Prototype Demo**
    - Execute a complete mission: Plan $\rightarrow$ Drive $\rightarrow$ Probe $\rightarrow$ AI Report.

## Phase 4: Optimization (Future)
- Implement **On-Device AI** (using Qwen 0.5B) for real-time decision making.
- Integrate GPS/RTK for centimeter-level accuracy.
- Expand to multi-robot coordination.
