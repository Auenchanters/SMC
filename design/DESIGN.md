# DESIGN.md: SMC survey app, direction C "Row marker"

Chosen by the owner on 14 Nov 2026 from `design/redesigns/` (C), with three additions: a dark mode, purposeful motion, and two separate pages (the simulator, where an operator runs and watches a survey; the console, where a manager reviews runs, fields and settings). The pages in `design/app/` are the reference mock-ups.

## What it is

A working tool for a farm operator and the agronomist who reads the results, not a showcase. It runs a soil-moisture survey (today in the simulator, later on the rover), shows what the rover is doing, decides a verdict from the telemetry and keeps every run on record. `design/redesigns/c-row-marker.html` stays as the "how it works" page.

## Colour

Every hue comes from the field.

| Token | Light | Dark | It is this because |
|---|---|---|---|
| `--ground` | `#EEEFE6` | `#131811` | Light: pale dry soil with a green cast. Dark: leaf shadow at dusk, green-black, never blue-slate. |
| `--ground-2` | `#E3E5D8` | `#1A2117` | One step of separation for sheets and side panels. |
| `--surface` | `#F5F6EF` | `#1F271C` | Inputs and raised sheets. |
| `--line` | `#C9CCBA` | `#2E3829` | Hairlines; they do the job shadows would. |
| `--line-2` | `#AEB29C` | `#45513E` | Borders of things you can press. |
| `--ink` | `#1D231A` | `#E3E8D8` | Text; tinted toward the leaf, never pure black or white. |
| `--ink-2` | `#4A5243` | `#AAB39E` | Secondary text. |
| `--ink-3` | `#737A69` | `#7C8571` | Labels, units. |
| `--leaf` | `#2F5A2A` | `#86B472` | The brand hue: a tomato leaf from our replay's canopy. Selection and the verdict band. |
| `--flag` | `#F2C53D` | `#F2C53D` | Row-marker flag yellow. **One job: the button that moves you forward** (Start survey, Save). Under 5% of the screen. |
| `--dry` | `#A2542A` | `#E08A55` | Dry soil and missed targets. Same family as the map's dry end. |
| `--wet` | `#3E5F86` | `#7EA4CC` | The map's wet end. Data only. |

Map colours are the viewer's own ramp (dry orange to wet blue) and stay the same in both themes: they are data, not chrome. The viewer's uncertainty layer is violet-blue today; move it to a leaf-to-clay ramp when the viewer is restyled.

Dark mode follows the system (`prefers-color-scheme`) and can be overridden by a toggle stored per user (`data-theme` on `<html>`). It is not an inversion: the leaf lightens to stay readable on the dark ground, the flag stays the same yellow, the dry colour lightens.

## Type

- **Zilla Slab** 500/700: headings, the verdict, the big numbers. A slab because the field is a place of stencilled signs and seed packets, not of glossy software. Use lining figures (`font-variant-numeric: lining-nums`).
- **Archivo** 400/700: everything else. A grotesque with real width; it stays clear at 13 px on a phone in sunlight.
- Scale (ratio ≈1.25, hand-tuned): 12 label, 13 small, 16 body, 20 lead, 24 h2, 32 h1 (phone), 40 h1, 56–72 verdict.
- Tracking: −0.02em at 40 px and above, +0.08em on uppercase labels, none on body. Line height 1.05 display, 1.2 headings, 1.55 body.
- Body measure at most 66ch.

## Shape and surface

- Radius is a hierarchy: 6 px buttons and chips, 8 px inputs, 10 px choice tiles, 14 px sheets and the verdict band, 50% only for the play button and step numbers.
- No glass, no blur. Panels over the 3D view are solid `--ground`. The one exception is the guided tour: it dims and blurs everything except the part it is explaining, because there the blur's job is to push the rest of the page back.
- Shadows only on things that float over the 3D view or slide over content (chips, the phone sheet, the toast): `0 1px 2px` of the ink colour at 35%, light from above.
- Cards only for things that are discrete and comparable: field choices, strategy choices. Lists and tables have no card around them.

