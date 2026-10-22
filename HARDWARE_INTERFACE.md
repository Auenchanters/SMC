# 🔌 Hardware-to-Software Interface Plan

This document defines how the physical Rover (Raspberry Pi) will communicate with the AI Agronomist system.

## 1. Data Flow Architecture
The system uses an **Asynchronous Logging Architecture**. The rover does not need a constant internet connection to work.

**Rover $\rightarrow$ Local Log $\rightarrow$ Base Station $\rightarrow$ AI Report**

## 2. Telemetry Specification
The Raspberry Pi will write data to two primary files on the local SD card in the same format as the `agrisim` simulator:

### A. `probes.csv`
Every time the probe is actuated and a reading is taken:
`t_s, x_m, y_m, value_vwc, valid, sensor_id`
- `t_s`: Time in seconds since mission start.
- `x_m, y_m`: GPS/Odometry coordinates.
- `value_vwc`: The raw voltage converted to Volumetric Water Content.
- `valid`: Boolean (True if the probe reached the target depth).

### B. `metrics.json`
At the end of the mission, a local script will calculate the run summary:
- `run.path_length_m`: Total distance from odometry.
- `run.plant_contacts`: Number of times the ultrasonic/IR sensors detected an obstacle.
- `run.mission_time_s`: Total elapsed time.

## 3. Synchronization Process
1. **Physical Connection**: Rover is plugged into the Base Station via USB or synced via Wi-Fi.
2. **Data Transfer**: The `runs/` folder is copied from the Pi to the Laptop.
3. **Analysis**: `agri_advisor.py` is executed on the transferred folder.

## 4. Hardware Mapping
| Sim Variable | Physical Component | Method |
| :--- | :--- | :--- |
| `x_m, y_m` | Encoder + IMU | Dead Reckoning / Wheel Odometry |
| `value_vwc` | Capacitive Probe | Analog-to-Digital Converter (ADC) |
| `plant_contacts`| Ultrasonic/IR Sensors | Digital Pin Interrupts |
| `mission_time` | System Clock | `time.time()` |
