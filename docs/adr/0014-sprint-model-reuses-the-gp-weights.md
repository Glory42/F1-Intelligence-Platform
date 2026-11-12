# The sprint model reuses weighted-v4's GP weights on the sprint grid

sprint-v2 scored eight 0–1 features with hand-picked weights and a softmax at T = 0.3: the shape weighted-v3
had before ADR 0010 replaced it for the GP. About 30 sprints (2021–2026) seemed too few to fit a model of its
own, so it was never fitted or replayed. `scripts/backtest_sprint.py` now replays every sprint from data
before its weekend, on the local snapshot, against the stored predictions and two baselines:

| model (30 sprints) | log loss | Brier | top-1 |
|---|---|---|---|
| sprint-v2, as stored | 2.173 | 0.838 | 60% |
| v4 transfer (GP weights, sprint grid) | 0.970 | 0.475 | 60% |
| pooled (refit on GPs + earlier sprints) | 0.955 | 0.470 | 60% |
| sprint-only fit (20 sprints with 10+ before) | 1.028 | 0.529 | 65% |
| P(win \| grid slot) | 1.041 | 0.515 | 70% |
| equal chances | 3.010 | | |

Paired per sprint, v4 transfer beats sprint-v2 by 1.203 ± 0.230 log loss, worse than even the grid baseline.
Pooling gains 0.015 ± 0.016 over the transfer, and the transfer's edge over the grid (0.071 ± 0.239) is
noise on 30 sprints.

sprint-v3 is the transfer: `gp_features_v4.sprint_features` builds v4's seven features from the sprint's own
grid sheet (`sprint_results` grid and SQ1–3 times; in 2021–22 Friday qualifying set the sprint grid and its
times stand in), and the committed `src/models/gp_v4.json` scores them with a plain softmax.

## Consequences

- No sprint weights, temperature or fit of its own: refitting the GP model refits the sprint model.
  `feature_manifest.py`, `feature_helpers.py` and the sprint section of `docs/feature-weights.json` are gone.
- `driver_sprint_features` stores rows the GP's way (`features` JSONB: value + contribution). Migration
  `0032` added the column and made sprint-v2's `*_score` columns nullable; a later one drops them.
- The API serves sprints with the GP manifest: the same seven features and importances.
- `compute_sprint_features` skips sprints inside the committed fit, like `compute_features`;
  `backfill_all_predictions.py` writes each season's GPs and sprints with weights fitted on earlier seasons.
- Sprints get no podium chance: the Henery discount was validated on GPs only.
- 30 sprints can't tell sprint-v3 from the grid baseline. Rerun `backtest_sprint.py` as sprints accumulate,
  and before any change that refits the GP model.
