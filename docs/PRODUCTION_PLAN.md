# Production plan: from simulator to a system that surveys a real farm

Ordered software work, written 2026-11-08. This is the build order for "run it on a real field", not the research roadmap (that is [FUTURE_SCOPE.md](FUTURE_SCOPE.md)). Where the two overlap, this document wins on sequencing because nothing in FUTURE_SCOPE can be measured on a real farm until phases 0 to 3 exist.

## What the repository actually has today

Verified against the tree, not assumed:

| Capability | State |
|---|---|
| Simulated field, probe, rover, mapping, metrics | works (`src/agrisim`, 21 modules) |
| CLI: `run`, `view`, `bench`, `suite`, `gate`, `train`, `eval` | works |
| agribench v1: 8 tasks, 11 baselines, 2 oracles, fresh-field protocol | works; entry 78.5, below state of the art |
| Mission packaging (`ai_agronomist/run_mission.py` → folder) | works, verified end to end |
| AI debrief (Ollama, computed verdict, validation) | works (`ai_agronomist/write_debrief.py`) |
| Control panel | Streamlit single-user (`ai_agronomist/control_centre_app.py`) |
| Real probe readings in | **nothing** |
| Real rover link (serial, radio, MQTT) | **nothing** |
| Persistent store (database) | **nothing** — each run is an orphan folder of CSV/JSON |
| Probe calibration from lab samples | **nothing** — every soil and probe number is a PLACEHOLDER |
| Multi-farm, multi-user, auth | **nothing** |
| Irrigation plan as a deliverable | **nothing** |

Two consequences that set the order:

1. Every real reading that arrives today lands in a folder nobody can query, so the store must come before the rover.
2. Every LLM answer today is grounded only in one mission's `metrics.json`, so "use LLMs properly" means giving them history, which again needs the store.

## Principles

- **Local-first.** The field laptop and the rover work with no network. SQLite in WAL mode is the primary store; the cloud is a mirror, never a dependency for taking a reading.
- **One schema, one ingest path.** Rover logs, handheld readings, lab samples and simulated runs all enter through the same tables, so strategies and dashboards never branch on provenance.
- **The twin stays.** Every hardware path has a mock transport that runs the same code against the simulator, so the software is testable on a train and CI stays offline.
- **No new runtime dependency without a licence check and a Decision Log entry** (repository rule 3).
- **Grounded generation.** The LLM writes prose over numbers computed in Python, from the store, with the validator that already exists.

## Phase 0 — Data model and store (foundation)

Nothing else can be built honestly before this.

- New package `src/agrisim/store/`: `schema.py`, `migrations/0001_init.sql`, `repo.py` (typed read/write functions), `verify.py`.
- SQLite via the standard library, WAL mode, `PRAGMA foreign_keys=ON`. Numbered migrations applied by `agrisim db migrate`; a `schema_version` table.
- Tables (first cut):

```sql
farms(id, name, created_at, notes)
fields(id, farm_id, name, geometry_geojson, row_spacing_m, plant_spacing_m, lane_count)
missions(id, field_id, strategy, seed, config_yaml, started_at, ended_at, status,
         probe_budget, path_length_m, mission_time_s, plant_contacts, rmse, dry_f1,
         calibration_95, notes)
readings(id, mission_id, field_id, source, taken_at, x, y, depth_m, value,
         status, raw_value, probe_id, confidence)
   -- source: 'sim' | 'rover' | 'handheld' | 'lab'
   -- status: 'ok' | 'failed_hard_soil' | 'misread' | 'dropped'
track_points(id, mission_id, taken_at, x, y, heading, speed, state)
artefacts(id, mission_id, kind, path, sha256, bytes, created_at)
zones(id, field_id, kind, geometry_geojson, drip_lateral_id, area_m2, root_depth_m)
plans(id, mission_id, zone_id, litres, confidence, method, created_at)
llm_runs(id, mission_id, model, prompt_sha256, tokens_in, tokens_out, outcome, report_path)
events(id, at, level, source, mission_id, message, payload_json)
```

