# Week plan, 14 to 20 November 2026

Goal: one redesigned web app (command centre and 3D replay) running on a Hugging Face Space, with the debrief written by Qwen 3.5 on ZeroGPU.

Each working day ends with the gates green (ruff, ruff format, mypy on Windows and Linux, pytest, licence gate), a commit, a push, and `.claude/handoff.md` updated.

## Budget

The weekly usage limit is about 71% used and resets on 18 Nov at 21:00 UTC (19 Nov, 02:30 IST). Until then the work is kept small: decisions, the design file and the server skeleton, done on a cheaper model where the step is mechanical. The heavy build and the deploy go after the reset.

## Plan

| Day | Work | Done when |
|---|---|---|
| Fri 14 | The owner picks one of the three redesigns in `design/redesigns/` (A field book, B night console, C row marker), names the Hugging Face Space and runs `hf auth login`. | A direction is chosen and the Space name is known. |
| Sat 15 | `DESIGN.md` for the chosen direction (design-md-planner): tokens, type scale, the one accent's job, what does not animate. Change the "no web-dashboard code" rule in `CLAUDE.md`. | `DESIGN.md` passes the anti-slop checklist; rule updated. |
| Sun 16 | Server skeleton with `gr.Server`: serve the two pages, an API route that runs one mission (`run_survey`) and returns `metrics.json`, `probes.csv` and the scene. Laptop only. Cheaper model. | A mission can be launched from the new command-centre page on the laptop. |
| Mon 17 | Command-centre page built from `DESIGN.md`: field, strategy, budget, launch, verdict with its reasons, debrief. Cheaper model for the markup. | The page shows a real run's verdict and debrief at 1440 and 390 px. |
| Tue 18 | Replay page: restyle `src/agrisim/viewer3d/` (index, CSS, HUD) to the chosen direction; the glass panels go. three.js and the scene code stay. | The replay works at 1440 and 390 px with the new HUD. |
| Wed 19 (after the reset) | Hugging Face Space: trimmed requirements (no torch pin, no SB3; `agrisim` with `--no-deps`), `transformers` Qwen 3.5 4B debrief inside `@spaces.GPU`, `GRADIO_SSR_MODE=false`, deploy private, verify with the huggingface-spaces skill's four steps. | The Space runs a mission and writes a debrief. |
| Thu 20 | Replay look with the cook loop against references the owner approves; public landing page through the taste-skill gate if time allows; README and `HANDOVER.md` match the code. | Stills approved; docs match. |

Buffer, after the 20th: one full agribench tier (about 53 minutes, run alone), CI fixes, an optional launch video.

## Found while making the redesigns (to fix in the week)

- The debrief validator flags a false contradiction: the seed-42 package says the narrative "claims a plant contact" for the phrase "plant contacts (0 recorded)". Fix in `validate_report` in `ai_agronomist/write_debrief.py`.
- The validator does not check which hotspots the narrative ranks first. The seed-7 debrief calls x 24.0, y 5.8 (0.172) the most urgent and never mentions the driest reading, 0.149 at x 28.0, y 5.8. The new debrief view should list hotspots from `probes.csv`, not from the model's text.
- `agrisim view` binds to 127.0.0.1 only, so `http://localhost:8766` fails where `localhost` resolves to IPv6. Either bind both or print the 127.0.0.1 address only (it already does).

## Risks

- ZeroGPU accepts torch 2.8.0 to 2.11.0; the project pins 2.14.1. The Space must not install the project's torch pin.
- `gr.Server` has no hot reload: restart after each change while building.
- Never run `agrisim suite` beside another heavy job on the laptop: it runs out of memory and reports a false hard fail.
