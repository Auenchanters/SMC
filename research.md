# Research: competitors, related work, our gaps, and what to build

Compiled 16 October 2026, at commit `59ed20d` (branch `rover-v2-visuals`), from a web research session plus measurements run on this repository that day.

**Purpose of this file.** It is the input for a future planning session. A reader (human or coding agent) should be able to turn it into EXECPLAN milestones without redoing the research. It records:
- what exists commercially;
- what has been published;
- where agrisim stands against both;
- every flaw we know of in our own work, with evidence;
- a concrete, ordered set of work packages;
- a plan for a research paper.

## 0. How to use this document

1. Read Section 1 (summary), then Sections 6 (our flaws), 7 (the measurement made this session), 8 (work packages) and 9 (paper plan).
2. Turn the work packages in Section 8 into EXECPLAN milestones (M12 onward), in the order given in Section 8.0. Each package lists its goal, evidence, design, code touchpoints, tests and acceptance criteria.
3. Obey `CLAUDE.md`. In particular:
   - permissive licences only;
   - Windows-native with no compiler;
   - determinism from the run seed;
   - placeholders live only in configs;
   - **only `metrics.py` and the RL reward in `env.py` may read ground truth**;
   - no results in docs that `agrisim bench` did not produce;
   - Claude is never a git author.
4. Before writing any paper text, re-check every item in Section 11 (unverified claims) and re-run the searches behind any "nobody has done X" claim.

### Legend (same idea as context.md)
- **[V]** Verified against a public source during this session. URLs are in Section 12.
- **[S]** Measured in our own simulator during this session or recorded in EXECPLAN/README; reproducible from this repo.
- **[M]** Standard textbook or literature knowledge, not re-checked against a source this session.
- **[U]** Uncertain or partly verified; check before relying on it.
- **[P]** A proposal or plan, not a fact.

---

## 1. Executive summary

1. **Nobody sells what we are building.** [V] Commercial products fall into five groups:
   - fixed in-ground probes (CropX, Sentek, Soil Scout, Fasal);
   - handheld meters (Stenon FarmLab);
   - coarse remote or neutron sensing (Planet Soil Water Content, cosmic-ray neutron sensors);
   - tractor-pulled conductivity mapping (Veris);
   - soil-coring robots for nutrient lab tests (Rogo SmartCore).

   None maps soil moisture at sub-metre resolution by probing between the rows of a standing crop.
2. **Research robots that push a moisture probe exist, all recent.** [V]
   - MoistureMapper (CASE 2025);
   - AgriOne (IROS 2024 workshop);
   - Langenscheidt et al. (J. Field Robotics, DOI 10.1002/rob.70258);
   - Nguyen et al. (ICRA 2025 workshop; soil sampling with an onboard lab);
   - Linford and Haghshenas-Jaryani (Discover Agriculture 2024).

   They either plan in open space (Euclidean distance), visit preset waypoints, or do no planning at all.
3. **The closest planning paper leaves our niche open.** [V] Pulido Fentanes et al. (J. Field Robotics 2020) list path-planning constraints from soil beds and rows as future work.
4. **Our distinct combination.** As far as this session's searches found:
   - travel restricted to a lane graph;
   - reversing inside lanes;
   - plant contact as a hard metric;
   - per-probe insertion cost;
   - kriging with uncertainty;
   - soil that changes during the mission;
   - a Gymnasium environment;
   - an open, deterministic benchmark with held-out seeds and honest negative results.

   No paper we found combines these.
5. **Our biggest weaknesses.** [S]
   - No real data at all.
   - Weak dry-zone detection: F1 0.24 to 0.33 on held-out fields.
   - Adaptive probing is statistically tied with even spacing on map error.
   - The learned policy (PPO) loses to simple baselines.
   - Probe failures are independent coin flips, and positioning is perfect. Both flatter us.
6. **New finding this session (Section 7).** [S]
   - Lane-centre probes cannot see the drip-line wetness along the plant rows.
   - In the demo config, the probe's placeholder bias (+0.01) happens to cancel most of that unseen row-to-lane difference (+0.015 on average).
   - Correcting both would cut mean squared map error by 8 to 11%, on 47 to 50 of 50 held-out fields, and raise dry-zone recall by 0.04 to 0.06.
   - In reality, readings taken only at lane centres cannot separate probe bias from the row-vs-lane moisture difference.
   - Rover v2's ±60 mm side rail does not fix this.
7. **Key theoretical point (Section 7.3).** [M] With fixed kriging or GP hyperparameters, the map's uncertainty depends only on *where* readings were taken, not on their values. So "probe where uncertainty is highest" is close to a fixed space-filling design. That explains why it ties with even spacing. Real adaptivity needs objectives that depend on the values read, such as "is this zone below the dry threshold?".
8. **Recommended paper thesis.** [P] Decision-focused, lane-constrained adaptive probing.
   - In planted rows, a rover can probe only from lanes, and every probe costs 10 to 30 s.
   - What the farmer needs is which zones are too dry.
   - So plan for that decision (level-set or water-regret objectives, cost per second, lookahead), not for map uncertainty.
   - Evaluate on fields calibrated against real data, with published methods re-implemented as baselines, plus one small field validation.
9. **Cheapest high-value next steps.** [P]
   - Re-implement the published baselines (WP2, a few lines each).
   - Add a direction-dependent variogram and the lateral-reach parameter (WP5, WP6).
   - Pull the public Cook Agronomy Farm dataset (WP1a).
   - Collect one afternoon of handheld readings in a real tomato plot (WP1b).

---

## 2. Our current state (snapshot at `59ed20d`)

### 2.1 What agrisim does
A pure-Python simulator of a planted tomato field. A differential-drive rover drives only lane and headland centrelines. It stops at probe sites, pushes a moisture probe in, and builds a kriging map (mean plus variance) of volumetric water content (VWC). Everything is scored against a hidden truth. The same world is a Gymnasium environment. Windows-native and deterministic. CI runs on windows-latest and ubuntu-latest, and the README reports 92 tests.

Pipeline:
1. `field.py`: layout.
2. `soil.py`: FFT Gaussian random field plus drip stripes plus dry and wet patches.
3. `weather.py` (optional): rain, evapotranspiration (ET) and drainage.
4. `policies.py`: where to probe.
5. `planning.py`: lane graph.
6. `control.py`: pure pursuit, turn-in-place in headlands, reverse in lanes.
7. `safety.py`: canopy contact.
8. `sensor.py`: probe.
9. `mapping.py`: kriging.
10. `metrics.py`: scoring.
11. `bench.py`, `env.py`, `cli.py`, `viz.py`, `view3d.py`.

### 2.2 Demo configuration (all PLACEHOLDERS) [S]
| Group | Values |
|---|---|
| Field | 30 m (x, along rows) × 20 m (y); headland 2.0 m; row spacing 1.2 m; plant spacing 0.5 m; canopy radius 0.22 to 0.30 m; stem keep-out 0.15 m; plant dropout 3% |
| Rover | 0.40 × 0.50 m (v2 scenario: 0.40 × 0.58 m); max speed 0.5 m/s; yaw rate 1.0 rad/s; safety margin 0.05 m |
| Soil | mean VWC 0.25; std 0.05; correlation length 3 to 30 m; exponential covariance; drip-stripe amplitude 0.03; 1 to 3 dry patches (radius 1 to 3 m, depth 0.08); 0 to 1 wet patch (height 0.06); clip [0.05, 0.45]; soil grid 0.25 m |
| Probe | footprint radius 0.05 m; noise std 0.02; bias **+0.01**; resolution 0.001; failure probability 0.01 (independent coin flip); insertion time 10 s (v2 scenario: 29 s); optional bad-contact misread (`bad_contact_prob`, `bad_contact_drop`, reads low) |
| Survey | probe spacing 2.0 m; budget 60; candidate spacing 1.0 m (464 candidate sites); recheck probes 10 |
| Mapping | ordinary kriging (PyKrige), exponential variogram, **isotropic**, `pseudo_inv=True`; output grid 0.5 m (40 × 60 = 2400 cells); dry threshold 0.18; at least 5 readings, else the global mean |

Drip stripe in `soil.py`:
- The stripe adds `amp * cos²(π d / row_spacing)` for `d < row_spacing/2`, where `d` is the distance to the nearest row, only in the planted area.
- It is exactly 0 at lane centres, where `d = 0.6 m`.
- Probe sites lie only on lane centrelines (`field.py`, `candidate_probe_sites` / `lane_sites`).

### 2.3 Results so far [S]
Held-out evaluation, `agrisim eval`, seeds 100 to 149, budget 30. Mean ± 95% Student-t interval:

| Strategy | RMSE (VWC) | R² | Dry F1 | Distance | Time |
|---|---|---|---|---|---|
| greedy_variance | 0.0333 ± 0.0019 | 0.55 | 0.33 | 775 m | 33 min |
| fixed_spacing | 0.0338 ± 0.0018 | 0.54 | 0.24 | 466 m | 23 min |
| random | 0.0354 ± 0.0019 | 0.50 | 0.25 | 733 m | 33 min |
| ppo (MaskablePPO, 200k steps) | 0.0357 ± 0.0020 | 0.49 | 0.27 | 689 m | 31 min |
| greedy_variance_per_cost | 0.0364 ± 0.0023 | 0.46 | 0.28 | 149 m | 11 min |

Additional results:
- **Baseline and calibration.** A field-average map scores RMSE ≈ 0.052. About 96% of cells fall inside the map's own 95% band. Dry-zone F1 is undefined on 8 to 17 of 50 fields per strategy, because the map predicts no dry cell at all. Zero plant contacts in all 250 held-out runs and 200 bench runs.
- **Bench, seeds 0 to 49, budget 30.**
  - Fixed spacing: RMSE 0.0323 ± 0.0016.
  - Greedy: 0.0327 ± 0.0019, with dry F1 0.44 vs 0.33 for fixed, but it drives 785 m vs 466 m.
  - Variance-per-cost: 0.0387, 152 m.
- **Seed 7, fixed spacing, budget 60.** RMSE 0.0299, R² 0.677, dry precision 0.870, recall 0.116, F1 0.205 (truth dry fraction 0.072), calibration 0.979, 59/60 valid probes, 465.7 m, 1685 s.
- **Rain shower scenario** (`configs/scenarios/rain_shower.yaml`, budget 60, 30 fields): recheck 0.0276 ± 0.0020 (1501 m, 65 min); greedy 0.0280 ± 0.0016; fixed + recheck 0.0300 ± 0.0014 (728 m, 37 min); fixed 0.0308 ± 0.0012 (466 m, 28 min). Per seed, fixed + recheck beats fixed by 0.00075 (standard error 0.00049, 18/30 seeds). That is not conclusive. At budget 30 there is no gain.
- **RL environment.**
  - Observation: 6 channels on the 40 × 60 grid (normalised mean, variance, probed mask, position, budget left, time).
  - Action: `Discrete(464)`.
  - Reward: `100 × (RMSE before − RMSE after) − 1e-3 × travel time (s)`.
  - Network: SmallCNN to 128 features, then policy and value heads of [256]. `n_steps = max(64, 1024 // n_envs)`, batch 64.
  - Cost: about 21 ms per step, almost all of it kriging. 200k steps took 24.5 min with 6 workers.
  - Training reward plateaued between 0.09 and 0.25.
  - On held-out fields it behaves close to random.

