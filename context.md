# AgriRover: Project Context (single source of truth)

Last updated: 13 October 2026. Compiled from the team's planning sessions with Claude.
Read this before writing any code. If something here conflicts with a newer decision by the team, the team wins; update this file.

## 0. Legend

- **[V]** Verified against a public source on or before the date stated. URLs are in Section 14.
- **[P]** Team plan or decision. Not a fact about the world.
- **[A]** Assumption or placeholder. Not verified. Must be checked or calibrated before being presented as fact.
- **[Q]** Open question that a human must answer.

---

## 1. Team, constraints and rules

- Team: five first-year BE students (AI and Data Science), MSRIT, Bengaluru. Beginners in robotics; building with AI coding agents. Claude Code is the implementation agent for this build; its instructions live in `CLAUDE.md`. [P]
- Hardware: one laptop with an NVIDIA RTX 3050 Laptop GPU (stated by the team). [A] Laptop RTX 3050 variants usually have 4 to 6 GB VRAM; check with `nvidia-smi`.
- **Platform rule (hard):** everything in Phase 1 must install and run natively on the team lead's Windows machine, using only free and open-source software. Linux-only tools may appear only as optional extras that the Windows path never needs. See Section 7.2. [P]
- Department process: idea entry (Excel sheet) → presentation → software-only simulation/prototype demo → if approved, funding to build the physical rover as the final project. No hard deadline has been given. [P]
- **Technology selection rules (from the team lead), in priority order:**
  1. Quality first.
  2. Free and open source with no usage restrictions, because the team will modify components. In practice: prefer MIT, BSD, Apache-2.0, ISC, PSF, Zlib, CC0. Do not add GPL/AGPL/LGPL dependencies to shipped code when a permissive option of comparable quality exists. LGPL system libraries pulled in indirectly and used unmodified (for example GEOS under Shapely) are tolerated. External tools that are not linked into our code (for example Blender, which is GPL) are fine to use.
  3. Latest technology: current releases (ideally updated within the last ~6 months). Nothing outdated.
- Communication style: blunt and honest. Never overclaim results. Every number shown in a presentation must trace to a measured result or a cited source.

---

## 2. Project statement (as submitted)

Idea entry text: *AI-Powered Crop and Soil Health Monitoring Rover: An AI-powered rover that moves through crop fields, using cameras and soil sensors to spot plant diseases, check soil health and moisture, and recommend exactly where water, pesticides, or nutrients are needed.*

