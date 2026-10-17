# agribench: the benchmark for agrisim

agribench scores our probing solution against every published method we could re-implement, and against a clairvoyant oracle, on fields nobody has seen. It is built to keep failing until the solution is genuinely as good as the problem allows. It runs on every push (quick tier) and nightly (full tier).

- Run it: `uv run agrisim suite --tier quick --workers 8` (PowerShell commands are in [How to run](#how-to-run)).
- Our entry: [solution.yaml](solution.yaml). Change this file to submit a new solution.
- The frozen benchmark: [v1/](v1/) (`suite.yaml`, `worlds/`, `LOCK.json`, `baseline.json`).
- Code: `src/agrisim/suite.py` (scoring, statistics, gates), `metrics.py` (CRPS, dry F1, the oracle), `policies.py` (baselines). Tests: `tests/test_suite.py`.

## 1. Why a new benchmark

There is no shared benchmark for adaptive soil probing by a ground robot in a planted crop.

- The 2024 survey of learning-based informative path planning (Popović, Ott, Rückin, Kochenderfer, RAS 179) names the lack of standardised simulators, metrics and benchmarks as a key open problem: papers use their own simulators and their own baselines, so results do not compare.
- The one agricultural IPP benchmark found, Waterberry Farms (Matloob et al., arXiv 2305.06243, MIT, code at github.com/lboloni/MREM), simulates a Florida farm with disease spread and soil humidity. Its robots move freely cell to cell, there are no lanes, plants or probe costs, and it scores only estimation loss (an asymmetric, time-averaged squared error). We borrow its time-aware, decision-weighted scoring idea.
- The robots that push moisture probes (MoistureMapper, CASE 2025; AgriOne, IROS 2024 workshop; Langenscheidt et al., JFR) each report on their own few fields with their own metrics, and MoistureMapper's simulation headline is the map's own variance, not the error against truth.

So agribench re-implements the competitors inside one simulator and judges everyone the same way. Section 4 lists what was taken from where.

## 2. What is scored

Our entry is a probing strategy plus, optionally, mapper settings (`solution.yaml`). Everything else, the field, soil, probe, rover and weather, is a frozen world file.

Each **task** is a world, a probe budget and a **deadline**. After the run, the map is rebuilt from the readings taken by the deadline and scored against the truth at the deadline. A strategy that drives too far simply has fewer readings when the time is up, so travel counts without a separate cost term. This is the "equal mission time" comparison from research.md (hypothesis H1). Every strategy is told the probe budget and the deadline, as a real mission planner would be (`run_survey(deadline=...)`, `Context.deadline`); the published baselines ignore the deadline, so their runs did not change when this was added.

Gated metrics, per task:

| metric | what it measures | direction |
|---|---|---|
| `rmse` | map error against the hidden truth, VWC | lower |
| `crps` | the map and its uncertainty together: mean continuous ranked probability score of N(mean, variance) per cell. A proper scoring rule, so a wide band cannot buy a good score (Gneiting and Raftery 2007). | lower |
| `dry_f1` | the farmer's decision: F1 of the cells below the dry threshold, defined on every field (1 when neither truth nor map has a dry cell, 0 when only one has) | higher |

Reported, not gated: `bias` and `ubrmse` (the SMAP / ISMN convention, ubRMSE = sqrt(RMSE² − bias²); Entekhabi et al. 2010, Gruber et al. 2020), `coverage95`, probes taken by the deadline, mission time, path length, plant contacts, compute time.

**Normalised score** (as D4RL does for offline RL): for each task metric, 0 = the `random` strategy and 100 = the better of the two clairvoyant oracles, both on the same fields. Scores can go below 0 or above 100. A metric counts only when the oracle is clearly better than random on those fields (one-sided Wilcoxon, p < alpha); otherwise it is reported as uninformative and cannot pass.

## 3. Rules, and why each one exists

| rule | why |
|---|---|
| Worlds and `suite.yaml` are frozen under `LOCK.json` (sha256, line endings normalised). Any edit is a hard failure until the lock is rewritten. | Moving the goalposts must show up in review. A real change is a new version folder (`v2/`), because scores across versions do not compare. |
| The entry can change the strategy and the mapper method, variogram and `min_readings`, never the dry threshold or the scoring grid. | Otherwise the entry could make the decision easier instead of better. |
| Gates are decided on **fresh fields**: seeds drawn from a hash of the run's key (CI: the commit SHA), at or above 2^31, so never a public, development, paper or PPO-training seed. | Reusing a fixed holdout lets you overfit to it through repeated feedback (Blum and Hardt, "The Ladder", ICML 2015; Dwork et al., "reusable holdout", Science 2015). A simulator can draw new fields for free, so it never reuses one. Any code change changes the commit, so the fresh fields change too. |
| **Public fields** (seeds 200–263) are fixed and used only for the regression ratchet. If public scores sit well above fresh ones (intervals apart), the report flags possible tuning to the public fields. | Comparable numbers from push to push, without letting them decide the gates. |
| Statistics are paired by field: every strategy sees the same fields. One-sided Wilcoxon signed-rank tests with Holm correction across baselines; 95% bootstrap intervals (2000 resamples, fixed seed); the headline is the interquartile mean of the normalised scores with a stratified bootstrap interval. | Means of a few noisy runs mislead; IQM and stratified bootstrap intervals are the recommended reporting (Agarwal et al., "Deep RL at the Edge of the Statistical Precipice", NeurIPS 2021). |
| Hard constraints: no crash, zero plant contacts on every run of every strategy. | A planner that touches a plant is not a planner we can ship. |
| A crashed run counts as a hard failure, and a map with no readings is scored as the prior (the config's mean and spread). No field is ever dropped from an average. | The old bench averaged dry F1 only over fields where it was defined, which flattered strategies that predict nothing dry. |
| Policies and mappers may not see the truth. `tests/test_suite.py` swaps the truth every component sees, except the probe, for noise, and checks every strategy's readings stay identical (and that the oracle's change, so the check can see a leak). A second test bans truth names from `policies.py` and `mapping.py`. | The CLAUDE.md truth-isolation rule, enforced rather than trusted. |
| The oracle is labelled reference-only and the entry may not be an oracle. | It reads the truth. |
| CI never commits. `baseline.json` is updated by a person with `--update-baseline`. | The CLAUDE.md authorship rule, and so that accepting a worse score is a visible, reviewed choice. |

## 4. Tasks

| task | world | budget | deadline | tier | what it tests |
|---|---|---|---|---|---|
| `demo_b30` | demo | 30 | 25 min | quick, full | the reference field, a small budget |
| `demo_b60` | demo | 60 | 40 min | full | the reference field, the demo budget |
| `v2_b30` | rover_v2 | 30 | 40 min | quick, full | rover v2's 29 s probe cycle: each probe is expensive |
| `rain_b60` | rain_shower | 60 | 50 min | quick, full | soil that changes during the mission (a 20 mm/h shower); bad soil contact |
| `drying_b60` | hot_afternoon | 60 | 40 min | full | steady drying during the mission |
| `rough_b60` | rough_soil | 60 | 40 min | full | patchy soil (correlation length 1–5 m) |
| `large_b60` | large_field | 60 | 60 min | full | a 50 × 30 m field with 1.5 m rows: sparse sampling, long drives |
| `harsh_b60` | harsh | 60 | 40 min | quick, full | the realism the demo leaves out: dry soil makes probes fail (up to 50%) or stop short and read low; positions off by 0.3 m along the row (no RTK); a noisier, more biased probe |

Every world number is a placeholder, as in `configs/demo.yaml`. The two realism features in `harsh` are new in the simulator (`probe.hard_soil`, `rover.along_row_error_std`); both default to off, and every earlier run is byte-identical.

## 5. Baselines (the competition)

| strategy | source | notes |
|---|---|---|
| `fixed_spacing` | lawnmower, the standard IPP baseline (Popović et al. 2024) | full lane coverage; not time-aware, so a deadline can cut it short |
| `random` | standard | the floor (score 0) |
| `greedy_variance` | Pulido Fentanes et al., JFR 2020; MoistureMapper's greedy benchmark | maximum kriging variance |
| `greedy_variance_per_cost` | ours | variance per second of driving and probing |
| `recheck`, `fixed_plus_recheck` | ours (M11) | revisit doubtful readings |
| `moisturemapper_a1`, `moisturemapper_a2` | MoistureMapper, IEEE CASE 2025, arXiv 2507.12716 | A1 = σ²(1 − d/d_max), A2 = (σ² + 1 − d/d_max)/2, next site random among the top five; σ² scaled to [0, 1] as their unit-variance GP; d along the lane graph, not straight lines |
| `dov` | Roberts-Elliott, Das and Cielniak, Robotics 14(6):77, 2025 | distance over variance; the exact bid form is unverified, so "DOV-style" |
| `mi_greedy` | Krause, Singh and Guestrin, JMLR 9, 2008 | greedy mutual information, σ²(s given probed) / σ²(s given all other unprobed sites), with the fitted variogram's covariance |
| `spatial_coverage` | Walvoort, Brus and de Gruijter, Computers & Geosciences 2010 | k-means centres snapped to sites, visited nearest first; the standard soil-survey design |
| `ppo` | ours (M8), `models/ppo_v1` | run only where the model fits the field |

Every baseline uses the world's reference mapper (ordinary kriging, exponential variogram), as the published methods use kriging or a GP.

**Oracles (the ceiling, reference only).** `oracle_rmse` and `oracle_dry` know the truth. Each keeps a Gaussian-process copy of the map with the field's true mean, variance and correlation length, and probes next where the truth would most improve that map per second of travel and probing: squared error, or the number of cells on the wrong side of the dry threshold. Their final map comes from the same reference mapper as everyone, so only the choice of sites is clairvoyant. They are greedy, so they are a strong reference rather than a proven optimum. An entry with a better mapper can score above 100; that means the ceiling is too low and the benchmark needs a v2.

## 6. Gates, status and exit codes

The report has one status, the first that applies:

| status | meaning | `--fail-on hard` | `sota` | `saturation` (default) |
|---|---|---|---|---|
| `hard_fail` | a crash, a plant contact, or frozen files that do not match `LOCK.json` | fail | fail | fail |
| `regression` | on the public fields, a task metric dropped more than 2 normalised points against `baseline.json` and the drop is significant (one-sided Wilcoxon, Holm across task metrics) | fail | fail | fail |
| `below_sota` | on fresh fields, some task metric where our entry does not beat every baseline significantly (one-sided Wilcoxon, Holm across baselines) | pass | fail | fail |
| `below_saturation` | beats every baseline, but some task metric's normalised score has a 95% lower bound under 90, or its ceiling is uninformative | pass | pass | fail |
| `saturated` | every task metric's lower bound is at least 90 | pass | pass | pass |

Exit code 1 means the run failed at the requested level. CI uses `--fail-on hard` for the job and `agrisim gate ... --fail-on saturation` as a separate step that may fail without blocking.

## 7. How to run

Windows PowerShell, one command per line:

```powershell
uv run agrisim suite --tier quick --workers 8
uv run agrisim suite --tier full --workers 8
uv run agrisim suite --tier full --workers 8 --fresh-key mytest
uv run agrisim gate runs\suite_20261017T120000Z\report.json --fail-on sota
```

- `--fresh-key` fixes the fresh fields so a run can be repeated exactly (the report records the key; without it a random key is used). CI uses the commit SHA.
- Each run writes `runs\suite_<UTC time>\report.md`, `report.json` (everything in the report, as data) and `rows.csv` (one row per run).
- The quick tier is 4 tasks × (16 public + 16 fresh) fields; the full tier is 8 tasks × (64 + 64). On 8 workers the quick tier takes a few minutes and the full tier about half an hour.

After a real improvement, record it so later pushes are held to it, then commit `benchmarks/v1/baseline.json`:

```powershell
uv run agrisim suite --tier full --workers 8 --update-baseline
```

Changing the benchmark itself (a world, a task, a target): edit `v1/`, rewrite the lock, and explain why in the ExecPlan Decision Log. For anything beyond a bug fix, copy `v1/` to `v2/` instead, so old scores stay meaningful.

```powershell
uv run agrisim suite --write-lock
```

## 8. Known limits

- **Simulator only.** Every world number is a placeholder until calibrated (WP1). A real-data track, replaying probes on dense measured fields, needs a dataset first: the Tarrawarra soil-moisture patterns (Western and Grayson 1998; 500–2000 TDR points per survey, free for research and teaching) and the Cook Agronomy Farm network (Gasch et al. 2017; licence not yet found) are the candidates. Check each licence before downloading.
- **The oracle is greedy and uses a GP surrogate**, so it is not an upper bound in the strict sense. If our entry passes it, raise the ceiling (non-myopic oracle) in v2.
- **Positioning error is independent per reading.** Real GNSS error is correlated in time.
- **Fresh fields from the commit SHA** can be computed once a commit exists, but tuning to them needs another commit, which changes them.
- **Compute time is reported, not gated.** A strategy that is too slow for the rover's computer would still pass.
- **No zone-level irrigation metric yet** (WP9, water regret). `dry_f1` is cell-level.

## 9. Results

Only from `agrisim suite` runs, latest first.

### `planned_survey` (17 October 2026, commit `cca381b`)

Full tier, fresh key = the commit SHA `cca381b9f63dca653f53df67866e670077b7c479` (fields drawn after the strategy was frozen), 15,232 surveys, 0 crashes, 0 plant contacts, 55 min on 14 workers. `baseline.json` was recorded from this run. The 1,536 public-field values of `greedy_variance` match the old `baseline.json` exactly, so telling strategies the deadline changed no baseline.

**Status: below state of the art.** The overall score rose from 28.5 to **73.9** [95% CI 69.9, 79.1], the best of any real strategy. Our entry beats every baseline on 8 of 24 task metrics: `dry_f1` on every task except `harsh_b60`, and `rmse` on `rain_b60`. It saturates 4 of them: `crps` on `demo_b30`, `demo_b60` and `large_b60`, and `dry_f1` on `demo_b60`.

The strategy (`policies.PlannedSurvey`):
1. Coverage sites (k-means, as spatial coverage) for 80% of the budget, routed by nearest neighbour plus 2-opt on the lane graph. If the whole budget would not fit before the deadline, fewer probes are planned.
2. When rain is forecast before the deadline, the rover drives to the farthest planned site rather than probing soil the rain is about to change, as long as the rest of the plan still fits after the rain.
3. The last 20% of the budget goes where a reading helps the map most: integrated variance reduction plus 30 times the expected misclassification reduction for the dry threshold (research.md WP3), per second of driving and probing, and only where the remaining probes still fit before the deadline.

Its two weights were chosen on development seeds 0-49 and confirmed on 50-99. No public or fresh field was used for tuning.

Leaderboard (fresh fields):

| rank | strategy | score |
|---|---|---|
| ref. | oracle_rmse | 97.8 |
| 1 | **planned_survey (our entry)** | **73.9** |
| ref. | oracle_dry | 72.6 |
| 2 | spatial_coverage (Walvoort et al. 2010) | 58.0 |
| 3 | fixed_spacing (lawnmower) | 55.1 |
| 4 | fixed_plus_recheck (ours) | 54.6 |
| 5 | moisturemapper_a1 (CASE 2025) | 48.8 |
| 6 | moisturemapper_a2 | 45.3 |
| 7 | greedy_variance (the old entry) | 32.1 |
| 8 | recheck (ours) | 27.6 |
| 9 | mi_greedy (Krause 2008) | 25.8 |
| 10 | greedy_variance_per_cost (ours) | 15.7 |
| 11 | random | 0.0 |
| 12 | dov (DOV-style) | −116 |

Our entry per task (normalised score [95% CI], 64 fresh fields; **bold** = beats every baseline, one-sided Wilcoxon with Holm):

| task | rmse | crps | dry_f1 | probes by deadline | mission |
|---|---|---|---|---|---|
| demo_b30 | 58.9 [48.6, 70.0] | 121 [101, 156] | **64.9** [45.3, 87.3] | 30 of 30 | 16 min |
| demo_b60 | 73.9 [66.9, 82.5] | 117 [102, 139] | **118** [100, 142] | 60 of 60 | 31 min |
| v2_b30 | 41.8 [29.7, 54.1] | 98.8 [67.3, 148] | **62.6** [44.3, 82.1] | 30 of 30 | 26 min |
| rain_b60 | **50.5** [42.8, 59.2] | 75.0 [63.4, 91.7] | **60.8** [41.7, 79.8] | 60 of 60 | 44 min |
| drying_b60 | 65.4 [58.9, 71.6] | 98.2 [88.4, 111] | **87.7** [72.8, 106] | 60 of 60 | 30 min |
| rough_b60 | 45.2 [34.7, 55.6] | 72.2 [54.7, 94.6] | **52.4** [34.1, 74.7] | 60 of 60 | 30 min |
| large_b60 | 69.7 [63.9, 75.4] | 104 [92.9, 118] | **83.7** [71.4, 96.4] | 60 of 60 | 43 min |
| harsh_b60 | 59.5 [43.4, 76.7] | 114 [84.5, 170] | 72.8 [52.2, 98.4] | 60 of 60 | 28 min |

What this says:
- **Probing by the dry threshold is what moves the score.** The coverage route alone ties spatial coverage. The last fifth of the budget, aimed at cells whose dry/not-dry call is in doubt, lifts `dry_f1` above every baseline on 7 of 8 tasks while costing little RMSE.
- **Time-awareness**: every probe is taken before the deadline on every task. On `rain_b60` the rover waits out the shower (44 min missions against 29 min for spatial coverage), and this is the only task where it also beats every baseline on RMSE.
- **RMSE and CRPS on soil that does not change tie with the coverage designs, and this looks close to the honest limit of v1.** Measured on development seeds: two noise draws of the same design differ by 7 to 15% RMSE per field, so a significant win needs a consistent 3 to 4% gain. An exchange-optimised design lowers the integrated kriging variance only 0.3 to 1.9% below k-means. Kriging with the true variogram gives the same RMSE as the fitted one, and the exponential model is already the best of the five the entry may choose. The dry and wet patches hold only about 9% of the squared error. Under a stationary random field, variance-only adaptivity cannot beat a good space-filling design (research.md Section 7.3), and it ties in practice too. Reaching `below_saturation` (beating every baseline on every metric) would need information the v1 fields do not offer to a strategy that cannot see the truth. Whether v2 should gate RMSE and CRPS differently is a decision for the team.
- **`harsh_b60` dry F1 is not won yet.** The probe reads 0.02 wet, so probes at the edge of a dry zone read wet and shrink the mapped dry area. Dry soil also makes half of the probes there fail. Treating failures as likely-dry pseudo-readings and retrying them made no measurable difference.
- **Against external levels**, the map's ubRMSE is now within the SMAP requirement (0.04) on all 8 tasks (`rough_b60` 0.0389). RMSE reaches the factory-calibrated probe class (0.03) on `demo_b60`, `drying_b60` and `rain_b60`.

### First full run (17 October 2026, entry `greedy_variance`)

Code at `b300fb6` plus the agribench milestone, fresh key `full-2026-10-17`. That is 14,208 surveys (8 tasks × 128 fields × up to 14 strategies), with 0 crashes and 0 plant contacts, in 76 minutes on 14 workers (17.8 CPU-hours measured, inflated by laptop throttling; about 10 CPU-hours unloaded). `baseline.json` was first recorded from this run.

**Status: below state of the art.** Our entry, `greedy_variance`, beats every baseline on 0 of 24 task metrics, and none is saturated. Overall score **28.5** [95% CI 23.8, 34.2]. Every one of the 24 ceilings is informative.

Leaderboard (fresh fields; each strategy scored as if it were the entry):

| rank | strategy | score |
|---|---|---|
| ref. | oracle_rmse | 96.8 |
| ref. | oracle_dry | 65.2 |
| 1 | spatial_coverage (Walvoort et al. 2010) | 55.0 |
| 2 | fixed_plus_recheck (ours) | 53.1 |
| 3 | fixed_spacing (lawnmower) | 52.7 |
| 4 | moisturemapper_a1 (CASE 2025) | 51.8 |
| 5 | moisturemapper_a2 | 45.2 |
| 6 | **greedy_variance (our entry)** | **28.5** |
| 7 | mi_greedy (Krause 2008) | 28.4 |
| 8 | recheck (ours) | 27.1 |
| 9 | greedy_variance_per_cost (ours) | 12.7 |
| 10 | random | 0.0 |
| 11 | dov (DOV-style) | −114 |

ppo is not ranked: its model does not fit the large field, so it has no score there.

Our entry per task (normalised score [95% CI], 64 fresh fields; probes taken by the deadline):

| task | rmse | crps | dry_f1 | probes by deadline |
|---|---|---|---|---|
| demo_b30 | 22.5 [6.8, 36.2] | 32.2 [3.5, 58.1] | 28.5 [6.6, 48.1] | 21.9 of 30 |
| demo_b60 | 28.3 [17.8, 37.7] | 35.3 [20.4, 49.1] | 26.8 [−0.5, 48.3] | 35.1 of 60 |
| v2_b30 | 48.7 [32.5, 63.4] | 99.3 [64.0, 150] | 12.0 [−14.0, 35.3] | 27.2 of 30 |
| rain_b60 | 14.5 [1.6, 25.2] | 23.3 [2.3, 39.6] | 20.6 [−6.3, 44.3] | 44.7 of 60 |
| drying_b60 | 35.3 [24.7, 43.7] | 46.8 [33.2, 57.4] | 30.3 [10.3, 46.3] | 35.5 of 60 |
| rough_b60 | 16.3 [5.6, 26.7] | 23.0 [6.9, 37.3] | −0.9 [−19.7, 13.8] | 36.4 of 60 |
| large_b60 | 23.5 [12.8, 33.5] | 32.4 [15.9, 47.3] | 18.1 [−4.3, 36.6] | 34.9 of 60 |
| harsh_b60 | 39.3 [24.2, 54.6] | 70.9 [40.5, 126] | 43.6 [24.3, 61.0] | 38.2 of 60 |

What this says:
- **The deadline is what beats greedy variance.** It chases the most uncertain spot anywhere in the field, so it spends its time driving and has taken only 22 to 45 of its probes when the time is up. Designs that cover the field in a sensible order (spatial coverage, the lawnmower, MoistureMapper's distance-weighted rule) take all their probes and win. The old bench ranked greedy first only because it ignored time.
- **The ceiling is far away.** The best real strategy reaches 55. The clairvoyant oracle shows that the same probe, budget and mapper could cut map error by a further 5 to 17% below the best real strategy on each task. It also reaches 1.2 to 2.6 times its dry F1 (0.26 against 0.44 on `demo_b30`).
- **Dry-zone detection is the weakest part**: `dry_f1` scores sit lowest, and on `rough_b60` our entry is at the level of random probing.
- **Against external levels**, the map's ubRMSE is within the SMAP mission requirement (0.04) on 7 of 8 tasks (not `rough_b60`, at 0.042). RMSE never reaches the factory-calibrated probe class (0.03).
- DOV-style bidding collapses into "always the nearest site" on a lane graph, so it scores far below random.

## Sources

- Popović, Ott, Rückin, Kochenderfer, "Learning-based methods for adaptive informative path planning", RAS 179:104727, 2024. https://arxiv.org/abs/2404.06940
- Matloob et al., "Waterberry Farms: A Novel Benchmark For Informative Path Planning", arXiv 2305.06243. https://arxiv.org/abs/2305.06243
- Agarwal et al., "Deep Reinforcement Learning at the Edge of the Statistical Precipice", NeurIPS 2021; rliable. https://github.com/google-research/rliable
- Blum and Hardt, "The Ladder: A Reliable Leaderboard for Machine Learning Competitions", ICML 2015. https://arxiv.org/abs/1502.04585
- Dwork et al., "The reusable holdout", Google Research blog summary. https://research.google/blog/the-reusable-holdout-preserving-validity-in-adaptive-data-analysis/
- Gneiting and Raftery, "Strictly proper scoring rules, prediction, and estimation", JASA 2007; Gneiting, Balabdaoui and Raftery, JRSS-B 2007. https://sites.stat.washington.edu/people/raftery/Research/PDF/Gneiting2007jrssb.pdf
- Entekhabi et al., "Performance metrics for soil moisture retrievals and application requirements", J. Hydrometeorology 11:832–840, 2010. https://dspace.mit.edu/handle/1721.1/66195
- SMAP L4 soil moisture: validated to ubRMSE 0.04 m³/m³. https://smap.jpl.nasa.gov/files/smap2/107%20-%20Reichle.pdf
- Gruber et al., "Validation practices for satellite soil moisture retrievals: What are (the) errors?", RSE 244:111806, 2020. https://rsc4earth.de/publication/gruber-validation-2020/
- METER TEROS 12 specifications: ±0.03 m³/m³ generic, ±0.01–0.02 m³/m³ medium-specific. https://metergroup.com/products/teros-12/teros-12-tech-specs/
- MoistureMapper, arXiv 2507.12716. https://arxiv.org/html/2507.12716v1
- Wadoux et al., "Spatial cross-validation is not the right way to evaluate map accuracy", Ecological Modelling 2021 (why exhaustive truth, which a simulator has, beats cross-validation). https://research.wur.nl/en/publications/spatial-cross-validation-is-not-the-right-way-to-evaluate-map-acc/
- Tarrawarra data set. https://people.eng.unimelb.edu.au/aww/tarrawarra/tarrawarra.html
- Low-cost GNSS without RTK: metre-level guidance errors. https://uvadoc.uva.es/bitstream/handle/10324/83781/35%20Jaime%20Augmentacion%20systems.pdf?sequence=1
- Every other paper cited here is in research.md Section 12.
