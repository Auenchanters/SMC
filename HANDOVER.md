# Handover: agrisim (Layer A)

You are taking over a finished first version of the soil-moisture survey simulator and the first rover hardware design. This page tells you how to set it up, how to test it end to end, what results to expect, and what is still open. Read [README.md](README.md) first for what the project does, or watch the two narrated videos: the [explainer](docs/media/agrisim-explainer.mp4) and the [live demo](docs/media/agrisim-demo.mp4). The quickest way to see what the project does is the 3D replay: `uv run agrisim run --config configs/demo.yaml --seed 7 --view`.

State (17 Oct 2026; first handover 14 Oct):
- ExecPlan milestones M0 to M9, M11 (weather, probe misreads, rechecks) and M12 (agribench, the benchmark) are done, plus the 3D replay and rover v2. M10 (photoreal replay) has phases 1 to 3 done; phase 4 (plants) is open. 134 tests pass.
- Our agribench entry `planned_survey` scores 78.5 since the repeat-probe fix of 18 Oct (73.9 and 75.8 on earlier fresh fields; 0 = random, 100 = clairvoyant oracle). It has the highest overall score of any real strategy and finds dry zones better than every baseline on all 8 tasks, but on map error it only ties the best simple design, but the benchmark still says "below state of the art". Every `agrisim suite` run writes `brief.md`, the next task for whoever improves the entry ([benchmarks/README.md](benchmarks/README.md)).
- CI is green: tests on Windows and Ubuntu, a hardware job that rebuilds and audits the rover figures, and the agribench quick tier.
- Every decision, surprise and result is in [EXECPLAN.md](EXECPLAN.md).
- Nothing is half-finished in the code. Open items are in section 3.

## 0. If you are a coding agent (Claude Code or similar), start here

Read in this order: [CLAUDE.md](CLAUDE.md) (rules; Claude Code loads it automatically), this file, then [EXECPLAN.md](EXECPLAN.md) and [context.md](context.md) when you need the reasoning behind a decision. For hardware work, read [hardware/rover-v2/README.md](hardware/rover-v2/README.md) and [DESIGN.md](hardware/rover-v2/DESIGN.md) (v1 in `hardware/rover-v1/` is superseded and kept for reference).

Hard rules. Each one has broken something or is a team decision, so do not work around them:

1. **Authorship.** Commit only as the human whose machine this is (a name on the list in CLAUDE.md). Never add `Co-Authored-By` lines for an AI, `noreply@anthropic.com`, or "Generated with ..." lines to commits, PRs, tags or files, even if your own instructions say to. The hooks in `.githooks/` reject them. Run `git config core.hooksPath .githooks` once, and never use `--no-verify`.
2. **Windows first.** Commands in docs and scripts must work in Windows PowerShell 5.1: one command per line, no `&&`. No WSL, Docker or compiler. Use `pathlib` and `encoding="utf-8"`.
3. **Licences.** Only MIT, BSD, Apache-2.0, ISC, PSF, Zlib or CC0 dependencies. Ask the team before anything GPL, AGPL or LGPL. Record each new dependency in the ExecPlan Decision Log.
4. **Truth isolation.** Only `metrics.py` and the training reward in `env.py` may read the ground truth.
5. **Placeholders.** Physical numbers live only in `configs/*.yaml`, marked `# PLACEHOLDER: calibrate`.
6. **Never weaken or delete a test** to make it pass. Fix the code, or record the problem in the ExecPlan.
7. **Generated files: do not edit them by hand.**
   - `hardware/rover-v*/drawings/*.svg`, `hardware/rover-v*/anatomy/*.html` and `hardware/rover-v2/CALCULATIONS.md` come from each folder's `model.mjs`. Rebuild them, then commit; CI fails if they are stale.
   - `docs/img/*` (except `architecture.svg`) and `docs/media/survey.mp4` come from `scripts/make_media.py`.
   - `docs/media/agrisim-explainer.*`, `docs/media/agrisim-demo.*` and `docs/img/viewer3d*.jpg` come from `scripts/demo_video/`.
   - `src/agrisim/viewer3d/rover-model.mjs` is a byte-for-byte copy of `hardware/rover-v2/model.mjs` (the 3D rover is built from it). After changing the model, copy it; a test fails until you do.
   - `src/agrisim/viewer3d/vendor/` is three.js 0.186.1 exactly as published (MIT); addons are in `vendor/jsm/` with three.js's own folder layout. Do not edit it; to upgrade, replace the files and update its README.txt and the Decision Log.
   - `src/agrisim/viewer3d/assets/` holds CC0 assets (sky photo, and later textures and models). Each one is listed with its source and licence in `assets/LICENSES.md`; add new ones there.