## Layout

- **Simulator page** (`simulator.html`): a top bar; on a desk a setup rail (left, 320 px), the 3D view (centre), readouts (right, 320 px), the time bar under the view. On a phone: the view, then a sheet that slides up. Setup collapses to a one-line summary once a run starts.
- **Console page** (`console.html`): a top bar with page tabs (Runs, Fields, Rovers, Settings); a numbers strip; the runs table with filters; a detail panel for the selected run. On a phone the table becomes a list of rows that open the detail.
- One primary action per screen, in flag yellow.

## Motion

Motion explains something or confirms something. Durations: 120 ms state change, 220 ms move, 360 ms entering surface. Entering decelerates (`cubic-bezier(.2,.8,.2,1)`), leaving accelerates (`cubic-bezier(.4,0,1,1)`).

| What moves | Why |
|---|---|
| Start survey button turns into a progress bar of probe stops | Confirms the launch and shows how far the run is. |
| A new stop appears on the time bar (grows from 0 in 160 ms) and the readout number rolls to the new value (220 ms) | Draws the eye to the reading that just changed. |
| Map layer change crossfades the view (220 ms) | Shows it is the same field under a different layer. |
| The verdict band enters from below (360 ms) when the run ends | It is new information that was not there before. |
| The debrief text appears as the model writes it | It is being written; waiting is visible. |
| Theme switch crossfades colours (200 ms) | Avoids a flash. |
| The phone sheet follows the finger and settles (220 ms) | It is a physical object. |
| Tour: the clear spotlight and its yellow ring move from part to part (220 ms); the card's text slides in | Shows where the explanation now points. |

**Does not animate:** tables, sorting, page tabs, scrolling, hover on rows, numbers in the console, the console's charts. Nothing fades in on scroll. With `prefers-reduced-motion: reduce`, every transition above becomes an instant change, the debrief appears whole, and the 3D camera cuts instead of flying.

## Guided tour

First-time users get a short tour on each page (12 steps on the Simulator, 7 on the Console). It starts by itself on the first visit, can be skipped at any step, and can be opened again from the Tour button in the top bar.
- One part at a time is in focus; the rest is dimmed and blurred by four panels around it (not a clip-path cut-out, which some renderers draw wrongly).
- The page shows the state the step talks about: setup steps show the empty setup, the 3D steps show a survey in progress, the verdict step shows a finished one. The page is left ready for a first survey at the end.
- The card sits beside the part on a desk and docks at the bottom on a phone. Keys: right and left arrows move, Escape closes, Tab stays inside the card. The page behind is inert while the tour is open.
- Copy is plain: what the part is, what to do with it, one number where it helps (60 stops take about 32 minutes; the map error limit is 0.0350).

## Commercial use: what the real app needs beyond the mock-ups

- Every run is stored with its config, seed, metrics, probes, scene and debrief, and can be reopened, compared and exported (CSV of readings, PDF of the debrief).
- Settings that today live in code become visible and editable by an admin: the verdict thresholds (map error ≤ 0.035, dry ground found ≥ 30%, probe success ≥ 80%, plant contacts 0), the debrief model, the field list.
- Roles: operator (runs surveys), agronomist (reads and annotates), admin (settings, fields, rovers). On the Space this starts as one password-protected workspace.
- Clear state for every failure: the model is down (verdict and table still show; the debrief says it is unavailable), a probe returns nothing (shown as a hollow stop), the run is cancelled.
- Keyboard and screen-reader use: every control reachable, the time bar is a slider with a spoken value, contrast AA in both themes.

## Don't

- No violet, indigo, gradient text, glass, blue-slate dark, emoji icons.
- Never use the flag yellow for anything but the forward action.
- Never show a verdict the code did not compute; the AI's text sits under it, labelled.
