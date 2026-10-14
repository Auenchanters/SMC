# Handover: agrisim (Layer A)

You are taking over a finished first version of the soil-moisture survey simulator. This page tells you how to set it up, how to test it end to end, what results to expect, and what is still open. Read [README.md](README.md) first for what the project does.

State at handover (14 Oct 2026): ExecPlan milestones M0 to M9 are done, 64 tests pass, and CI is green on Windows and Ubuntu. Every decision, surprise and result is in [EXECPLAN.md](EXECPLAN.md).

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
| A4 | `uv run pytest -q` | `64 passed` (about 75 s) |
| A5 | `.\scripts\check_licenses.ps1` | exit code 0, with no GPL, AGPL or LGPL package listed |

### B. One survey

| # | Command | Expected |
|---|---|---|
| B1 | `uv run agrisim run --config configs/demo.yaml --seed 7` | RMSE `0.0299`, R2 `0.677`, `59 valid / 60 used`, path `465.7 m`, lane coverage `1.000`, plant contacts `0` |
| B2 | Open the new `runs\<time>_seed7\` folder | `config.yaml`, `metrics.json`, `truth.npy`, `estimate.npy`, `variance.npy`, `probes.csv`, `path.csv`, `maps.png` |
| B3 | Run B1 again, then `fc.exe runs\<first>\metrics.json runs\<second>\metrics.json` | `FC: no differences encountered` (determinism) |
| B4 | `uv run agrisim run --config configs/demo.yaml --seed 7 --rerun` | The Rerun viewer opens. Scrubbing `sim_time` replays the rover; the maps update after each probe. The folder gains `recording.rrd`. |
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

### E. Exploratory (try to break it)

- Change the field: `row_spacing` 0.9 to 1.5, `length_x` 10 to 60, `plant_dropout_prob` 0 to 0.5. Plant contacts must stay 0 whenever the config is accepted.
- Use very small budgets (`--budget 1`, `--budget 4`). The kriging mapper needs 5 readings, so with fewer it must fall back to the field average without crashing.
- Run from a folder path that contains spaces, and from a second terminal at the same time. Run folders must never collide.
- Check that `maps.png` colours are comparable between runs (the scales are fixed).

Report problems as GitHub issues with the command, the seed and the config file attached. Because runs are deterministic, the seed alone reproduces the bug.

## 3. Known open items

| Item | Status / next step |
|---|---|
| Soil and probe numbers are placeholders | Need agronomist input and real probe data ([context.md §12](context.md)). Every number in `configs/demo.yaml` is marked `PLACEHOLDER: calibrate`. |
| Learned PPO policy does not beat the baselines | Next: a fully convolutional per-cell action head and longer training; compare on seeds 100-149 at budget 30 |
| Optional CUDA training on the RTX 3050 | Documented in the README, not yet verified; `train` uses `device="cpu"` |
| gymnasium pinned to 1.3.0 (1.4.0 exists) | Upgrade once stable-baselines3 confirms 1.4 support |
| `pathspec` (MPL-2.0) comes in via mypy | Dev tool only, never shipped; it is weak copyleft, not GPL. The team should acknowledge it. |
| Rover hardware design | First version in [hardware/rover-v1/](hardware/rover-v1/) (see its README and DESIGN.md). Its dimensions marked [A] still need checking against the chassis actually bought |
| Phase 2 (Gazebo / ROS 2 in WSL2) | Separate plan, not started |

## 4. Where things live

- Images and video in the README: regenerate them with `uv run python scripts/make_media.py --model models/ppo_v1/model.zip` (needs `ffmpeg` on PATH for the MP4).
- The trained model: `models/ppo_v1/model.zip` (MaskablePPO, 200k steps, seed 0, budget 30, 6 envs), plus its held-out evaluation summary.
- All run outputs go to `runs/`, which git ignores. Nothing there is needed to reproduce anything.