8. **Pull before you edit README.md or HANDOVER.md.** Two people edit them.

Definition of done for any change. All of these must pass before you commit:

```powershell
uv run ruff check .
uv run ruff format --check .
uv run mypy src
uv run pytest -q
.\scripts\check_licenses.ps1
```

If you changed anything under `hardware/`, also run the rebuild and audit commands in that folder's README ([v2](hardware/rover-v2/README.md), [v1](hardware/rover-v1/README.md)). Then update the ExecPlan's Progress, Surprises & Discoveries, Decision Log and Outcomes sections, and check that CI on GitHub is green after you push.

Do not run `--rerun` from an agent's shell unless the user wants the viewer. It opens a window, and the command does not return until that window is closed (see EXECPLAN, M6 surprises). To produce a recording without a window, call `run_survey(..., rerun=True, rrd_path=..., spawn=False)`.

## 1. Set up (Windows PowerShell)

Run one command per line. PowerShell 5.1 has no `&&`.

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
git clone git@github.com:Auenchanters/SMC.git
cd SMC
uv sync
git config core.hooksPath .githooks
```

Then add your GitHub name to the contributor list at the top of [CLAUDE.md](CLAUDE.md) (it says "teammate: TBD"). That list is a project rule: only the named team members commit to this repository. Coding-agent attribution lines are blocked by the hooks in `.githooks/`. Never commit with `--no-verify`.

## 2. Test plan

Work through these in order and tick each one. "Expected" values came from the team lead's laptop (Windows 11, Python 3.13.9, 16 threads). Map metrics should match exactly, because runs are deterministic. Timings will differ.

### A. Quality gates

| # | Command | Expected |
|---|---|---|
| A1 | `uv run ruff check .` | `All checks passed!` |
| A2 | `uv run ruff format --check .` | all files already formatted |
| A3 | `uv run mypy src` | `Success: no issues found in 18 source files` |
| A4 | `uv run pytest -q` | `70 passed` (about 50 to 140 s) |
| A5 | `.\scripts\check_licenses.ps1` | exit code 0, with no GPL, AGPL or LGPL package listed |

### B. One survey

| # | Command | Expected |
|---|---|---|
| B1 | `uv run agrisim run --config configs/demo.yaml --seed 7` | RMSE `0.0299`, R2 `0.677`, `59 valid / 60 used`, path `465.7 m`, lane coverage `1.000`, plant contacts `0` |
| B2 | Open the new `runs\<time>_seed7\` folder | `config.yaml`, `metrics.json`, `truth.npy`, `estimate.npy`, `variance.npy`, `probes.csv`, `path.csv`, `maps.png` |
| B3 | Run B1 again, then `fc.exe runs\<first>\metrics.json runs\<second>\metrics.json` | `FC: no differences encountered` (determinism) |
| B4 | `uv run agrisim run --config configs/demo.yaml --seed 7 --rerun` | The Rerun viewer opens. Left: "The field from above" (robot in red, plants in green, readings as dots) and "Average map error over time". Right: a "How to read this" panel and the four maps with plain names. Press play or drag the time bar: the survey replays at 30x and the maps update after each reading. The folder gains `recording.rrd`. |
| B4b | `uv run agrisim run --config configs/demo.yaml --seed 7 --view` | Prints the same numbers as B1, then `3D viewer: http://127.0.0.1:<port>/` and opens it in your browser. The robot (AgriRover v2: rocker beams that follow the ground, the probe tower in the open bay) drives between tomato rows, stops, pushes the probe in; marks appear and the map fills in. The "Right now" panel ends at "Survey complete", `60 of 60 (1 failed)`, `466 m`, plants touched `0`, map off by `±3.0 % points`. Ctrl+C in the terminal stops it. The folder gains `scene.json` (about 1.2 MB). |
| B4c | `uv run agrisim view runs\<the B4b folder>` | The same replay opens again without re-running. On a folder without `scene.json` it says to use `--view` (exit code 2). |
| B4d | `uv run agrisim run --config configs/scenarios/rain_shower.yaml --seed 7 --policy fixed_plus_recheck --view` | RMSE `0.0303`, `59 valid / 60 used`, path `641.0 m / 2054 s`, plant contacts `0`. In the replay, from 10:00 to 20:00 of mission time it rains: streaks fall, the light dims, the soil turns darker and wetter, and the panel says "Raining 20 mm an hour". After the route, the robot goes back to a few spots; the panel says "checking again" and why. |
| B5 | `uv run agrisim run --config configs/demo.yaml --seed 7 --policy greedy_variance --budget 30` | plant contacts `0`; the rover drives in reverse inside lanes rather than turning around |
| B6 | `uv run agrisim run --config configs/demo.yaml --seed 7 --policy ppo --model models/ppo_v1/model.zip --budget 30` | RMSE `0.0348`, `29 valid / 30 used`, path `783.6 m`, plant contacts `0` |

