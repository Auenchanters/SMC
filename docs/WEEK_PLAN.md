# Week plan, 14 to 20 November 2026

Goal: a commercially usable app in direction C (`design/DESIGN.md`) with two pages, the Simulator (an operator runs and watches a survey) and the Console (runs, fields, rovers, reports, settings), light and dark, running on a Hugging Face Space with the debrief written by Qwen 3.5 on ZeroGPU. `design/redesigns/c-row-marker.html` stays as the "how it works" page.

Each working day ends with the gates green (ruff, ruff format, mypy on Windows and Linux, pytest, licence gate), a commit, a push, and `.claude/handoff.md` updated.

## Budget

The weekly usage limit is about 75% used (14 Nov) and resets on 18 Nov at 21:00 UTC (19 Nov, 02:30 IST). Until then the work is kept small: decisions, the design file and the server skeleton, done on a cheaper model where the step is mechanical. The heavy build and the deploy go after the reset.

## Plan

| Day | Work | Done when |
|---|---|---|
| Fri 14 (done) | The owner picked C and asked for dark mode, motion, two separate pages and a commercially usable app. `design/DESIGN.md` written; `design/app/simulator.html` and `design/app/console.html` mock-ups built and checked at 1440 and 390 px in both themes. | Mock-ups approved by the owner. |
| Sat 15 | Run store: every run saved with config, seed, metrics, probes, scene and debrief in one folder per run plus a SQLite index (`sqlite3`, standard library, no new dependency). Verdict rules read from a settings file instead of constants in `write_debrief.py`. Change the "no web-dashboard code" rule in `CLAUDE.md`. Cheaper model. | Tests cover the store and the rules file; gates green. |
| Sun 16 | Server with `gr.Server`: serve `simulator.html` and `console.html`; API routes to start a run, stream its progress (stop by stop), list runs, read one run, export readings CSV, save rules. Laptop only. | A run started from the Simulator page shows up in the Console. |
| Mon 17 | Simulator page wired to the API: live stops, verdict, debrief streamed from the model; the 3D view embeds the restyled `viewer3d` (solid panels, C tokens, both themes, the uncertainty ramp moved off violet). Cheaper model for the markup. | A full run plays live at 1440 and 390 px in both themes. |
| Tue 18 | Console page wired: filters, run detail, open replay, CSV export, debrief PDF (browser print stylesheet, no new dependency), verdict-rules form with a change log. One shared password for the workspace. | Every Console control works on real runs. |
| Wed 19 (after the reset) | Hugging Face Space: trimmed requirements (no torch pin, no SB3; `agrisim` with `--no-deps`), `transformers` Qwen 3.5 4B debrief inside `@spaces.GPU`, `GRADIO_SSR_MODE=false`, deploy private, verify with the huggingface-spaces skill's four steps. Run store on the Space's persistent storage. | The Space runs a survey, keeps it, and writes a debrief. |
| Thu 20 | Roles (operator, agronomist, admin), failure states (model down, cancelled run, missing reading), keyboard and screen-reader pass, AA contrast in both themes; README and `HANDOVER.md` match the code. | An accessibility pass and the failure states are checked in the browser. |

Buffer, after the 20th: replay look with the cook loop, one full agribench tier (about 53 minutes, run alone), CI fixes, an optional launch video.

## Found while making the redesigns (to fix in the week)

- The debrief validator flags a false contradiction: the seed-42 package says the narrative "claims a plant contact" for the phrase "plant contacts (0 recorded)". Fix in `validate_report` in `ai_agronomist/write_debrief.py`.
- The validator does not check which hotspots the narrative ranks first. The seed-7 debrief calls x 24.0, y 5.8 (0.172) the most urgent and never mentions the driest reading, 0.149 at x 28.0, y 5.8. The new debrief view should list hotspots from `probes.csv`, not from the model's text.
- `agrisim view` binds to 127.0.0.1 only, so `http://localhost:8766` fails where `localhost` resolves to IPv6. Either bind both or print the 127.0.0.1 address only (it already does).

- The viewer's uncertainty layer is drawn in violet-blue, which `DESIGN.md` bans; change its ramp when `viewer3d` is restyled.

## Risks

- ZeroGPU accepts torch 2.8.0 to 2.11.0; the project pins 2.14.1. The Space must not install the project's torch pin.
- `gr.Server` has no hot reload: restart after each change while building.
- Never run `agrisim suite` beside another heavy job on the laptop: it runs out of memory and reports a false hard fail.