### 2.4 Hardware design (rover v2, not built) [S]
From `hardware/rover-v2/DESIGN.md`:
- **Probe force.** 175 N usable push with a 20% margin, against a 106 N dry-crust estimate. v1 managed 54 N.
- **Layout.** Probe between the axles in an open bay, on a ±60 mm sideways rail. 60 mm into the soil; the axis stands 624 mm tall.
- **Chassis.** Rocker-differential, 150 mm clearance.
- **Battery.** 12S LiFePO4, 230 Wh, about 7 surveys per charge (26 Wh per seed-7 survey).
- **Probe cycle.** About 29 s including cleaning, so the v2 mission takes 47 min vs 28 min with the 10 s placeholder.
- **Cleaning.** Escalates automatically through levels 0 to 5 with no person involved. A level-4 failure marks the reading invalid.
- **Open bench questions:** soil strength; share of cleaning levels; reference block; GPL hoverboard firmware; rocker stiffness; tyre pressure; **along-row positioning without RTK**; canopy height clearance.

---

## 3. Commercial landscape

### 3.1 Robotic soil sampling (nutrients)
**Rogo Ag, SmartCore** (West Lafayette, Indiana; founded 2014; Purdue-linked) [V]
- **What.** A robot mounted on a Bobcat skid steer, with RTK-GPS and LiDAR, collects soil cores with a hydraulic auger for lab analysis. Sold as a service: grid or zone sampling, lab analysis and fertiliser recommendations.
- **Claims** (company-reported, not independent):
  - returns to the same spot each year within about 12 inches and hits target depth within 3 mm;
  - one source says a 500-acre field on a 2.5-acre grid takes about 5 h;
  - "millions of acres" (third-party review site, unsourced).
- **Partners:** Central Valley Ag (announced Nov 2024) and ASM ("Soil Tax Guys").
- **Flaws for our use:** measures nutrients, not moisture; lab turnaround; pre-planned grids, not adaptive; machine-sized, not built for driving between rows of a standing crop [U, inferred from the size].
- **Lesson:** sampling as a service works commercially, while selling hardware has killed others (Section 3.7).

### 3.2 Handheld real-time sensing
**Stenon FarmLab** (Germany) [V]
- **What.** Handheld multi-sensor soil analyser; the company claims results in under 20 s.
- **Independent evidence:**
  - A 2025 north-east Germany field study (1,187 measurements over 10 months) found physical parameters (temperature, texture) reliable. Chemical ones (mineral nitrogen, phosphorus, soil organic carbon) had poor temporal stability and low spatial correlation, and the 2022/23 version was judged not ready for precision nutrient management.
  - A separate mineral-nitrogen validation found R² 0.3 for single measurements and 0.66 for site means: useful for relative differences, not absolute values.
- **Cost:** a review estimates €3 to 4 per measurement against about €44 per lab sample.
- **Status:** raised €18M (Series B) in July 2026, for Brazil and a "next-generation machine-integrated platform" due later in 2026. **Watch this.** It is a move toward on-vehicle soil sensing.
- **Flaws for our use:** a person walks to every point, and there is no planning or map uncertainty.

### 3.3 In-ground probe networks (time series at fixed points)
- **CropX** [U]. No product-specific facts were verified this session.
- **Sentek, Hortau** [M]. Not researched this session.
- **Soil Scout** (Finland) [V]. Buried wireless sensors for moisture, temperature and salinity. Company claims: down to 2 m deep, about 20 years with no maintenance. A 2019 article says the base station needs cellular coverage and a SIM.
- **Teralytic** [V/U]. A LoRa probe reporting every 15 minutes. Its current status is **unverified**; a shutdown was not confirmed.
- **Fasal** (Bengaluru, founded 2018) [V]. AI and IoT horticulture platform: on-farm sensors including soil moisture, plus local-language advisories.
  - FasalOne (Apr 2025): modular IoT units.
  - **FasalJet and FasalJet Pro (Jan 2026):** automated irrigation and fertigation, rolling out in Maharashtra, Karnataka, Andhra Pradesh, Haryana and Himachal Pradesh.
  - Revenue from device fees plus monthly subscriptions. About $17.6M total funding per a tracker. Sold its fresh-produce distribution business to Innoterra (Mar 2025).
  - **Relevance:** a local company that already controls irrigation valves and could be a customer or partner for our map.
- **General flaws of point probes** [V, from independent studies found via search; exact paper attribution to confirm, see Section 11]:
  - a probe senses only a small soil volume;
  - several units of the same sensor in one field rarely agree;
  - extra sensor sets help less for longer irrigation cycles and more heterogeneous fields;
  - different calibrations are needed per sensor or zone;
  - one or more sensors cannot cover a whole irrigation zone.
- **Lesson:** fixed probes give *time*, a rover gives *space*. They are complementary. A rover map can tell a farmer where to put fixed probes and how representative each one is.

### 3.4 Remote sensing
- **Planet Soil Water Content** [V]. Satellite-derived, at 20 m (beta), 100 m and 1 km resolution. It measures the top layer of soil only. The provider VanderSat offered a 100 m product at 5 cm depth.
- **Flaw for our use:** far coarser than 1.2 m rows and surface only. It is a prior or covariate for our map, not a competitor at row scale.

### 3.5 Field-scale non-contact sensing
**Cosmic-ray neutron sensors (CRNS)** [V]
- Footprint radius about 130 to 240 m (the R86 radius, which contains 86% of detected neutrons), depending on humidity, soil moisture and vegetation.
- Penetration depth about 15 to 83 cm.
- At least half the signal comes from the first 50 m.
- Pulido Fentanes et al. mounted one on a rover (Section 4, paper 1).
- **Flaw:** about one number per field, so it cannot find a clogged emitter.

### 3.6 Proximal mapping and scouting robots
- **Veris iScan / iScan Flex** [V/U]. Tractor-pulled apparent electrical conductivity over 0 to 60 cm. A moisture feature is listed, but no spec was found. **Flaws:** a proxy needing calibration, and it cannot drive a standing row crop. Useful as a pre-season covariate.
- **EarthSense TerraSentia** [V]. Commercial robot that drives under the crop canopy, collecting plant-trait data. Breeding companies use it.
  - context.md records 198,249 maize plots with 3 to 5 robots per year (2019 to 2023), and about $15k per year to lease (2019).
  - No soil-moisture capability was found.
- **VineScout** (EU H2020 project 737669) [V]. Autonomous vineyard robot with a multispectral camera and an infrared radiometer.
  - Douro trials 2019 to 2020 predicted vine water status (leaf water potential) from canopy temperature with cross-validated R² of 0.57 (morning) and 0.42 (midday); RMSE 0.191 and 0.139 MPa.
  - **Lesson:** indirect water-status sensing is only moderately accurate, which supports direct probing.

### 3.7 Failures (lessons on economics)
- **Mineral** (Alphabet X) [V]. Announced Oct 2020 as X's "computational agriculture" project and spun out in Jan 2023. **Shut down 3 July 2024**; some assets were licensed to Driscoll's, and John Deere later acquired a technology suite for See & Spray (date not found). Reported reasons: no viable business model for scaling the rover, a crowded market and profit concerns.
- **Small Robot Company** (UK; Tom, Dick and Harry robots) [V]. Voluntary winding-up resolutions passed **1 Feb 2024** (Gazette). It could not close an international investor within its runway and cited perceived risk in UK agtech.
- **Lesson:** hardware-heavy ag robots die on unit economics. Prove value in simulation first (we do), keep the rover cheap, and sell outcomes (a survey service, water saved).

### 3.8 Indian prior art (from context.md, verified 30 Sep 2026)
- AgRobot (Kota; Aryan Singh): cameras and soil-moisture sensors; national award 2024.
- IIT Kharagpur with C-DAC: tracked robot that detects plant disease and sprays.
- Harvested Robotics (Hyderabad): laser weeding.
- CropFollow: learned visual under-canopy navigation.
- A reconfigurable crop-scouting vehicle: moisture, nutrient and disease sensing below the canopy.

**Never claim the rover concept is new.**

### 3.9 Summary matrix
| Category | Spatial detail | Works in standing rows | Moisture | Adaptive | Autonomy |
|---|---|---|---|---|---|
| Rogo (coring) | Grid points | No [U] | No (nutrients) | No | Yes |
| Stenon (handheld) | Wherever a person walks | Yes (on foot) | Partly | No | No |
| In-ground probes (Fasal etc.) | 1 point per zone | Yes (fixed) | Yes | No | n/a |
| Satellite (Planet) | 20 m to 1 km | n/a | Surface | No | n/a |
| CRNS | ~130 to 240 m radius | n/a | Yes | No | n/a |
| Veris (EC) | Swaths | No | Proxy | No | Tractor |
| TerraSentia / VineScout | Under canopy | Yes | Indirect (VineScout) | No | Yes |
| **agrisim + rover v2 (planned)** | **Sub-metre map + uncertainty** | **Yes (lanes only)** | **Yes (direct probe)** | **Yes** | **Yes (design)** |

---

## 4. Ten core research papers

