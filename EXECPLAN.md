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
- [x] M4 Rover kinematics, lane planner, path follower and plant-contact safety. (2026-10-13)
- [x] M5 Mapping (kriging) and metrics. (2026-10-13)
- [x] M6 Simulation runner, CLI, run outputs and Rerun visualisation. (2026-10-13)
- [x] M7 Benchmark harness and baseline probing strategies. (2026-10-13)
- [x] M8 Gymnasium environment, MaskablePPO training and evaluation. (2026-10-13) Training and held-out evaluation done; the learned policy does not beat the baselines (see Outcomes).
- [x] M9 Team-facing README and demo script. (2026-10-13)
- [x] Outside the milestones: rover hardware design v1 in `hardware/rover-v1/` (2026-10-14), redesigned with a self-cleaning probe cartridge and under-leaf camera arms (be342be).
- [x] 3D replay viewer and a plainer Rerun layout (2026-10-14), after the team lead found the viewer hard to understand. See Decision Log.
- [ ] M10 Photoreal graphics for the 3D replay (started 2026-10-15). Phase 1 (modules), phase 2 (lighting) and phase 3 (field) done 2026-10-15; phase 4 (plants) next.
- [x] M11 Weather, probe misreads and rechecks (2026-10-15). Rain and evapotranspiration change the soil during a mission; the rover corrects old readings with its rain gauge and can go back to spots it doubts (`recheck`, `fixed_plus_recheck`). Scenario configs in `configs/scenarios/`. See Outcomes for the honest result.
- [ ] M12 onward: toward a test bench for field robots (roadmap below, not started).
- [x] Pre-handover review (2026-10-14): two crash bugs fixed, Rerun layout fixed, hardware CI job added, demo video and its recording scripts added. See Surprises, Decision Log and Outcomes.

## Surprises & Discoveries

- Robustness review (2026-10-15, report `SMC-found-and-fixed.md` from an outside review at `ec499ad`; its patch file was not available, so every finding was reproduced on `c7e2d73` and fixed again here). All 22 reproduced. The serious ones:
  - Validation accepted configs where the rover touched plants (34 contacts on seed 7 with a 0.8 m rover, `safety_margin: 0`, `row_spacing: 1.0`, `headland: 1.5`). The cause was a half-degree heading wobble while leaving a lane, with the rover's corner exactly at the canopy edge. Clearance checks now add a tracking allowance: 1.5 cm, plus the corner swing at 0.12 rad (4.3 cm for the demo rover). A fuzz of 300 random configs within 1% of the new limits, with two strategies each, gave 0 contacts.
  - `dt` of 0.7 s made a turn in place oscillate forever.
  - A 300 x 200 m field needed a 76 GB distance matrix. A KD-tree now finds the 49,634 sites in 0.15 s.
  - `agrisim train` crashed whenever `stem_keepout` removed sites.
  - YAML `.nan` was accepted as a probe bias.
  - On Windows a second `agrisim view` could share a busy port. The server now claims it exclusively, which the test confirms on Windows.
- The densified path check must stay separate from the pointwise one: `contacts()` is also used on unrelated poses (the shapely cross-check test). So `safety.path_contacts` fills in the path and `contacts` stays pointwise.

