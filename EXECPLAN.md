# Build agrisim: a soil-moisture survey simulator for a tomato-field rover

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds. It follows the ExecPlan conventions described in OpenAI's PLANS.md. Read `context.md` and `CLAUDE.md` first; this plan assumes both are in the repository root. The primary target platform is Windows (x86-64); every milestone must pass on Windows.

## Purpose / Big Picture

After this work, a team member can run one command and watch a small rover drive every lane of a simulated tomato field without touching a plant, stop to probe the soil, and build a full-field moisture map with an uncertainty map. The run prints how accurate the map is against the hidden truth (error, dry-zone detection, probes used, path length, plant contacts) and saves everything to a run folder. A second command benchmarks many random fields and compares probing strategies. A third trains an adaptive probing policy in a Gymnasium environment and compares it honestly against simple baselines. This is "Layer A" of the project: pure Python, no ROS, no 3D engine. The 3D Gazebo world is a later, separate plan.

Observable outcome:

    uv run agrisim run --config configs/demo.yaml --seed 7 --rerun

opens a Rerun viewer showing the field, plants, lanes, the moving rover, probe points coloured by reading, and side-by-side truth, estimate, error and uncertainty grids. It writes `runs/<timestamp>_seed7/` with metrics and figures.

## Progress

- [x] M0 Repository scaffold, tooling and CI. (2026-10-13) uv project, pinned deps, ruff/mypy/pytest config, CI matrix, licence gate, git hooks blocking Claude attribution.
- [x] M1 Configuration models and field layout. (2026-10-13)
- [x] M2 Ground-truth soil-moisture generator. (2026-10-13)
- [x] M3 Moisture probe sensor model. (2026-10-13)
- [ ] M4 Rover kinematics, lane planner, path follower and plant-contact safety.
- [ ] M5 Mapping (kriging) and metrics.
- [ ] M6 Simulation runner, CLI, run outputs and Rerun visualisation.
- [ ] M7 Benchmark harness and baseline probing strategies.
- [ ] M8 Gymnasium environment, MaskablePPO training and evaluation.
- [ ] M9 Team-facing README and demo script.

## Surprises & Discoveries

(Record unexpected behaviour, library quirks, version issues and evidence here as you go.)

- M0: Newer releases exist than context.md lists: rerun-sdk 0.39.0 (12 Oct 2026; context said 0.37.x), gymnasium 1.4.0 (5 Oct 2026), torch 2.14.1. See Decision Log for what was pinned.
- M0: The PyPI `torch` wheel on Windows is a CPU build (`torch.__version__ == "2.14.1+cpu"`, `torch.version.cuda is None`). Linux resolves torch from the PyTorch CPU index via `[tool.uv.sources]`, so no `nvidia-*` wheels enter the lockfile.
- M0: rerun-sdk pulls pyarrow (Apache-2.0), pillow (MIT-CMU), psutil (BSD-3), attrs (MIT). Pillow's MIT-CMU is a permissive HPND/MIT-family licence, not on the CLAUDE.md list by name.
- M0: mypy 2.4.0 (dev only) pulls `pathspec` 1.1.1, licensed MPL-2.0 (file-level weak copyleft). It is not GPL/AGPL/LGPL, so the gate passes, but it is outside the CLAUDE.md permitted list. It is a dev tool, never shipped or modified. Flagged for the team.
- M0: pip-licenses `--fail-on` with `--partial-match` needs both "GPL" and "General Public License" because the AGPL trove classifier ("GNU Affero General Public License v3") does not contain the substring "GPL". Negative control: `--fail-on "Mozilla"` correctly fails on pathspec.
- M0: All 64 locked packages have a `win_amd64` cp313/abi3 wheel or a pure-Python wheel (checked by parsing uv.lock); nothing builds from source.
- M1: Shapely has no inline type hints; mypy strict needs `types-shapely` (typeshed, Apache-2.0). Its latest is 2.1.0.20260728 while shapely is 2.2.0; no mismatch hit so far.
- M2: `shapely.union_all` of ~900 canopy discs takes 0.1 to 0.26 s per layout and dominated test time (28 s suite). `FieldLayout.free_space` is now a lazy `cached_property`; nothing in the simulation loop needs it. Suite now ~2 s.
- M2: The probe footprint (r = 0.05 m) is smaller than a soil cell (0.25 m), so averaging cell centres inside the disc would find none. `mean_over_disc` instead averages the bilinear field over a sunflower point pattern (16 points minimum, more as r/resolution grows).
- M2: Measured lag-1 m correlation along x for a 4 m exponential field matches exp(-1/4) within 0.08 (averaged over 20 seeds), so the FFT generator reproduces the configured covariance.
- M3: Nothing unexpected. The probe draws both the failure coin and the noise sample on every read, so a failure does not shift the random stream for later reads.

