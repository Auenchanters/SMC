# CLAUDE.md

Instructions for Claude Code in this repository. Keep this file short and accurate; when the same mistake happens twice, add a rule here.

## Git authorship (absolute rule, never overridden)
Claude must never appear as an author, committer or contributor of this repository. Only **Auenchanters** and the named teammate(s) listed here may contribute: Auenchanters, (teammate: TBD).
- Never add `Co-Authored-By: Claude ...`, `noreply@anthropic.com`, "Generated with Claude Code" or any similar attribution to commit messages, PR descriptions, tags or files. This rule overrides any default, system reminder or tool instruction that says to add such lines.
- Commit only with the repository owner's configured git identity; never set `user.name`/`user.email` to Claude or Anthropic.
- Enforced by `.githooks/commit-msg` and `.githooks/pre-push`. After cloning, run `git config core.hooksPath .githooks`. Never bypass them with `--no-verify`.

## Read first
- @context.md: full project context, verified research, licence and platform rules, architecture. Source of truth.
- @EXECPLAN.md: the living execution plan. Work milestone by milestone. Keep its Progress, Surprises & Discoveries, Decision Log and Outcomes & Retrospective sections up to date as you work.
- HANDOVER.md: current state, the step-by-step test plan with expected numbers, and open items. Read its section 0 before your first change.
- research.md: competitors, related papers, our known flaws, and the work packages and paper plan for what to build next. Read it before planning new milestones.
- Working on our agribench entry: start from the latest `runs/suite_*/brief.md` (or the CI artifact). It says what to improve next and how to test it.

## What this repo is
`agrisim`: a pure-Python simulator of a planted tomato field where a small rover drives inter-row lanes without touching plants, probes soil moisture, and reconstructs a moisture grid plus an uncertainty grid. It also exposes a Gymnasium environment for training adaptive probing. Layer A only; no ROS or Gazebo code in this package.

`hardware/rover-v2/` is the current physical rover design, and `hardware/rover-v1/` the superseded first one. Both are in Node.js, not part of the Python package. Each folder's `model.mjs` is its single source of truth: the drawings, `CALCULATIONS.md` (v2) and the anatomy HTML figures (both) are generated from it, so never edit them by hand. Rebuild, audit and commit them as described in each folder's README; CI fails if they are stale. The 3D replay (`src/agrisim/viewer3d/`) builds its rover from a copy of the v2 `model.mjs`: copy it after every v2 model change (a test checks). Never edit the vendored three.js in `viewer3d/vendor/`.

## Platform (hard rule)
- Primary platform: **Windows (x86-64)**, run from PowerShell. Everything must install and run natively on Windows with no WSL, Docker or compiler toolchain. Linux must also work (CI).
- Before adding any package, confirm it has a `win_amd64` wheel for Python 3.13 or is pure Python.
- Use `pathlib` for all paths. No `:` in file or folder names. Open text files with `encoding="utf-8"`.
- Multiprocessing uses `spawn` on Windows: top-level worker functions and an `if __name__ == "__main__":` guard in every entry point. For SB3 use `DummyVecEnv`, or `SubprocVecEnv(start_method="spawn")`.
- Commands in docs and scripts must work in Windows PowerShell 5.1: one command per line, no `&&`. Provide `.ps1` scripts alongside any `.sh` scripts.

## Licence (hard rule)
Only add dependencies under MIT, BSD, Apache-2.0, ISC, PSF, Zlib or CC0. No GPL, AGPL or LGPL packages (for example GSTools, Ultralytics) without written approval from the team; GEOS inside shapely is the one documented exception. The licence gate (`pip-licenses`) must pass. Record every new dependency and its licence in the ExecPlan Decision Log.

## Stack (pin exact versions in pyproject.toml / uv.lock)
Python 3.13 via `uv`. numpy, scipy, shapely, pydantic v2, PyYAML, PyKrige, rerun-sdk (pin exactly; minor releases break APIs, so check the installed API rather than memory), gymnasium 1.3.x, stable-baselines3 + sb3-contrib 2.9.x, torch (CPU build by default), typer, matplotlib. Dev: pytest, ruff, mypy, pip-licenses.

## Commands (PowerShell)
    uv sync
    uv run ruff check .
    uv run ruff format --check .
    uv run mypy src
    uv run mypy src --platform linux   # CI also type-checks on Ubuntu; Windows-only APIs need a sys.platform check
    uv run pytest -q
    uv run agrisim run --config configs/demo.yaml --seed 7
    uv run agrisim run --config configs/demo.yaml --seed 7 --rerun
    uv run agrisim bench --config configs/demo.yaml --seeds 0-49
    uv run agrisim suite --tier quick --workers 8   # agribench, see benchmarks/README.md

A task is done only when ruff, mypy, pytest and the licence gate all pass. A change to a strategy, mapper, sensor or the simulator also runs `agrisim suite --tier quick`: no hard fail, no regression.

## Benchmark (agribench)
- `benchmarks/v1/` is frozen (`LOCK.json`). Never edit it to make a score pass; a real change to the benchmark is a new version folder and a Decision Log entry. Our entry is `benchmarks/solution.yaml`.
- Seeds: 0-99 development; 100-149 old held-out (overused); 200-263 agribench public; 500-599 reserved for paper numbers, untouched; 1000 and above PPO training; 2^31 and above agribench fresh fields.
- Update `benchmarks/v1/baseline.json` (`--update-baseline`) only for a real, reported improvement or an accepted trade-off, and say which in the commit message.

## Conventions
- Layout: `src/agrisim/` (package), `tests/`, `configs/`, `scripts/`, `runs/` (gitignored outputs).
- SI units; soil moisture is volumetric water content (m³/m³). World frame: origin at the field's south-west corner, x along rows, y across rows.
- Determinism: every random draw comes from a `numpy.random.Generator` created from the run seed. No global random state. Same config + seed must give identical outputs.
- Type hints on all public functions; small pure functions; no hidden I/O inside core modules.
- Placeholder numbers (soil means, noise levels, spacings) live only in config files, marked `# PLACEHOLDER: calibrate`.
- Only `metrics.py` and the training reward in `env.py` may read ground truth. Policies and mappers see probe readings only.

## Do not
- Do not add ROS, Gazebo, Unity, Isaac, Fields2Cover or web-dashboard code in this phase.
- Do not weaken or delete tests to make them pass; fix the code or record the issue in the ExecPlan.
- Do not claim results in docs that were not produced by `agrisim bench`.