### C. Benchmark and learned policy

| # | Command | Expected |
|---|---|---|
| C1 | `uv run agrisim bench --config configs/demo.yaml --seeds 0-49 --budget 30 --workers 4 --strategies fixed_spacing,random,greedy_variance,greedy_variance_per_cost` | About 40 s (without `--strategies` it runs all 12 strategies and takes several minutes). Summary RMSE: fixed_spacing `0.03225`, random `0.03671`, greedy_variance `0.0327`, greedy_variance_per_cost `0.03866`; plant_contacts `0 +/- 0` for all |
| C2 | Same as C1 with `--workers 1` | Same numbers as C1 (serial = parallel), slower |
| C3 | `uv run agrisim eval --model models/ppo_v1/model.zip --config configs/demo.yaml --seeds 100-149 --budget 30 --workers 6` | About 50 s. Matches [models/ppo_v1/eval_seeds100-149_budget30.md](models/ppo_v1/eval_seeds100-149_budget30.md), e.g. ppo RMSE `0.03573` |
| C4 | `uv run agrisim train --config configs/demo.yaml --timesteps 2000 --seed 0 --out runs/ppo_smoke` | Finishes in about 75 s and writes `runs\ppo_smoke\model.zip` |
| C5 (optional, ~25 min) | `uv run agrisim train --config configs/demo.yaml --timesteps 200000 --seed 0 --n-envs 6 --out runs/ppo_v2` | Episode reward (`ep_rew_mean` in the log) rises from about -0.04 to about 0.2. Results may differ slightly from `models/ppo_v1` because of parallel environment timing |

### D. Things that must fail cleanly

