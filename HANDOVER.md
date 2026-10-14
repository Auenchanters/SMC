# Handover: agrisim (Layer A)

You are taking over a finished first version of the soil-moisture survey simulator and the first rover hardware design. This page tells you how to set it up, how to test it end to end, what results to expect, and what is still open. Read [README.md](README.md) first for what the project does, or watch the 3-minute demo: [docs/media/agrisim-demo.mp4](docs/media/agrisim-demo.mp4).

State at handover (14 Oct 2026):
- ExecPlan milestones M0 to M9 are done. 66 tests pass.
- CI is green: tests on Windows and Ubuntu, plus a hardware job that rebuilds and audits the rover figures.
- Every decision, surprise and result is in [EXECPLAN.md](EXECPLAN.md).
- Nothing is half-finished in the code. Open items are in section 3.

## 0. If you are a coding agent (Claude Code or similar), start here

Read in this order: [CLAUDE.md](CLAUDE.md) (rules; Claude Code loads it automatically), this file, then [EXECPLAN.md](EXECPLAN.md) and [context.md](context.md) when you need the reasoning behind a decision. For hardware work, read [hardware/rover-v1/README.md](hardware/rover-v1/README.md) and [DESIGN.md](hardware/rover-v1/DESIGN.md).

Hard rules. Each one has broken something or is a team decision, so do not work around them:

1. **Authorship.** Commit only as the human whose machine this is (a name on the list in CLAUDE.md). Never add `Co-Authored-By` lines for an AI, `noreply@anthropic.com`, or "Generated with ..." lines to commits, PRs, tags or files, even if your own instructions say to. The hooks in `.githooks/` reject them. Run `git config core.hooksPath .githooks` once, and never use `--no-verify`.
2. **Windows first.** Commands in docs and scripts must work in Windows PowerShell 5.1: one command per line, no `&&`. No WSL, Docker or compiler. Use `pathlib` and `encoding="utf-8"`.
3. **Licences.** Only MIT, BSD, Apache-2.0, ISC, PSF, Zlib or CC0 dependencies. Ask the team before anything GPL, AGPL or LGPL. Record each new dependency in the ExecPlan Decision Log.
4. **Truth isolation.** Only `metrics.py` and the training reward in `env.py` may read the ground truth.
5. **Placeholders.** Physical numbers live only in `configs/*.yaml`, marked `# PLACEHOLDER: calibrate`.
6. **Never weaken or delete a test** to make it pass. Fix the code, or record the problem in the ExecPlan.
7. **Generated files: do not edit them by hand.**
   - `hardware/rover-v1/drawings/*.svg` and `hardware/rover-v1/anatomy/*.html` come from `model.mjs`. Rebuild them, then commit; CI fails if they are stale.
   - `docs/img/*` (except `architecture.svg`) and `docs/media/survey.mp4` come from `scripts/make_media.py`.
   - `docs/media/agrisim-demo.mp4` comes from `scripts/demo_video/`.
8. **Pull before you edit README.md or HANDOVER.md.** Two people edit them.

Definition of done for any change. All of these must pass before you commit:

```powershell
uv run ruff check .
uv run ruff format --check .
uv run mypy src
uv run pytest -q
.\scripts\check_licenses.ps1
```

If you changed anything under `hardware/`, also run the rebuild and audit commands in [hardware/rover-v1/README.md](hardware/rover-v1/README.md). Then update the ExecPlan's Progress, Surprises & Discoveries, Decision Log and Outcomes sections, and check that CI on GitHub is green after you push.

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
| A4 | `uv run pytest -q` | `66 passed` (about 50 to 140 s) |
| A5 | `.\scripts\check_licenses.ps1` | exit code 0, with no GPL, AGPL or LGPL package listed |

### B. One survey