Each card gives: citation; what it does (hardware, sensor, method, evaluation); key numbers; flaws (the authors' own, then ours); relevance; what to borrow.

### Paper 1. Pulido Fentanes et al., "Kriging-based robotic exploration for soil moisture mapping using a cosmic-ray sensor", J. Field Robotics 37(1):122–136, 2020, DOI 10.1002/rob.21914; arXiv 1811.05384 [V]
- **Hardware:** Thorvald agricultural robot (ROS, GNSS) carrying a Hydroinnova fast-neutron (cosmic-ray) moisture sensor.
- **Method:** neutron counts modelled as Poisson inside kriging. The robot explores by kriging variance and also adapts the **measurement time** per stop (adaptive measurement interval).
- **Sites:** an airfield of about 0.3 ha (East Kirkby, UK) and about 7 ha of wheat stubble (near Volos, Greece).
- **Evaluation:** offline in simulation, against surrogate models built from real data collected at the two sites. There were no live autonomous exploration runs.
- **Strategies compared:** Greedy, Monte Carlo (next-best-view) and Adaptive Sampling; fixed vs adaptive measurement intervals.
- **Findings:**
  - Adaptive sampling was **not always best on model quality**: slightly worse than the other two, but it travelled much less.
  - Greedy's map quality was comparable and may suit small, uniform fields.
  - The adaptive measurement regime travelled slightly further.
- **Authors' limitations:**
  - the wet/dry gradient at the validation site was very low, so high-variance areas were hard to find;
  - field size limited sample density;
  - longer missions might align better.
- **Future work they list:** changing the measurement time on the fly; **path-planning constraints from soil beds and rows**; mapping several soil properties at once.
- **Our critique:** the robot drives freely; there is no field validation of the adaptive loop; the footprint is so large that sub-field patches are invisible.
- **Relevance:** the closest prior planning work, and its stated future work is our niche. It is also the precedent for evaluating on surrogates built from real data, as in WP1a.

### Paper 2. MoistureMapper (Univ. of Nevada, Reno and Desert Research Institute), "MoistureMapper: An Autonomous Mobile Robot for High-Resolution Soil Moisture Mapping at Scale", IEEE CASE 2025, arXiv 2507.12716 [V] (author names not retrieved [U])
- **Hardware:**
  - AgileX Scout 2.0 UGV; Jetson AGX Orin 64 GB; 30 Ah battery (about 3.5 h of motor operation); RTK GPS (Swift Navigation Duro Inertial).
  - SEC MiniTrase TDR with probe lengths 8 to 20 cm.
  - **Two synchronised DC linear actuators, 300 mm stroke, up to 3000 N** (a direct-push drill).
  - No insertion or cycle time is reported.
- **Method:** a Gaussian process with an RBF kernel and signal variance fixed at 1; the length scale value is not given. Two acquisition functions, where `d` is the Euclidean distance from the robot normalised by `d_max`:
  - A1 (multiplicative): `σ²(x) · (1 − d/d_max)`;
  - A2 (additive): `0.5 · (σ²(x) + (1 − d/d_max))`.

  The next point is picked **randomly among the top five** to avoid local minima. Stopping rules: maximum samples, maximum distance or a variance threshold. Baseline: greedy maximum variance with no travel term.
- **Evaluation:**
  - Simulation on 60 maps (square areas of side 20 to 100), with metrics of distance, sample count, and maximum and average residual variance.
  - The headline claim, "up to 30% less travel distance and 5% less variance", is attributed to A2.
  - Lab check: average VWC error 0.7% against an SEC HandiTrase reference.
  - Field test: **one 10 × 10 m grass plot** (Dick Taylor Memorial Park, Reno), ground truth from a manual Acclima TDR-315H. Benchmark: 16 samples, 153 m, 2019 s, RMSE 13.1. A1: 21 samples, 176 m, 2607 s, RMSE 12.2. The RMSE units were not stated in what we read [U].
- **Authors' limitations:**
  - the field stopping rule (entropy below 0.2) differs from simulation;
  - **dense soil sometimes stopped full insertion, and readings were consistently lower than ground truth**; accuracy improved with inserted length.
  - Future work: varied soils, online length-scale estimation, force sensing to auto-stop the drill, laser ranging for penetration depth.
- **Our critique:**
  - the simulation headline is the map's own variance, not error against truth;
  - one tiny field test, with only the benchmark and A1;
  - Euclidean travel, not row-constrained;
  - stationary RBF kernel;
  - the length scale is not learned online.
- **Relevance:** the most direct competitor in method. **Borrow** A1 and A2 as baselines (WP2), and its evidence that **incomplete insertion biases readings low** (WP4).

### Paper 3. AgriOne: Tsimpidi, Tevetzidis, Sumathy, Nikolakopoulos (Luleå Univ. of Technology), "Design and Evaluation of a UGV-Based Robotic Platform for Precision Soil Moisture Remote Sensing", IROS 2024 Workshop on Agricultural Robotics for a Sustainable Future; arXiv 2504.18284 [V]
- **Hardware** (from an EGU 2025 abstract): Clearpath Husky A200 UGV with a METER TEROS 12 VWC sensor on a linear-actuator probe.
- **Method:** a "surface-aware" collection framework for heterogeneous terrain. It flags and discards readings where the probe failed to penetrate.
- **Evaluation:** "multiple field experiments". It is an extended abstract with **no quantitative accuracy**. A 2026 EGU abstract describes missions to georeferenced waypoints, so sampling is not adaptive [U].
- **Relevance:** another probe-pushing UGV; a validity check for failed penetration. Workshop-paper precedent for a first publication.

### Paper 4. Langenscheidt, Haghshenas-Jaryani, Bernhardt, "Mobile Manipulator Robot for Autonomous In-Situ Soil Measurements in Chile Pepper Cultivation", J. Field Robotics, DOI 10.1002/rob.70258 [V] (year reported as 2026 [U]; the Wiley page was not readable)
- **Hardware:** a rover with a 6-DoF manipulator and a TEROS 12 sensor.
- **Method:**
  - two-stage visual alignment from RGB-D data, adapting to terrain slope and finding obstacle-free insertion sites;
  - force-based detection of sensor-soil contact;
  - adaptive impedance control with **Kalman-filter soil-stiffness estimation** for controlled insertion.
- **Evaluation:** 41 sensing operations in varying soil during the early chile pepper season. **75.6% success** (counted only after full insertion). **90.2% correct decisions**, including aborts when needed.
- **Authors' limitations:** cannot detect flush surface obstacles; occasional false contact detection; incorrect verification that insertion finished.
- **Predecessor:** Linford and Haghshenas-Jaryani, "A ground robotic system for crops and soil monitoring and data collection in New Mexico chile pepper farms", Discover Agriculture (Nov 2024). A 4-wheel rover with a 6-DoF arm and a wrist camera for slope alignment; force sensing and impedance control were future work [V].
- **Our critique:** no mapping, no planning, a per-site focus.
- **Relevance:** real insertion success rates are well below 100% and **depend on soil conditions**. The best evidence for making failures soil-dependent in our sensor model (WP4). Its stiffness estimate shows a failed or hard insertion carries information about the soil.

### Paper 5. Nguyen, Muller, Rubin, Wang, Sibona, Sukkarieh (+ McBratney in v3), "Towards Autonomous In-situ Soil Sampling and Mapping in Large-Scale Agricultural Environments", ICRA 2025 Workshop on Field Robotics; arXiv 2506.05653 [V]
- **What:** a Sample Acquisition System (automated in-field sampling) plus an onboard Sample Analysis Lab for real-time pH and macronutrients.
- **Results:** field trials on a large Australian farm. It consistently collects **50 g at 200 mm depth**, and the lab processes a sample in **about 10 minutes**.
- **Our critique:** at about 10 minutes per sample, a mission can afford very few samples, so *where* to sample dominates the outcome. The paper does not address it (from the abstract).
- **Relevance:** shows where expensive in-situ analysis is heading. Our planning becomes more valuable as per-sample cost rises. That justifies sweeping probe cycle time in experiments (10 s, 29 s, 600 s).

### Paper 6. Roberts-Elliott, Das, Cielniak (Univ. of Lincoln), "Kriging-Variance-Informed Multi-Robot Path Planning and Task Allocation for Efficient Mapping of Soil Properties", Robotics (MDPI) 14(6):77, May 2025, DOI 10.3390/robotics14060077 [V]
- **Method:**
  - auction-based multi-robot task allocation guided by kriging variance;
  - a **Distance Over Variance (DOV)** bid rule;
  - integration into a cheapest-insertion task-queuing heuristic;
  - **dropping tasks at low-variance locations**.
- **Evaluation:** simulated, using historical soil-compaction data. Whether Thorvald robots were used is not confirmed [U].
- **Lineage:** Pulido Fentanes et al., "3D Soil Compaction Mapping through Kriging-based Exploration with a Mobile Robot" (arXiv 1803.08069) showed kriging variance as a reward for exploration [V for existence; venue not checked].
- **Our critique:** simulation only, compaction not moisture, no row constraints shown, multi-robot.
- **Relevance:** DOV is an easy baseline (WP2), and task dropping is a cheap idea. Multi-robot is a later extension.

### Paper 7. RAPID project: Thayer, Vougioukas, Goldberg, Carpin [V]
- **Papers:**
  - "Routing algorithms for robot assisted precision irrigation", ICRA 2018;
  - "Multi-robot routing algorithms for robots operating in vineyards", CASE 2018 (best conference paper);
  - IEEE T-ASE 2020 (journal version);
  - a 2019 bi-objective follow-up adding soil-moisture sampling (venue listed as "ASE 2019" in the search, likely IEEE CASE 2019 [U]).
- **What:** robots visit vines to adjust passive drip emitters (PEAD actuator, later on a mobile arm). Routing is an **orienteering problem on vineyard row graphs** under a time or battery budget. It stays NP-hard on these graphs. The authors give greedy heuristics, team orienteering for fleets, and parameter-free heuristics. They benchmark on commercial vineyard data.
- **Bi-objective version:** chooses between adjusting emitters and collecting soil-moisture samples that improve a soil-water inference model.
- **Our critique:** each vine's value is fixed beforehand, not an uncertainty map that changes with every reading (except partly in the bi-objective paper).
- **Relevance:** **the closest formalism to our lane graph.** Cite it for routing on row graphs, borrow its orienteering heuristics for the lookahead planner (WP7), and borrow the "robot adjusts irrigation" framing to close the loop (WP9).

### Paper 8. Tokekar, Vander Hook, Mulla, Isler, "Sensor planning for a symbiotic UAV and UGV system for precision agriculture", IROS 2013; journal version IEEE T-RO 32(6), 2016 [V for both versions existing; journal venue and volume from memory, M]
- **What:** a drone plus a ground robot estimate soil nitrogen across a farm to guide fertiliser. The ground robot carries the drone between deployment points.
- **Method:** a **Sampling TSPN** problem for the ground robot's *slow* soil measurements, plus an orienteering formulation for drone measurements under an energy budget. Both have **approximation algorithms with guarantees**. The goal is to classify each point by nitrogen-deficiency level, a **threshold or classification objective**.
- **Evaluation:** simulations with real soil data and early drone field experiments.
- **Related:** University of Minnesota patent (inventor Volkan Isler).
- **Our critique:** open fields; needs a drone.
- **Relevance:** precedent for (a) a cost model where measurement time dominates, as with our probe cycle, and (b) a **classification objective** rather than variance, which supports our decision-focused thesis (WP3). Cite as related, not the same, because it assumes open terrain.

### Paper 9. Rückin, Jin, Popović, "Adaptive Informative Path Planning Using Deep Reinforcement Learning for UAV-based Active Sensing", ICRA 2022, pp. 4473–4479, DOI 10.1109/ICRA46639.2022.9812025; arXiv 2109.13570; code github.com/dmar-bonn/ipp-rl [V]
- **Method:** Monte Carlo tree search combined with a convolutional network trained offline with deep RL, to choose informative sensing actions in large state and action spaces.
- **Results:** in simulation, comparable to existing methods with **8 to 10x lower runtime**. Validated on real surface-temperature data. Supports online replanning on limited compute.
- **Follow-up:** "Towards Map-Agnostic Policies for Adaptive Informative Path Planning" (arXiv 2410.17166) addresses generalisation and retraining cost.
- **Our critique:** a drone in free space.
- **Relevance:** the right pattern for our RL. Use learning to speed up or guide a planner (tree search plus learned values), not a bare policy over 464 actions.

### Paper 10. Cao, Wang, Vashisth, Fan, Sartoretti, "CAtNIPP: Context-Aware Attention-based Network for Informative Path Planning", CoRL 2022, PMLR 205; code in the marmotlab GitHub [V]
- **Method:** fully reactive neural planning for adaptive IPP. **Self-attention over a graph** of candidate locations captures dependencies at several spatial scales. Trained with deep RL.
- **Results:** significantly outperforms state-of-the-art non-learning IPP solvers in solution quality and computing time once trained.
- **Cost** (reported by the later paper arXiv 2410.17166): **about 24 h on 4 GPUs** to converge, and it needs retraining when parameters change significantly.
- **Our critique:** free-space roadmap graphs, not row-constrained; heavy training compute.
- **Relevance:** if we keep RL, the architecture to copy is a **per-node policy over the lane graph** (attention or GNN). Its compute cost is a reason to also try cheaper per-node heads first (WP8). Our RTX 3050 laptop cannot afford 4 GPUs for 24 h.

### 4.11 Supporting theory and methods (cite alongside)
- **Krause, Singh, Guestrin, "Near-Optimal Sensor Placements in Gaussian Processes: Theory, Efficient Algorithms and Empirical Studies", JMLR 9:235–284, 2008** (ICML 2005 version) [V]. Maximising mutual information for sensor placement is NP-complete. Greedy is within (1 − 1/e) of optimal because of submodularity, with lazy evaluation and robust extensions. **Explains why greedy is hard to beat,** and gives the MI-greedy baseline (WP2).
- **Gotovos, Casati, Hitz, Krause, "Active Learning for Level Set Estimation", IJCAI 2013, pp. 1344–1350** [V]. Classify where an unknown GP function lies above or below a threshold, sampling by GP confidence bounds (the LSE algorithm), with sample-complexity guarantees and batch extensions. Related heuristics: Straddle (Bryan et al. 2005) [V, cited by a later paper] and RMILE (Zanette et al. 2019) [V, cited]. **This is the core of WP3:** "is this cell or zone below the dry threshold?".
- **Booth, Carpin, "Informative path planning for scalar dynamic reconstruction using coregionalized Gaussian processes and a spatiotemporal kernel", IROS 2023, arXiv 2309.07340** (UC Merced; funded by IoT4Ag) [V]. A space-time kernel that plugs into IPP and beats time-agnostic models in simulation. A UC Merced ICRA 2025 follow-up does multi-robot with multi-output GPs. **Relevance:** our weather-driven soil changes over a 30 to 65 min mission (WP10).
- **Popović, Ott, Rückin, Kochenderfer, "Learning-based methods for adaptive informative path planning", Robotics and Autonomous Systems 179:104727, 2024; arXiv 2404.06940** [V]. Survey with a unified problem definition and taxonomies. **Use it to structure the related-work section.**
- **Hollinger, Sukhatme, "Sampling-based robotic information gathering algorithms", IJRR 33(9):1271–1287, 2014** (RSS 2013 version) [V; volume and pages from a BibTeX entry, U]. RIG: graph-based sampling plus branch and bound under a budget. A classic non-myopic IPP reference.
- **Suryan, Tokekar, GP informative path planning with a soil-farm framing, arXiv 1909.01895** [V existence only; read before citing].
- **Polic, Car, Tabak, Orsag, "Robotic Irrigation Water Management: Estimating Soil Moisture Content by Feel and Appearance", arXiv 2201.07653 (Jan 2022)** [V]. A manipulator with RGB-D and a moisture sensor; force control to place the sensor near roots without plant damage; deep learning to estimate moisture from images.
- **Iqbal, Xu, Halloran, Li, "Development of a Multi-Purpose Autonomous Differential Drive Mobile Robot for Plant Phenotyping and Soil Sensing", Electronics 9(9):1550, 2020** [V]. MARIA: an open-source ROS rover with GNSS and an actuated 2D LiDAR (0.2% error steering through rows), plus a 3-DoF manipulator meant for soil sampling.
- **VineScout, Remote Sensing 13(14):2830, 2021** [V]. See Section 3.6.
- **Köhli et al., "Footprint characteristics revised for field-scale soil moisture monitoring with cosmic-ray neutrons", Water Resources Research 2015; arXiv 1602.04469** [V]. CRNS footprint numbers in Section 3.5.
- **Gasch et al., "A Field-Scale Sensor Network Data Set for Monitoring and Modeling the Spatial and Temporal Variation of Soil Water Content in a Dryland Agricultural Field", 2017** (Cook Agronomy Farm, WSU) [V]. 42 locations × 5 depths (30 to 150 cm). Hourly and daily VWC, soil temperature and bulk EC from April 2007 (downloadable files to June 2016). Also site shapefile, bulk density, particle size and crop IDs 2007 to 2016. A 2011–2012 subset is in the GSIF R package. **Data source for WP1a.**
- **Probe insertion physics** [V, general]. Penetration resistance rises as soil dries. Insertion force can displace the probe and leave air gaps that bias readings or make them unusable. A Rothamsted model predicts penetrometer resistance from density, drying and depth (full text embargoed). **No source found that directly tests robotic probe insertion failure in dry soil.** That supports WP4 as a modelling contribution.

---

## 5. Comparison: where we stand

### 5.1 Feature matrix ("?" = not established this session)
| Feature | agrisim (us) | P1 Pulido Fentanes | P2 MoistureMapper | P3 AgriOne | P4 Langenscheidt | P7 RAPID | P10 CAtNIPP |
|---|---|---|---|---|---|---|---|
| Real robot / real field data | No | Yes (robot; data-driven surrogates) | Yes (1 plot) | Yes | Yes (41 ops) | Real vineyard data | No |
| Probe pushed into soil | Simulated | No (non-contact) | Yes | Yes | Yes | No | No |
| Adaptive site selection | Yes | Yes | Yes | No? (waypoints) | No | Fixed values (bi-objective: partly) | Yes |
| Travel restricted to rows/lanes | **Yes** | No (future work) | No (Euclidean) | ? | n/a | **Yes (row graph)** | No |
| Plant contact measured | **Yes (hard metric, 0)** | No | No | No | Partly (clear spot) | No | No |
| Scored vs ground truth (not own variance) | **Yes** | Yes (vs validation model) | Partly (field RMSE; sim variance) | No numbers | Success rate | n/a | ? |
| Uncertainty calibration reported | **Yes** | ? | No | No | n/a | n/a | ? |
| Learned planner | Yes (loses) | No | No | No | No | No | **Yes (wins)** |
| Soil changes during mission | **Yes (M11)** | No | No | No | No | No | No |
| Non-myopic planning | **No** | Partly (Monte Carlo next-best-view) | No (top-5 random) | No | n/a | **Yes (orienteering)** | Yes |
| Open, deterministic benchmark | **Yes** | ? | ? | ? | ? | ? | Code public |

### 5.2 Where we are ahead
- Row and lane-constrained travel with in-lane reversing, and **zero plant contact as a hard metric**. No planning paper measures plant contact.
- Scoring against hidden truth (RMSE, MAE, R², dry precision, recall and F1, calibration), not the map's own variance (MoistureMapper's weakness).
- Fair comparison: identical seeds for every strategy, held-out seeds (100 to 149, training at 1000 and above), 95% intervals, published negative results, byte-identical reruns, Windows and Linux CI.
- Soil that changes during the mission, plus recheck strategies.
- Hardware co-designed from physics (probe force equals weight; open bay; automatic cleaning) and aimed at the insertion problems papers 2 and 4 report.