| # | What to do | Expected |
|---|---|---|
| D1 | Copy `configs/demo.yaml` to `configs/wide_rover.yaml` and set `rover: width: 0.60`, then run B1 with that config | A validation error that states the numbers ("clear lane width 0.600 m ... is less than rover width ..."), not a crash |
| D2 | Set `field: headland: 1.0` in a copy, then run B1 | An error saying the headland is too short to turn in place |
| D3 | `uv run agrisim eval --model models/ppo_v1/model.zip --config configs/demo.yaml --seeds 1000-1001` | Rejected: evaluation seeds must be below 1000 (training uses seeds of 1000 and above) |
| D4 | `uv run agrisim run --config configs/demo.yaml --policy nonsense` | An error listing the valid policies (exit code 2); no run folder is created |
| D5 | `uv run agrisim bench --config configs/demo.yaml --seeds 0-1 --strategies foo` | `unknown strategies ['foo']` |
| D6 | Set `probe: failure_prob: 0.5` in a copy and run B1 | Runs to the end with `42 valid / 60 used` and plant contacts `0`. Across many seeds the failure rate averages 0.5 (measured 0.508 over 20 seeds); seed 0 happens to lose only 18 |
| D7 | `uv run agrisim bench --config configs/demo.yaml --seeds 5-3` (also try `--seeds abc`) | `Invalid value for --seeds: bad seed range '5-3'` (exit code 2); no `runs\bench_*` folder is created |
| D9 | Add a top-level line `dt: 1.0` to a copy and run B1 | `dt 1.0 s is too long` (exit code 2), no run folder |
| D10 | In a copy set `rover: length: 0.8`, `safety_margin: 0.0` and `field: row_spacing: 1.0`, `headland: 1.5` | An error naming the `tracking allowance` (this config used to touch plants 34 times) |
| D11 | In copies set `soil: grid_resolution: 30.0`; or `soil: corr_length_range: [1000.0, 2000.0]`; or `probe: bias: .nan` | `too coarse`; `soil grid too large to generate`; `finite number` |
| D12 | In a copy set `field: length_x: 10.0`, `width_y: 4.8`, then run B6 with it | `was trained for a different field` (exit code 2), no run folder |
| D13 | `uv run agrisim run --config configs/demo.yaml --model models/ppo_v1/model.zip` (no `--policy ppo`) | `--model is only used with --policy ppo` |
| D14 | `uv run agrisim bench --config configs/demo.yaml --seeds 0-2,1` | `seed(s) [1] listed more than once` |
| D15 | Start `uv run agrisim view <a --view run folder> --port 8765 --no-browser` in two terminals | The second one is refused: `cannot listen on port 8765` |
| D8 | Set `field: stem_keepout: 5.0` in a copy and run B1 | Runs to the end: `0 valid / 0 used`, path `465.7 m`, lane coverage `1.000`, plant contacts `0`, and the map metrics are `nan` (no readings). No point on any lane is 5 m from every stem. This used to crash. (With `0.7`, only 34 sites remain, in plant gaps and lane ends: `33 valid / 34 used`.) |

### D2. The benchmark (agribench, [benchmarks/README.md](benchmarks/README.md))