- M11: the first "odd reading" rule (more than 2x probe noise away from the neighbours) treated ordinary soil variation between sparse readings as misreads and wasted probes; RMSE got worse than without rechecks. Comparing against the field's own typical disagreement (median-based, 3x) fixed that. Evidence: budget-30 recheck RMSE 0.0355 with the old rule vs 0.0344 with the new one (seeds 0-29).
- M11: correcting old readings with the rain gauge removes most of the error rain causes, so going back for rain alone rarely beats measuring somewhere new. Rechecks pay off mostly for misreads and only once the field is already well covered (budget 60, not 30).

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
- M4: The demo plan is 466 m of driving and 21,699 steps at dt = 0.05 s. A Python-level step loop costs about 70 µs per step (~1.5 s per full drive), so the 20-seed zero-contact test takes ~30 s. Acceptable for now; revisit if the benchmark is too slow.
- M4: Measured on seeds 0-4: with the footprint inflated by safety_margin on every side there are still zero canopy overlaps, and the maximum lateral tracking error inside lanes is 0.36 mm (turn-in-place then pure pursuit along straight segments).
- M4: scipy-stubs types `KDTree.query_ball_point` loosely; a `cast(list[list[int]], ...)` is needed under mypy strict.
- M5: PyKrige 1.7.3 ships no type information; mypy override `ignore_missing_imports` for `pykrige.*`. PyKrige emits warnings during variogram fitting on small samples; they are silenced inside `KrigingMapper.estimate`. `pseudo_inv=True` is used so repeated probe locations do not make the kriging system singular.
- M6: The first full-coverage waypoint is itself a probe stop; the first loop version only probed on arrival and silently used 59 of 60 probes. Fixed, and the CLI test now asserts probes_used == probe_budget.
- M6: `np.clip` on Python scalars inside `rover.step` cost ~90% of simulation time. Plain min/max made `run_survey` ~10x faster (0.2 s per demo survey, identical results).
- M6: rerun-sdk 0.39 API used: `rr.RecordingStream`, `rec.spawn(connect=False)`, `rec.set_sinks(rr.GrpcSink(), rr.FileSink(path))`, `rec.set_time('sim_time', duration=t)`, `rr.LineStrips2D`, `rr.Boxes2D`, `rr.Points2D`, `rr.Image`, `rr.Scalars`. The spawned viewer is a detached process that inherits stdout; when the command's output is piped (as in an agent tool) the pipe stays open until the viewer closes, although the run itself has finished. In an interactive PowerShell the command returns normally.
- M7: Adaptive strategies first produced plant contacts (up to 76 per run): to reach a site behind it in the same lane, the rover turned 180 deg in place, and the footprint's turning circle (0.32 m) is wider than the clear half-lane (0.30 m). The follower now reverses along a segment that points behind it (heading error > 90 deg + 0.3 rad), so in-lane heading never flips; rotations only happen on headland centrelines. New test covers in-lane backtracking. All 200 bench runs now have zero contacts.
- M7: Benchmark (seeds 0-49, budget 30): fixed spacing has the lowest RMSE (0.0323 +/- 0.0016) and is not beaten by any adaptive strategy on map error. Greedy max-variance matches it on RMSE (0.0327 +/- 0.0019) and has the best dry-cell F1 (0.44 vs 0.33) but drives 69% further (785 m vs 466 m). Greedy variance-per-cost is the cheapest (152 m, 652 s vs 1351 s) but has the worst RMSE (0.0387). Random is worse than fixed spacing on every map metric. Dry-cell precision is undefined (no predicted dry cell) on 11-17 of 50 seeds per strategy: kriging smooths out small dry patches.
- M8: Env step costs ~21 ms, almost all of it kriging (variogram fit + 2400-cell grid). With 6 spawn SubprocVecEnv workers, 200k steps took 24.5 min on the 16-thread laptop CPU. PPO updates showed high approx_kl (~0.09) and clip fraction (~0.67) early on: large policy steps.
- M8: Training episode reward rose from -0.04 (about random) to ~0.2 within ~60k steps, then plateaued noisily between 0.09 and 0.25 up to 200k steps. On held-out seeds the policy behaves close to random (similar path length and RMSE). Likely causes, untested: a 128-d global CNN feature followed by a linear head over 464 site actions is weak at spatial choice (a fully convolutional per-cell action head would fit better); 200k steps is only ~6.7k episodes; per-step RMSE-change rewards are noisy. Not tuned further, per CLAUDE.md (no tuning to make results look good).
- Handover: An invalid config or policy name used to surface as a full Python traceback, and an unknown policy left an empty run folder behind. Both are fixed and covered by tests. While checking the handover test plan, seed 0 with failure_prob 0.5 lost only 18 of 60 probes; across 20 seeds the measured rate is 0.508, so the sensor is correct and that seed is an outlier.
- Review (2026-10-14): `LanePlanner.plan_full_coverage` crashed ("argmin of an empty sequence") when a lane had no candidate probe site, which a valid config can cause (for example `stem_keepout` wider than half the row spacing). Such lanes now just get no stops. Regression test added.
- Review (2026-10-14): `--seeds 5-3` (reversed) gave an empty seed list. `bench` then crashed with an IndexError after creating an empty output folder; `eval` crashed on `max([])`; `--seeds abc` gave a traceback. `parse_seeds` now rejects these and the CLI reports a clean usage error (exit 2) before writing anything. `eval` also rejects `--budget < 1`, like `bench`.
- M10 (2026-10-15): three.js 0.186 removed PCFSoftShadowMap (it falls back to PCFShadowMap with a warning); use PCFShadowMap with shadow.radius. A browser tab that is hidden does not run requestAnimationFrame, so values that the frame loop sets (the sun's position) look wrong when inspected there; inspect in a visible tab or in the headless recorder. Headless Chrome can use the real GPU with `--enable-gpu --use-angle=d3d11` (the recorder's `perf` step does this).
- 3D replay (2026-10-14): CI failed once on a test that passed locally: under GitHub Actions, Typer colours its error box, so an option name like `--view` is split by colour codes. Tests that look for text in CLI errors must strip ANSI codes first (reproduce locally with `GITHUB_ACTIONS=true`).
- 3D replay (2026-10-14): Windows can map `.js` to `text/plain` in the registry, and browsers refuse to run such a module script, so the viewer's server sets the JavaScript type explicitly. Headless Chrome renders the 3D page (and now the Rerun web viewer) at only 4 to 5 frames per second, so the video recorder replaces the page's clock with a virtual one and captures exactly one frame per 1/30 s step.
- Review (2026-10-14): The Rerun viewer never showed the field (rover, plants, lanes, probes). Its automatic layout made views only for the four map images and the RMSE plot. `RerunLogger` now sends an explicit blueprint: field view (flipped so north is up, like the maps), RMSE over the whole run, the four maps, playback at 30x. Found while recording the demo video in the Rerun web viewer.