### 5.3 Where we are behind
- Papers 1 to 5 all have a real robot or real data; we have neither.
- Learned planners win in papers 9 and 10; ours loses.
- No non-myopic planner (RAPID, CAtNIPP and Rückin have one).
- No multi-robot (papers 6 and 7) and no space-time GP (Booth and Carpin).
- No covariates or priors (satellite, EC, last survey).

### 5.4 Positioning statement (for the paper and a pitch) [P]
> For row crops on drip irrigation, existing tools are either single points that run for months, field averages, or pre-planned nutrient cores taken between seasons. We contribute a lane-constrained, plant-safe, decision-focused probing planner and an open benchmark calibrated on real data. It tells a farmer which irrigation zones are too dry, with stated uncertainty, from a few dozen probes per survey.

---

## 6. Our flaws (complete list, with evidence, severity and fix)

Severity: **H** = would block a paper or a real deployment; **M** = weakens claims; **L** = polish.

1. **(H) No real data.** Every soil and probe number is a placeholder (`configs/demo.yaml`). Results are "inside the simulator only". → WP1.
2. **(H) Weak on the farmer's decision.** Held-out, budget 30:
   - dry F1 is 0.24 (fixed) to 0.33 (greedy);
   - dry recall is 0.149 (fixed) and 0.236 (greedy) [S, this session];
   - seed 7 at budget 60 has recall 0.116;
   - F1 is undefined on 8 to 17 of 50 fields, where the map calls nothing dry.

   Kriging smooths dry patches away, and every strategy optimises map variance or RMSE, not the dry/not-dry decision. → WP3, WP5.
3. **(M) Adaptive gains are not significant on RMSE.** Greedy 0.0333 vs fixed 0.0338 with overlapping intervals, and greedy drives 66% further. The theoretical reason is in Section 7.3. We also have no paired statistical tests, only overlapping intervals. → WP3, WP7, WP11.
4. **(M) RL loses** (0.0357, close to random).
   - **Architecture:** a global 128-d CNN feature, then a linear head over 464 site actions. It cannot easily say "this specific site".
   - **Reward:** noisy per-step RMSE change.
   - **Cost:** 21 ms per step because kriging is re-fit every step.
   - **Training:** 200k steps is only about 6.7k episodes, and training abstracts driving as lane-graph distance divided by speed.

   → WP8.
5. **(M) All policies are myopic** (one step). With 29 s per probe (v2), ordering and route matter more. → WP7.
6. **(H for realism) Lane-centre sampling cannot see row structure, and bias is confounded with it.** Measured this session (Section 7). The ±60 mm v2 rail sees only about 2% of the stripe. A reach of about 0.30 m from the lane centre would see 50% of it. → WP6, WP5.
7. **(M) The map model ignores known field structure.** Isotropic ordinary kriging, while the truth has row-aligned stripes. PyKrige 1.7.3 already supports `anisotropy_scaling` and `anisotropy_angle` (both ordinary and universal kriging) and drift terms `regional_linear`, `point_log`, `external_Z`, `specified` and `functional` [S, checked in the installed package]. A distance-to-row drift cannot be identified from lane-centre samples alone (the drift column is constant). It needs lateral reach (WP6). → WP5.
8. **(H for realism) Probe failure is an independent 1% coin flip** (`sensor.py`, `fail = rng.random() < c.failure_prob`). The bad-contact misread (M11) is also independent of soil state. Reality (papers 2 and 4; insertion physics): failures and low-biased partial insertions **increase as soil dries and hardens**, so the driest spots are the most likely to be missed or under-read. The simulator hides this bias. → WP4.
9. **(M) Perfect positioning.** Tracking error in the simulator is 0.36 mm, and readings are logged at the true position. Real GNSS without RTK is off by metres along rows (DESIGN.md open question 7). → WP10.
10. **(M) The product stops at a map.** No irrigation recommendation per drip zone and no water-saved figure, which is what a farmer, Fasal or an examiner would value. → WP9.
11. **(L/M) Single depth** (about 6 cm into soil for v2). Roots and the Cook Farm data go much deeper. → later.
12. **(M) The weather model flatters the robot.** The robot's own rain correction is almost perfect (README limitations). → WP10.
13. **(L) Only one field geometry and crop.** Generalisation across row spacing and field size is untested. → WP11 (experiment matrix).
14. **(M) Held-out seeds 100 to 149 have been looked at many times.** For final paper numbers, reserve a fresh, untouched seed range. → WP11.