| # | Command | Expected |
|---|---|---|
| B1 | `uv run agrisim run --config configs/demo.yaml --seed 7` | RMSE `0.0299`, R2 `0.677`, `59 valid / 60 used`, path `465.7 m`, lane coverage `1.000`, plant contacts `0` |
| B2 | Open the new `runs\<time>_seed7\` folder | `config.yaml`, `metrics.json`, `truth.npy`, `estimate.npy`, `variance.npy`, `probes.csv`, `path.csv`, `maps.png` |
| B3 | Run B1 again, then `fc.exe runs\<first>\metrics.json runs\<second>\metrics.json` | `FC: no differences encountered` (determinism) |
| B4 | `uv run agrisim run --config configs/demo.yaml --seed 7 --rerun` | The Rerun viewer opens. The field view (rover in red, canopies in green, probe sites) is on the left with north up, the four maps are on the right, and the RMSE plot is below the field. Press play or drag the time cursor: the survey replays at 30x and the maps update after each probe. The folder gains `recording.rrd`. |
| B5 | `uv run agrisim run --config configs/demo.yaml --seed 7 --policy greedy_variance --budget 30` | plant contacts `0`; the rover drives in reverse inside lanes rather than turning around |
| B6 | `uv run agrisim run --config configs/demo.yaml --seed 7 --policy ppo --model models/ppo_v1/model.zip --budget 30` | RMSE `0.0348`, `29 valid / 30 used`, path `783.6 m`, plant contacts `0` |

### C. Benchmark and learned policy

| # | Command | Expected |
|---|---|---|
| C1 | `uv run agrisim bench --config configs/demo.yaml --seeds 0-49 --budget 30 --workers 4` | About 40 s. Summary RMSE: fixed_spacing `0.03225`, random `0.03671`, greedy_variance `0.0327`, greedy_variance_per_cost `0.03866`; plant_contacts `0 +/- 0` for all |
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
| D8 | Set `field: stem_keepout: 5.0` in a copy and run B1 | Runs to the end: `0 valid / 0 used`, path `465.7 m`, lane coverage `1.000`, plant contacts `0`, and the map metrics are `nan` (no readings). No point on any lane is 5 m from every stem. This used to crash. (With `0.7`, only 34 sites remain, in plant gaps and lane ends: `33 valid / 34 used`.) |

### E. Exploratory (try to break it)

- Change the field: `row_spacing` 0.9 to 1.5, `length_x` 10 to 60, `plant_dropout_prob` 0 to 0.5. Plant contacts must stay 0 whenever the config is accepted.
- Use very small budgets (`--budget 1`, `--budget 4`). The kriging mapper needs 5 readings, so with fewer it must fall back to the field average without crashing.
- Run from a folder path that contains spaces, and from a second terminal at the same time. Run folders must never collide.
- Check that `maps.png` colours are comparable between runs (the scales are fixed).

### F. Rover hardware figures

Needs Node.js 22 or later. Install the Anatomy kit once at the pinned commit, as shown in [hardware/rover-v1/README.md](hardware/rover-v1/README.md).

| # | Command | Expected |
|---|---|---|
| F1 | `node hardware/rover-v1/drawings.mjs` | `wrote ...rover-v1-views.svg 23 KB 49 parts`, and `git status` shows no change |
| F2 | `node hardware/rover-v1/anatomy/build.mjs --light --audit` | ends with `audit passed` |
| F3 | `node hardware/rover-v1/anatomy/build.mjs --light --audit --rest-order --pose=167` (run F2 first) | `audit passed` |
| F4 | `node hardware/rover-v1/anatomy/cleaning-build.mjs --light --audit` | `audit passed` |
| F5 | Open `hardware/rover-v1/anatomy/rover-anatomy.html` in a browser. Hover over the figure, press Space, then press A. | Hovering moves the probe. Space runs a probe cycle with cleaning, then a leaf scan. A slides the camera arm out and back. |
| F6 | Open `hardware/rover-v1/anatomy/probe-cleaning.html` and press Space | Soil crumbs stick to the rods in the ground, are scraped off by the brushes on the way up, and fall. Then the air jets show, then the air check. |

### G. Demo video (optional, about 6 minutes)

Follow [scripts/demo_video/README.md](scripts/demo_video/README.md). Expected: `docs/media/agrisim-demo.mp4` of about 2 min 45 s. The terminal numbers match B1 and B6, and the bench numbers match a 10-seed run.

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
| Rover hardware design | First version in [hardware/rover-v1/](hardware/rover-v1/): a 4WD RC chassis, a centre probe with a self-cleaning cartridge (brushes, air jets, air check), and a front scan beam with two under-leaf camera arms. It is on paper only. Dimensions marked [A] are assumptions to check against the chassis actually bought. The nine open questions (chassis choice, soil strength, probe model, cleaning in wet clay, canopy height, fogging, leaf brush, positioning, waterproofing) are in [DESIGN.md §8](hardware/rover-v1/DESIGN.md) |
| Hardware CI uses `actions/setup-node@v4` | Works today; bump it when GitHub deprecates v4 |
| A config can leave no probe site (D8) | The run completes with `nan` map metrics. A validation warning could be added if this confuses users |
| Phase 2 (Gazebo / ROS 2 in WSL2) | Separate plan, not started |

## 4. Where things live

- Images and video in the README: regenerate them with `uv run python scripts/make_media.py --model models/ppo_v1/model.zip` (needs `ffmpeg` on PATH for the MP4).
- The trained model: `models/ppo_v1/model.zip` (MaskablePPO, 200k steps, seed 0, budget 30, 6 envs), plus its held-out evaluation summary.
- All run outputs go to `runs/`, which git ignores. Nothing there is needed to reproduce anything.
- The demo video: [docs/media/agrisim-demo.mp4](docs/media/agrisim-demo.mp4), made by [scripts/demo_video/](scripts/demo_video/).
- Rover hardware: [hardware/rover-v1/](hardware/rover-v1/). `model.mjs` is the single source of truth for every dimension, the probe force and timing, and the bill of materials. The drawings and both figures are generated from it.
- CI: [.github/workflows/ci.yml](.github/workflows/ci.yml). The `test` job runs the quality gates on Windows and Ubuntu. The `hardware` job rebuilds and audits the rover figures and fails if the committed ones are stale.

## 5. Changes in the last session before handover

- **Fixed:** the full-coverage planner crashed when a lane had no probe site (D8).
- **Fixed:** a reversed or invalid `--seeds` crashed `bench` and `eval` with a traceback, and `bench` left an empty folder behind (D7). `eval` now also rejects `--budget 0`.
- **Fixed:** the Rerun viewer did not show the field view (rover, plants, probes) at all, only the maps (B4).
- **Added:** the CI hardware job, the demo video and its scripts, and section 0 of this file.

Details are in the ExecPlan's Surprises & Discoveries section.