Original long-term vision (team's own problem statement, not independently sourced):
- Farmers judge crop and soil health by eye, usually after damage is visible; pests and disease often start on leaf undersides and plant bases.
- Water, fertiliser and pesticide are applied uniformly instead of where needed.
- Lab soil tests are slow; drones see only the canopy top.
- Planned capabilities: soil moisture, temperature, pH and NPK at each stop; ground heat map; under-leaf imaging; disease, deficiency and growth diagnosis; per-zone recommendations; later GPS-tagged per-plant history and local-language alerts.
- Stages: (1) software and simulation, (2) physical rover on campus plots, (3) real farms.

---

## 3. Decision history

- **30 Sep 2026**: Novelty check. The concept is not original (Section 4). The value must come from specific contributions done rigorously.
- **1 Oct 2026**: Corrections to the team's first technical sketch:
  - It is not OCR. Leaf analysis is image classification, detection and segmentation.
  - A leaf photo alone cannot tell water need; soil moisture must come from a soil sensor fused with images.
  - "Full crop health scan" must be split into separate, testable tasks.
  - Navigation needs segmentation, depth, localisation and a planner, not just object detection.
  - Capturing leaf undersides is an active-perception problem (find leaf, position camera).
  - A simulator can validate navigation and pipeline logic, but cannot prove disease-detection accuracy; that needs real held-out images.
- **1 Oct 2026**: Team answers: tomato as the likely crop; no deadline; RTX 3050 laptop; no field access yet; five beginners.
- **8 Oct 2026**: A detailed build blueprint was written for the presentation (Claude Doc "Autonomous Crop & Soil Health Rover: Build Blueprint").
- **13 Oct 2026**: Prototype scope narrowed to a **soil-moisture survey simulator** (Section 6). The simulation must be reusable later to train models that run on the real rover.
- **13 Oct 2026**: The stack was re-verified for the latest versions and licences (Section 7). This file was created.

---

## 4. Prior art (verified 30 Sep 2026)

- **EarthSense TerraSentia** [V]: commercial under-canopy robot (autonomous navigation, sensors, cloud analytics), used for disease and nutrient scouting in row crops. One study reports data from 198,249 maize plots collected with 3 to 5 robots per year, 2019 to 2023. A 2019 report priced it at about $15,000 per year to lease (dated figure).
- **CropFollow** [V]: published learned visual navigation for under-canopy robots (ResNet-18 backbone). The authors had to collect their own under-canopy dataset.
- **Reconfigurable crop-scouting vehicle** [V]: published design collecting soil moisture, nutrient and disease information at sub-canopy level.
- **AgRobot, Kota, Rajasthan** [V]: AI rover by Aryan Singh with cameras and soil-moisture sensors; Pradhan Mantri Rashtriya Bal Puraskar 2024; commercialisation reported from November 2024.
- **IIT Kharagpur with C-DAC** [V]: tracked robot that detects plant diseases from camera images and sprays pesticide (MeitY-funded).
- **Harvested Robotics, Hyderabad** [V]: laser weeding robot (different product, shows an active Indian agri-robotics field).

Implication: never claim the concept is new or first.

---

## 5. Long-term technical cautions (apply to all future phases)

- **Lab vs field images** [V]: PlantVillage tomato has about 18,160 images in 10 classes (9 diseases plus healthy), heavily imbalanced (5,357 yellow leaf curl virus vs 373 mosaic virus), lab-captured single leaves on uniform backgrounds. One 2025 study reports a ResNet-50 dropping from over 99% on PlantVillage to under 30% on field images (PlantDoc). PlantDoc has 2,598 internet-scraped images, 13 species, 27 classes.
- **Leaf undersides** [V]: tomato leaf mold sporulates on the underside of older leaves; spider mites, whiteflies, aphids and thrips are found on undersides. Leaf mold is mainly a greenhouse/high-tunnel disease.
- **Low-cost NPK sensors** [V]: a CIAT/CGIAR evaluation found low accuracy and strong moisture sensitivity and did not recommend them for fertiliser management. Treat NPK as advisory until lab-calibrated.
- **Labels** [P]: disease labels must come from a plant pathologist or agronomist; the team must not self-label.
- **Licences** [V]: Ultralytics YOLO is AGPL-3.0 (or a paid Enterprise licence). Under the team's licence rule, prefer permissive detectors for shipped code. [P]
- **GPU-heavy simulators** [V]: current Isaac Sim documentation lists a minimum of GeForce RTX 4080 with 16 GB VRAM and 32 GB RAM; the team's RTX 3050 laptop is far below this.
- **Field access** (for future image data): leads are GKVK (UAS Bengaluru), IIHR Hesaraghatta, KVK Kolar and ICAR-KVK Bengaluru Rural; Kolar is a traditional tomato district. Access is not confirmed. [Q]

---

## 6. Current build target: Soil-Moisture Survey Simulator (Prototype v1)

### 6.1 Goal [P]
Simulate a planted tomato field. A small rover drives the lanes between plant rows, covering the whole field from the edges to the centre, without touching any plant. At stops it inserts a moisture probe into the soil. Readings are assembled into a pixel-style moisture grid of the entire field, with an uncertainty grid, so a farmer can see exactly which zones are under-watered. The same simulation must be reusable to train the decision-making that will later run on the real rover.

### 6.2 What "coverage" means in a planted field [P]
The rover cannot cross plant rows. It drives inter-row lanes in a back-and-forth (boustrophedon) pattern with turns in the headlands at the field edges. Probe points lie in lanes near the root zones, never closer to a stem than a configured keep-out distance.

### 6.3 In scope
- Procedural tomato field layout (rows, plants, lanes, headlands), all configurable.
- Hidden ground-truth soil-moisture field with realistic spatial structure (Section 9).
- Moisture probe sensor model with noise, bias and footprint.
- Rover kinematics, path planning, path following and plant-contact detection.
- Map reconstruction (kriging) into a grid plus an uncertainty grid.
- Metrics against ground truth (Section 10).
- Live visualisation and saved run reports.
- A Gymnasium environment for training an adaptive probing policy, with honest baselines.

### 6.4 Out of scope for v1
Disease detection, cameras, NPK, pH, temperature, the ground heat map, dashboards for farmers, local-language alerts, and the 3D Gazebo world. The 3D world is Phase 2 (Section 8.3).

### 6.5 Success criteria [P]
1. A fresh randomised field runs end to end from one command with a fixed seed and is reproducible.
2. Zero plant contacts across the evaluation seeds, or every contact explained.
3. The reconstructed grid is scored against ground truth with the metrics in Section 10.
4. Results are reported honestly, including where adaptive probing does not beat simple baselines.

---

## 7. Technology research (verified 13 Oct 2026 unless stated)

| Component | Choice | Current version / date | Licence | Verdict |
|---|---|---|---|---|
| Core language | Python | 3.13 target [P] | PSF | SB3 2.8 added official 3.13 support; Gymnasium 1.3 supports 3.14 [V] |
| Packaging | uv | current [A] | MIT/Apache [A] | Lockfile, fast installs |
| Kriging | PyKrige | 1.7.3 (conda-forge updated Oct 2025; PyPI wheels up to cp314) [V] | BSD-3 [V] | Use: ordinary/universal kriging with variance output |
| Random fields | Own FFT spectral generator (NumPy) | n/a | BSD (NumPy) | GSTools rejected: LGPL-3.0 [V] conflicts with the licence rule |
| Coverage planning | Own lane planner (Shapely) | Fields2Cover 2.1.0 on PyPI, 3 Sep 2026 [V] | BSD-3 [V] | Fields2Cover is **not used in Phase 1**: pip builds it from source and needs GDAL, GEOS, Eigen, Boost and OR-Tools [V], which is impractical on Windows. Regular tomato rows only need a boustrophedon lane planner. Fields2Cover returns in Phase 2 (inside WSL2) via opennav_coverage |
| Neural networks | PyTorch (CPU build by default) | 2.10 released Jan 2026; 2.11 made CUDA 13.0 the stable PyPI variant [V] | BSD-3 [A] | Default to the CPU build: the probing models are small. Optional GPU: PyTorch publishes Windows x86 CUDA 12.6/12.8/13.0 builds [V]; install from the PyTorch index (see EXECPLAN M0) |
| Visualisation | Rerun SDK | 0.37.x (0.37.0 released 1 Sep 2026) [V] | MIT / Apache-2.0 [V] | Use. Minor versions carry breaking changes [V], so pin exactly. 0.34 added a Viewer MCP for LLM agents; 0.33 added headless viewer mode [V] |
| RL interface | Gymnasium | 1.3.0, 22 Apr 2026 [V] | MIT [A] | Use |
| RL algorithms | Stable-Baselines3 + sb3-contrib | 2.9.0, 15 Jun 2026 (torch ≥ 2.8, gymnasium < 2.0) [V] | MIT [A] | Use MaskablePPO for masked discrete actions |
| Middleware (Phase 2) | ROS 2 Lyrical Luth | Released 22 May 2026; LTS to May 2031; Tier 1: Ubuntu 26.04 and Windows 11; Ubuntu 24.04 is Tier 3 [V] | Apache-2.0 [A] | Use for Phase 2 |
| 3D simulator (Phase 2) | Gazebo Jetty | LTS; available for Lyrical via `ros-lyrical-ros-gz` [V]; support extended to May 2031 to match ROS [V] | Apache-2.0 [V] | Use. Windows support is experimental [V]; OCI/Docker images exist [V] |
| Navigation (Phase 2) | Nav2 (Lyrical release) | Released 25 Aug 2026 [V] | Apache-2.0 [A] | Use. New Vector Object Server, Adaptive Goal Checker, RPP improvements [V] |
| Coverage server (Phase 2) | opennav_coverage / opennav_row_coverage | main branch works with Fields2Cover v2; F2C not available as binary on Lyrical, must be built from source [V] | [A] check | Use for Phase 2 row coverage |
| Field generator (Phase 2) | AOC tomato farm (LCAS) | Targets Ubuntu 22.04 + ROS 2 Humble [V] | Apache-2.0 [V] | Use the Gazebo generator only; Jetty/Lyrical compatibility unverified [Q]. Do not use its Unity half (Unity editor is proprietary) |
| Field generator (Phase 2) | CropCraft | Blender ≥ 4.0, verified on Blender 5.0.1; YAML config; Gazebo model export; renders RGB + semantic masks [V] | Apache-2.0 [V] | Use for crop rows and future vision data |
| Reference code | Virtual Maize Field | Branches for current ROS 2 and Gazebo [V] | [A] check | Reference only |
| Textures | Poly Haven, ambientCG | current [V] | CC0 [V] | Use |
| Crop-water model (later) | AquaCrop-OSPy | open-source Python port of FAO AquaCrop [V] | Listed as both Apache-2.0 and MIT on an index page [V]; confirm in repo [Q] | Defer to v2 (time dynamics) |
| Coding agent workflow | Claude Code with CLAUDE.md + an ExecPlan | Claude Code loads CLAUDE.md at session start; since v2.1.277 (18 Sep 2026) it reads AGENTS.md only when no CLAUDE.md exists [V]. The ExecPlan format comes from OpenAI's PLANS.md and works with any agent [V] | n/a | Use CLAUDE.md |

### 7.1 Rejected or deferred, and why
- **Isaac Sim / Isaac Lab**: minimum GPU spec (RTX 4080, 16 GB VRAM) far exceeds the team's laptop [V].
- **Newton, MuJoCo Warp, Genesis**: current GPU-parallel engines aimed at manipulation and legged learning [V]; comparisons in 2026 still describe Gazebo as owning outdoor robotics and ROS 2 integration [V]. No benefit for a ground rover doing coverage on a 3050 laptop.
- **Webots**: Apache-2.0 and beginner-friendly, but the latest stable release found was R2025a (31 Jan 2025) [V]. Fails the "latest" rule and has no tomato-field generator.
- **Godot + Godot RL Agents**: MIT [V], but no robot sensor models and no ROS bridge; weakest path to the real rover.
- **Unity**: editor is proprietary; fails the licence rule.
- **GSTools**: LGPL-3.0 [V]; replaced by our own random-field generator plus PyKrige.
- **Docker Desktop**: not open source; not used. Phase 2 uses WSL2 directly.

### 7.2 Windows compatibility and licence audit (Phase 1)

Every Phase 1 dependency, its licence, and how it installs on Windows (x86-64, Python 3.13). [V] means checked during research; [A] means a well-known fact not re-checked this session. Claude Code must confirm each one at M0 (EXECPLAN) and record the result.

| Package | Licence | Windows install |
|---|---|---|
| uv (package manager) | MIT / Apache-2.0 [A] | Official PowerShell installer [V] |
| Python 3.13 | PSF [A] | Installed by uv |
| numpy, scipy | BSD-3 [A] | Prebuilt Windows wheels [A] |
| shapely | BSD-3 (bundles GEOS, LGPL, used unmodified) [A] | Prebuilt Windows wheels [A] |
| pydantic v2, PyYAML, typer | MIT [A] | Wheels / pure Python [A] |
| PyKrige | BSD-3 [V] | Windows wheels published (e.g. cp312 and cp314 win_amd64) [V] |
| rerun-sdk | MIT / Apache-2.0 [V] | win_amd64 wheel published for 0.37.x [V]; viewer bundled with the Python SDK [V] |
| gymnasium | MIT [A] | Pure Python [A] |
| stable-baselines3, sb3-contrib | MIT [A] | Pure Python [A] |
| torch | BSD-3 [A] | CPU wheels on PyPI; CUDA builds for Windows x86 from the PyTorch index [V] |
| matplotlib | PSF-based (permissive) [A] | Prebuilt Windows wheels [A] |
| pytest, ruff, mypy | MIT [A] | Wheels [A] |
| pip-licenses (CI licence check) | MIT [A] | Pure Python [A] |

**GPU caveat:** NVIDIA's CUDA libraries and GPU driver are free of charge but proprietary. The fully open-source path is the CPU build of PyTorch, which is the default. Using the RTX 3050 for training is optional and is the one place a proprietary (free) component enters. [A]

Not used on the Windows path: Fields2Cover (from-source build), GSTools (LGPL), Ultralytics (AGPL), Unity, Isaac Sim, Docker Desktop.

**Windows coding rules** (enforced in CLAUDE.md):
- Use `pathlib` for every path; never hard-code `/` separators.
- Run-folder names must not contain `:` (invalid on Windows). Use `20261013T101500Z_seed7`.
- Open text files with `encoding="utf-8"` explicitly.
- Multiprocessing on Windows uses `spawn`: worker functions must be top-level and importable, and every entry point needs an `if __name__ == "__main__":` guard. SB3 `SubprocVecEnv` must use `start_method="spawn"`, or use `DummyVecEnv`.
- Documented commands must work in Windows PowerShell 5.1, so no `&&` chaining; give one command per line. Ship `scripts/demo.ps1`.
- CI runs on both `windows-latest` and `ubuntu-latest`; Windows is the primary target.

### 7.3 Phase 2 on Windows (later, for orientation)
- ROS 2 Lyrical is Tier 1 on Windows 11 [V], but Gazebo's native Windows support is experimental [V].
- Plan: run Phase 2 inside **WSL2 with Ubuntu 26.04**. WSL was open-sourced under the MIT licence on 19 May 2025, though a few Windows-side components remain closed [V]. WSLg runs Linux GUI apps such as Gazebo on Windows 11 [V].
- Performance of Gazebo under WSLg on an RTX 3050 laptop is unverified [Q]; test early in Phase 2.

---

## 8. Architecture [P]

### 8.1 Two layers
- **Layer A, `agrisim` (pure Python, no ROS):** field layout, soil truth, probe model, rover kinematics, planning, safety, mapping, metrics, visualisation, Gymnasium environment, CLI. Runs headless and fast on any laptop. This is the product logic and the training ground.
- **Layer B (Phase 2), Gazebo Jetty + ROS 2 Lyrical:** 3D tomato rows, rover body, contact sensors, cameras, Nav2 with row coverage. It calls Layer A through a probe service for soil readings, so soil logic exists in exactly one place.

### 8.2 Conventions
- Units: SI. Metres, seconds, radians. Soil moisture as volumetric water content (VWC, m³/m³).
- World frame: origin at the field's south-west corner, x along the rows, y across rows, z up (ENU-like).
- Every run is driven by a config file plus an integer seed and must be bit-for-bit reproducible on the same machine.

### 8.3 Phase 2 outline (separate ExecPlan later)
Generate the world (AOC generator or CropCraft) → rover URDF/SDF → `ros_gz` bridge → probe service calling `agrisim` → contact sensors on plant collision volumes → Nav2 + opennav_row_coverage → compare plant-contact and coverage metrics with Layer A.

---

## 9. Making soil moisture believable

Ground truth is not white noise. Measured field data shows spatially correlated moisture:
- Irrigated transect: semivariogram ranges of 3 to 32 m for water content [V].
- Levelled fields: ranges from 42 m to 334 m depending on depth, site and mean moisture [V].
- Ranges are shorter during heavy irrigation [V].
- Installed sensors often overestimated soil water content compared with reference samples in one study [V].

Generator design [P]:
- Base: Gaussian random field via FFT with an exponential or Matérn-like covariance; correlation length sampled per episode (default range 3 to 30 m for a small plot, from the values above).
- Drip-line structure: wetter stripes along plant rows, drier lane centres.
- Anomalies: a few dry patches ("clogged emitter") and occasional wet patches ("leak"), randomly placed and sized.
- Clip to a physically plausible VWC range.
- **All numeric defaults (mean VWC, standard deviation, stripe amplitude, anomaly sizes, probe noise and bias) are placeholders [A]** until calibrated with an agronomist or real probe data.

Probe model [P]: reading = local average of truth over a small footprint + bias + Gaussian noise, quantised to the sensor resolution, with a small configurable failure probability.

---

## 10. Evaluation metrics [P]
- Map quality: RMSE, MAE and R² of the reconstructed grid vs truth; calibration of the predicted uncertainty.
- Decision quality: precision and recall of detecting "dry" cells (below a configurable threshold).
- Safety: plant-contact count (target zero).
- Efficiency: number of probes, path length, mission time, lane coverage percentage.
- Baselines: global mean, inverse-distance weighting, fixed-spacing probing, maximum-variance greedy probing. Any learned policy must be compared with all of them over many seeds.

---

## 11. Risks
- Fields2Cover cannot be installed practically on Windows → Phase 1 uses our own lane planner and does not depend on it.
- Rerun breaks APIs between minor versions → pin an exact version.
- PyTorch from PyPI on Windows is a CPU build → acceptable for Phase 1; GPU is optional via the PyTorch index.
- Windows-specific bugs (paths, multiprocessing spawn, encodings) → coding rules in Section 7.2 and Windows CI.
- AOC tomato farm targets Humble/22.04 → Phase 2 may need porting work.
- Gazebo on Windows is experimental → Phase 2 runs inside WSL2 with Ubuntu 26.04.
- Placeholder soil parameters could make the simulation look precise when it is not → label them clearly everywhere.
- Learned probing may not beat the greedy-variance baseline → report it honestly; the baseline alone is a valid product.

---

## 12. Open questions [Q]
1. The team lead's machine runs Windows. Which operating systems do the other four laptops run, and are they Windows 10 or 11? (WSLg for Phase 2 is best on Windows 11.)
2. Real tomato row spacing, plant spacing and plant height at the target farms.
3. Which moisture probe will the real rover use (type, depth, accuracy, insertion time)?
4. What threshold defines "under-watered" for tomato at each growth stage? (Needs an agronomist.)
5. Does the AOC Gazebo generator run on Gazebo Jetty?

---

## 13. Future phases (for orientation only)
- Phase 2: Gazebo/ROS 2 world (Section 8.3).
- Phase 3: cameras, under-leaf imaging, disease classification trained on real expert-labelled images; vision models evaluated on real held-out field images only.
- Phase 4: physical rover; probe calibration against lab tests; campus plots.

---

## 14. Sources
- ROS 2 Lyrical release: https://discourse.openrobotics.org/t/ros-2-lyrical-luth-released/55021 ; https://docs.ros.org/en/lyrical/Releases/Release-Lyrical-Luth.html
- Gazebo cadence and support windows: https://discourse.openrobotics.org/t/new-release-cadence-for-gazebo-and-better-alignment-with-ros/55667
- Gazebo Jetty: https://discourse.openrobotics.org/t/gazebo-jetty-released/50349 ; Windows install (experimental): https://gazebosim.org/docs/latest/install_windows_src/ ; containers: https://discourse.openrobotics.org/t/announcing-gazebo-open-container-images-docker-compatible-for-all-releases/51700
- Nav2 Lyrical: https://discourse.openrobotics.org/t/nav2-lyrical-release-key-features/57666
- opennav_coverage: https://github.com/open-navigation/opennav_coverage
- Fields2Cover: https://pypi.org/project/fields2cover/ ; https://github.com/Fields2Cover/Fields2Cover
- PyKrige: https://pypi.org/project/PyKrige ; https://anaconda.org/conda-forge/pykrige
- GSTools licence: https://science.ecosyste.ms/projects/4337
- Rerun: https://github.com/rerun-io/rerun ; releases: https://sourceforge.net/projects/rerun.mirror/files/0.37.0/
- Gymnasium release notes: https://gymnasium.farama.org/gymnasium_release_notes/
- Stable-Baselines3 changelog: https://stable-baselines3.readthedocs.io/en/master/misc/changelog.html
- AOC tomato farm: https://github.com/LCAS/aoc_tomato_farm
- CropCraft: https://github.com/Romea/cropcraft
- Virtual Maize Field: https://github.com/FieldRobotEvent/virtual_maize_field
- Agri simulation list: https://github.com/rajithadesilva/awesome-agriculture
- Textures (CC0): https://app.cinevva.com/guides/free-textures-hdris-materials
- AquaCrop-OSPy: https://pypi.org/project/aquacrop/3.0.5 ; https://ost.ecosyste.ms/projects/46164
- Webots: https://en.wikipedia.org/wiki/Webots
- Isaac Sim requirements: https://docs.isaacsim.omniverse.nvidia.com/5.1.0/installation/requirements.html
- Simulator landscape 2026: https://medium.com/@brukg07/the-robot-sensor-showdown-5-simulators-compared-b9463f3f9f40 ; https://www.godrift.ai/blogs/best-robot-simulators-ros2
- Godot RL Agents: https://github.com/edbeeching/godot_rl_agents
- Ultralytics licence: https://ultralytics.com/license
- Soil moisture spatial variability: https://repository.arizona.edu/handle/10150/278505 ; https://scisoc.confex.com/crops/2014am/webprogram/Paper86004.html ; https://agu.confex.com/agu/fm14/webprogram/Paper16838.html
- Sensor bias study: https://soil.copernicus.org/articles/11/435/2025/soil-11-435-2025-supplement.pdf
- ExecPlan format: https://github.com/openai/openai-agents-python/blob/main/PLANS.md
- Claude Code and AGENTS.md/CLAUDE.md: https://www.eesel.ai/blog/claude-code-agents-md ; https://chudi.dev/blog/claude-code-agents-md
- PyTorch Windows builds: https://dev-discuss.pytorch.org/t/wheel-variants-for-pytorch-release-2-10-published/3305 ; https://dev-discuss.pytorch.org/t/transitioning-pypi-cuda-wheels-to-cuda-13-0-as-the-stable-release-2-11/3325
- WSL open source: https://learn.microsoft.com/windows/wsl/opensource ; https://en.wikipedia.org/wiki/Windows_Subsystem_for_Linux
- Earlier sections (prior art, datasets, sensors): sources listed in the team's Build Blueprint doc, researched 30 Sep to 8 Oct 2026.