---

## 7. Measurements and analysis done this session

### 7.1 Drip stripe vs probe bias experiment [S]
**Question.** How much map error comes from the drip-line wetness under plant rows, which lane-centre probes never see?

**Method.** Held-out seeds 100 to 149, `configs/demo.yaml`, strategies fixed_spacing and greedy_variance, budgets 30 and 60. For each run, compute the known stripe on the output grid and score three variants of the map. This is a diagnostic oracle only; no policy or mapper reads the truth. Script in Appendix B.

The three variants:
- (a) the original map;
- (b) the map plus the stripe;
- (c) the map plus the stripe minus the configured probe bias (0.01).

**Results.** Each cell is mean RMSE over 50 fields, then "fields improved / 50", then dry recall.

| Strategy, budget | Original | + stripe only | + stripe − bias |
|---|---|---|---|
| fixed, 30 | 0.0338; recall 0.149 | 0.0345 (worse; 15/50); recall 0.119 | **0.0322** (−9% MSE; **47/50**); recall **0.184** |
| greedy, 30 | 0.0333; recall 0.236 | 0.0336 (23/50); recall 0.198 | **0.0318** (−8% MSE; **47/50**); recall **0.287** |
| fixed, 60 | 0.0292; recall 0.258 | 0.0303 (15/50); recall 0.205 | **0.0277** (−9% MSE; **49/50**); recall **0.315** |
| greedy, 60 | 0.0285; recall 0.322 | 0.0293 (19/50); recall 0.259 | **0.0269** (−11% MSE; **50/50**); recall **0.385** |

Also: removing only the bias (fixed, budget 30) makes the map worse, 0.0338 → 0.0350.

**Interpretation.**
1. The stripe averages `amp × 1/2 = +0.015` VWC over the planted area, with an RMS of `amp × √(3/8) ≈ 0.018`. Lane-centre readings see none of it.
2. The probe bias (+0.01) shifts lane readings up, which happens to offset most of the missing +0.015. The two placeholder errors partly cancel, which is a coincidence of our placeholders.
3. Correcting both gains 0.0015 to 0.0016 RMSE. That is about **3x the greedy-vs-fixed gap** (0.0005) and consistent across nearly all fields.
4. In a real field, **readings taken only at lane centres cannot separate probe bias from the row-vs-lane moisture difference**. Both shift the map by a constant. Separating them needs (a) readings at different distances from the row (lateral reach, WP6) and (b) a bias calibration, such as the dock reference block in rover v2 or gravimetric samples (WP1b).
5. **Rover v2's ±60 mm rail is not enough.** Reach is measured sideways **from the lane centre**; with 1.2 m rows the lane centre is 0.6 m from the row, so a reach `r` puts the probe at `d = 0.6 − r` from the row, where the stripe is `cos²(π·d/1.2)` of its peak:

   | Reach from lane centre | Distance from row | Share of stripe peak seen |
   |---|---|---|
   | 0.06 m (v2 rail) | 0.54 m | 2.4% |
   | 0.15 m | 0.45 m | 15% |
   | 0.30 m | 0.30 m | 50% |
   | 0.45 m | 0.15 m | 85% (inside the canopy radius except between plants) |

   Canopy radius 0.22 to 0.30 m and stem keep-out 0.15 m set the safe limit. Plants are 0.5 m apart, so there are gaps between canopies.
6. **Caveat.** Stripe amplitude, shape and probe bias are placeholders. The real size of this effect must come from field data (WP1b: readings in rows and in lanes).

### 7.2 What PyKrige can do without new dependencies [S]
In PyKrige 1.7.3 (installed):
- `OrdinaryKriging` and `UniversalKriging` accept `anisotropy_scaling` and `anisotropy_angle`;
- `UniversalKriging` supports drift terms `regional_linear`, `point_log`, `external_Z`, `specified` and `functional`;
- `pseudo_inv` is available. We already pass `pseudo_inv=True`.

Per-point (heteroscedastic) noise is not directly supported. If needed, a small NumPy GP with a per-point noise vector is about 30 lines and adds no dependency.

### 7.3 Why "probe where uncertainty is highest" ties with even spacing [M]
For GP regression or kriging with **fixed** hyperparameters, the posterior variance is

`σ²(x | D) = k(x,x) − k_xD (K_DD + σ_n² I)⁻¹ k_Dx`.

It depends only on the sample **locations** D, never on the values read. A maximum-variance greedy policy is therefore a fixed space-filling design, decided before any reading. agrisim re-fits the variogram from the readings at every step, so the values enter only through the fitted range and sill. That is mild adaptivity.

Consequences:
- (a) Greedy variance behaves like an even-ish spacing whose step is set by the fitted range. That is what we observe: same RMSE, but it drives further because it ignores travel.
- (b) Variance-only objectives can be planned offline, so non-myopic planning is cheap for them (e.g. orienteering over precomputed variance reductions).
- (c) **Real adaptivity needs a value-dependent objective.** For example, the probability that a cell or zone is below the dry threshold depends on the estimated mean, so it changes with every reading. This is the theoretical core of the paper thesis (WP3).

---

## 8. What to build: work packages

### Status update (17 October 2026)
- **WP2 done**: `moisturemapper_a1`, `moisturemapper_a2`, `dov`, `mi_greedy` and `spatial_coverage` are in `policies.py`.
- **WP11 partly done, as agribench** (`benchmarks/README.md`, `agrisim suite`): paired one-sided Wilcoxon with Holm, bootstrap intervals, win rates; fresh, never-reused fields per run instead of a reserved seed range for day-to-day work (500 to 599 stays untouched for the paper); an 8-task experiment matrix; a clairvoyant oracle ceiling (Section 9.5).
- **WP4 sensor side done**: `probe.hard_soil` (failures and short, low readings rise in dry soil). The mapper and policy side (censored observations) is still open.
- **WP10 positioning error done**: `rover.along_row_error_std`. Probe drift, blocked lanes and the space-time kernel are still open.
- The first agribench scores are in the ExecPlan Outcomes (M12).

### 8.0 Order and dependencies [P]
1. WP2 (literature baselines) and WP11-lite (paired statistics, fresh seed range): cheap, and they make every later result comparable.
2. WP5 (direction-dependent variogram) and WP6 (lateral reach): cheap, and they quantify the structural limit from Section 7.
3. WP1a (Cook Farm calibration) in parallel with WP1b (own field data; needs field access and a handheld probe).
4. WP4 (soil-dependent failures) → WP3 (decision-focused acquisition and metrics) → WP9 (zone irrigation plan and water regret).
5. WP7 (lookahead planner).
6. WP8 (RL redesign), optional; keep it as a negative result if it still loses.
7. WP10 (robustness: GNSS noise, drift, blocked lanes, space-time kernel).
8. WP12 (paper assets).

Suggested EXECPLAN mapping:
- M12 = WP2 + WP11-lite
- M13 = WP5 + WP6
- M14 = WP1a
- M15 = WP4
- M16 = WP3 + WP9
- M17 = WP7
- M18 = WP8
- M19 = WP10
- M20 = WP1b field campaign and validation
- M21 = WP12

Effort scale: S = under a day, M = 1 to 3 days, L = a week or more (agent-assisted).

### WP1. Ground the simulator in real data (H)
**WP1a: Cook Agronomy Farm calibration** (effort M)
- **Goal:** replace guessed soil statistics with values fitted to a real field, and build "real-data surrogate" fields like Pulido Fentanes et al.
- **Data:** Cook Agronomy Farm (WSU). 42 locations × 5 depths, hourly and daily VWC, temperature and bulk EC, 2007 to 2016 files. Via catalog.data.gov and data.nkn.uidaho.edu. **Check the dataset licence and terms before committing any file**; prefer a download script plus checksum over committing the data.
- **Caveat:** a dryland wheat field with depths from 30 cm, not drip-irrigated tomato at 6 cm. Use it for **variogram shape, range, sill and temporal dynamics (wetting and drying rates)**, not for drip stripes.
- **Design:**
  - `scripts/calibrate_cookfarm.py` (outside the package; no new runtime dependency) fits experimental variograms per date and depth, using PyKrige or NumPy.
  - Write `configs/scenarios/cookfarm_fit.yaml` with fitted ranges and sills (still marked as calibrated from Cook Farm, not tomato).
  - Optionally a `soil.source: data` mode that krige-interpolates a real snapshot onto the grid as the truth, with readings re-sampled from it.
- **Acceptance:** a report in the EXECPLAN with fitted ranges and their spread. The benchmark re-run on the fitted scenario, with ranking changes reported.

**WP1b: our own field campaign** (effort L; needs field access, context.md Q items)
- **Goal:** calibrate stripe amplitude, row-vs-lane difference, probe noise and bias, correlation length and dry threshold for tomato. Then validate the map.
- **Protocol** [P]:
  - One drip-irrigated tomato plot of about 20 × 30 m (GKVK, IIHR Hesaraghatta, KVK Kolar; access unconfirmed).
  - A handheld capacitance or TDR probe (the same model planned for the rover if possible).
  - **A dense reference grid of about 100 to 150 readings**: every lane centre every 1 m, plus transects across 3 to 4 rows at 0.1 m steps from lane centre to the row (as close as the canopy allows).
  - Repeat each transect point 3 times to estimate probe noise.
  - Take 10 to 20 gravimetric samples (oven-dried) at probe points to estimate probe bias.
  - Record GPS or tape positions, time, irrigation schedule (emitter spacing and flow), soil texture, canopy size and an agronomist's dry threshold.
  - Repeat before and 2 to 4 h after an irrigation pulse.
- **Use:** fit the stripe amplitude and profile (cos² or the measured shape), the noise and the bias. Then hold out the dense grid as ground truth and test the strategies by sub-sampling it (a replay benchmark).
- **Acceptance:** sim-vs-real gap reported (variogram fit, stripe profile, noise). At least one strategy comparison on real data.

### WP2. Re-implement published baselines (H, effort S)
Add to `policies.py` (each one implements `Policy.choose(ctx) -> int`, registered in `STRATEGIES` and `make_policy`):
- `moisturemapper_a1`: score = `σ̂²(s) · (1 − d(s)/d_max)`;
- `moisturemapper_a2`: score = `0.5 · (σ̂²(s) + 1 − d(s)/d_max)`.
  - `σ̂²` is variance normalised to [0, 1] across unvisited sites (they fixed the GP signal variance at 1).
  - `d` is lane-graph distance via `ctx.graph.distances`. Also run a Euclidean variant to match the paper.
  - Pick uniformly among the top 5 with the seeded `rng`, as in the paper.
