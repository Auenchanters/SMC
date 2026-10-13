# agrisim

A pure-Python simulator of a planted tomato field. A small rover drives the lanes between plant rows without touching any plant, stops to push a moisture probe into the soil, and builds a moisture map of the whole field plus a map of how uncertain that estimate is. It also has a Gymnasium environment for training a rover to choose where to probe.

This is "Layer A" of the AgriRover project: no ROS, no 3D engine. Background and design are in [context.md](context.md); the build plan and its results are in [EXECPLAN.md](EXECPLAN.md).

> **All soil and probe numbers are placeholders.** Soil moisture levels, noise, dry-patch sizes, row spacing and the "dry" threshold in `configs/demo.yaml` are not yet calibrated against a real field or a real probe. Use the results to compare strategies inside the simulator. Do not present them as field accuracy.

## Install (Windows, PowerShell)

You need [uv](https://docs.astral.sh/uv/) and git. Nothing else: no WSL, Docker or compiler.

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

Then, in the repository folder:

```powershell
uv sync
git config core.hooksPath .githooks
```

`uv sync` installs Python 3.13 and every pinned dependency into `.venv`. The second command turns on the repository's git hooks (see [CLAUDE.md](CLAUDE.md)). The same commands work on Linux and macOS.

## The commands

Run one survey with seed 7 and watch it live in the Rerun viewer:

```powershell
uv run agrisim run --config configs/demo.yaml --seed 7 --rerun
```

Leave out `--rerun` to run without a window. Add `--policy greedy_variance` (or `random`, `greedy_variance_per_cost`) to try another probing strategy, and `--budget 30` to change the number of probes.

Compare all probing strategies over 50 random fields with the same probe budget:

```powershell
uv run agrisim bench --config configs/demo.yaml --seeds 0-49 --budget 30 --workers 4
```

Train a learned probing policy, then evaluate it next to every baseline on 50 fields it never saw:

```powershell
uv run agrisim train --config configs/demo.yaml --timesteps 200000 --seed 0 --n-envs 6 --out runs/ppo_v1
uv run agrisim eval --model runs/ppo_v1/model.zip --config configs/demo.yaml --seeds 100-149 --budget 30
```

Training uses field seeds 1000 and above; `eval` refuses seeds of 1000 or more, so evaluation fields are always held out.

A ready-made demo: `scripts/demo.ps1` (Windows) or `scripts/demo.sh` (Linux/macOS).

## What a run produces

Each run writes a new folder `runs/<UTC time>_seed<seed>/` (for example `runs/20261013T173847Z_seed7/`). Earlier runs are never overwritten.

| File | Contents |
|---|---|
| `config.yaml` | The exact configuration used |
| `metrics.json` | All metrics below, plus the hidden soil field's correlation length and dry/wet patches |
| `truth.npy` | The hidden true moisture map on the output grid (0.5 m cells; rows = y, columns = x) |
| `estimate.npy` | The reconstructed moisture map |
| `variance.npy` | The uncertainty of the estimate (kriging variance, (m³/m³)²) |
| `probes.csv` | Every probe: time, position, reading, whether it worked |
| `path.csv` | The rover's pose every 0.05 s |
| `maps.png` | Truth, estimate, absolute error and variance side by side, with fixed colour scales |
| `recording.rrd` | The Rerun recording (only with `--rerun`); reopen with `uv run rerun runs/<folder>/recording.rrd` |

In the Rerun viewer, scrub the `sim_time` timeline to replay the mission: the field outline, headlands, lanes, plant canopies (green), the rover (red box) and its trail, probe points coloured by reading (red = failed probe), the four maps updating after each probe, and the map error (RMSE) over time.

`bench` and `eval` write `runs/bench_<time>/` or `runs/eval_<time>/` with `results.csv` (one row per strategy and seed) and `summary.md` (mean and 95% interval per strategy).

## What the metrics mean

Soil moisture is volumetric water content (VWC): cubic metres of water per cubic metre of soil, so 0.25 means 25%.

| Metric | Meaning | Better |
|---|---|---|
| `rmse`, `mae` | Typical error of the moisture map in VWC, over every 0.5 m cell (root-mean-square and mean absolute) | Lower |
| `r2` | Share of the field's moisture variation the map explains (1 = perfect, 0 = no better than one average value) | Higher |
| `dry_precision` | Of the cells the map calls dry (below `dry_threshold`), the fraction that really are dry. Empty when the map calls nothing dry | Higher |
| `dry_recall` | Of the truly dry cells, the fraction the map found | Higher |
| `dry_f1` | Balance of the two above | Higher |
| `calibration_95` | Fraction of cells where the truth falls inside the map's own 95% uncertainty band. About 0.95 means the uncertainty map is honest | Close to 0.95 |
| `rmse_global_mean`, `rmse_idw` | (bench only) Map error if the same readings were turned into a map by a single average, or by inverse-distance weighting, instead of kriging | For comparison |
| `probes_used`, `valid_probes` | Probes taken, and how many returned a reading (probes can fail) | |
| `path_length_m`, `mission_time_s` | Distance driven and total time including probe insertions | Lower |
| `lane_coverage` | Fraction of all lane length the rover drove | 1.0 for a full survey |
| `plant_contacts` | Times the rover's body overlapped a plant canopy | Must be 0 |

## Probing strategies

- `fixed_spacing`: drive every lane end to end (back and forth), probing at evenly spread stops. This is the full-coverage survey.
- `random`: probe random spots in the lanes.
- `greedy_variance`: always probe where the map is currently most uncertain.
- `greedy_variance_per_cost`: the same, but divide uncertainty by the time it takes to get there.
- `ppo`: a learned policy from `agrisim train` (MaskablePPO).

The adaptive strategies drive between spots along lanes and headlands only. They reverse along a lane instead of turning around inside it, because turning on the spot in a lane would brush the plants.

Results so far (50 fields, 30 probes each) are in EXECPLAN.md under "Artifacts and Notes". The short version: on this placeholder field, plain fixed spacing gives the lowest map error. Greedy max-variance matches it and finds dry patches better, but drives about 70% further. Variance-per-cost is the cheapest mission but less accurate. The first trained PPO policy (200k steps) did not beat these baselines on held-out fields; it behaves close to random.

## Optional: train on the NVIDIA GPU

Not needed: the default PyTorch install is the CPU build and the models are small. NVIDIA's CUDA libraries are free but not open source, so the CPU build is the fully open path.

To try the GPU on Windows, replace torch inside `.venv` with a CUDA build from the official PyTorch index (CUDA 12.6 works with older drivers; `cu130` is also published):

```powershell
uv pip install --reinstall torch==2.14.1 --index-url https://download.pytorch.org/whl/cu126
uv run --no-sync python -c "import torch; print(torch.cuda.is_available())"
```

Use `uv run --no-sync ...` afterwards; a plain `uv run` or `uv sync` puts the CPU build back. Note that `agrisim train` currently pins training to the CPU (`device="cpu"`), because the small CNN trains about as fast there; changing that is a one-line edit in `src/agrisim/env.py`.

## Developer checks

A task is done when all of these pass:

```powershell
uv run ruff check .
uv run ruff format --check .
uv run mypy src
uv run pytest -q
.\scripts\check_licenses.ps1
```

The last one fails if any installed package is GPL, AGPL or LGPL. CI runs the same checks on Windows and Ubuntu.

## Layout

```
src/agrisim/   config, field, soil, sensor, rover, planning, control, safety,
               mapping, metrics, policies, sim, env, bench, viz, io, cli
configs/       demo.yaml (placeholder numbers marked "PLACEHOLDER: calibrate")
tests/         pytest suite
scripts/       demo and licence-check scripts (.ps1 and .sh)
runs/          outputs (not committed)
```