## Decision Log

- Decision: Layer A is pure Python with no ROS dependency. Rationale: fast iteration, headless training, runs on every team laptop; soil logic must live in one place that the later Gazebo layer calls. Date: 2026-10-13.
- Decision: Our own FFT Gaussian-random-field generator instead of GSTools. Rationale: GSTools is LGPL-3.0; the team's rule forbids copyleft dependencies when a permissive option exists. Date: 2026-10-13.
- Decision: PyKrige (BSD-3) for kriging. Date: 2026-10-13.
- Decision: Our own lane planner; Fields2Cover is not used in Phase 1. Rationale: Fields2Cover 2.1.0 installs from source and needs GDAL, GEOS, Eigen, Boost and OR-Tools, which is impractical on Windows; a planted tomato plot has regular rows, so a boustrophedon lane planner is sufficient. Date: 2026-10-13.
- Decision: Windows is the primary platform; CI runs on windows-latest and ubuntu-latest. Documented commands must work in Windows PowerShell 5.1 (no `&&`). Date: 2026-10-13.
- Decision: PyTorch CPU build by default; CUDA build optional through the PyTorch package index. Rationale: the probing models are small; PyPI Windows wheels are CPU builds. Date: 2026-10-13.
- Decision: Implementation agent is Claude Code; durable instructions live in CLAUDE.md. Date: 2026-10-13.
- Decision: Python 3.13. Rationale: Stable-Baselines3 2.8+ officially supports 3.13; Gymnasium 1.3 supports up to 3.14. Date: 2026-10-13.
- Decision: Pin exact versions of every dependency, especially rerun-sdk, whose minor releases contain breaking changes. Check PyPI for the latest stable release of each package at the time of M0 and record the chosen versions here. Date: 2026-10-13.
- Decision (M0): Pinned versions, checked on PyPI 2026-10-13. Every one has a win_amd64 cp313 (or abi3) wheel or is pure Python. Licence from package metadata.

  | Package | Pin | Windows wheel | Licence |
  |---|---|---|---|
  | numpy | 2.5.4 | cp313 win_amd64 | BSD-3-Clause (+0BSD, MIT, Zlib, CC0 bundled parts) |
  | scipy | 1.18.1 | cp313 win_amd64 | BSD-3-Clause |
  | shapely | 2.2.0 | cp313 win_amd64 | BSD-3-Clause (bundles GEOS, LGPL, unmodified: documented exception) |
  | pydantic / pydantic-core | 2.14.1 / 2.50.1 | pure / cp313 win_amd64 | MIT |
  | pyyaml | 6.0.3 | cp313 win_amd64 | MIT |
  | pykrige | 1.7.3 | cp313 win_amd64 | BSD-3-Clause |
  | rerun-sdk | 0.39.0 | cp310-abi3 win_amd64 | MIT OR Apache-2.0 |
  | gymnasium | 1.3.0 | pure | MIT |
  | stable-baselines3 | 2.9.0 | pure | MIT |
  | sb3-contrib | 2.9.0 | pure | MIT |
  | torch | 2.14.1 (CPU) | cp313 win_amd64 | BSD-3 / Apache-2.0 / MIT family (metadata: Apache-2.0 AND BSD-2/3-Clause AND BSL-1.0 AND MIT) |
  | typer | 0.27.3 | pure | MIT |
  | matplotlib | 3.11.2 | cp313 win_amd64 | PSF-based (Matplotlib licence) |
  | dev: pytest | 9.1.1 | pure | MIT |
  | dev: ruff | 0.17.0 | py3 win_amd64 | MIT |
  | dev: mypy | 2.4.0 | cp313 win_amd64 | MIT |
  | dev: pip-licenses | 5.5.5 | pure | MIT |
  | dev: types-pyyaml | 6.0.12.20260906 | pure | Apache-2.0 |
  | dev: scipy-stubs | 1.18.1.1 | pure | BSD-3-Clause |
  | build: uv_build | >=0.12.18,<0.13 | n/a | MIT / Apache-2.0 |

  Transitive packages (full list via `uv run pip-licenses`): all MIT, BSD, Apache-2.0, ISC or PSF, except pillow (MIT-CMU, permissive) and pathspec (MPL-2.0, dev-only via mypy). No GPL/AGPL/LGPL. Date: 2026-10-13.