- `dov` (Roberts-Elliott): choose the minimum of `distance / variance` (lane-graph distance) [U: check the exact bid form and the low-variance task-dropping rule in the paper].
- `mi_greedy` (Krause et al.): choose the site maximising `σ²(s | A) / σ²(s | Ā \ s)` over candidate sites, with a covariance from the fitted variogram. 464 sites gives a 464 × 464 matrix, which is cheap.
- `spatial_coverage`: k-means (NumPy) on the planted area into B clusters, snap centroids to the nearest candidate sites, and visit in lane-graph nearest-neighbour or 2-opt order. A standard soil-science design and a strong non-adaptive baseline.

**Tests:** each policy returns an unvisited index; is deterministic per seed; and gives zero contacts in a smoke bench.

**Acceptance:** `agrisim bench` table with all baselines, seeds 0 to 49, budgets 30 and 60. Report in the EXECPLAN.

### WP3. Decision-focused probing (the main contribution) (H, effort M)
**Goal:** probe where the dry/not-dry call (per cell or per irrigation zone) is most uncertain, per second of driving plus insertion.

**Definitions** (threshold `h` = `mapping.dry_threshold`; posterior mean `μ(x)` and standard deviation `σ(x)`):
- **Straddle score:** `1.96·σ(x) − |μ(x) − h|`. Positive means ambiguous.
- **LSE ambiguity** (Gotovos et al.): with confidence interval `[μ − β^½σ, μ + β^½σ]`, `a(x) = min(μ + β^½σ − h, h − (μ − β^½σ))` for cells not yet classified. Sample the maximum.
- **Expected misclassification reduction** (closed form plus quadrature). The current misclassification probability of cell c is `m_c = Φ(−|μ_c − h| / σ_c)`. After probing site s, the posterior variance `σ'_c²` is known in advance (Section 7.3). The new mean is distributed as `μ'_c ~ N(μ_c, σ_c² − σ'_c²)`, so `E[m'_c] = E[Φ(−|μ'_c − h| / σ'_c)]`, computed with 5 to 10 Gauss-Hermite nodes. Score `Σ_c (m_c − E[m'_c])`, optionally weighted by zone area.
- **Per-time versions:** divide by `travel(pos, s)/v + insertion_time`, as `greedy_variance_per_cost` already does.

**New metrics** in `metrics.py` (allowed to read truth):
- dry-zone IoU;
- **zone decision accuracy** (zones = drip laterals or row segments; see WP9);
- **anytime curves**: RMSE and dry F1 against mission time, plus their area under the curve.

**Policies:** `straddle`, `lse`, `emr` (expected misclassification reduction), each with a per-cost variant.

**Tests:**
- scores are finite;
- on a synthetic field with one known dry patch, `emr` probes inside or around the patch earlier than `fixed_spacing` (a deterministic, seeded check).

**Acceptance:** paired comparison (WP11) of the decision metrics against all baselines. **Hypothesis H1** in Section 9.3.

### WP4. Soil-dependent probe failure and partial insertion (H, effort S–M)
**Goal:** model that dry, hard soil causes failed or shallow insertions with low-biased readings. Then test whether planners that know this do better.

**Sensor model** in `sensor.py` (new `ProbeConfig` fields, all placeholders, defaults keeping old behaviour):
- `p_fail(θ) = failure_prob + (fail_dry_max − failure_prob) · logistic((θ_hard − θ)/fail_width)`, where `θ` is the true VWC at the site.
- On "partial insertion" (probability rising the same way): `reading −= partial_drop · U(0.5, 1)`. This matches MoistureMapper's low readings.
- **Keep the random-draw order stable:** draw all random numbers every call, as now, so existing results stay byte-identical when the new parameters are 0.

**Using the information (mapper or policy side, no truth access):**
- (a) Treat a failed insertion as a **censored observation** (likely `θ < θ_hard`): add a pseudo-reading at `E[θ | θ < θ_hard]` under the current posterior, with variance `Var[θ | θ < θ_hard]` (truncated-normal formulas, NumPy only).
- (b) The policy re-tries nearby (the v2 rail shift) or flags the area as likely dry.

**Tests:**
- failure rate rises as truth dries (seeded statistics);
- with the new parameters at 0, metrics.json is byte-identical to before.

**Acceptance and hypothesis H3:** with correlated failures, standard strategies lose dry recall. Treating failures as censored observations recovers part of it.

### WP5. Use known field structure in the mapper (M, effort S)
- Add `mapping.anisotropy_scaling` and `mapping.anisotropy_angle` (rows lie along x, so the angle is 0). Optionally fit the scaling per run from directional experimental variograms (along x vs along y).
- Add `mapping.method: universal_kriging_rows`: `UniversalKriging` with a `functional` drift `f(x, y) = cos²(π·d_row(y)/row_spacing)` (the known layout, not the truth). Fall back to ordinary kriging when the drift column is near-constant, which is the case for lane-centre-only samples. **Row positions come from the layout, which the robot knows. This is not truth access.**
- **Tests:** on a synthetic field that has only stripes, drift kriging with lateral samples recovers the amplitude, and the fallback triggers with lane-only samples.
- **Acceptance:** RMSE and dry recall with and without, paired. Combined with WP6 this is **hypothesis H2**.

### WP6. Lateral probe reach and hardware co-design (H, effort S–M)
- New `probe.lateral_reach` (m, default 0, so old behaviour is unchanged) and `survey.lateral_offsets` (for example [0, ±0.15, ±0.30]).
- **Candidate sites:** lane centre plus offsets. They must stay outside `stem_keepout` of every stem and outside canopy radius plus margin (reuse `site_ok` in `field.py`). The rover stays on the centreline; only the probe tip moves sideways.
- **Safety check:** extend `safety.py` with a probe-tip vs canopy test. Plant contact must stay 0.
- **Sweep reach** (from the lane centre) 0, 0.06 (v2 rail), 0.15, 0.30, 0.45 m. That puts the probe 0.6, 0.54, 0.45, 0.30 and 0.15 m from the row. Plot RMSE, dry recall, and the share of rejected sites against reach.
- **Output for hardware:** the reach needed to (a) identify the stripe and bias and (b) reach a given dry recall. Feed it into `hardware/rover-v2/model.mjs` (rail travel) only after the team agrees; hardware files are generated from `model.mjs`.

### WP7. Non-myopic planning on the lane graph (M, effort M)
- **Variance or coverage objectives:** plan offline (Section 7.3), with orienteering over the lane graph under a time budget `T`: `Σ travel/v + n·insertion ≤ T`. Use greedy insertion plus 2-opt (RAPID-style heuristics). No solver dependency.
- **Decision objectives:** rollouts or MCTS with fantasised readings drawn from the posterior (`μ' ~ N(μ, σ² − σ'²)`). Use depth 2 to 4 and a beam of the best K candidates by one-step score, with fixed hyperparameters inside the lookahead for speed.
- **Budget switch:** support a mission-time budget, not just a probe count, because v2's 29 s cycle makes time the binding limit.
- **Acceptance (hypothesis H4):** at equal mission time, lookahead beats one-step on the decision metrics, with the margin growing with insertion time (10 s vs 29 s vs 600 s, the paper 5 regime).

### WP8. RL redesign, or a principled negative result (M, effort M–L)
- **Per-site action head:** a fully convolutional network outputs a score map, and logits are gathered at each candidate site's pixel. A cheap substitute for attention. A graph-attention variant over lane-graph nodes (CAtNIPP-style) is optional.
- **Reward:** decision-focused (WP3 misclassification reduction or WP9 regret change), with a time penalty.
- **Speed:** freeze the variogram per episode (fit once after the first K readings). Replace PyKrige refits with a NumPy GP using rank-1 Cholesky updates, which should cut the 21 ms step substantially (measure it).
- **Hybrid** (Rückin-style): use the network as a value or prior inside the WP7 lookahead.
- **Acceptance:** the same held-out protocol. If it still does not beat the best non-learning planner, report it as a negative result, with a learning-curve figure.

### WP9. Close the loop: per-zone irrigation plan and water regret (H for impact, effort S–M)
- **Zones:** one per drip lateral (row) or per row segment. Add `field.zone_length` (placeholder) or use whole rows.
- **Plan:** `w_m = max(0, θ_target − θ̂_m) · root_depth · area_m · 1000` litres. Here `θ̂_m` is a zone statistic from the map (mean, or a lower quantile using the variance; that choice is a parameter).
- **Regret metric** in `metrics.py`: `R = Σ_m [α_under·max(0, w*_m − w_m) + α_over·max(0, w_m − w*_m)]`, with `w*` from the truth. Placeholders: `θ_target`, `root_depth`, `α_under > α_over`.
- **Report:** water saved against uniform irrigation (every zone gets the field-mean deficit) and against "irrigate everything to target".
- **Output file:** `irrigation_plan.csv` in the run folder (zone, litres, confidence).
- **Acceptance:** regret and water saved per strategy in the bench summary.

### WP10. Robustness and realism (M, effort M)
- **GNSS error:** `rover.position_noise_std` and `rover.along_row_bias`. The reading is stored at the *believed* position; the truth is sampled at the true position.
- **Probe drift over a mission**, and occasional blocked lanes (the planner must re-route; the lane graph needs an edge-removal API).
- **Space-time map:** add time to the kriging or GP covariance (separable, with a temporal range fitted from Cook Farm in WP1a), following Booth and Carpin. Compare with the M11 rain-gauge correction.
- **Imperfect rain correction:** add noise or bias to the robot's own rain gauge (README limitation).
- **Acceptance:** each realism factor turned on alone and together. Report how much each strategy degrades.

### WP11. Evaluation rigour (H, effort S)
- **Paired tests** on per-seed differences: Wilcoxon signed-rank (SciPy, already a dependency), Holm correction across comparisons, median difference with a bootstrap 95% interval, and win rate (k/50). Add to `bench.py` and `summary.md`.
- **Seed policy:**
  - 0 to 99 for development;
  - 100 to 149 is the existing held-out set, already seen;
  - **500 to 599 reserved and untouched until final paper numbers**;
  - 1000 and above for training.

  Record this in CLAUDE.md or the EXECPLAN when adopted.
- **Experiment matrix:** strategies × budgets {15, 30, 60} × insertion time {10, 29, 600 s} × scenarios {demo, rain_shower, hot_afternoon, correlated failures (WP4), Cook Farm fit (WP1a), field replay (WP1b)} × reach from lane centre {0, 0.06, 0.15, 0.30, 0.45}. Run it as one `agrisim bench` sweep script with fixed seeds.
- **Sensitivity:** vary each placeholder ±50% and show the ranking is stable, or report where it flips.

### WP12. Paper assets (effort M)
Figures and tables, all generated by scripts from bench outputs, as `scripts/make_media.py` does today. See Section 9.7.

---

## 9. Research paper plan

### 9.1 Title options [P]
1. "Where to Probe: Decision-Focused, Lane-Constrained Adaptive Soil-Moisture Sampling for Row-Crop Rovers"
2. "Probing Between the Rows: Plant-Safe Adaptive Soil-Moisture Mapping under Lane Constraints"
3. Benchmark-led alternative: "agrisim: An Open Benchmark for Adaptive Soil Probing by Rovers in Planted Row Crops"

