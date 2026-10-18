# Future scope

What agrisim can become, in the order we would build it. Each item says why it matters (with the evidence), what to build, and how we would know it worked. The README gives the summary; this file is the detail.

Sources:
- [research.md](../research.md): competitors, papers, our known flaws and work packages WP1 to WP12, with every claim tagged [V] verified, [S] simulated, [P] proposal.
- [benchmarks/README.md](../benchmarks/README.md): agribench and its results.
- The latest `runs/suite_*/brief.md`: what the benchmark says to fix next.
- The [ExecPlan roadmap](../EXECPLAN.md#roadmap-toward-a-test-bench-for-field-robots).

Effort: **S** under a day, **M** 1 to 3 days, **L** a week or more.

## 1. Next: make the entry win where it does not yet (software only)

agribench status is **below state of the art**. `planned_survey` scores 78.5 out of 100 (73.9 and 75.8 on earlier sets of fresh fields), the highest overall score of any real strategy. It beats every baseline on dry-zone F1 in all 8 tasks of the latest run, but on map error (RMSE, CRPS) it only ties the best simple design. Three gaps remain.

| # | Item | Why (evidence) | What to build | Done when |
|---|---|---|---|---|
| 1.1 | **Dry zones under hard soil** (`harsh_b60` dry F1) | Up to half of the probes in dry soil fail or read low, so the mapped dry area shrinks. It is won since the repeat-probe fix, but narrowly (interval 71 to 121), and earlier runs did not win it. Retrying, and treating failures as likely dry, made no measurable difference ([benchmarks/README.md](../benchmarks/README.md) §9). | Treat a failed insertion as a *censored* reading ("drier than θ_hard") in the mapper, using truncated-normal formulas in NumPy (research.md WP4). Correct for the probe's known wet bias near the threshold. | `harsh_b60` dry F1 beats every baseline on fresh fields (Holm p < 0.05) |
| 1.2 | **Map error on soil that does not change** (RMSE and CRPS on 6 tasks) | Measured: two noise draws of the same design differ by 7 to 15% per field. An optimised design lowers kriging variance only 0.3 to 1.9% below k-means. Variance-only adaptivity cannot beat a good space-filling design (research.md §7.3). | The structure the mapper ignores: an anisotropic variogram and a row drift (WP5), plus probe reach towards the rows (WP6, below). If v1 cannot separate them, propose an agribench v2 that gates RMSE as "not worse than", not "better than". | RMSE beats spatial coverage significantly, or the team accepts a v2 gate |
| 1.3 | **Lookahead under a time budget** | With rover v2's 29 s probe cycle, the order and the route matter more than the next pick. RAPID and CAtNIPP plan several steps ahead. | Rollouts with readings drawn from the posterior, depth 2 to 4, over the best K sites (WP7). | At equal mission time, it beats one-step on dry F1, and the margin grows with probe time (10, 29, 600 s) |

How to work on any of these: start from `brief.md`, tune on development seeds 0 to 99 only, then score the commit with `agrisim suite --tier full --fresh-key <SHA>`. These are the loop rules in [benchmarks/README.md](../benchmarks/README.md) §7.

## 2. Ground the simulator in real data (the biggest gap)

Every soil and probe number is a placeholder. All the research robots we compare against have a real robot or real data. We have neither (research.md §5.3).

| # | Item | What to build | Done when |
|---|---|---|---|
| 2.1 | **Public data calibration** (WP1a, M) | Fit variogram range, sill and wetting and drying rates from the Cook Agronomy Farm sensor network (42 locations × 5 depths, 2007 to 2016). Do it in a script outside the package, after checking the data licence, and write `configs/scenarios/cookfarm_fit.yaml`. Tarrawarra (500 to 2000 TDR points per survey) is the other candidate. | Fitted ranges reported; agribench re-run on the fitted world; ranking changes stated |
| 2.2 | **Our own field campaign** (WP1b, L) | One drip-irrigated tomato plot (about 20 × 30 m). Take a dense handheld grid of 100 to 150 readings, plus transects from the lane centre to the row. Repeat readings 3 times to measure noise. Take 10 to 20 oven-dried samples to measure probe bias. Measure before and after an irrigation pulse. | The gap between simulator and field is reported (variogram, stripe profile, noise). At least one strategy is compared on real data. |
| 2.3 | **A real-data track in agribench** | Replay strategies on the dense measured grid: a strategy "probes" by reading the nearest measured point. | `agrisim suite` reports a real-data task next to the simulated ones |

## 3. Close the loop to the farmer's decision

A map is not what a farmer buys. What they need is how much water each drip zone gets.

| # | Item | What to build | Done when |
|---|---|---|---|
| 3.1 | **Per-zone irrigation plan** (WP9, S to M) | One zone per drip lateral or row segment. Litres per zone = deficit × root depth × area, using a lower quantile of the map where it is uncertain. Write it to `irrigation_plan.csv` in each run folder. | Every run writes the plan with a confidence per zone |
| 3.2 | **Water regret and water saved** | Asymmetric regret against the truth (under-watering costs more than over-watering). Compare water saved against uniform irrigation. | Gated in agribench v2 next to `dry_f1` |
| 3.3 | **Zone-level decision probing** | Make the acquisition target zone decisions instead of cells (an extension of the dry-threshold term in `planned_survey`). | Better zone accuracy at equal mission time |
| 3.4 | **Hand-off to irrigation controllers** | An export format that a valve controller can read. Fasal's FasalJet already actuates valves in five Indian states, which makes it a likely partner rather than a rival (research.md §10). | One documented export, agreed with a partner |

## 4. Realism the benchmark still leaves out

| # | Item | Why | What to build |
|---|---|---|---|
| 4.1 | **Lateral probe reach and hardware co-design** (WP6) | Probes at the lane centre cannot see the wetter drip line under the rows, and in real data that cannot be told apart from probe bias (research.md §7.1). Rover v2's ±60 mm rail sees about 2% of the stripe; a reach of 0.30 m would see 50%. | Add `probe.lateral_reach` and probe-tip safety checks, then sweep the reach from 0 to 0.45 m. Feed the reach that is needed into `hardware/rover-v2/model.mjs`, once the team agrees. |
| 4.2 | **Correlated positioning error** | Real GNSS error without RTK drifts over time. We draw it independently per reading. | An error that follows a random walk along the row |
| 4.3 | **Space-time map** | Soil changes during a 30 to 65 min mission. Today the robot brings old readings forward with a near-perfect rain model. | A separable space-time covariance (Booth and Carpin 2023); a noisy rain gauge |
| 4.4 | **Blocked lanes and probe drift** | Real fields have both. | Edge removal in the lane graph with re-routing; probe drift over a mission |
| 4.5 | **Irrigation and several depths** | Drip pulses wet the rows that lane probes do not see. The roots go deeper than 6 cm. | Drip schedules in `weather.py`; a second soil layer |

## 5. Learning (optional; a negative result is a result)

| # | Item | What to build | Done when |
|---|---|---|---|
| 5.1 | **Per-site action head** (WP8) | A fully convolutional score map, read out at each candidate site. Optionally, attention over lane-graph nodes (CAtNIPP-style). | It matches or beats `planned_survey` on fresh fields, or is reported as a negative result with a learning curve |
| 5.2 | **A faster environment** | A NumPy GP with rank-1 Cholesky updates instead of refitting PyKrige every step, which costs 21 ms a step today. | Step time measured and cut |
| 5.3 | **Hybrid planner** | Use the network as a value function inside the lookahead in 1.3 (Rückin et al. 2022). | It beats both the planner alone and the network alone |

## 6. The benchmark itself (agribench v2)

v1 stays frozen. A v2 folder would add:
- the real-data track (2.3);
- a zone-level water-regret metric (3.2);
- a non-myopic oracle, because the current one is greedy and our entry already scores above `oracle_dry`;
- correlated positioning error (4.2);
- a compute-time gate, so that a strategy too slow for the rover's computer cannot pass;
- possibly an RMSE gate of "not worse than" (1.2).

Each change is a Decision Log entry ([benchmarks/README.md](../benchmarks/README.md) §3).

## 7. Toward a test bench for field robots

This is the team's long-term aim: agrisim as a "wind tunnel" for farm robots ([ExecPlan roadmap](../EXECPLAN.md#roadmap-toward-a-test-bench-for-field-robots)).
- **Scenario library and scorecard:** dry spell, storm mid-survey, waterlogged corner, misreading probe, blocked lane, all scored at once.
- **Crops as profiles:** `configs/crops/<crop>.yaml` with spacing, canopy growth, root depth, dry threshold and water use per growth stage. Add a second crop only when someone has its numbers.
- **Robots as plug-ins:** a small interface, so another team can test its own robot or sensor without editing agrisim.
- **Several robots:** auction-based task allocation (Roberts-Elliott et al. 2025) and team orienteering on row graphs (RAPID).
- **Phase 2:** a Gazebo Jetty and ROS 2 world (in WSL2) that calls this package for soil truth, so the physics bench and the decision bench share one soil.
- **3D replay, M10 phase 4:** generated tomato plants. Phases 1 to 3 are done.

## 8. Hardware and product

- **Build and bench-test rover v2** ([hardware/rover-v2/DESIGN.md](../hardware/rover-v2/DESIGN.md)). These are the design's open questions:
  - soil strength;
  - how often each cleaning level is needed;
  - the reference block for bias calibration;
  - positioning along the row without RTK;
  - rocker stiffness;
  - canopy clearance.
- **Phase 3:** cameras and disease detection, evaluated on real images labelled by experts.
- **Survey as a service**, as Rogo sells soil coring. Keep the bill of materials low. Mineral (Alphabet) and Small Robot Company both shut down on hardware economics (research.md §3.7), so prove the water saved per hectare in simulation, then in one field, before scaling.

## 9. Research paper

The plan is research.md §9. In short:
- **Thesis:** decision-focused, lane-constrained adaptive probing.
- **Hypotheses H1 to H5:**
  - H1: probing for the dry/not-dry decision beats variance and the published baselines;
  - H2: lane-centre-only sampling confounds probe bias with the row structure;
  - H3: failures in dry soil are informative;
  - H4: lookahead gains more as probes get slower;
  - H5 (optional): learning.
- **Venue:** first a 4 to 6 page workshop paper at ICRA or IROS, then a journal once field data exists.
- **Reserved seeds:** paper numbers come from seeds 500 to 599, which are still untouched.

Before claiming "first" or "only", re-run the searches in research.md §11.