- Decision (M0): gymnasium pinned to 1.3.0, not the newer 1.4.0. Rationale: CLAUDE.md specifies 1.3.x, and stable-baselines3 2.9.0 (15 Jun 2026) was released and tested before gymnasium 1.4.0 (5 Oct 2026). Revisit when SB3 confirms 1.4 support. Date: 2026-10-13.
- Decision (M0): rerun-sdk pinned to 0.39.0 (latest, released 12 Oct 2026) rather than 0.37.x named in context.md, per the "latest technology" rule. Visualisation code (M6) is written against the installed 0.39.0 API. Date: 2026-10-13.
- Decision (M0): Licence gate is `pip-licenses --partial-match --fail-on "GPL;General Public License"`, run in CI and via `scripts/check_licenses.ps1` / `.sh`. The `agrisim` package itself reports UNKNOWN because the team has not chosen a project licence yet [Q]. Date: 2026-10-13.
- Decision (M0): Git authorship is restricted to the team (see CLAUDE.md); `.githooks/commit-msg` and `.githooks/pre-push` reject Claude/Anthropic attribution. Enable after cloning with `git config core.hooksPath .githooks`. Date: 2026-10-13.
- Decision (M1): Rows are centred in y, with n_rows = floor(width_y / row_spacing) - 1 so the two outer lanes are full lanes inside the field (demo: 15 rows, 16 lanes). Plants run from x = headland to x = length_x - headland; lane centrelines run from x = headland/2 to length_x - headland/2, where the rover turns. Date: 2026-10-13.
- Decision (M1): Added a second geometry check: headland >= 2 * (turn-in-place radius + safety_margin + canopy_radius_max), because the plan turns in place on the headland centreline. Added `wet_patch_radius` and `wet_patch_height` to SoilConfig (the plan lists wet_patch_count only) so wet-patch numbers live in config, not code. Date: 2026-10-13.
- Decision (M2): GRF by FFT circulant embedding on a grid padded by 3 correlation lengths; small negative eigenvalues from truncation are clipped to zero (an approximation), and each realisation is renormalised to zero mean, unit variance. Correlation length is sampled uniformly from `corr_length_range`. Drip stripes are cos^2 in distance to the nearest row (peak on the row, zero at lane centres), only over the planted x span. Dry and wet patches are compact raised-cosine bumps, so "inside the radius" is well defined. Date: 2026-10-13.
- Decision (M3): Probe value = mean over footprint disc + bias + N(0, noise_std), rounded to resolution, clipped to [0, 1]. Failure returns valid=False, value=None. `ProbeReading` is a frozen dataclass with fields x, y, t, value, valid, sensor_id only (test enforces no truth field). Date: 2026-10-13.