### 9.2 Abstract skeleton (numbers to fill only from `agrisim bench` or field data) [P]
> Mapping soil moisture inside a standing row crop requires a rover that probes only from inter-row lanes, avoids every plant, and spends 10–30 s per insertion. Existing robotic soil-moisture systems plan in open space and optimise map uncertainty. We formulate lane-constrained, decision-focused probing: choose probe sites along a lane graph, under a mission-time budget and a no-contact constraint, to classify irrigation zones as dry or not, accounting for insertions that fail more often in dry soil. We show that variance-driven sampling reduces to a fixed design and ties with even spacing, while value-dependent objectives [improve dry-zone F1 by X / cut water-allocation regret by Y] at equal mission time. We also show that lane-centre readings cannot separate probe bias from row-scale moisture structure, and quantify the lateral probe reach needed. Results: [N] fields calibrated on real sensor-network data, re-implemented published baselines, [one field validation]. Code and benchmark are open source.

### 9.3 Research questions and falsifiable hypotheses [P]
- **H1 (decision focus).** At equal mission time, decision-focused acquisition (straddle, LSE or expected misclassification reduction, per-cost) beats variance-based and published baselines on dry-zone F1 and zone regret. Paired Wilcoxon, Holm-corrected p < 0.05, win rate ≥ 70%. It must not lose more than 5% on RMSE. *Falsified if:* no significant gain on the held-out fresh seeds.
- **H2 (observability).** With lane-centre-only sampling, probe bias and row-scale structure are confounded. Lateral reach of r ≥ r* (measured from the lane centre) plus drift kriging cuts RMSE and raises dry recall significantly. Find r* by the WP6 sweep. Section 7.1 suggests it lies above 0.15 m, since below that the probe sees under 15% of the stripe.
- **H3 (informative failures).** When failure probability rises in dry soil, every baseline's dry recall falls. Treating failures as censored observations recovers a significant part of the loss.
- **H4 (lookahead).** The gain from lookahead over one-step grows with insertion time (10, 29, 600 s).
- **H5 (learning, optional).** A per-site learned policy matches or beats the best hand-designed planner at lower run time. If not, report the negative result.

### 9.4 Formal problem (for the paper) [P]
- **Field:** `F ⊂ ℝ²`, rows at `y = r_j`, lane centrelines at `y = ℓ_k`.
- **Candidate sites:** `S = {s_i}` on lane centrelines, plus lateral offsets within the reach `ρ`, excluding the keep-out around stems and the canopy disks.
- **Lane graph:** `G = (V, E)` with lengths. Travel time `τ(a, b) = d_G(a, b)/v`. Probe time `c_p`.
- **Unknown field:** `θ(x)`, a random field (for example a GP with a known-structure mean `m(x) = β₀ + β₁·g_row(x)` and a direction-dependent covariance).
- **Observation at s:** `z = θ̄(s) + b + ε`, `ε ~ N(0, σ_n²)`. Insertion fails with probability `p_f(θ̄(s))`, increasing as θ decreases. A partial insertion gives `z − δ`.
- **Zones** `Z_m` with decisions `w_m` (litres). Loss `L(w, θ)`: asymmetric regret, or area-weighted misclassification of `{θ < h}`.
- **Policy:** π picks the next site from the history. Route constraint: consecutive sites are connected through G; `Σ τ + n·c_p ≤ T`; zero plant contact.
- **Objective:** minimise `E[L(w(D_π), θ)]`.
- **Remarks:**
  - (i) with fixed hyperparameters, variance objectives are non-adaptive (Section 7.3);
  - (ii) lane-only S makes `b` and `β₁` unidentifiable (Section 7.1);
  - (iii) the problem generalises orienteering on row graphs (RAPID) and Sampling-TSPN (Tokekar), so it is NP-hard [M; state carefully and cite].

### 9.5 Baselines
- fixed_spacing (full lane coverage);
- random;
- greedy_variance (Pulido Fentanes-style);
- greedy_variance_per_cost;
- MoistureMapper A1 and A2;
- DOV (Roberts-Elliott);
- MI greedy (Krause);
- spatial coverage (k-means);
- PPO (ours);
- an oracle upper bound that knows the truth, for reference only and clearly labelled.

### 9.6 Metrics
- **Map:** RMSE, MAE, R², calibration_95.
- **Decision:** dry precision, recall, F1 and IoU; zone accuracy; water regret; water saved against uniform irrigation.
- **Cost:** path length, mission time, energy (v2 model: 26 Wh per seed-7 survey; scale with time and distance, placeholder).
- **Safety:** plant contacts; probe-tip contacts (WP6).
- **Reliability:** insertion failures, rechecks.
- **Anytime:** each metric against time, with area under the curve.

### 9.7 Figures and tables
1. Problem figure: field, rows, lanes, drip stripe profile, probe reach, rover footprint (the 3D replay or anatomy figure can supply art).
2. Section 7.1 table and the stripe-profile diagram (lane-only observability).
3. Main results table on fresh seeds 500 to 599: mean, paired difference, p-value and win rate.
4. Anytime curves of dry F1 and RMSE against mission time.
5. Pareto plot of decision quality against mission time.
6. Reach trade-off curve: RMSE and dry recall against reach, with the share of rejected sites.
7. Failure-correlation ablation (H3).
8. Lookahead gain against insertion time (H4).
9. Calibration: Cook Farm variograms, and field-vs-sim stripe profile (WP1b).
10. Field validation map (if WP1b happens).

### 9.8 Related-work structure (map to Section 4)
1. Soil-moisture sensing at different scales: point probes, CRNS, satellite, proximal EC (Section 3; Köhli 2015).
2. Robots for in-situ soil measurement: papers 2, 3, 4 and 5; Linford 2024; Polic 2022; Iqbal 2020; VineScout.
3. Kriging and GP-based robotic exploration of soil: papers 1 and 6; Pulido Fentanes' 3D compaction paper.
4. Informative path planning (IPP), classical (Krause 2008; Hollinger and Sukhatme 2014) and learned (papers 9 and 10; the Popović 2024 survey).
5. Routing on agricultural row graphs: paper 7 (RAPID); paper 8 (Tokekar).
6. Level-set estimation and decision-focused sensing: Gotovos 2013, Straddle and RMILE. **Gap claim:** this session found no robotic soil-moisture work that plans around the irrigation decision. **Re-search before claiming** (Section 11).

### 9.9 Threats to validity (write them in the paper)
- Simulator-to-field gap: placeholders, the stripe model, the probe model.
- Calibration data from a different crop and depth (Cook Farm dryland, 30 to 150 cm).
- A single field geometry.
- Held-out seed reuse (mitigated by the fresh range 500 to 599).
- The RL budget is small compared with CAtNIPP.
- Energy figures come from a design that has not been built.

### 9.10 Venue strategy and publication hygiene [P]
- **Step 1:** a 4 to 6 page paper at an agricultural or field-robotics **workshop** at ICRA or IROS. AgriOne and Nguyen et al. took this route. Step 2: a journal (for example Computers and Electronics in Agriculture, Precision Agriculture, Journal of Field Robotics, Smart Agricultural Technology, or IEEE RA-L) once field data exists. Check each venue's scope and deadlines when planning [U].
- **Reproducibility package:** repo tag, the exact commands, the seed ranges and the configs. Every number traces to a `runs/` output.
- **AI-use disclosure:** follow each venue's policy on AI-assisted writing and coding. The CLAUDE.md git-authorship rule is separate; Claude is never a git author.
- **Never claim:**
  - that the rover concept is new;
  - field accuracy from simulation alone;
  - RL superiority without evidence;
  - "first" or "only" without a fresh, documented search.

---

## 10. Product and market notes [P]
- **Who it is for:** growers of high-value, drip-irrigated row crops (tomato first; Kolar is a traditional tomato district) and agronomy services.
- **Deployment model:** survey-as-a-service, like Rogo. The dock and v2's automatic cleaning keep people out of the per-sample loop.
- **Partners, not rivals:** irrigation controller and IoT firms (Fasal and FasalJet), which already actuate valves. Our zone plan (WP9) is their input. Fixed probes plus a rover map is a natural bundle.
- **Watch:** Stenon's machine-integrated platform (2026); research robots with pushed probes (papers 2 to 5).
- **Economics lesson (Mineral, Small Robot Company):** keep the bill of materials and operating cost low, prove water saved per hectare in simulation and then in one field before scaling hardware.

---

## 11. Open questions, unverified items, and things to re-check

**Facts to verify before citing:**
1. Langenscheidt et al.: publication year (reported 2026), volume and pages (Wiley returned 403).
2. MoistureMapper: author names; units of the field RMSE (12.2 vs 13.1).
3. Tokekar et al.: confirm the IEEE T-RO 2016 journal venue, volume 32(6) and pages (from memory).
4. RAPID bi-objective soil-moisture paper: exact venue (CASE 2019?) and title.
5. Roberts-Elliott et al.: exact DOV bid formula, the robot platform, and the task-drop rule.
6. Hollinger and Sukhatme IJRR 33(9):1271–1287: check against the journal.
7. AgriOne: whether any adaptive selection exists in the full paper; any accuracy numbers.
8. Point-probe variability studies (Section 3.3): match each claim to its exact paper. One source is Springer s11119-024-10138-9; the others are from search snippets.
9. CropX, Sentek, Hortau, Teralytic: current status and products (not verified).
10. Rogo: current acreage and fleet (only company or third-party claims found).

**Checks before implementation:**

11. Cook Agronomy Farm: data licence or terms of use before redistribution.
12. Re-run searches for a "decision-focused / level-set / irrigation-decision robotic soil sampling" paper (query ideas: "level set estimation soil moisture robot", "active classification irrigation zones robot", "task-aware informative path planning agriculture"), and for "lane-constrained / row-constrained informative path planning ground robot". This session found none.
13. Check whether "agrisim" collides with an existing published tool name. No exact match found this session (apsimNGpy, CropForge and FieldSim are different).

**Decisions for the team:**