- `agrisim run --store <db>` writes the mission, readings, track and artefact hashes as it finishes; the files stay on disk, the database holds the index. `agrisim db verify` reconciles hashes and reports drift.
- `agrisim import <folder>` ingests the ~50 existing run folders, so the team starts with history instead of an empty database.
- Done when: one mission and one imported folder are queryable in SQL; `db verify` passes; a test proves the same seed produces the same rows; existing gates unchanged.

## Phase 1 — Real readings in, calibrated probe out

The bridge from placeholders to a farm.

- `agrisim ingest readings <file>` for three inputs: rover probe log (CSV), handheld sensor (CSV), lab samples (CSV with wet and oven-dry mass). Each row is validated, deduplicated by `(field_id, round(x, 2), round(y, 2), depth_m, taken_at)` and written with its `source`.
- `agrisim calibrate` fits what the simulator currently guesses:
  - probe bias and noise from paired robot/lab samples (the 0.02 wet bias today is a PLACEHOLDER),
  - the hard-soil threshold from `failed_hard_soil` events against measured moisture,
  - variogram range and sill per depth from the handheld grid (reusing the existing fitter).
  Output `probe_calibration.json` + `variogram_<depth>.json`, with residual statistics and a plot.
- Loader: a mission can run `--calibration <file>` so the mapper and metrics use measured parameters; `agrisim run` prints which parameters were measured and which are still placeholders.
- Done when: one real plot's readings load, calibration artefacts exist with residual numbers, and a mission run on the sim with measured parameters reports them in `metrics.json`.

## Phase 2 — Rover link

Software only; it must work against the mock before any hardware exists.

- New package `src/agrisim/robot/`: `transport.py` (`MockTransport`, `SerialTransport`, `MqttTransport` behind one interface), `protocol.py` (framed messages, command ids, acks, retries, timeouts), `executor.py` (turns the existing planner output into robot commands), `safety.py` (stop on link loss, geofence, contact guard, abort on low battery).
- `agrisim robot run --transport mock --config ...` executes a mission through the same executor and writes to the store like a simulation, with `missions.strategy='real'`.
- Replay: `agrisim view` reads a real mission from the store using the same scene writer, so a field day can be replayed in 3D.
- Note: exact wire protocol, baud rate and command set are PLACEHOLDERS until the rover firmware exists; the interface and the safety behaviour are what this phase fixes.
- Done when: a mock mission completes with the same metrics the simulator produces for the same plan, a link-loss test stops the robot within one control period, and a recorded session replays identically twice.

## Phase 3 — LLM layer as a service

Today's advisor is a script tied to one folder and one model endpoint.

- Move the logic into `src/agrisim/advisor/` (`facts.py`, `prompt.py`, `validate.py`, `render.py`, `backends/`), keeping `ai_agronomist/write_debrief.py` as a thin CLI so nothing breaks.
- Backends: `ollama` (local, default), `openai_compatible` (`base_url` + key from the environment), `none` (template report with no model). Offline always works.
- Grounding from the store: the prompt gains the field's history (last N missions, zone deficits, calibration state) and the report cites probe and zone identifiers that exist in the database.
- Cost and safety: per-mission token ceiling, cache keyed by `prompt_sha256`, refusal path that still writes a report, and no model call when metrics are missing.
- Done when: identical output from CLI and panel for the same mission; the `none` backend produces a complete report with no network; the validator rejects five seeded contradictions; token and cost per mission are recorded in `llm_runs`.

## Phase 4 — Real data proper