## Outcomes & Retrospective

(Fill in at each milestone and at completion: what works, what does not, what was learned, what remains.)

- M0: `uv sync` installs everything on Windows 11 with no compiler. ruff, ruff format, mypy (strict), pytest (4 tests) and the licence gate pass locally. `uv run agrisim version` works. CI workflow written for windows-latest and ubuntu-latest; first CI result pending the first push. Open: project licence for `agrisim` itself not chosen. CI run on the first push: success on windows-latest and ubuntu-latest.
- M1: Config models validate geometry with messages that state the numbers; `FieldLayout.generate` and `candidate_probe_sites` work. 14 tests pass (row count, lane-to-stem clearance over 5 seeds, determinism, keep-out, oversized rover and short headland rejected).
- M2: `SoilTruth.generate` produces a float32 (80, 120) grid for the demo field; tests cover determinism, clip range, correlation ordering (25 m smoother than 4 m), dry-patch effect, bilinear and disc sampling. 19 tests pass.
- M3: `MoistureProbe.read` done. Over 4000 reads the mean error matches the configured bias and the error std matches noise_std within 5%; failure rate matches failure_prob. 22 tests pass.

## Context and Orientation

The repository starts empty except for `context.md`, `CLAUDE.md` and this file. Terms used in this plan:

- **Field**: a rectangle of length `length_x` (along rows) by `width_y` (across rows), in metres. The origin is the south-west corner; x runs along the rows, y across them.
- **Row**: a line of tomato plants parallel to x. Rows are spaced `row_spacing` apart in y.
- **Plant**: a stem position plus a canopy modelled as a circle of radius `canopy_radius` (randomised per plant within a configured range). The rover must never overlap a canopy circle (a "plant contact").
- **Lane**: the free strip between two adjacent rows, plus the outer strips beyond the first and last rows. The rover drives along lane centrelines.
- **Headland**: free strips at both ends of the field (x near 0 and x near `length_x`) where the rover turns from one lane into the next.
- **Boustrophedon**: back-and-forth coverage; drive lane 1 east, turn in the headland, drive lane 2 west, and so on.
- **VWC**: volumetric water content, the soil-moisture unit, in m³/m³.
- **Ground truth**: the hidden, simulated real moisture grid. Only the metrics code and the training reward may read it.
- **Kriging**: a geostatistical interpolation method that predicts values between sample points and also returns a prediction variance (uncertainty). Implemented with PyKrige.
- **Variogram range / correlation length**: the distance over which moisture values remain correlated.
- **Gymnasium**: the standard Python API for reinforcement-learning environments. **MaskablePPO** (sb3-contrib) is PPO that respects an action mask, so the agent never picks invalid actions.
- **Rerun**: a logging and visualisation SDK; code calls `rerun.log(...)` and a viewer shows the data live.

## Plan of Work

### M0 Repository scaffold, tooling and CI
Create a `uv` project named `agrisim` with a `src/` layout, Python 3.13, and a console script `agrisim` pointing to `agrisim.cli:app` (Typer). Add runtime dependencies: numpy, scipy, shapely, pydantic (v2), pyyaml, pykrige, rerun-sdk, gymnasium, stable-baselines3, sb3-contrib, torch, typer, matplotlib. Add dev dependencies: pytest, ruff, mypy. Look up the latest stable release of each on PyPI now, pin exact versions, and record them in the Decision Log along with each licence. Configure ruff (lint and format) and mypy (strict on `src/agrisim`). Add a GitHub Actions workflow running ruff, mypy and pytest on ubuntu-latest and windows-latest. Add `.gitignore` for `runs/`, `.venv/` and caches. Create empty modules listed in Interfaces and Dependencies and one smoke test that imports the package.