## Decision Log

- Decision (robustness review, 2026-10-15): validation now also requires the following:
  - a tracking allowance on top of `safety_margin`;
  - `dt` at most 0.1 m and 0.25 rad per step;
  - at least 2 grid cells across the field's short side;
  - a soil FFT grid of at most 25 million cells;
  - `vwc_clip` within [0, 1];
  - finite numbers everywhere.

  The demo config passes them unchanged: lane need 0.587 of 0.600 m, headland need 1.43 of 2.0 m. Every published number is unchanged. Checked again: seed 7 gives RMSE 0.0299, 465.7 m; PPO gives 0.0348, 783.6 m.

  The PPO environment's actions are now every lane site, a list fixed by the config, with sites near a plant masked. On the demo config the action list is identical, so `models/ppo_v1` still loads. Date: 2026-10-15.

- Decision (M11): weather is a small bucket water balance written here (about 60 lines), not AquaCrop-OSPy. Rationale: we need minutes-scale moisture change in the probe's top layer during one mission, not a season of crop growth; no new dependency. Revisit for season-long scenarios (roadmap step 4). Date: 2026-10-15.
- Decision (M11): `weather` is optional in the config. Without it nothing changes over time and every existing number (README, HANDOVER, bench, PPO evaluation) is unchanged; the probe's bad-contact draws are also taken only when `bad_contact_prob > 0`, so older probe noise streams do not shift. The weather random stream is a fifth `SeedSequence` child, which leaves the first four identical. Date: 2026-10-15.
- Decision (M11): the rover's water-balance model is the truth's model except for the spatial soak-in. This is optimistic (a real rover's model will be off in field capacity, drainage and evapotranspiration too), so rechecks are probably worth more in a real field than here. Recorded as an open item rather than tuned. Date: 2026-10-15.
- Decision (M11): a newer reading replaces an older one at the same spot rather than averaging them, because after rain the old one is out of date. Rechecks probe 0.15 m beside the old hole, as a real probe would. Date: 2026-10-15.
- Decision (M11): the Gymnasium environment and the trained PPO model stay without weather and without rechecks (unchanged action mask), so the M8 evaluation remains reproducible. Date: 2026-10-15.

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
- Decision (M4): The full-coverage plan places a candidate stop every probe_spacing m per lane (16 lanes x 15 = 240 on the demo field), then thins them evenly along the route to the probe budget (60 in demo.yaml, or --budget in the bench). Rationale: the plan text asks for both a probe_spacing and a probe_budget; thinning along the boustrophedon gives a staggered, roughly uniform pattern with the same budget as the adaptive strategies. Date: 2026-10-13.
- Decision (M4): Path following = turn in place until heading error <= 0.15 rad, then pure pursuit (lookahead 0.3 m) along each straight segment; a segment ends within 1 cm of its end point. `contacts` is an analytic rectangle-vs-circle test on (S, 3) pose arrays with a KD-tree for candidates, cross-checked against Shapely on 300 random poses. `LaneGraph` is closed form (same lane: |dx|; else min over the west and east headlands), which is exact for straight parallel lanes, instead of a general graph search. Date: 2026-10-13.
- Decision (M5): IDW variance is NaN everywhere (IDW has no uncertainty model; no invented proxy). GlobalMean variance is the sample variance (ddof=1). Dry precision/recall are NaN when undefined (no predicted / no true dry cells); F1 is NaN if either is NaN and 0 if both are 0. Calibration = fraction of cells with |truth - mean| <= 1.96 sqrt(var), NaN when there is no variance. Lane coverage = fraction of lane-centreline points (every 0.1 m) within 0.1 m of a driven pose. Truth is resampled to the output grid by bilinear sampling at output cell centres (exact 2x2 block mean for 0.25 m -> 0.5 m). Date: 2026-10-13.
- Decision (M6): Each seed is split with `SeedSequence(seed).spawn(4)` into independent streams for layout, soil, probe noise and policy, so every policy sees the identical field and soil for a given seed. Maps are coloured with fixed ranges (VWC: vwc_clip; abs error: [0, 2 std_vwc]; variance: [0, (2 std_vwc)^2]) in both the PNG and Rerun. `truth.npy` is truth resampled to the output grid so it aligns with `estimate.npy` and `variance.npy`. The probe reads at the rover's actual stopping pose (within 1 cm of the stop), not the nominal site. NaN metrics are written as null in metrics.json. Date: 2026-10-13.
- Decision (M7): Adaptive strategies start at the west end of lane 0 and stop after the last probe (no return leg); fixed spacing drives the whole full-coverage route, so its path length includes lanes after its last probe. Uncertainty for the greedy strategies is ordinary-kriging variance at the candidate sites from the readings so far; before kriging is usable (< min_readings) it is the distance to the nearest probe (maximin spread). Variance-per-cost divides by (lane-graph distance / max_speed + insertion_time_s). The bench also reports global-mean and IDW RMSE on each strategy's own readings. Intervals are 95% Student-t over seeds; undefined values (NaN) are dropped and n is shown. Parallel workers use an explicit spawn context on every OS. Date: 2026-10-13.
- Decision (M7): Differential-drive rover may drive in reverse along a segment (see Surprises). Rationale: safer than an in-lane U-turn and cheaper than detouring through a headland. Date: 2026-10-13.
- Decision (M8): Observation = 6 x 40 x 60 float32 channels on the 0.5 m mapping grid: kriging mean ((m - mean_vwc) / std_vwc), variance / std_vwc^2, probed-cell mask, rover cell, budget fraction left, normalised time; clipped to [-10, 10]. Before kriging is usable the map is the config prior (mean_vwc, std_vwc^2). Reward = 100 x (RMSE before - RMSE after) - 0.001 x travel seconds; time_penalty and reward_scale are constructor arguments, not soil placeholders. The env abstracts driving as lane-graph distance / max_speed; evaluation instead runs the trained model inside run_survey with the full kinematic drive, so it is compared with the baselines under identical conditions. Training episodes draw seeds >= 1000; eval refuses seeds >= 1000. MaskablePPO: SmallCNN (3 conv + linear 128), net_arch pi=[256], vf=[256], n_steps 1024/n_envs, batch 64, ent_coef 0.01, CPU. Date: 2026-10-13.
- Decision (M9): README documents an optional CUDA torch swap with `uv pip install --reinstall torch==2.14.1 --index-url https://download.pytorch.org/whl/cu126` plus `uv run --no-sync`, leaving the lockfile CPU-only. torch 2.14.1 publishes Windows cp313 wheels for cu126 and cu130 (not cu128), checked 2026-10-13. Not verified on the RTX 3050 in this session: `agrisim train` uses device="cpu". Date: 2026-10-13.
- Decision (handover, 2026-10-14): Project licence is MIT (c) 2026 Auenchanters, chosen by the team lead; added LICENSE and `license = "MIT"` in pyproject.toml. The trained model `models/ppo_v1/model.zip` (10 MB, with its held-out eval summary) is committed so evaluation can be reproduced without retraining. README images and the replay video are generated from real runs by `scripts/make_media.py`. The CLI now reports invalid configs, policies and budgets as one clean error (exit code 2) before creating any run folder, and `agrisim run` takes `--model` for `--policy ppo`. Date: 2026-10-14.
- Decision (review, 2026-10-14): CI gains a `hardware` job (ubuntu, Node 22). It clones the Anatomy kit (MIT, github.com/wheresryan22/anatomy) pinned to commit e6600ffc4e8e6620eeb45bf49bcdbd5e4b84163f, rebuilds the drawings and both anatomy figures from `model.mjs`, runs the geometry audits, and fails if the committed outputs differ. Rationale: the hardware outputs are generated files; this keeps them in sync with the model and catches geometry faults. The kit is a build tool, never shipped; it adds no Python dependency.
- Decision (3D replay, 2026-10-14): `agrisim run --view` writes `scene.json` (field, plants, path, readings, and the map after every reading, rebuilt with the configured mapper; about 1.2 MB and 5 s for the demo run) and `agrisim view <run>` serves a three.js page on 127.0.0.1 with the standard library's HTTP server. The page only replays simulator output. Its rover is built from a copy of `hardware/rover-v1/model.mjs` (a test keeps the copy identical), so the 3D rover always matches the hardware design. three.js 0.186.1 (MIT, released 2026-09-24) is vendored unmodified with its licence in `src/agrisim/viewer3d/vendor/`, so the page works offline. It is a browser asset, not a Python dependency, so pip-licenses does not see it; recorded here instead. WebGL, not WebGPU, so it runs on any laptop and in headless Chrome. Considered and not used: threejs-particle-fluids (MIT, WebGPU only). Blender was offered for modelling; not needed, because building the rover from the model keeps one source of truth.
- Decision (3D replay, 2026-10-14): Plain-language interface for first-time users: a "Right now" panel (what the robot is doing, stop k of N, last reading in % water with "too dry" or "OK"), readings in % water, map error in % points, a colour scale with no green (it blends with plants): red-brown dry, yellow at the dry threshold, blue wet. The Rerun layout keeps its data but gets plain view names and a "How to read this" text panel.
- Decision (M10, 2026-10-15): The team lead approved the 3D replay viewer (`agrisim run --view`) and its photoreal overhaul. This is recorded because CLAUDE.md says "no web-dashboard code in this phase"; the viewer is a local replay page, not a dashboard, and exists at the team lead's request. Assets must be CC0 (Poly Haven) or made by us; Blender is used only as an authoring tool (its GPL does not apply to the models it exports). Each asset and its licence is listed in `src/agrisim/viewer3d/assets/LICENSES.md`.
- Decision (M10 phase 2, 2026-10-15): Lighting comes from a CC0 sky photo (Poly Haven "Kloofendal 48d Partly Cloudy (Pure Sky)", 2K HDR, 5.3 MB). It was chosen over a real farm-field sky because that one is overcast (its brightest 0.1% of pixels carry 1% of the sky's light, against 60% here), so it cannot cast crisp shadows, and over a midday sky whose sun is at 74 degrees (short shadows); this sun is at 48 degrees. At load the page finds the sun in the photo, removes the sun disc from the lighting copy (a directional light carries it, with shadows) and replaces the lower half with soil-coloured bounce light. One shadow map follows the camera (tight and sharp up close, wide from overhead), with its size in steps and its centre snapped to texels so it does not shimmer; simpler than cascaded shadow maps and enough here. Medium and High add GTAO ambient occlusion and 4x MSAA through an EffectComposer; AgX tone mapping. Sun 8, sky light 0.6, exposure 0.92, chosen by side-by-side captures (`node scripts/demo_video/record.mjs lookdev`, with `LOOKDEV_QUERY="sun=..&sky=..&exposure=.."`). Graphics menu: Auto (default; measures real frame times and steps once or twice), Low, Medium, High; the choice is remembered.
- Decision (M10 phase 3, 2026-10-15): The field follows reference photos of smallholder tomato fields (Wikimedia Commons: Chamarajanagar and Nashik in India, Kaduna in Nigeria, Walewale in Ghana; and a photo from the team lead of a path between staked rows). Ground is a 5 cm height field (10 cm on Low) from seeded noise: ridges 10 cm high under every plant row with uneven shoulders and ends, furrows where the rover drives with wheel ruts at the rover's track, clods and lumps, pits and small craters (kept off ridge tops), a field that is not level, and a grassy bund. The furrow bottom is kept 0.5 m wide, wider than the rover (0.395 m). The rover sits on the ground: height, pitch and roll from the highest point under each tyre. Soil: two CC0 Poly Haven photo sets (farm_soil, brown_mud_02) re-encoded to 3.5 MB by `scripts/assets/make_soil.py`, mixed by how low the ground is, by their height maps and by the simulated true moisture (wetter soil darker and glossier), sampled twice at different turns to hide tiling, warmed toward the ochre of the reference path. The data colours now tint the soil (keeping its texture) instead of a flat layer above it. Reading marks became wire survey flags beside the probe hole, just outside the rover's tyres, with flat dots that fade in when zoomed out. Stakes became crooked wood and bamboo poles of uneven height at about half the plants, with string lines along the rows. Scatter: clods, pale stones, fallen tomatoes, straw, and grass and weeds that sway, kept out of the rover's tracks. A final grade pass (contrast, saturation, vignette) on Medium and High.
- Decision (review, 2026-10-14): The demo video (`docs/media/agrisim-demo.mp4`, 2 min 46 s, 6.4 MB) is committed. It is made by `scripts/demo_video/` (Node + headless Chrome screencast over the DevTools protocol + ffmpeg). The terminal part replays real captured output at real timing; waits over 1.6 s are sped up and labelled on screen. No new Python dependency.

## Outcomes & Retrospective

- M11 (2026-10-15): 75 tests pass; ruff, mypy strict and the licence gate pass. The default `configs/demo.yaml` gives identical results for every existing strategy (checked: same RMSE and path to the last digit for seed 7 before and after). Benchmark on `configs/scenarios/rain_shower.yaml` (10-minute 20 mm/h shower from 10 min, 5% misreads), seeds 0-29, `agrisim bench --strategies fixed_spacing,greedy_variance,recheck,fixed_plus_recheck`:
  - Budget 60: RMSE fixed 0.0308 +/- 0.0012, fixed_plus_recheck 0.0300 +/- 0.0014, greedy_variance 0.0280 +/- 0.0016, recheck 0.0276 +/- 0.0020. Per seed, fixed_plus_recheck beats fixed by 0.00075 on average (standard error 0.00049, better on 18/30 seeds) and recheck beats greedy by 0.00041 (s.e. 0.00038, 18/30). A small gain, not statistically conclusive. fixed_plus_recheck drives 728 m in 37 min vs 466 m in 28 min.
  - Budget 30: no gain (fixed_plus_recheck vs fixed +0.00005, recheck vs greedy +0.00010). With few probes, a new spot is worth more than a second look.
  - Zero plant contacts in every run.

(Fill in at each milestone and at completion: what works, what does not, what was learned, what remains.)

- M0: `uv sync` installs everything on Windows 11 with no compiler. ruff, ruff format, mypy (strict), pytest (4 tests) and the licence gate pass locally. `uv run agrisim version` works. CI workflow written for windows-latest and ubuntu-latest; first CI result pending the first push. Open: project licence for `agrisim` itself not chosen. CI run on the first push: success on windows-latest and ubuntu-latest.
- M1: Config models validate geometry with messages that state the numbers; `FieldLayout.generate` and `candidate_probe_sites` work. 14 tests pass (row count, lane-to-stem clearance over 5 seeds, determinism, keep-out, oversized rover and short headland rejected).
- M2: `SoilTruth.generate` produces a float32 (80, 120) grid for the demo field; tests cover determinism, clip range, correlation ordering (25 m smoother than 4 m), dry-patch effect, bilinear and disc sampling. 19 tests pass.
- M3: `MoistureProbe.read` done. Over 4000 reads the mean error matches the configured bias and the error std matches noise_std within 5%; failure rate matches failure_prob. 22 tests pass.
- M4: Kinematics, full-coverage planner, pure-pursuit follower, contact detection and lane-graph shortest paths done. Full plan driven on 20 seeds with zero plant contacts; shortest paths only use lane and headland centrelines; oversized rover rejected (M1). 46 tests pass (~43 s).
- M5: Mapper protocol with GlobalMean, IDW and Kriging (with global-mean fallback) done; metrics done. On a smooth synthetic field with 80 samples, kriging RMSE is below a quarter of the global-mean RMSE. 51 tests pass.
- M6: `agrisim run` works headless and with `--rerun` (viewer opened, recording.rrd 1.5 MB). Seed 7 demo: zero contacts, lane coverage 1.000, 60 probes. Two runs with the same seed give byte-identical metrics.json. 54 tests pass.
- M7: `agrisim bench` runs 4 strategies x 50 seeds in 41 s with 4 spawn workers; serial and parallel results are identical (test). Acceptance: zero plant contacts on every seed and strategy; kriging RMSE below global-mean RMSE on 50/50 seeds for fixed spacing (target >= 90%). Honest result: no adaptive strategy beats fixed spacing on RMSE at budget 30 on this placeholder field. 59 tests pass.
- M8: `AdaptiveProbingEnv` passes gymnasium `check_env`, is deterministic per episode seed, and masks probed sites. `agrisim train` (MaskablePPO, 200k steps, seed 0) and `agrisim eval` (seeds 100-149, budget 30, same as every baseline) both ran. Result on held-out seeds: PPO RMSE 0.0357 +/- 0.0020 vs greedy max-variance 0.0333 +/- 0.0019, fixed spacing 0.0338 +/- 0.0018, random 0.0354 +/- 0.0019, variance-per-cost 0.0364 +/- 0.0023. PPO drives 689 m (random 733 m, fixed 466 m, variance-per-cost 149 m). Zero plant contacts for every strategy. The learned policy does not beat the simple baselines; the greedy-variance baseline remains the best adaptive strategy (context.md risk: "the baseline alone is a valid product").
- M9: README for beginners (install, the commands, outputs, every metric, placeholder warning, optional GPU) and scripts/demo.ps1 + demo.sh done. 62 tests pass; ruff, mypy strict and licence gate pass.
- Overall (2026-10-13): All of M0-M9 work on Windows 11 natively (no WSL, Docker or compiler) and pass CI on windows-latest and ubuntu-latest. Acceptance met: deterministic runs, zero plant contacts on all evaluated seeds and strategies, full lane coverage for fixed spacing, kriging beats global mean on 50/50 seeds. What remains: calibrate soil/probe placeholders with real data; choose a project licence for agrisim; try a fully convolutional action head or longer training if adaptive probing matters; verify the optional CUDA path on the RTX 3050; Phase 2 (Gazebo/ROS 2) is a separate plan.
- Handover (2026-10-14): README rewritten (results tables, architecture diagram, replay GIF/MP4, screenshots), HANDOVER.md test plan added with expected values checked on this machine, MIT licence added. 64 tests pass; ruff, mypy strict and the licence gate pass.
- M10 phase 3 (2026-10-15): average frame time with the new field (`perf`, now total time / frames, because single frame times swing when the frame cap is off): Low 3.8 ms, Medium 11.5 ms, High 12.3 ms; 95th percentile about 30 ms on Medium and High.
- M10 phase 2 (2026-10-15): frame times on the team lead's laptop (RTX 3050 Laptop GPU, 1600x900, `node scripts/demo_video/record.mjs perf`): Low 7.6 ms median (10.4 ms 95th percentile), Medium 11.5 (18.1), High 11.3 (14.5); budget 16.7 ms. Integrated GPUs are not measured yet; Auto drops to Low there if needed.
- 3D replay (2026-10-14): 70 tests pass; ruff, mypy strict and the licence gate pass. The demo video (3 min 9 s) now includes the 3D replay and the new Rerun layout.
- Pre-handover review (2026-10-14): 66 tests pass; ruff, ruff format, mypy strict and the licence gate pass; the hardware audits pass. Seed 7 still gives RMSE 0.0299, 59/60 probes, 465.7 m, 0 contacts, and the PPO run still gives RMSE 0.0348, 783.6 m. HANDOVER.md now opens with a section for a coding agent taking over.

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

### M10 Photoreal graphics for the 3D replay
Requested by the team lead (2026-10-15): the replay looked computer-drawn (flat ground with a speckle texture, ball-shaped plants, no contact shadows, box robot). Goal: it should feel like a real tomato field, while staying a faithful replay of simulator output, offline, and usable on an ordinary laptop. Decisions taken with the team lead: photoreal look, 10 to 15 MB of new assets, Blender (already installed) to author plants and robot parts, with the generator scripts committed. Stay on three.js with the WebGL renderer (no engine change).

Phases, each ending with before/after screenshots for the team lead:
1. Look-dev and structure: references, asset choice, budgets (60 fps at Medium on a laptop, under 25 MB download, field loaded in under 3 s); split `viewer3d/app.js` into modules with no change in behaviour.
2. Rendering: image-based lighting from a CC0 sky photo, sun matched to it, cascaded shadows, ground-contact ambient occlusion (GTAO), anti-aliasing, tone mapping, Low/Medium/High quality with automatic fallback.
3. Field: raised beds, sunken lanes, wheel ruts and clods as real geometry; CC0 photographed soil textures without visible tiling; soil darker and glossier where the simulated moisture is higher; the data layer redrawn as a translucent tint with contour lines; drip tape, main pipe.
4. Plants: a Blender script that generates tomato plant variants (stem, side shoots, compound leaves with alpha and veins, flower and fruit trusses, stake and twine), LODs, compressed glTF, instancing and wind sway; every plant stays inside the simulator's canopy radius.
5. Rover: detailed parts modelled in Blender at real dimensions, placed by `model.mjs` (still the single source of truth); materials; a soil cut-away view showing the probe rods in the ground.
6. Surroundings and polish: field edges, grass and weeds, hedgerow or tree line, haze, restyled panels.
7. Verification and handover: frame-time checks per quality level, fixed-camera screenshot comparisons, demo video and README images re-recorded, HANDOVER, CLAUDE.md and this plan updated.

### M11 Weather, probe misreads and rechecks
Requested by the team lead (2026-10-15): add weather such as rain so the soil moisture changes, and let the robot go back to points it is unsure about instead of only following a predefined path.

- `weather.py`: the soil layer the probe reads (`layer_depth`) is a bucket per grid cell, stepped every `step_s`: rain soaks in (scaled by a smooth random infiltration field with `infiltration_cv`, for runoff and crusting), evapotranspiration removes water, water above `field_capacity` drains at `drainage_per_h`. `SoilDynamics` is the hidden truth over time; `sim.Truth(t)` hands the probe the soil at the moment of each reading, and the map is scored against the soil at the end of the mission.
- The rover's side (`weather.current_view`): it knows the rain gauge and the same bucket model, but not how much rain soaked in at each spot. Older readings are brought forward to "now" with the model; a newer valid reading within 0.3 m replaces an older one; failed readings are dropped.
- Probe misreads (`probe.bad_contact_prob`, `bad_contact_drop`): poor soil contact reads drier than the soil and the probe does not know it.
- `recheck` strategy: greedy max-variance over new sites and doubted readings alike. Doubt = (infiltration_cv x the rain's moisture change since the reading)^2 + how far a single reading is from its 6 nearest neighbours beyond 3x the field's typical (median-based) disagreement. A second reading at a spot clears the "odd" part, so a real local anomaly is not rechecked forever. A recheck probes 0.15 m along the lane from the old hole.
- `fixed_plus_recheck`: the full-coverage route with `survey.recheck_probes` fewer stops, then that many `recheck` choices.
- `extends:` in a config file: a scenario is a base config plus changes (`configs/scenarios/rain_shower.yaml`, `hot_afternoon.yaml`).
- 3D replay: rain streaks and dimmer light while it rains, soil wetness and the "Real moisture" layer follow the simulated moisture, the status panel says when it rains and why the robot checks a spot again.

### Roadmap: toward a test bench for field robots
The team's long-term aim (2026-10-15): make agrisim for field robots what a wind tunnel is for aerodynamics, a place to test a robot and its decision-making against many fields, crops and weather before it goes outside. Order matters: a test bench is only worth trusting once it has been checked against real measurements.

1. Calibrate and validate one crop first (tomato): real probe readings and weather-station data from one field over a few weeks; fit the soil, probe and weather numbers that are now placeholders; report how far the simulator is from the field. Without this step, results stay "inside the simulator only".
2. Scenario library and a scorecard: named scenarios (dry spell, storm mid-survey, waterlogged corner, misreading probe, blocked lane) run by `agrisim bench` across many seeds, so a change to a robot or a strategy is scored on all of them at once.
3. Crops as profiles: move crop numbers (row and plant spacing, canopy size and growth, root depth, dry threshold, water use per growth stage) into `configs/crops/<crop>.yaml`; the field generator and the 3D replay read the profile. Add a second crop only when someone needs it and has its numbers.
4. Richer weather and soil: irrigation schedules (drip pulses wet the rows the lane probe does not see), a daily cycle of evapotranspiration, soil texture zones, several depths. Consider AquaCrop-OSPy (context.md) if crop water use needs to be realistic.
5. Robots as plug-ins: the probe model, rover size and speed, and the strategy are already swappable; add a small interface so a team can test its own robot or sensor model without editing agrisim.
6. Phase 2 (Gazebo / ROS 2) calls this package for soil truth, so the physics test bench and the decision test bench share one soil.

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
    > uv run agrisim run --config configs/demo.yaml --seed 7   (M6, 2026-10-13)
    policy         full_coverage
    RMSE / MAE     0.0299 / 0.0230 m3/m3   R2 0.677
    dry cells      precision 0.870  recall 0.116  F1 0.205  (truth dry fraction 0.072)
    calibration95  0.979
    probes         59 valid / 60 used
    path / time    465.7 m / 1685 s
    lane coverage  1.000
    plant contacts 0
    > uv run agrisim bench --config configs/demo.yaml --seeds 0-49 --budget 30 --workers 4   (M7, 2026-10-13; full table in runs/bench_*/summary.md)
    | metric          | fixed_spacing      | random             | greedy_variance    | greedy_variance_per_cost |
    | rmse            | 0.03225 +/- 0.0016 | 0.03671 +/- 0.0018 | 0.0327 +/- 0.0019  | 0.03866 +/- 0.0024 |
    | r2              | 0.5835 +/- 0.043   | 0.4588 +/- 0.055   | 0.5653 +/- 0.055   | 0.391 +/- 0.078    |
    | dry_f1          | 0.3254 (n=39)      | 0.22 (n=38)        | 0.4357 (n=33)      | 0.3707 (n=35)      |
    | calibration_95  | 0.9673             | 0.9637             | 0.9605             | 0.9522             |
    | path_length_m   | 465.7              | 737.8              | 785.2              | 151.5              |
    | mission_time_s  | 1351               | 1965               | 2023               | 652.1              |
    | plant_contacts  | 0                  | 0                  | 0                  | 0                  |
    Kriging RMSE < global-mean RMSE: 50/50, 50/50, 49/50, 48/50 seeds.
    > uv run agrisim train --config configs/demo.yaml --timesteps 200000 --seed 0 --n-envs 6 --out runs/ppo_v1   (M8; 1467 s; ep_rew_mean -0.04 -> ~0.2)
    > uv run agrisim eval --model runs/ppo_v1/model.zip --config configs/demo.yaml --seeds 100-149 --budget 30 --workers 6
    | metric          | fixed_spacing      | random             | greedy_variance    | greedy_var_per_cost | ppo               |
    | rmse            | 0.03378 +/- 0.0018 | 0.03544 +/- 0.0019 | 0.03328 +/- 0.0019 | 0.03637 +/- 0.0023  | 0.03573 +/- 0.002 |
    | r2              | 0.5438             | 0.4974             | 0.5534             | 0.4644              | 0.4864            |
    | dry_f1          | 0.2393 (n=36)      | 0.251 (n=33)       | 0.3265 (n=42)      | 0.2802 (n=34)       | 0.268 (n=36)      |
    | path_length_m   | 465.7              | 733.4              | 774.9              | 149.3               | 689.2             |
    | mission_time_s  | 1351               | 1955               | 1999               | 647.8               | 1860              |
    | plant_contacts  | 0                  | 0                  | 0                  | 0                   | 0                 |

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