| # | What to do | Expected |
|---|---|---|
| G1 | `uv run agrisim suite --tier quick --workers 8 --fresh-key handover` | About 4 to 6 minutes; prints `N/1920 runs` as it goes, then the report and `wrote runs\suite_<time>`. Status `BELOW STATE OF THE ART` today, exit code 1 at the default `--fail-on saturation`. The hard gate and the regression gate (against `benchmarks\v1\baseline.json`) pass |
| G2 | Run G1 again with the same key | The same scores to the last digit (the report's `overall` and `tasks` match) |
| G3 | Add a comment line to `benchmarks\v1\worlds\demo.yaml`, run G1 with `--fail-on hard`, then undo the edit | `HARD FAIL` and `worlds/demo.yaml: changed`, exit code 1 |
| G4 | Set `strategy: oracle_rmse` in `benchmarks\solution.yaml`, run G1, then undo | Rejected: an oracle reads the truth and cannot be the entry |
| G5 | `uv run agrisim gate <the G1 folder>\report.json --fail-on hard` | Prints the status; exit code 0 |

### E. Exploratory (try to break it)

- Change the field: `row_spacing` 0.9 to 1.5, `length_x` 10 to 60, `plant_dropout_prob` 0 to 0.5. Plant contacts must stay 0 whenever the config is accepted.
- Use very small budgets (`--budget 1`, `--budget 4`). The kriging mapper needs 5 readings, so with fewer it must fall back to the field average without crashing.
- Run from a folder path that contains spaces, and from a second terminal at the same time. Run folders must never collide.
- Check that `maps.png` colours are comparable between runs (the scales are fixed).

### F. Rover hardware figures

Needs Node.js 22 or later. Install the Anatomy kit once at the pinned commit, as shown in [hardware/rover-v1/README.md](hardware/rover-v1/README.md).

| # | Command | Expected |
|---|---|---|
| F0 | `node hardware/rover-v2/calc.mjs` then `node hardware/rover-v2/drawings.mjs` | `wrote ...CALCULATIONS.md`, `wrote ...rover-v2-views.svg 22 KB 49 parts`, and `git status` shows no change. CALCULATIONS.md shows 22.4 kg, 175 N usable probe push, 42 deg side slope, 624 mm overall height, about 7.1 surveys per charge, a 28.0 s probe cycle |
| F0b | `uv run agrisim run --config configs/scenarios/rover_v2.yaml --seed 7` | The v2 footprint passes validation: RMSE `0.0299`, path `465.7 m / 2825 s`, plant contacts `0` |
| F1 | `node hardware/rover-v1/drawings.mjs` | `wrote ...rover-v1-views.svg 23 KB 49 parts`, and `git status` shows no change |
| F2 | `node hardware/rover-v1/anatomy/build.mjs --light --audit` | ends with `audit passed` |
| F3 | `node hardware/rover-v1/anatomy/build.mjs --light --audit --rest-order --pose=167` (run F2 first) | `audit passed` |
| F4 | `node hardware/rover-v1/anatomy/cleaning-build.mjs --light --audit` | `audit passed` |
| F5 | Open `hardware/rover-v1/anatomy/rover-anatomy.html` in a browser. Hover over the figure, press Space, then press A. | Hovering moves the probe. Space runs a probe cycle with cleaning, then a leaf scan. A slides the camera arm out and back. |
| F6 | Open `hardware/rover-v1/anatomy/probe-cleaning.html` and press Space | Soil crumbs stick to the rods in the ground, are scraped off by the brushes on the way up, and fall. Then the air jets show, then the air check. |
| F7 | `node hardware/rover-v2/anatomy/build.mjs --light --audit`, then the `--rest-order` pose audits in [hardware/rover-v2/README.md](hardware/rover-v2/README.md) (`--pose=270`, `--pose=120`, `--rail=-60`, `--twist=100`) | each ends with `audit passed` (about a minute each) |
| F8 | `node hardware/rover-v2/anatomy/cleaning-build.mjs --light --audit` | `audit passed` |
| F9 | Open `hardware/rover-v2/anatomy/rover-anatomy.html`. Wait, then press T, then R | The tour runs a probe cycle (the carriage runs down the axis, the bellows folds, the probe goes into the notch), shifts the probe 60 mm along its rail (`129 N usable`), then raises the twist pads: the beams turn ±19.5°, the bar rocks, the body stays level and rises 45 mm. T and R toggle the twist and the rail by hand |
| F10 | Open `hardware/rover-v2/anatomy/probe-cleaning.html` and press Space | One stubborn sample escalates: wiper and brushes (level 0), air knife and a failed air check (1), a second stroke (2), then a water spray, drying and a passing check (3). Crumbs fall at each level |

### G. Demo video (optional, about 12 minutes)

Follow [scripts/demo_video/README.md](scripts/demo_video/README.md). Expected: `docs/media/agrisim-explainer.mp4` (about 3 min 20 s) and `docs/media/agrisim-demo.mp4` (about 2 min 20 s), each with a `.srt` and a `.jpg` beside it. The terminal numbers in the demo are a real `agrisim run --policy planned_survey` on seed 7 and a real 10-seed `agrisim bench`.

Report problems as GitHub issues with the command, the seed and the config file attached. Because runs are deterministic, the seed alone reproduces the bug.

## 3. Known open items

| Item | Status / next step |
|---|---|
| Soil and probe numbers are placeholders | Need agronomist input and real probe data ([context.md §12](context.md)). Every number in `configs/demo.yaml` is marked `PLACEHOLDER: calibrate`. |
| Learned PPO policy does not beat the baselines | Next: a fully convolutional per-cell action head and longer training; compare on seeds 100-149 at budget 30 |
| Optional CUDA training on the RTX 3050 | Documented in the README, not yet verified; `train` uses `device="cpu"` |
| gymnasium pinned to 1.3.0 (1.4.0 exists) | Upgrade once stable-baselines3 confirms 1.4 support |
| `pathspec` (MPL-2.0) comes in via mypy | Dev tool only, never shipped; it is weak copyleft, not GPL. The team should acknowledge it. |
| Teammate's name in CLAUDE.md | The contributor list says "teammate: TBD". Add your GitHub name there in your first commit |
| Rover hardware design | v2 in [hardware/rover-v2/](hardware/rover-v2/DESIGN.md) replaces v1 (2026-10-15). It is on paper only. Its eight bench questions are in [DESIGN.md §9](hardware/rover-v2/DESIGN.md): soil strength, cleaning-level shares, the dock's reference block, the controller firmware licence, pivot stiffness, tyre pressure, positioning, and canopy height. Both anatomy figures and the 3D replay show v2. Its probe axis is now 624 mm tall, the tallest part (the first v2 model's 134 mm axis could not make its stroke; see EXECPLAN Surprises); check it against the canopy (DESIGN §9.8) |
| Hardware CI uses `actions/setup-node@v4` | Works today; bump it when GitHub deprecates v4 |
| 3D replay: JavaScript is not linted or unit-tested | The Python side (scene data, server, model copy) is tested. The page itself was checked by eye and by the demo-video recorder. If it grows, add a small headless-browser smoke test |
| 3D replay: water or soil effects | Considered [threejs-particle-fluids](https://github.com/dgreenheck/threejs-particle-fluids) (MIT) for drip-irrigation water or the probe's air blast. Not used: it needs WebGPU with no WebGL fallback, so the page would stop working on some laptops and in the headless recorder |
| A config can leave no probe site (D8) | The run completes with `nan` map metrics. A validation warning could be added if this confuses users |
| Weather (M11) is optimistic | The robot's water-balance model matches the truth's except for soak-in, so rechecks are likely worth more in a real field. There is no irrigation (drip wets the rows, but the probe stands in the lanes), and no daily cycle. See the ExecPlan M11 Decision Log |
| PPO environment has no weather or rechecks | On purpose, so the M8 evaluation stays reproducible. Add both before retraining |
| Test bench for field robots (long-term aim) | The staged roadmap is in EXECPLAN.md ("Roadmap: toward a test bench"). Step 1 is calibrating against one real field |
| Phase 2 (Gazebo / ROS 2 in WSL2) | Separate plan, not started |
| agribench: our entry is below state of the art | `planned_survey` beats every baseline on 8 of 24 task metrics, all of them dry-zone F1. Map error and CRPS tie the coverage designs on soil that does not change, which the evidence says is near the honest limit of v1; whether v2 should gate them differently is a team decision. Dry-zone detection in `harsh_b60` is won only narrowly. The latest `runs/suite_*/brief.md` lists what to try next ([benchmarks/README.md](benchmarks/README.md) Section 9) |
| `dov` baseline is set up wrongly | Our DOV-style strategy bids on every site; the paper bids only on a shortlist of the most uncertain ones. So it crawls along one lane and scores far below random, and beating it means nothing. Fixing it changes a v1 baseline: a team decision ([benchmarks/README.md](benchmarks/README.md) Section 8). The README leaves it out of the competitor table until then. |
| M10 phase 4 (plants in the 3D replay) | Not started; phases 1 to 3 are done |

## 4. Where things live

- Images and video in the README: regenerate them with `uv run python scripts/make_media.py --model models/ppo_v1/model.zip` (needs `ffmpeg` on PATH for the MP4).
- The trained model: `models/ppo_v1/model.zip` (MaskablePPO, 200k steps, seed 0, budget 30, 6 envs), plus its held-out evaluation summary.
- All run outputs go to `runs/`, which git ignores. Nothing there is needed to reproduce anything.
- The videos: [docs/media/agrisim-explainer.mp4](docs/media/agrisim-explainer.mp4) and [docs/media/agrisim-demo.mp4](docs/media/agrisim-demo.mp4), made by [scripts/demo_video/](scripts/demo_video/).
- Rover hardware: [hardware/rover-v2/](hardware/rover-v2/) (current) and [hardware/rover-v1/](hardware/rover-v1/) (superseded). In each, `model.mjs` is the single source of truth for every dimension, the probe force and timing, and the bill of materials. The drawings, v2's CALCULATIONS.md and both folders' figures are generated from it.
- CI: [.github/workflows/ci.yml](.github/workflows/ci.yml). The `test` job runs the quality gates on Windows and Ubuntu. The `hardware` job rebuilds and audits the rover figures and fails if the committed ones are stale.

## 5. Changes in the last session before handover

- **Fixed:** the full-coverage planner crashed when a lane had no probe site (D8).
- **Fixed:** a reversed or invalid `--seeds` crashed `bench` and `eval` with a traceback, and `bench` left an empty folder behind (D7). `eval` now also rejects `--budget 0`.
- **Fixed:** the Rerun viewer did not show the field view (rover, plants, probes) at all, only the maps (B4).
- **Added:** the CI hardware job, the demo video and its scripts, and section 0 of this file.
- **Added:** the 3D replay (`--view` and `agrisim view`, B4b and B4c), built so a first-time user can follow it without help. The Rerun viewer got plain panel names and a "How to read this" panel (B4).

- **Added (rover v2, 2026-10-15):** [hardware/rover-v2/](hardware/rover-v2/DESIGN.md), the physics-led redesign with an open probe bay, rocker-differential chassis, 150 mm clearance, LiFePO4 + BMS, and autonomous cleaning levels 0 to 5 with a dock. Calculations are generated from `model.mjs` (F0), and the simulator runs its footprint with `configs/scenarios/rover_v2.yaml` (F0b).
- **Fixed (robustness review, 2026-10-15):** all 22 findings of the outside review `SMC-found-and-fixed.md`, re-checked on the current code. Highlights: validated configs could touch plants (now a tracking allowance), long `dt` hung, huge fields ran out of memory, `train` crashed with a large `stem_keepout`, NaN in configs, model/field mismatches, a busy port on Windows, and the demo script carrying on after a failure. 17 regression tests are in `tests/test_robustness.py`; D9 to D15 check them by hand.
- **Added (M11):** weather (`weather:` in a config; `weather.py`), probe misreads (`probe.bad_contact_*`), the `recheck` and `fixed_plus_recheck` strategies, `extends:` scenario configs in `configs/scenarios/`, and rain in the 3D replay (B4d). Without a `weather:` section everything behaves exactly as before.
- **Added (M12, 2026-10-17):** agribench (`agrisim suite`, `agrisim gate`, `benchmarks/`), competitor baselines, the clairvoyant ceiling and CI per push (section D2). Then our entry `planned_survey` (28.5 to 73.9), `brief.md` after every suite run (the improvement loop), and suite and bench workers that Windows no longer throttles in the background (a full tier ran about 3.5 to 7 times faster).

- **Added (rover v2 visuals, 2026-10-16):** v2 anatomy figures (Fig 1 the whole rover with the probe cycle, the rail and a twist; Fig 2 the cleaning levels), audited in CI, and the 3D replay now builds v2. Fixed in the v2 model on the way: the probe axis (a 134 mm axis cannot make a 330 mm stroke; now 624 mm tall for a 290 mm stroke), the differential bar (it ran through the probe tower; now on the front box), the single rail the probe passed through (now two), and the beam tilt formula (19.5°, not 18.4°, for a 100 mm step). F0, F7 to F10.

Details are in the ExecPlan's Surprises & Discoveries section.