14. Method paper (decision-focused) or benchmark paper first? Recommendation: method paper with the benchmark as a contribution.
15. Keep RL in the paper (WP8) or drop it to a short negative result?
16. Field access and probe purchase for WP1b. Which handheld probe (ideally the rover's planned probe)?
17. Agronomist input: the dry threshold for tomato at each growth stage, root depth, `θ_target`, and how heavily to weight under-watering against over-watering in WP9.
18. Hardware: change the v2 rail reach after WP6 results?

---

## 12. Sources (all retrieved or checked 16 Oct 2026)

**Commercial and market**
- Rogo: https://www.farmprogress.com/technology/robot-pulls-soil-samples-better-than-you ; https://techpoint.org/tech-directory/rogo/ ; https://pitchbook.com/profiles/company/277394-50 ; https://mercerlandmark.com/rogo/ ; https://www.cvacoop.com/knowledge-center/inside-autonomous-soil-sampling-robot ; https://asmlabs.net/robotic-soil-sampling/
- Stenon: https://www.mdpi.com/2571-8789/9/3/67 ; https://www.hswt.de/en/research/research-profile/publications/detail/validation-of-a-sensor-system-for-real-time-measurement-of-mineralized-nitrogen-in-soils ; https://www.mdpi.com/1424-8220/25/24/7430 ; https://www.tamradar.com/funding-rounds/stenon-series-b-18m ; https://agfundernews.com/stenon-bags-20-5m-to-combat-fertilizer-price-hikes-with-better-nitrogen-management
- Soil Scout: https://siliconcanals.com/this-finnish-startup-is-the-first-to-transmit-critical-soil-data-wirelessly-from-underground-in-real-time/ ; https://www.lightreading.com/iot/finnish-startup-goes-underground-to-measure-soil-conditions
- Teralytic: https://thespoon.tech/teralytic-sensors-help-farmers-manage-their-fertilizing/
- Fasal: https://www.cbinsights.com/company/fasal ; https://agfundernews.com/breaking-indias-fasal-raises-1-6m-seed-funding-to-build-out-precision-ag-across-southeast-asia ; https://www.freshplaza.com/north-america/article/9806771/we-extended-our-crop-intelligence-from-sensing-to-on-farm-action/
- Point-probe variability: https://link.springer.com/article/10.1007/s11119-024-10138-9
- Planet SWC: https://docs.planet.com/data/planetary-variables/soil-water-content/techspec/ ; https://docs.sentinel-hub.com/api/latest/data/planetary-variables/soil-water-content/
- CRNS footprint: https://arxiv.org/pdf/1602.04469 ; https://www.ufz.de/index.php?en=38057
- Veris: https://www.farmprogress.com/equipment/super-sensors-planting-tillage
- EarthSense: https://siebelschool.illinois.edu/news/robotics-startup-earthsense-wins-international-innovation-award ; https://researchpark.illinois.edu/?p=20880
- VineScout: https://www.mdpi.com/2072-4292/13/14/2830 ; https://cordis.europa.eu/project/id/737669/results/it ; https://newatlas.com/vinescout-vineyard-robot/56454/
- Mineral: https://siliconangle.com/2024/07/03/alphabet-shuts-agricultural-ai-robot-startup-mineral-licenses-part-driscolls/ ; https://techcrunch.com/2020/10/12/alphabets-latest-moonshot-is-a-field-roving-plant-inspecting-robo-buggy/
- Small Robot Company: https://www.thegazette.co.uk/notice/4548543 ; https://www.servicedealer.co.uk/latest-news/small-robot-company-enters-liquidaton

**Research papers**
1. Pulido Fentanes 2020: https://arxiv.org/html/1811.05384 ; https://onlinelibrary.wiley.com/doi/full/10.1002/rob.21914 ; https://nora.nerc.ac.uk/id/eprint/525862/
2. MoistureMapper: https://arxiv.org/html/2507.12716v1 ; https://www.dri.edu/?p=1391141
3. AgriOne: https://arxiv.org/abs/2504.18284 ; https://meetingorganizer.copernicus.org/EGU25/EGU25-1910.html ; https://meetingorganizer.copernicus.org/EGU26/EGU26-5265.html
4. Langenscheidt et al.: https://doi.org/10.1002/rob.70258 ; predecessor: https://link.springer.com/article/10.1007/s44279-024-00113-3
5. Nguyen et al.: https://arxiv.org/abs/2506.05653v1
6. Roberts-Elliott et al.: https://doi.org/10.3390/robotics14060077 ; https://bibbase.org/network/publication/robertselliott-das-cielniak-krigingvarianceinformedmultirobotpathplanningandtaskallocationforefficientmappingofsoilproperties-2025 ; 3D compaction: https://arxiv.org/pdf/1803.08069
7. RAPID: https://goldberg.berkeley.edu/pubs/ICRA2018-stefano-rapid-routing-final.pdf ; https://goldberg.berkeley.edu/pubs/CASE2018-Multi-Robot-Routing-Vinyards.pdf ; https://par.nsf.gov/servlets/purl/10111783 ; https://rapid.berkeley.edu/about.html
8. Tokekar et al.: https://experts.umn.edu/en/publications/sensor-planning-for-a-symbiotic-uav-and-ugv-system-for-precision-/ ; https://conservancy.umn.edu/items/c8f34b68-6e13-4be3-8de9-93f08e66cafd
9. Rückin et al.: https://arxiv.org/abs/2109.13570 ; https://github.com/dmar-bonn/ipp-rl ; follow-up https://arxiv.org/pdf/2410.17166
10. CAtNIPP: https://proceedings.mlr.press/v205/cao23b.html

**Supporting**
- Krause et al. 2008: https://jmlr.org/papers/v9/krause08a.html
- Gotovos et al. 2013: https://www.ijcai.org/Abstract/13/202 ; LSE variants: https://arxiv.org/pdf/2408.03144
- Booth and Carpin 2023: https://arxiv.org/abs/2309.07340v1
- Popović et al. 2024: https://arxiv.org/abs/2404.06940v3
- Hollinger and Sukhatme: https://robotics.usc.edu/publications/840 ; https://arxiv.org/pdf/1607.01883 (follow-up)
- Suryan and Tokekar: https://arxiv.org/pdf/1909.01895
- Polic et al. 2022: https://arxiv.org/abs/2201.07653v1
- Iqbal et al. 2020: https://www.mdpi.com/2079-9292/9/9/1550
- Cook Agronomy Farm: https://catalog.data.gov/dataset/data-from-a-field-scale-sensor-network-data-set-for-monitoring-and-modeling-the-spatial-an-487c3 ; https://data.nkn.uidaho.edu/node/1744 ; https://gsif.r-forge.r-project.org/cookfarm.html
- Penetration resistance: https://repository.rothamsted.ac.uk/item/8v306/a-simple-model-to-predict-soil-penetrometer-resistance-as-a-function-of-density-drying-and-depth-in-the-field ; https://publish.csiro.au/sr/SR9660001
- Sampling designs (cLHS vs spatial coverage): https://docs.lib.purdue.edu/sydag/2025/posters/16

---

## Appendix A. Acquisition functions (reference)
Notation: `μ(s)` and `σ²(s)` are the posterior mean and variance at site s. `d(s)` is lane-graph distance from the rover, and `d_max` is its maximum over unvisited sites. `t(s) = d(s)/v + c_p` is the time to reach s and probe it. `h` is the dry threshold. `Φ` is the standard normal CDF.

| Name | Score (maximise unless noted) | Source |
|---|---|---|
| Max variance | `σ²(s)` | ours; Pulido Fentanes-style |
| Variance per cost | `σ²(s) / t(s)` | ours |
| MoistureMapper A1 | `σ̂²(s)·(1 − d/d_max)`, random among top 5 | paper 2 |
| MoistureMapper A2 | `0.5·(σ̂²(s) + 1 − d/d_max)`, random among top 5 | paper 2 |
| DOV | minimise `d(s) / σ²(s)` [U exact form] | paper 6 |
| MI greedy | `σ²(s|A) / σ²(s|Ā∖s)` | Krause 2008 |
| Straddle | `1.96·σ(s) − |μ(s) − h|` | Bryan et al. 2005 (via later citations) |
| LSE ambiguity | `min(μ+β^½σ − h, h − (μ−β^½σ))` over unclassified cells | Gotovos 2013 |
| Expected misclassification reduction | `Σ_c [Φ(−|μ_c−h|/σ_c) − E Φ(−|μ'_c−h|/σ'_c)]`, with `μ'_c ~ N(μ_c, σ_c²−σ'_c²)` | ours [P], from Section 7.3 |
| Per-time version of any score | `score(s) / t(s)` | ours |

## Appendix B. Script for the Section 7.1 experiment
Run from the repo root: `uv run python <path>/stripe_check.py 30`, then again with `60`. It reads the truth only for this offline diagnostic, never inside a policy or mapper.

- For variant (b), "+ stripe only", replace `r.mean + st - cfg.probe.bias` with `r.mean + st`.
- For "bias removed only", use `r.mean - cfg.probe.bias`.

```python
"""How much of the map error is the drip stripe that lane-centre probes cannot see?"""

import sys
from pathlib import Path

import numpy as np

from agrisim.config import load
from agrisim.metrics import map_metrics
from agrisim.sim import run_survey


def stripe_on_grid(res, cfg):
    f = cfg.field
    gx, gy = np.meshgrid(res.grid.x_centres, res.grid.y_centres)
    d = np.abs(gy[..., None] - res.layout.row_y).min(axis=-1)
    s = np.where(d < f.row_spacing / 2, np.cos(np.pi * d / f.row_spacing) ** 2, 0.0)
    planted = (gx >= f.headland) & (gx <= f.length_x - f.headland)
    return cfg.soil.drip_stripe_amplitude * s * planted


if __name__ == "__main__":
    cfg = load(Path("configs/demo.yaml"))
    budget = int(sys.argv[1])
    for policy in ("fixed_spacing", "greedy_variance"):
        base, oracle, rec0, rec1 = [], [], [], []
        for seed in range(100, 150):
            r = run_survey(cfg, seed, policy, budget=budget, spawn=False)
            st = stripe_on_grid(r, cfg)
            m0 = map_metrics(r.truth_grid, r.mean, r.var, cfg.mapping.dry_threshold)
            m1 = map_metrics(
                r.truth_grid, r.mean + st - cfg.probe.bias, r.var, cfg.mapping.dry_threshold
            )
            base.append(m0.rmse)
            oracle.append(m1.rmse)
            rec0.append(m0.dry_recall)
            rec1.append(m1.dry_recall)
        b, o = np.array(base), np.array(oracle)
        print(
            f"{policy:16s} budget {budget}: RMSE {b.mean():.4f} -> {o.mean():.4f} "
            f"({100 * (1 - (o**2).mean() / (b**2).mean()):.0f}% of MSE), "
            f"better on {(o < b).sum()}/50; dry recall {np.nanmean(rec0):.3f} -> {np.nanmean(rec1):.3f}"
        )
```

## Appendix C. Glossary (for new team members)
- **VWC:** volumetric water content, m³ of water per m³ of soil (0.25 = 25%).
- **Kriging / Gaussian process (GP):** interpolation that gives a best guess and its uncertainty at every point, using how quickly moisture changes with distance (the variogram or kernel).
- **Variogram range:** the distance beyond which two readings are roughly unrelated.
- **Direction-dependent (anisotropic) model:** moisture changes at different rates along and across rows.
- **Drift / trend (universal kriging):** a known pattern, such as "wetter near drip lines", added to the map model.
- **IPP (informative path planning):** choosing where a robot measures, and in what order, to learn the most within a budget. "Adaptive" means it replans after each reading.
- **Myopic / non-myopic:** looks one probe ahead, or several.
- **Orienteering problem:** choose which places to visit, and a route, to collect the most reward within a time budget.
- **Level-set estimation:** find where a function is above or below a threshold (here, "too dry").
- **Submodular / (1 − 1/e):** diminishing returns; it is why picking the best next spot greedily is provably near-optimal for some objectives.
- **Censored observation:** "the value is below X" without the exact value, as when a probe fails in hard dry soil.
- **Paired test (Wilcoxon signed-rank):** compares two strategies on the same fields, field by field.
- **Held-out seeds:** fields never used while developing or training, kept for honest evaluation.
