<div align="center">

# 🌱 agrisim: soil-moisture survey simulator

**A rover drives the lanes of a tomato field without touching a plant, probes the soil, and maps where the field is too dry.**

[![CI](https://github.com/Auenchanters/SMC/actions/workflows/ci.yml/badge.svg)](https://github.com/Auenchanters/SMC/actions/workflows/ci.yml)
[![Python 3.13](https://img.shields.io/badge/Python-3.13-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![Windows native](https://img.shields.io/badge/Windows-native,_no_WSL-0078D4?logo=windows&logoColor=white)](#quickstart)
[![tests](https://img.shields.io/badge/tests-92_passing-3FB950)](tests/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-1.3-0081A5)](https://gymnasium.farama.org/)
[![Rerun](https://img.shields.io/badge/Rerun-0.39-6E40C9)](https://rerun.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A pure-Python simulator of a planted tomato field. A small differential-drive rover follows the lanes between plant rows, stops to push a moisture probe into the soil, and turns a few dozen noisy readings into a **full-field moisture map plus an uncertainty map**. The same world is a **Gymnasium environment**, so you can train a rover to decide *where* to probe and compare it honestly with simple strategies.

> **On 50 held-out fields with 30 probes each: zero plant contacts in all 250 runs, and the kriged map beats a field-average map on 248 of 250. The trained RL policy did *not* beat the simple baselines, and we say so.**

![A full-coverage survey: the rover (red) drives every lane, each probe updates the map, the hidden truth is on the right](docs/img/survey.gif)

<sub>Real simulator output, seed 7. Higher-quality video: [docs/media/survey.mp4](docs/media/survey.mp4). Soil parameters are placeholders until calibrated.</sub>

**Demo video (3 min 9 s):** [docs/media/agrisim-demo.mp4](docs/media/agrisim-demo.mp4) shows the CLI, a run's outputs, the Rerun viewer, the 3D replay and the rover hardware figures.

</div>

---

## Table of contents

- [Why this exists](#why-this-exists)
- [Results](#results)
- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Screenshots](#screenshots)
- [Quickstart](#quickstart)
- [What a run produces](#what-a-run-produces)
- [Testing](#testing)
- [Regenerating the images and video](#regenerating-the-images-and-video)
- [Optional: NVIDIA GPU](#optional-nvidia-gpu)
- [Project structure](#project-structure)
- [Limitations and honest notes](#limitations-and-honest-notes)
- [Roadmap](#roadmap)
- [Handover](#handover)
- [License](#license)

---

## Why this exists

Farmers usually water a whole field the same way, and dry patches show up only once the plants suffer. A soil-moisture survey fixes that, but a probe reads one spot at a time and each insertion takes about 10 seconds. The questions this project answers in simulation, before any hardware is bought:

1. **Can a small rover cover a planted field without touching a single plant?** It may only drive the lanes between rows and turn in the headlands at the field edges.
2. **How few probes are enough to map the whole field, and how sure is the map?** Every map comes with its own uncertainty.
3. **Does choosing probe spots adaptively (or with reinforcement learning) beat a plain evenly-spaced survey?** It has to be tested on the same fields and with the same probe budget.

This is **Layer A** of the AgriRover project (MSRIT, first-year AI & DS team): pure Python, no ROS and no 3D engine, so it runs headless on any laptop. The idea of a scouting rover is not new (see [context.md §4](context.md)); the value here is doing these three things carefully and reporting them honestly.

## Results

All numbers below come from `agrisim eval` (held-out fields, seeds 100-149, budget 30 probes) and `agrisim bench` (seeds 0-49). Transcripts are in [EXECPLAN.md, *Artifacts and Notes*](EXECPLAN.md#artifacts-and-notes).

![Held-out results: RMSE, distance driven, and dry-zone F1 per strategy with 95% intervals](docs/img/results.png)

| Strategy | Map error (RMSE, VWC) | R² | Dry-zone F1 | Distance | Mission time | Plant contacts |
|---|---|---|---|---|---|---|
| **greedy_variance** | **0.0333 ± 0.0019** | **0.55** | **0.33** | 775 m | 33 min | 0 |
| fixed_spacing (full coverage) | 0.0338 ± 0.0018 | 0.54 | 0.24 | 466 m | 23 min | 0 |
| random | 0.0354 ± 0.0019 | 0.50 | 0.25 | 733 m | 33 min | 0 |
| ppo (MaskablePPO, 200k steps) | 0.0357 ± 0.0020 | 0.49 | 0.27 | 689 m | 31 min | 0 |
| greedy_variance_per_cost | 0.0364 ± 0.0023 | 0.46 | 0.28 | **149 m** | **11 min** | 0 |

<sub>Mean ± 95% Student-t interval over 50 held-out fields. A single field-average value would score RMSE ≈ 0.052 with the same readings. Dry-zone F1 is undefined on fields where a map predicts no dry cell (8 to 17 fields per strategy); those are left out of its mean.</sub>

**What this means:**

- **Safety holds.** No strategy ever touched a plant: 250 held-out runs plus 200 bench runs, all with zero contacts.
- **The map is honest about its uncertainty.** About 96% of cells fall inside the map's own 95% band (target 95%).
- **The simple survey is hard to beat.** Even spacing and greedy "probe where the map is least sure" are statistically tied on map error. Greedy finds dry zones best, but drives 66% further.
- **Cheap but rougher.** Variance-per-cost finishes in less than half the time and is about 8% worse on map error.
- **RL did not win yet.** The first learned policy behaves close to random. Likely causes are listed in the [ExecPlan](EXECPLAN.md#surprises--discoveries).

### Weather and going back to check

The soil can now change during a mission. Rain soaks in (more in some spots than others), and sun and plants dry it out. The probe also sometimes misreads, because of poor soil contact. Two strategies let the robot go back to a spot it doubts: `recheck` (it chooses freely between new spots and doubted ones) and `fixed_plus_recheck` (the full route, then a few rechecks). The robot knows how much it rained, from its rain gauge, and corrects its older readings for it. It does not know how much soaked in at each spot.

Scenario `configs/scenarios/rain_shower.yaml` (a 10-minute downpour 10 minutes in, 1 misread in 20), 30 fields, budget 60:

| Strategy | Map error (RMSE) | Distance | Mission time |
|---|---|---|---|
| recheck | 0.0276 ± 0.0020 | 1501 m | 65 min |
| greedy_variance | 0.0280 ± 0.0016 | 1502 m | 66 min |
| fixed_plus_recheck | 0.0300 ± 0.0014 | 728 m | 37 min |
| fixed_spacing | 0.0308 ± 0.0012 | 466 m | 28 min |

Going back helps a little, by 2 to 3% on the same fields, and it does so on 18 of 30. That is not conclusive. With only 30 probes it does not help: a new spot is worth more than a second look. Details are in the [ExecPlan](EXECPLAN.md#outcomes--retrospective).

```powershell
uv run agrisim run --config configs/scenarios/rain_shower.yaml --seed 7 --policy fixed_plus_recheck --view
```

## How it works

Per mission, from one config file and one integer seed:

1. **Build a field.** Rows, plants with random canopy sizes and gaps, lanes, headlands ([field.py](src/agrisim/field.py)). Config validation refuses a rover that would not fit in a lane or could not turn in the headland, and the error message states the numbers.
2. **Hide a believable moisture field.** A spatially correlated Gaussian random field made with FFT, with wetter drip-line stripes along the rows plus random dry patches (a clogged emitter) and wet patches (a leak) ([soil.py](src/agrisim/soil.py)). Only the probe, the metrics and the RL reward may read it. With a `weather:` section it changes during the mission: rain soaks in unevenly, while sun and plants dry it ([weather.py](src/agrisim/weather.py)).
3. **Choose where to probe.** Fixed spacing, random, greedy max-variance, variance per travel cost, recheck (also goes back to readings it doubts), or a trained PPO policy ([policies.py](src/agrisim/policies.py)).
4. **Drive there safely.** Paths use only lane and headland centrelines ([planning.py](src/agrisim/planning.py)). The rover turns in place in headlands, follows lanes with pure pursuit, and **reverses** instead of making a U-turn inside a lane ([control.py](src/agrisim/control.py)). Every pose is checked against every nearby canopy ([safety.py](src/agrisim/safety.py)).
5. **Probe.** The reading is the footprint average plus bias, Gaussian noise and quantisation, and probes sometimes fail ([sensor.py](src/agrisim/sensor.py)).
6. **Map.** Ordinary kriging with a fitted variogram gives a mean map and a variance map. With too few readings it falls back to the field average; it never crashes ([mapping.py](src/agrisim/mapping.py)).
7. **Score.** RMSE, MAE, R², dry-cell precision/recall/F1, uncertainty calibration, distance, time, lane coverage and plant contacts ([metrics.py](src/agrisim/metrics.py)).

The same config and seed always give a byte-identical `metrics.json`.

## Architecture

![agrisim architecture](docs/img/architecture.svg)

Everything is driven by one YAML file ([configs/demo.yaml](configs/demo.yaml)). Every physical number in it is marked `# PLACEHOLDER: calibrate`. Scenarios in [configs/scenarios/](configs/scenarios/) start from it with `extends:` and change only what differs, for example adding a rain shower.

## 3D replay

Add `--view` to any run to replay it in 3D in your browser: the rover (built from the hardware design's dimensions) drives between staked tomato rows, parks, and pushes its probe into the soil. Every reading leaves a coloured mark and the moisture map fills in on the ground. A panel says in plain words what is happening, and buttons switch the ground colour between the robot's map, the real moisture, the map error and the uncertainty. It works offline (three.js is bundled) and needs no install beyond `uv sync`.

```powershell
uv run agrisim run --config configs/demo.yaml --seed 7 --view
```

| | |
|:---:|:---:|
| ![3D replay, following the robot](docs/img/viewer3d.jpg) **Following the robot.** It has parked and is pushing the probe into the soil. | ![3D replay, whole field](docs/img/viewer3d-field.jpg) **The whole field.** Orange = too dry, blue = wet; each round mark is a reading. |

Reopen a run later with `uv run agrisim view runs\<folder>`. Press `?` in the page for a guide.

## Screenshots

| | |
|:---:|:---:|
| ![Strategies on one field](docs/img/strategies.png) **Same field, same budget.** Where each strategy drives (blue) and probes (black). | ![Maps](docs/img/maps.png) **One run's output.** Truth, estimate, absolute error and kriging variance, all on fixed colour scales. |

![Final frame of the survey](docs/img/hero.png)

**Live view:** `--rerun` opens the [Rerun](https://rerun.io/) viewer. It shows the field, the moving rover, probes coloured by reading, the four maps updating after each probe, and the average map error over time. A "How to read this" panel explains each view. Drag the time bar to replay a mission.

## Quickstart

Windows PowerShell (Linux and macOS use the same commands). You need [uv](https://docs.astral.sh/uv/) and git. You do not need WSL, Docker or a compiler.

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
git clone git@github.com:Auenchanters/SMC.git
cd SMC
uv sync
git config core.hooksPath .githooks
```

`uv sync` installs Python 3.13 and every pinned dependency into `.venv`. The last line turns on the repository's git hooks (see [CLAUDE.md](CLAUDE.md)).

**1. One survey** (add `--view` for the 3D replay, or `--rerun` for the Rerun viewer):

```powershell
uv run agrisim run --config configs/demo.yaml --seed 7
```

```text
run folder     runs\20261013T173847Z_seed7
policy         fixed_spacing
RMSE / MAE     0.0299 / 0.0230 m3/m3   R2 0.677
dry cells      precision 0.870  recall 0.116  F1 0.205  (truth dry fraction 0.072)
calibration95  0.979
probes         59 valid / 60 used
path / time    465.7 m / 1685 s
lane coverage  1.000
plant contacts 0
```

Other options: `--policy random|greedy_variance|greedy_variance_per_cost`, `--budget 30`, or the shipped learned policy with `--policy ppo --model models/ppo_v1/model.zip`.

**2. Compare strategies** on 50 random fields with the same probe budget (about 40 s with 4 workers):

```powershell
uv run agrisim bench --config configs/demo.yaml --seeds 0-49 --budget 30 --workers 4
```

**3. Train and evaluate a learned policy.** Training takes about 25 min on a 16-thread laptop CPU. Evaluation runs every baseline on the same 50 held-out fields:

```powershell
uv run agrisim train --config configs/demo.yaml --timesteps 200000 --seed 0 --n-envs 6 --out runs/ppo_v1
uv run agrisim eval --model runs/ppo_v1/model.zip --config configs/demo.yaml --seeds 100-149 --budget 30 --workers 6
```

The model behind the results table ships in [models/ppo_v1/](models/ppo_v1/), so you can run `eval` without training first.

Training draws field seeds of 1000 and above, and `eval` refuses seeds of 1000 or more, so evaluation fields are always unseen.

There is also a ready-made demo: [scripts/demo.ps1](scripts/demo.ps1) (Windows) or [scripts/demo.sh](scripts/demo.sh).

## What a run produces

Each run writes a new folder `runs/<UTC time>_seed<seed>/`, for example `runs/20261013T173847Z_seed7/`. The name has no `:`, so it is valid on Windows, and earlier runs are never overwritten.

| File | Contents |
|---|---|
| `config.yaml` | The exact configuration used |
| `metrics.json` | Every metric below, plus the hidden field's correlation length and its dry and wet patches |
| `truth.npy` / `estimate.npy` / `variance.npy` | Truth, estimate and kriging variance on the 0.5 m output grid (rows = y, columns = x) |
| `probes.csv` | Every probe: time, position, reading, whether it worked |
| `path.csv` | The rover pose every 0.05 s |
| `maps.png` | Truth, estimate, error and variance with fixed colour scales |
| `recording.rrd` | Rerun recording (only with `--rerun`); reopen it with `uv run rerun <file>` |
| `scene.json` | Data for the 3D replay (only with `--view`); reopen it with `uv run agrisim view <folder>` |

`bench` and `eval` write `runs/bench_<time>/` or `runs/eval_<time>/` with `results.csv` (one row per strategy and seed) and `summary.md` (mean and 95% interval per strategy).

<details>
<summary><b>What every metric means</b></summary>

Soil moisture is volumetric water content (VWC): cubic metres of water per cubic metre of soil, so 0.25 means 25%.

| Metric | Meaning | Better |
|---|---|---|
| `rmse`, `mae` | Typical error of the map over every 0.5 m cell (root-mean-square and mean absolute) | Lower |
| `r2` | Share of the field's moisture variation the map explains (1 = perfect, 0 = no better than one average) | Higher |
| `dry_precision` | Of the cells the map calls dry (below `dry_threshold`), the fraction that really are. Empty if the map calls nothing dry | Higher |
| `dry_recall` | Of the truly dry cells, the fraction the map found | Higher |
| `dry_f1` | The balance of the two above | Higher |
| `calibration_95` | Fraction of cells whose truth lies inside the map's own 95% band | ≈ 0.95 |
| `rmse_global_mean`, `rmse_idw` | (bench) Error if the same readings were mapped by one average or by inverse-distance weighting | Comparison |
| `probes_used`, `valid_probes` | Probes taken, and how many returned a value (probes can fail) | |
| `path_length_m`, `mission_time_s` | Distance driven; total time including 10 s per probe insertion | Lower |
| `lane_coverage` | Fraction of all lane length driven | 1.0 for a full survey |
| `plant_contacts` | Times the rover body overlapped a canopy | **Must be 0** |

</details>

## Testing

```powershell
uv run ruff check .
uv run ruff format --check .
uv run mypy src
uv run pytest -q
.\scripts\check_licenses.ps1
```

There are 92 tests, about 50 to 140 s, with no network needed. They cover:

- geometry validation;
- field determinism;
- the soil generator's correlation structure, checked against the exponential covariance;
- probe bias, noise and failure rates;
- **zero plant contacts over a full survey on 20 random fields**;
- shortest paths that never cross a row;
- in-lane reversing;
- kriging beating the field average;
- hand-checked dry-cell metrics;
- byte-identical repeat runs;
- the Rerun recording;
- serial and parallel bench giving identical results;
- clean CLI errors for bad configs and policies;
- Gymnasium's `check_env`;
- an end-to-end train-and-eval smoke test.

`mypy` runs in strict mode. The licence gate fails on any GPL, AGPL or LGPL package. CI runs all of this on **windows-latest and ubuntu-latest** on every push.

## Regenerating the images and video

Everything in [docs/img](docs/img) and [docs/media](docs/media) is real simulator output, made by one script:

```powershell
uv run python scripts/make_media.py --model runs/ppo_v1/model.zip
```

It re-runs seed 7 and writes `survey.gif`, `survey.mp4` (needs `ffmpeg` on PATH), `hero.png`, `maps.png` and `strategies.png`. It draws `results.png` from the newest `runs/eval_*/results.csv`, or pass `--results <file>`. Without `--model`, the PPO panel is skipped. It takes about 8 minutes, mostly frame rendering. [architecture.svg](docs/img/architecture.svg) is edited by hand.

## Optional: NVIDIA GPU

You don't need a GPU. The default PyTorch is the CPU build and the models are small; NVIDIA's CUDA libraries are free but not open source, so the CPU build is the fully open path. To try the RTX 3050 anyway (torch 2.14.1 publishes Windows CUDA 12.6 and 13.0 builds):

```powershell
uv pip install --reinstall torch==2.14.1 --index-url https://download.pytorch.org/whl/cu126
uv run --no-sync python -c "import torch; print(torch.cuda.is_available())"
```

After that, use `uv run --no-sync ...`, because a plain `uv run` or `uv sync` restores the CPU build. Also note that `agrisim train` pins `device="cpu"` in [env.py](src/agrisim/env.py). *Not yet verified on the team laptop.*

## Project structure

```
src/agrisim/
  config.py     pydantic models + geometry validation, load(path)
  field.py      rows, plants, lanes, headlands, candidate probe sites
  soil.py       hidden truth: FFT Gaussian random field + drip stripes + dry/wet patches
  sensor.py     moisture probe: footprint mean, bias, noise, quantisation, failures
  rover.py      differential-drive kinematics, footprint
  planning.py   boustrophedon full-coverage planner, closed-form lane graph
  control.py    turn-in-place + pure pursuit, reverse along lanes
  safety.py     rectangle-vs-canopy contact test (KD-tree, vectorised)
  mapping.py    Mapper protocol: GlobalMean, IDW, Kriging (PyKrige)
  metrics.py    map and run metrics (may read the truth)
  policies.py   fixed, random, greedy variance, variance per cost
  sim.py        run_survey(): drive, probe, map, score
  env.py        Gymnasium env, MaskablePPO training, learned policy
  bench.py      multi-seed benchmark, 95% intervals, Markdown summary
  viz.py        Rerun logging
  view3d.py     3D replay: scene.json and a local web server
  viewer3d/     the 3D replay page (three.js 0.186.1 bundled, MIT)
  io.py         Windows-safe run folders and outputs
  cli.py        agrisim run | bench | train | eval | view
configs/demo.yaml   all placeholder numbers, marked "PLACEHOLDER: calibrate"
scripts/            demo.ps1 / demo.sh, check_licenses.ps1 / .sh, make_media.py, demo_video/
tests/              pytest suite
docs/img, docs/media  README images and video
models/ppo_v1/      trained MaskablePPO policy + its held-out evaluation
hardware/rover-v2/  rover hardware design: model, calculations, drawings, BOM (v1, superseded, in rover-v1/)
```

The planning documents are [context.md](context.md) (verified research, licence and platform rules; the source of truth), [EXECPLAN.md](EXECPLAN.md) (the milestone plan with every decision, surprise and result) and [CLAUDE.md](CLAUDE.md) (rules for the coding agent).

## Limitations and honest notes

- **Every soil and probe number is a placeholder.** Moisture levels, noise, patch sizes, row spacing and the "dry" threshold are not yet calibrated to a real field or probe. The results compare strategies *inside the simulator*; they are not field accuracy.
- **Kriging smooths away small dry patches.** On 8 to 17 of every 50 fields, the map calls no cell dry at all.
- **The first RL policy does not beat the baselines.** Likely fixes are a fully convolutional action head and longer training. These are untested.
- **The RL environment abstracts driving** as lane-graph distance divided by speed. Evaluation, however, runs the policy through the full kinematic simulation, under the same conditions as every baseline.
- **Weather is simple.** It is a single-layer water balance with rain, evapotranspiration and drainage. There is no irrigation yet, and the robot's own weather model is nearly perfect, which flatters it. Without a `weather:` section, the soil does not change during a mission.

## Roadmap

- **A test bench for field robots.** The long-term aim is a "wind tunnel" for farm robots: many fields, crops and weather scenarios to test a robot against before it goes outside. The staged plan is in the [ExecPlan roadmap](EXECPLAN.md#roadmap-toward-a-test-bench-for-field-robots). It starts with calibrating against one real tomato field, because a test bench is only as good as its match to reality.
- **Calibrate.** Agronomist input for tomato dry thresholds, real row and plant spacing, the chosen probe's accuracy and insertion time ([context.md §12](context.md)).
- **Better learned policy.** A per-cell (fully convolutional) action head and longer training, compared on the same held-out seeds.
- **Phase 2.** A Gazebo Jetty and ROS 2 Lyrical world (in WSL2) that calls this package for probe readings, so soil logic lives in one place.
- **Phase 3 and later.** Cameras and disease detection evaluated on real, expert-labelled field images; then the physical rover. Its current design, [hardware/rover-v2/](hardware/rover-v2/DESIGN.md), was laid out from the physics: an open probe bay between the axles (the only place the whole weight resists the push), a rocker-differential chassis with 150 mm clearance, a LiFePO4 battery with a designed BMS, and probe cleaning that escalates on its own and never needs a person. The first design is kept in [hardware/rover-v1/](hardware/rover-v1/).

## Handover

Taking the project over? Start with [HANDOVER.md](HANDOVER.md). It has a step-by-step test plan, the expected results, and the known open items.

## License

[MIT](LICENSE) © 2026 Auenchanters