- `scripts/fit_cookfarm.py`: Cook Agronomy Farm public network (42 locations × 5 depths, 2007 to 2016) → fitted variogram range/sill and wetting/drying rates → `configs/worlds/cookfarm.yaml`; agribench re-run and the ranking change reported. Check the data licence first and keep the download out of the repository.
- A real-data task in agribench: strategies "probe" the dense measured grid by nearest measured point; `agrisim suite` reports it next to the simulated tasks.
- Done when: fitted parameters are committed as config, the ranking comparison is written down, and one real plot has a score.

## Phase 5 — Farm workspace (multi-user, sync, alerts)

Only now does a cloud database earn its place.

- Sync: `agrisim sync` pushes new rows (SQLite → Postgres) with a monotonic `updated_at` cursor and pull-back for edits; resumable after offline days. Hypertables on `readings` and `track_points`. Recommended managed target: **Tiger Cloud / Timescale** (managed Postgres with hypertables and a free tier) — but SQLite remains the field store.
- Panel: farms, fields, missions, one mission view, calibration state; sign-in with per-farm scoping; every query filtered by the signed-in user's farm membership.
- Alerts: a rule ("dry zone above X m²") evaluated after ingest, sent by email/SMS; deduplicated per mission.
- Done when: two users see only their own farm, a mission taken offline syncs when the laptop reconnects, and an alert fires once per mission.

## Phase 6 — What the farmer actually buys

- `irrigation_plan.csv` per mission: litres per zone = deficit × root depth × area, using a lower quantile of the map where the kriging variance is high; confidence per zone.
- `water_regret`: asymmetric loss against truth (under-watering costs more), compared with uniform irrigation; gated in agribench v2.
- One documented export format for a valve controller (see FUTURE_SCOPE item 3.4 for the partner question).
- Done when: every mission writes a plan with per-zone confidence, and regret is reported next to `dry_f1`.

## Phase 7 — Field readiness

- Packaging: one installable artefact for the field laptop, pinned and offline-installable; no network on first run.
- Operations: structured logs, crash-safe mission resume, nightly backup of the SQLite file plus artefact hashes, `agrisim doctor` (store integrity, calibration age, disk, model availability).
- Documents: a field-day runbook a non-developer can follow, a calibration SOP, and a restore-from-backup drill that is actually performed once.
- Done when: someone who is not the author runs a survey and produces a plan using only the runbook, and the restore drill passes.

## Order and dependency

```
P0 store ──► P1 ingest + calibration ──► P2 rover link ──► P5 workspace/sync ──► P6 farmer deliverable
      └────────► P3 advisor service ────────┘                        │
      └────────► P4 real data (can start once P1 ingest exists) ────┘
                                     P7 hardening runs alongside P5–P6
```

Critical path to "we probed a real farm and produced an irrigation plan": P0 → P1 → P2 → P6. P3 and P4 can run in parallel by a second person; P5 is needed only when someone other than the operator reads the data.

Rough effort, one developer, software only: P0 3 d, P1 4 d, P2 5 d, P3 3 d, P4 4 d, P5 5 d, P6 3 d, P7 4 d. The dates that actually decide the schedule are hardware and the field campaign, not these.

## What not to build yet

- **ROS 2 / Gazebo.** The transport interface in P2 is the seam; a ROS bridge can implement it later.
- **A separate web frontend.** Streamlit covers the operator and the farmer until multi-farm load proves otherwise.
- **A cloud-first architecture.** A network outage must never stop a survey.
- **More probing strategies** before P1: without measured parameters, another strategy is another comparison of placeholders.
- **Fine-tuning or a bigger model.** The bottleneck in the AI layer was grounding and validation, not model quality; that is fixed by the store and the validator.

## Open decisions for the team

1. Which Postgres for P5 (Tiger Cloud/Timescale vs Neon vs stay local-only until a second farm exists).
2. Whether lab samples are oven-dry (accurate, slow) or a reference meter (fast, biased) — this decides the calibration design.
3. Whether the rover speaks serial over the tether or radio/MQTT; this decides which transport is real and which stays a test double.