Windows specifics for M0:
- Install uv on Windows with its official PowerShell installer (see the uv documentation); do not require WSL, Docker or admin-only tools for Phase 1.
- Before pinning any package, confirm on PyPI that it ships a `win_amd64` wheel for Python 3.13 (or is pure Python). If a package has no Windows wheel, stop and record it in Surprises & Discoveries instead of adding a compiler toolchain.
- PyTorch: depend on the default PyPI `torch`, which is a CPU build on Windows. Document an optional GPU setup in the README that points uv at the official PyTorch CUDA index for Windows, following uv's current PyTorch integration guide. Verify it with `torch.cuda.is_available()` on the RTX 3050 laptop. Never make GPU a requirement. Note: NVIDIA's CUDA libraries and driver are free of charge but proprietary, so the fully open-source path is the CPU build. On Linux CI, install the CPU-only torch build (PyTorch CPU index) so proprietary `nvidia-*` wheels are not pulled in.
- Licence gate: add a script or CI step that runs `pip-licenses` against the installed environment and fails on GPL, AGPL or LGPL packages (check the tool's current flags for this). Record every dependency's licence in the Decision Log.
- Add a `tests/test_windows_paths.py` that checks run-folder names contain no characters invalid on Windows (`<>:"/\|?*`).

### M1 Configuration models and field layout
In `config.py`, define pydantic models: `FieldConfig`, `RoverConfig`, `SoilConfig`, `ProbeConfig`, `SurveyConfig`, `MappingConfig`, and a top-level `SimConfig` with a `load(path)` function reading YAML. Validate geometry at load time: the clear lane width (`row_spacing - 2 * canopy_radius_max`) must be at least `rover.width + 2 * rover.safety_margin`, otherwise raise a clear error that states the numbers. Create `configs/demo.yaml` with the placeholder values below, each marked `# PLACEHOLDER: calibrate`:

    field: length_x 30.0, width_y 20.0, headland 2.0, row_spacing 1.2,
           plant_spacing 0.5, canopy_radius_min 0.22, canopy_radius_max 0.30,
           stem_keepout 0.15, plant_dropout_prob 0.03
    rover: width 0.40, length 0.50, max_speed 0.5, max_yaw_rate 1.0, safety_margin 0.05
    soil: grid_resolution 0.25, mean_vwc 0.25, std_vwc 0.05,
          corr_length_range [3.0, 30.0], covariance exponential,
          drip_stripe_amplitude 0.03, dry_patch_count [1, 3], dry_patch_radius [1.0, 3.0],
          dry_patch_depth 0.08, wet_patch_count [0, 1], vwc_clip [0.05, 0.45]
    probe: footprint_radius 0.05, noise_std 0.02, bias 0.01, resolution 0.001,
           failure_prob 0.01, insertion_time_s 10.0
    survey: probe_spacing 2.0, probe_budget 60, candidate_spacing 1.0
    mapping: method ordinary_kriging, variogram_model exponential,
             output_resolution 0.5, dry_threshold 0.18

In `field.py`, implement `FieldLayout.generate(cfg, rng)` producing: row y-positions, plant stems (with dropout to create gaps), per-plant canopy radii, lane centrelines as Shapely LineStrings, headland rectangles, and a free-space polygon (field minus canopy circles). Include `candidate_probe_sites(spacing)` returning points along lane centrelines that are at least `stem_keepout` from every stem. Tests: row count matches geometry; all lane centrelines are at least `canopy_radius_max + rover.width/2 + safety_margin` from every stem; the same seed gives identical layouts.

### M2 Ground-truth soil-moisture generator
In `soil.py`, implement `SoilTruth.generate(cfg, layout, rng)` returning an object holding a 2D float32 grid (rows = y, cols = x), its resolution and origin, plus metadata (sampled correlation length, anomaly list). Steps: (1) generate a stationary Gaussian random field with the configured covariance using the FFT spectral method on a padded grid, normalised to zero mean and unit variance; (2) scale to `mean_vwc` and `std_vwc`; (3) add drip-line stripes, wetter along each plant row with amplitude `drip_stripe_amplitude` decaying smoothly toward lane centres; (4) add dry patches (smooth radial dips) and wet patches; (5) clip to `vwc_clip`. Provide `value_at(x, y)` (bilinear) and `mean_over_disc(x, y, r)`. Tests: determinism; output within the clip range; the empirical correlation at 1 m lag is higher for a configured 25 m length than for a 4 m length, averaged over 20 seeds; a dry patch lowers the mean inside its radius versus outside.

### M3 Moisture probe sensor model
In `sensor.py`, implement `MoistureProbe.read(truth, x, y, t, rng) -> ProbeReading` where the reading is `mean_over_disc(x, y, footprint_radius) + bias + N(0, noise_std)`, quantised to `resolution`, clipped to [0, 1]. With probability `failure_prob` return a reading with `valid=False` and `value=None`. `ProbeReading` is a frozen dataclass: `x, y, t, value, valid, sensor_id`. It must not carry the true value. Tests: mean error over many reads converges to `bias`; noise standard deviation matches config within tolerance; failures occur at roughly the configured rate.

### M4 Rover kinematics, lane planner, path follower and plant-contact safety
In `rover.py`, implement a differential-drive kinematic model `step(state, v, w, dt)` with speed and yaw-rate limits, and the rover footprint as a rectangle polygon at the current pose. In `planning.py`, implement `LanePlanner.plan_full_coverage(layout, cfg) -> Plan` returning a boustrophedon sequence of waypoints along every lane centreline, with headland turns (turn in place for differential drive), and probe stops every `probe_spacing` metres snapped to valid candidate sites. Also implement `LaneGraph` (nodes are candidate sites and headland junctions; edges follow lanes and headlands) with `shortest_path(a, b)` for the adaptive mode. In `control.py`, implement a pure-pursuit path follower producing `(v, w)`. In `safety.py`, implement `contacts(footprint, layout) -> list[PlantContact]` using Shapely or analytic circle-rectangle tests, with a spatial index for speed. Tests: full-coverage plan visits every lane; simulated drive of the full plan on the demo config produces zero contacts for 20 seeds; a deliberately oversized rover fails config validation; the shortest path between two sites never cuts through a row.

### M5 Mapping and metrics
In `mapping.py`, implement a `Mapper` protocol with `update(reading)` and `estimate(grid_spec) -> (mean, variance)`. Implementations: `GlobalMeanMapper` (baseline; variance = sample variance everywhere), `IDWMapper` (baseline; variance = NaN or a distance-based proxy, clearly documented), and `KrigingMapper` using PyKrige `OrdinaryKriging` with an automatically fitted variogram of the configured model; fall back to `GlobalMeanMapper` if there are fewer than a minimum number of valid readings (configurable, default 5). In `metrics.py`, given truth (resampled to the output grid) and an estimate, compute RMSE, MAE, R², dry-cell precision/recall/F1 at `dry_threshold`, uncertainty calibration (fraction of cells whose truth lies within ±1.96·sqrt(variance)), plus run statistics (probes used, valid probes, path length, mission time, lane coverage fraction, plant contacts). Tests: on a smooth synthetic field with dense samples, kriging RMSE is below the global-mean RMSE; metrics on identical arrays give zero error and perfect R²; the dry-cell metrics are correct on a hand-built example.

### M6 Simulation runner, CLI, outputs and Rerun visualisation
In `sim.py`, implement `run_survey(cfg, seed, policy="full_coverage", rerun=False) -> RunResult`. Loop at fixed `dt` (default 0.05 s): follow the plan, check contacts every step, at probe stops pause for `insertion_time_s` and read the probe, update the mapper, and log. In `viz.py`, log to Rerun on a `sim_time` timeline: field outline, lanes, plant canopies (2D points with radii), rover footprint and trail, probe points coloured by value, and four images (truth, estimate, absolute error, variance) rendered with a fixed colour map and fixed value range so frames are comparable. Write the visualisation against the pinned rerun-sdk version; check its installed API instead of relying on memory. In `io.py`, save to `runs/<UTC timestamp>_seed<seed>/` using a Windows-safe timestamp such as `20261013T101500Z_seed7` (no colons), built with `pathlib`: `config.yaml`, `metrics.json`, `truth.npy`, `estimate.npy`, `variance.npy`, `probes.csv`, `path.csv`, a 2×2 PNG figure, and an `.rrd` recording when Rerun is enabled. The CLI exposes `agrisim run`. Tests: a run with Rerun disabled finishes headless and writes all files; two runs with the same seed produce identical `metrics.json`.

### M7 Benchmark harness and baseline probing strategies
In `policies.py`, implement probing strategies that choose the next probe site from the candidate list given only readings so far: `FixedSpacing` (the full-coverage plan), `Random`, `GreedyMaxVariance` (the site with the highest kriging variance), and `GreedyVariancePerCost` (variance divided by travel time on the lane graph). In `bench.py` and `agrisim bench --config ... --seeds 0-49 --budget 30`, run every strategy on every seed with the same probe budget and write `runs/bench_<timestamp>/results.csv` and a Markdown summary with the mean and 95% interval of each metric per strategy. If you parallelise seeds, use `concurrent.futures.ProcessPoolExecutor` with top-level worker functions and an `if __name__ == "__main__":` guard so it works with Windows `spawn`; keep a `--workers 1` serial mode as the default for debugging. Tests: the bench runs on 3 seeds in CI quickly; the summary contains every strategy.

### M8 Gymnasium environment, MaskablePPO training and evaluation
In `env.py`, implement `AdaptiveProbingEnv(gymnasium.Env)`. Each reset generates a new field and soil truth from the episode seed. The action is `Discrete(N)`: the index of the next candidate probe site; `action_masks()` excludes sites already probed. A step moves the rover along the lane-graph shortest path (travel time from distance and `max_speed`), takes a probe reading, and updates the kriging mapper. The observation is a fixed-shape float32 array with channels [estimate mean, normalised variance, visited mask, rover position], rasterised to the mapping grid, plus remaining budget and time as extra channels or a Dict entry. Reward = (RMSE before − RMSE after) − `time_penalty` × travel time; this is the only place outside metrics allowed to read the truth, and the code must state that clearly. The episode ends when the budget is used. Add `agrisim train` (MaskablePPO with a small CNN feature extractor; total timesteps, seed and output folder configurable) and `agrisim eval` (evaluates a saved model on held-out seeds and adds it to the bench table). Use `gymnasium.utils.env_checker.check_env` in tests. For vectorised training on Windows use `DummyVecEnv`, or `SubprocVecEnv` with `start_method="spawn"`. Acceptance is not "the RL agent wins"; it is that training runs, the agent is evaluated on held-out seeds with the same budget, and the comparison against all baselines is reported honestly.

### M9 Team-facing README and demo script
Write `README.md` for beginners: what the simulator does, installation with `uv`, the three commands, how to read the outputs, the meaning of every metric, and a clear note that soil parameters are placeholders until calibrated. Add `scripts/demo.sh` and `scripts/demo.ps1` that run a seeded demo with Rerun enabled.

## Concrete Steps

Work from the repository root in Windows PowerShell (the same commands work in a Linux shell). One command per line; do not chain with `&&`. Typical loop per milestone:

    uv sync
    uv run ruff check . --fix
    uv run ruff format .
    uv run mypy src
    uv run pytest -q

After M6:

    uv run agrisim run --config configs/demo.yaml --seed 7
    uv run agrisim run --config configs/demo.yaml --seed 7 --rerun

After M7:

    uv run agrisim bench --config configs/demo.yaml --seeds 0-49 --budget 30

After M8:

    uv run agrisim train --config configs/demo.yaml --timesteps 200000 --seed 0 --out runs/ppo_v1
    uv run agrisim eval --model runs/ppo_v1/model.zip --config configs/demo.yaml --seeds 100-149 --budget 30

Record short transcripts of real outputs in Artifacts and Notes.

## Validation and Acceptance

- `ruff`, `mypy` and `pytest` pass on Windows and Linux CI, and on the team lead's Windows laptop.
- The licence gate passes: no GPL, AGPL or LGPL packages in the environment (GEOS inside shapely is the documented exception).
- `agrisim run` on the demo config with seed 7 finishes headless, writes every output file listed in M6, and reports zero plant contacts and 100% lane coverage for the full-coverage policy.
- Across seeds 0 to 49 with the full-coverage policy: zero plant contacts on every seed. Kriging RMSE is expected to be below global-mean RMSE on at least 90% of seeds; if not, investigate and record the finding rather than tuning the test.
- Identical config and seed produce identical `metrics.json`.
- The bench table and the RL evaluation table exist and use the same budget and held-out seeds for every strategy.

## Idempotence and Recovery

Every command writes to a new timestamped folder under `runs/` and never overwrites earlier runs. All randomness flows from the seed, so any run can be reproduced exactly. If a dependency upgrade breaks something, revert `uv.lock` to the last working commit. If PyKrige fails to fit a variogram on a degenerate sample, the mapper falls back to the global mean and logs a warning; it never crashes a run.

## Artifacts and Notes

(Paste short command transcripts, sample metric outputs and screenshots of the Rerun view here as milestones complete.)

## Interfaces and Dependencies

Package layout under `src/agrisim/`:

    config.py    pydantic models, load(path) -> SimConfig
    field.py     FieldLayout.generate(cfg, rng); candidate_probe_sites(spacing)
    soil.py      SoilTruth.generate(cfg, layout, rng); value_at(x, y); mean_over_disc(x, y, r)
    sensor.py    MoistureProbe.read(truth, x, y, t, rng) -> ProbeReading
    rover.py     RoverState; step(state, v, w, dt); footprint(state) -> Polygon
    planning.py  LanePlanner.plan_full_coverage(layout, cfg) -> Plan; LaneGraph.shortest_path(a, b)
    control.py   PurePursuit.command(state, path) -> (v, w)
    safety.py    contacts(footprint, layout) -> list[PlantContact]
    mapping.py   Mapper protocol; GlobalMeanMapper; IDWMapper; KrigingMapper
    metrics.py   map_metrics(truth, mean, var, cfg); run_metrics(...)
    policies.py  FixedSpacing; Random; GreedyMaxVariance; GreedyVariancePerCost
    sim.py       run_survey(cfg, seed, policy, rerun) -> RunResult
    env.py       AdaptiveProbingEnv
    bench.py     run_benchmark(cfg, seeds, budget, strategies)
    viz.py       Rerun logging helpers
    io.py        run-folder writing
    cli.py       Typer app: run, bench, train, eval

Rules:
- Only `metrics.py` and the reward inside `env.py` may access `SoilTruth` values directly. Mappers and policies receive `ProbeReading` objects only.
- Every function that uses randomness takes a `numpy.random.Generator`.
- Data passed between modules uses frozen dataclasses or pydantic models, never loose dicts.

Dependencies (all permissive licences; confirm and pin at M0): numpy, scipy, shapely (bundles GEOS, which is LGPL; tolerated because it is used unmodified, per context.md), pydantic, pyyaml, pykrige (BSD-3), rerun-sdk (MIT/Apache-2.0), gymnasium, stable-baselines3, sb3-contrib, torch, typer, matplotlib; dev: pytest, ruff, mypy.

Future hook (do not implement now): `agrisim.bridge.ProbeService`, a small interface that the Phase 2 Gazebo/ROS 2 layer will call as `read(x, y, t) -> ProbeReading`, so soil logic stays only in this package.
