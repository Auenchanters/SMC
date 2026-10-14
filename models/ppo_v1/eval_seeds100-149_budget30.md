# agrisim eval: runs\ppo_v1\model.zip, demo.yaml, budget 30

Seeds: 50 (100-149); probe budget: [30]. Each cell is mean +/- 95% t-interval half-width over seeds (n shown when some values are undefined). Soil and probe parameters are placeholders until calibrated, so these numbers compare strategies inside the simulator only.

| metric | fixed_spacing | random | greedy_variance | greedy_variance_per_cost | ppo |
|---|---|---|---|---|---|
| rmse | 0.03378 +/- 0.0018 | 0.03544 +/- 0.0019 | 0.03328 +/- 0.0019 | 0.03637 +/- 0.0023 | 0.03573 +/- 0.002 |
| mae | 0.02675 +/- 0.0014 | 0.02802 +/- 0.0015 | 0.0265 +/- 0.0015 | 0.02868 +/- 0.0018 | 0.0282 +/- 0.0016 |
| r2 | 0.5438 +/- 0.051 | 0.4974 +/- 0.055 | 0.5534 +/- 0.056 | 0.4644 +/- 0.07 | 0.4864 +/- 0.061 |
| dry_precision | 0.5108 +/- 0.1 (n=36) | 0.6258 +/- 0.1 (n=33) | 0.5824 +/- 0.075 (n=42) | 0.6197 +/- 0.097 (n=34) | 0.5514 +/- 0.098 (n=36) |
| dry_recall | 0.1485 +/- 0.063 | 0.1293 +/- 0.053 | 0.2358 +/- 0.067 | 0.157 +/- 0.059 | 0.1601 +/- 0.058 |
| dry_f1 | 0.2393 +/- 0.07 (n=36) | 0.251 +/- 0.074 (n=33) | 0.3265 +/- 0.068 (n=42) | 0.2802 +/- 0.078 (n=34) | 0.268 +/- 0.068 (n=36) |
| calibration_95 | 0.9638 +/- 0.0086 | 0.9668 +/- 0.0096 | 0.9608 +/- 0.01 | 0.9633 +/- 0.012 | 0.957 +/- 0.012 |
| rmse_global_mean | 0.05134 +/- 0.00043 | 0.05168 +/- 0.0005 | 0.05177 +/- 0.00051 | 0.05268 +/- 0.0007 | 0.05169 +/- 0.00053 |
| rmse_idw | 0.03423 +/- 0.0015 | 0.03646 +/- 0.0015 | 0.03348 +/- 0.0016 | 0.03761 +/- 0.0022 | 0.03668 +/- 0.0018 |
| probes_used | 30 +/- 0 | 30 +/- 0 | 30 +/- 0 | 30 +/- 0 | 30 +/- 0 |
| valid_probes | 29.68 +/- 0.15 | 29.68 +/- 0.15 | 29.68 +/- 0.15 | 29.68 +/- 0.15 | 29.68 +/- 0.15 |
| path_length_m | 465.7 +/- 0 | 733.4 +/- 19 | 774.9 +/- 12 | 149.3 +/- 5.8 | 689.2 +/- 14 |
| mission_time_s | 1351 +/- 0 | 1955 +/- 39 | 1999 +/- 26 | 647.8 +/- 12 | 1860 +/- 29 |
| lane_coverage | 1 +/- 0 | 0.6274 +/- 0.022 | 0.4994 +/- 0.02 | 0.2406 +/- 0.013 | 0.5684 +/- 0.018 |
| plant_contacts | 0 +/- 0 | 0 +/- 0 | 0 +/- 0 | 0 +/- 0 | 0 +/- 0 |

Kriging RMSE below the global-mean RMSE (same readings):

- fixed_spacing: 50/50 seeds
- random: 50/50 seeds
- greedy_variance: 50/50 seeds
- greedy_variance_per_cost: 49/50 seeds
- ppo: 49/50 seeds
