# AgriRover v2: build brief

Written 2026-11-08, before any part is ordered. [DESIGN.md](DESIGN.md) answers "what machine, and why from the physics". This document answers the other direction: **what the software needs the robot to deliver, which numbers that fixes, what is still undesigned, and in what order to build and test it.** Where the two disagree, the requirement wins and the design changes.

Status: nothing physical exists. `model.mjs` is a parametric CAD-free model with mass, stability, traction, probe force, battery and BOM structure, but **no prices**, so there is no budget yet either.

## 1. What the software actually needs

Each row is a requirement with a number, the code that depends on it, and the bench test that proves it. These are the ones that change the hardware if missed; a rover that drives nicely but reports "failed" instead of "stalled in hard soil" is unusable for the mapping we now have.

| # | Requirement | Number | Why (what breaks without it) | Bench test |
|---|---|---|---|---|
| R1 | One record per probe cycle, machine-readable | `(utc, t_mono, x, y, depth_m, vwc, status, reason, probe_id)` as JSONL, fsync per line | `readings` table and the ingest path expect exactly this; a folder of photos is not data | 100 cycles → all lines valid JSON, 100% ingest, 0 rejects |
| R2 | Position accuracy at the probe | lateral ≤ 0.10 m; along-row ≤ 0.25 m | Lane clearance uses the 0.40 m width in a 0.60 m lane; the harsh world already assumes 0.3 m positioning sd, and kriging site matching breaks past that | String pot / total station on 20 points both directions |
| R3 | Probe cycle time | ≤ 35 s p95, 29 s mean | The planner budgets mission time; `rover_v2.yaml` uses 29 s, and 60 probes is already 47 min | 100 cycles in the soil bin, timed |
| R4 | Insertion success and honest failure | ≥ 95% in moist soil, ≥ 60% in dry crust, reason reported 100% | Dry-zone F1 and the censored mapping both depend on knowing *why* a probe failed | Soil bin at two moisture levels, 50 cycles each |
| R5 | Measurement depth | ≥ 0.10 m, ideally 0.20–0.30 m (see gap 1) | The farmer's decision is a root-zone deficit; 60 mm answers a different question | Paired with oven-dry samples at 0–100 and 100–200 mm |
| R6 | Sensor accuracy after calibration | ±0.02 VWC, resolution 0.001 | Simulator assumes bias 0.01 and noise 0.02; a worse probe makes every map worse | 30 lab samples spanning 0.08–0.35 VWC |
| R7 | Energy for one mission | 120 cycles + transit on one charge, 30% reserve | 60 probes ≈ 47 min plus driving; the dock returns at 30% | Bench discharge log at mission duty cycle |
| R8 | Link and safe stop | telemetry ≥ 1 Hz, command latency ≤ 200 ms, stop ≤ 1 control period on link loss | The executor in production plan P2 sends commands and must be able to stop the machine | Pull the link mid-motion, measure distance to stop |
| R9 | Local logging survives power loss | append-only, checksummed, last line never corrupt | A field day ends with a flat battery, not a clean shutdown | Yank power 20 times mid-write |
| R10 | Time | UTC + monotonic per record, drift < 1 s per mission | Rain correction and rechecks compare readings taken minutes apart | Compare to a reference clock over 1 h |
| R11 | Geometry | width ≤ 0.55 m, height ≤ 0.65 m, mass ≈ 22 kg | 0.60 m lanes (config), canopy clearance, two people can lift it | Tape measure, scale |
| R12 | Unattended dock | charge, refill, reference check, no human step | DESIGN.md §4 promises no per-sample human; the dock is what makes that true over a season | 7 days unattended |

## 2. The interface to build against

The rover is a node, not an app. It must speak the protocol in production plan P2 (`docs/PRODUCTION_PLAN.md`), and until it does, the mock transport does:

- **Commands:** `goto(x, y)`, `probe(depth_m)`, `dock()`, `abort()`, `status()`. Every command carries an id, is acked, retried twice, and is idempotent — a duplicate `probe` must not drill twice.
- **State at ≥ 1 Hz:** pose, heading, battery %, state (`idle|driving|probing|cleaning|docking|fault`), last error.
- **Failure taxonomy, which is the part that matters most:**
  - `stalled_hard_soil` — current above threshold with no depth progress. **This is the signal that makes censored mapping legitimate**: it means "drier than the threshold this soil refused at", not "no data". The robot must report the depth reached and the stall current.
  - `surface_too_low` — time-of-flight says the ground is > 20 mm below level: a positioning or terrain fault, not evidence about moisture.
  - `sensor_invalid` — depth reached, reading outside range or air check failed: a probe fault.
  - `retry_shifted` — the rail shift recovered the insertion; report it so the reading is not double counted.
- **One file per mission,** `rover_<mission_id>.jsonl` plus a sibling `.sha256`, so ingest can reject a truncated file.

If the robot reports only "failed", the censoring feature degrades into guessing, and `harsh_b60` loses the only signal that separates a dry refusal from a broken probe.

## 3. What is still undesigned, and what I would do

Ordered by how much they change the machine.

**Gap 1: probe depth is 60 mm, the question is about the root zone.** DESIGN.md puts the tips 60 mm into the soil, a deliberate choice to keep the push inside 175 N on dry crust. But the deliverable is "how much water per zone", which depends on 0–300 mm. Two honest options:

- *Now:* keep the shallow probe, and change the claim — call it a surface-moisture survey and calibrate the shallow → root-zone relationship from paired samples on the team's plot. This is a regression on real data, cheap, and it keeps 175 N valid.
- *Later:* add a second tool head that goes deeper (auger with a replaceable tip, or a tensiometer left in place). Deeper insertion needs roughly 2 to 3× the force, which means ballast and a heavier axis — a different machine, not a longer stroke on this one.

Do not silently deepen the stroke: it invalidates the force calculation that the whole layout rests on.

**Gap 2: no along-row positioning without RTK.** The support polygon and mass are solved; localisation is not. My recommendation, in cost order:

1. **Per-lane hard re-reference** (cheap, do this first): drive into each lane from the headland until a fixed stop/marker sets the along-lane origin, calibrate wheel-odometry slip per soil condition, then integrate. Error is bounded per lane instead of accumulating across the field. Target ±0.15 m, which satisfies R2.
2. **Fiducial markers at lane ends** read by the existing camera (AprilTag), if the mechanical stop proves impractical in mud.
3. **RTK GNSS** only if a customer needs absolute coordinates; it is the expensive way to satisfy a requirement that relative accuracy already meets.

**Gap 3: there is no radio link in the design.** The electronics talk CAN internally and the Pi 5 is onboard, but nothing says how the operator's laptop reaches it. Decide from the requirement: 1 Hz telemetry, 200 ms commands, 200 m range, 1 h mission. Wi-Fi from the Pi (bench and small plots) plus a LoRa or 4G module for the field. This is a small, separable module — design it with a documented interface so it can be swapped.

**Gap 4: no costed BOM.** `model.mjs` carries BOM entries but no prices, so nobody knows if this is a ₹80k or ₹300k machine. The eight long-lead items are the hub motors, the LiFePO4 pack and BMS, the linear axis, the cleaning pump and tank, the Pi 5 + MCU pair, GNSS/IMU, the enclosure, and the dock. Price these before buying anything: it decides whether the dock is in v2 or v3.

**Gap 5: cleaning performance in real clay is unmeasured.** DESIGN.md says so. The 29 s cycle assumes 10% of cycles need a wet clean. If the team's soil is sticky, that share rises and the mission time budget breaks. Measure the level-0-to-3 share in the soil bin early — it is a one-day test that changes both the cycle time and the water tank size.

**Gap 6: mass and height against handling.** 22 kg and 624 mm tall is one person carrying it badly and two people comfortably, and the tallest point is the probe axis, not the antenna. Before the field trial, decide how it gets to the plot (ramps? two-person lift? a trolley) — it is the kind of thing that turns a good demo into a cancelled one.

## 4. Build order, with a gate at each stage

Each stage is only worth starting when the previous gate passes. Nothing here needs the full machine.

| Stage | Build | Gate (pass/fail) | Why this order |
|---|---|---|---|
| S0 | Soil bin + measuring rig: force gauge, depth scale, a dummy probe, the team's real soil at two moisture levels | A dry-crust push of 106 N is repeatable within 10%, and depth is read to 1 mm | It calibrates every later test and settles gaps 1 and 5 before metal is cut |
| S1 | Drive base: rocker beams, differential bar, 4 hub motors, MCU, e-stop, encoders, battery | 100 m straight within ±0.10 m lateral; 90° turn in a 0.60 m lane; climbs a 54 mm step and a 20 deg slope; logs odometry | Everything else mounts on it, and R2/R7 are decided here |
| S2 | Probe module: sled, rail, belt axis, ST3215-class stepper, cleaning station, force/current sensing | 100 bin cycles: cycle ≤ 35 s p95, success ≥ 95% moist / ≥ 60% dry, stall reason correct 100%, cleaning-level share logged | This is the module that can invalidate the mission time and the mapping |
| S3 | Compute and firmware: Pi 5, MCU protocol, logging, GNSS/IMU, radio | Replay a recorded simulated mission through the real executor on blocks; every cycle lands in the store, 0 rejects; link-loss stop measured | Turns the machine into a node the software already speaks to |
| S4 | Field trial on a 10 × 20 m plot | 60 probes ≤ 60 min, ≥ 95% valid records, RMSE against a handheld grid ≤ 0.03 VWC | The first honest test of the whole loop |
| S5 | Dock: charging contacts, water refill, wash cup, reference block | 7 unattended days with no human step | Only worth building once S4 shows the survey is worth repeating |

Rough split of effort: S0 and S1 are about half the total build time; S2 is the riskiest; S3 is software and can run in parallel with S1.

## 5. How to test without a rover

The simulator and the mock transport already carry the software: `configs/scenarios/rover_v2.yaml` runs the v2 footprint (0.40 × 0.58 m) and the 29 s cycle, and production plan P2's `MockTransport` runs the real executor against it. So the ingest, store, planner and debrief can all be finished and tested before S1 exists — the hardware schedule is not on the critical path for the software, and the software is not on the critical path for the hardware. Keep it that way: any interface the mock cannot fake is an interface the hardware will get wrong.

## 6. What would make me change this brief

- Soil strength measured above about 150 N on dry crust: the 175 N design margin is gone, and mass or a different insertion method must be reconsidered before S2.
- Real beds narrower than 0.60 m: the 0.40 m width and 335 mm track no longer fit, which changes the chassis, not the software.
- A customer who needs absolute coordinates: RTK moves from "later" to a requirement, and the localisation plan changes.
