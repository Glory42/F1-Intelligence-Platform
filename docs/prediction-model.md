---
title: "Prediction Model"
description: "Feature weights, data origins, OpenF1/Jolpica vs static vs computed, softmax"
order: 4
---

# Prediction Model

## Overview

Two separate models run per race weekend: one for the grand prix, one for the sprint (sprint weekends only). Both score each driver with a weighted sum of features and turn the field's scores into win probabilities with a softmax. The grand prix model (`weighted-v4`) has its weights fitted to every GP since 2010 (ADR 0010); the sprint model (`sprint-v3`) applies those same weights to the sprint's own grid, since refitting on about 30 sprints gained nothing (ADR 0014).

**Prediction scorecard**

![Prediction page](../preview/Preview-predictionPage.webp)

**Race prediction detail**

![Prediction detail page](../preview/Preview-prediction[id]Page.webp)

**Championship title odds**

![Title odds](../preview/Preview-titleOddsPage.webp)

---

## Where the data comes from

Every feature score ultimately originates from one of three places:

### 1. OpenF1 + Jolpica (session data, free APIs)
The Python ingest jobs read each finished session from OpenF1 (laps, sectors, tyres, weather,
race control, qualifying times) and the official race classification from Jolpica (grid,
status, points), then store them in raw tables (`utils/openf1_session.py`). This was FastF1
until October 2026, when FastF1 3.9 started requiring a paid F1TV subscription (ADR 0011).
Seasons ingested before then keep their FastF1 rows.

| Session | Ingest job | Populates table(s) |
|---------------|-----------|-------------------|
| Race (`'R'`) | `ingest_race` | `race_results`: finish pos, grid pos, status, points |
| Qualifying (`'Q'`) | `ingest_qualifying` | `qualifying_results`: Q1/Q2/Q3 lap times, grid pos, sector times |
| FP2 (`'FP2'`) | `ingest_fp2` | `fp2_long_run_times`: stint median lap times on each compound |
| Race lap data | `ingest_race` | `lap_times`: per-lap time, sector times, tyre compound, tyre life, speed |
| Sprint (`'S'`) | `ingest_sprint` | `sprint_results`: sprint finish pos, points |
| Sprint Qualifying (`'SQ'`) | `ingest_sprint_qualifying` | `sprint_results.sq1/sq2/sq3_time_ms` |
| Sprint lap data | `ingest_sprint` | `sprint_lap_times`: per-lap sprint data |
| Weather | every ingest | `races.weather`, `races.sprint_weather`: share of OpenF1 weather samples with rain |

OpenF1's `headshot_url` is used for driver photos (FastF1's before 2023; not available before 2019).
Neither source provides team logos: those are stored as static files in `apps/web/public/teams/`.

### 2. Computed aggregates (run after each race)
`compute_season_stats` reads from the raw tables above and computes season-wide summaries for the
standings pages. The sprint features read the same aggregates computed as of the race date
(`utils/season_aggregates.py`); weighted-v4 builds its own form features from an in-memory race history.

| Aggregate table | Computed from | Key columns used by features |
|----------------|--------------|------------------------------|
| `driver_season_stats` | `race_results`, `qualifying_results` | `total_points`, `wins`, `races_entered`, `dnf_rate`, `avg_position_gain`, `teammate_quali_delta` |
| `team_season_stats` | `race_results` | `car_performance_score` (normalized avg finish), `reliability_score` (1 − DNF rate) |

### 3. Static / hardcoded
Some inputs never change and are seeded once into the database or hardcoded in Python.

| Value | Where stored | Changes? |
|-------|-------------|---------|
| Circuit overtake rate | `circuits.overtake_rate` | Never: seeded once per track |
| Circuit SC probability | `circuits.sc_probability` | After every race ingest: share of the circuit's completed races with safety-car laps (`ingest_race._recompute_circuit_sc_probability`). No current model reads it (sprint-v2 did) |
| GP model weights | `data-engine/src/models/gp_v4.json` (fitted, written by `scripts/fit_model_v4.py`); importances + labels in `docs/feature-weights.json`, mirrored in the API's `GP_FEATURE_MANIFEST`, which serves them with every Prediction | On a deliberate, backtested refit |
| Sprint model weights | None of its own: sprint-v3 uses `gp_v4.json` and the API's `GP_FEATURE_MANIFEST` | With every GP refit |

---

## Data pipeline: end-to-end flow

```
OpenF1 + Jolpica sessions (FastF1 before Oct 2026)
    │
    ▼  (ingest jobs)
raw tables: race_results, qualifying_results, lap_times, sprint_results,
            sprint_lap_times, fp2_long_run_times
    │
    ├──▶ GP: race_history (last 3 seasons, in memory) ─▶ gp_features_v4 ─▶ src/models/gp_v4.json weights
    │                                                     (compute_features)
    └──▶ sprint: season aggregates as of the race + sprint features (compute_sprint_features)
         │
         ▼
    driver_prediction_features (features JSONB) / driver_sprint_features (score columns)
         │
         ▼  (same job, same transaction: softmax T = 1 for GP / T = 0.3 for sprint)
    race_predictions / sprint_predictions
         │
         ▼  (Hono API reads)
    /prediction page: win probabilities, each driver's edge over the field, what-if lab
```

---

## Race Status Flow

```
conventional weekend:
  scheduled → qualifying_done → completed
                   │                │
          compute_features    ingest_race
                              compute_season_stats

sprint weekend:
  scheduled → sprint_qualifying_done → sprint_done → qualifying_done → completed
                       │                   │               │
              compute_sprint_features  ingest_sprint  compute_features
```

Main race predictions are computed at `qualifying_done`. Sprint predictions are computed at `sprint_qualifying_done` (after SQ session).

---

## Grand Prix Model: `weighted-v4`, 7 fitted features

See § Backtest below for the features, how they were chosen and how the model scores. In short: each
driver's score is Σ weight × standardized feature, the weights are fitted to past winners
(`utils/conditional_logit.py`, committed in `src/models/gp_v4.json`), and the stored row keeps every
feature's value and contribution (`features` JSONB). `raw_weighted_score` is the summed contributions.
`utils/gp_model_v4.py` is the only path to a GP Prediction (`training_races` → `fit(before=)` → `predict`):
the live job, the backfill, the fit script and the backtest all use it. `compute_features` uses the committed
fit and skips races inside it (`trained_on.to_date`), leaving their out-of-sample rows from the backfill.

| Feature | Importance |
|---------|-----------|
| Grid Slot (`grid`) | 20% |
| Driver Form (`driver_points`) | 18% |
| Team Race Pace (`team_race_pace`) | 18% |
| Grid × Hard-to-Pass Track (`grid_processional`) | 17% |
| Team Qualifying Pace (`team_quali_pace`) | 12% |
| Qualifying Pace (`quali_pace`) | 11% |
| Teammate Edge (`teammate_edge`) | 4% |

Importance is each feature's share of |weight per SD|, written to `docs/feature-weights.json` by
`scripts/fit_model_v4.py` and mirrored in the API's `GP_FEATURE_MANIFEST`. Refit only after
`scripts/backtest.py` validates the change.

## Sprint Model: `sprint-v3`, the GP weights on the sprint grid

`compute_sprint_features` builds weighted-v4's seven features for the sprint (`gp_features_v4.sprint_features`)
and scores them with the committed `gp_v4.json`, through the same `gp_model_v4.predict`:

- **Grid Slot, Grid × Hard-to-Pass Track:** the sprint's grid (`sprint_results.grid_position`).
- **Qualifying Pace:** the gap in SQ1–3. In 2021–22 Friday qualifying set the sprint grid and there was no SQ,
  so qualifying's times stand in.
- **Driver Form, Team Race / Qualifying Pace, Teammate Edge:** from races before the weekend, as for the GP.
- The sprint's own result is never a feature (`sprint_result` is zeroed for a sprint target).

Rows are stored the GP's way (`driver_sprint_features.features` JSONB) and served with the GP manifest. The job
skips sprints inside the committed fit, and `backfill_all_predictions.py` rebuilds past ones with weights fitted
on the seasons before, so stored sprint predictions are out-of-sample.

`scripts/backtest_sprint.py` replays every sprint from data before its weekend (ADR 0014):

| model (30 sprints, 2021–2026) | log loss | Brier | top-1 |
|---|---|---|---|
| sprint-v2 (hand weights, T = 0.3), as stored | 2.173 | 0.838 | 60% |
| **v4 transfer (sprint-v3)** | **0.970** | **0.475** | 60% |
| pooled: refit on GPs + earlier sprints | 0.955 | 0.470 | 60% |
| sprint-only fit (20 sprints with 10+ before) | 1.028 | 0.529 | 65% |
| P(win \| grid slot) | 1.041 | 0.515 | 70% |
| equal chances | 3.010 | | |

Paired per sprint, sprint-v3 beats sprint-v2 by 1.203 ± 0.230 log loss. Pooling gains 0.015 ± 0.016 (noise), so
the simpler transfer ships, and its edge over the grid baseline (0.071 ± 0.239) is noise on 30 sprints. The
eight hand-weighted sprint-v2 features are recorded in [`rulebased-architecture.md`](rulebased-architecture.md).

---

## Softmax → Win Probability

```python
exp_s = np.exp(scores / T)
win_probability = exp_s / exp_s.sum()
```

- **T = 1 for both models.** The fitted weights already set how decisive the model is, so there is no
  separate temperature to tune: the fit picks the scale that best matches who actually won. sprint-v2's
  hand-picked weights needed T = 0.3; sprint-v3 reuses the fitted ones.

Probabilities sum to 1.0 across all drivers in a race.

## Predicted Position

Drivers are ranked by `win_probability` descending. Rank 1 = predicted winner, stored in `race_predictions.predicted_winner_id` (or `sprint_predictions.predicted_winner_id` for sprints). All driver positions are stored in `driver_prediction_features.predicted_position` (or `driver_sprint_features.predicted_position`).

## Podium chance (GP only)

`compute_features` also stores each driver's P(top 3) in `driver_prediction_features.podium_probability`
(`utils/finishing_order.py`). The field's win probabilities are treated as a Plackett–Luce distribution:
20,000 finishing orders are drawn, seeded by `race_id` so a rerun writes the same numbers. The winner is drawn
from the win probabilities, and the places after it from win probability ^ 0.8 (a Henery discount).

`scripts/backtest.py --places` picked that 0.8 against a baseline of P(top k | grid slot) learned from earlier
races (190 GPs, 2018–2026, binary log loss per driver, lower is better):

| Henery exponent | podium log loss | podium Brier | points (top 10) log loss | points Brier |
|---|---|---|---|---|
| 1.0 (plain Plackett–Luce) | 0.2286 | 0.0690 | 0.8209 | 0.1649 |
| **0.8** | **0.2244** | **0.0686** | 0.6726 | 0.1642 |
| 0.6 | 0.2297 | 0.0698 | 0.5597 | 0.1649 |
| 0.4 | 0.2483 | 0.0741 | 0.5230 | 0.1697 |
| grid baseline | 0.2313 | 0.0695 | **0.5016** | **0.1639** |

- **Plain Plackett–Luce overrates favourites' podiums.** Drivers it gave 70%+ finished on the podium 76% of
  the time, against a mean prediction of 90%. The discount fixes most of that and beats the grid baseline.
- **P(points) and expected points aren't served.** At no exponent did P(top 10) beat the grid baseline: win
  probabilities are near zero for most of the field, and so are the chances the chain gives those drivers for
  P8–P10, but they score points often. Expected points would inherit the same error.
- Sprints have no podium chance: sprint-v3 was never validated for podiums.

`scripts/backfill_podium_probability.py` fills the column for stored predictions from their stored win
probabilities (no refit).

## Before qualifying (`pre-quali-v1`)

Until qualifying is ingested, weighted-v4 has nothing to score: three of its seven features (grid slot,
grid × hard-to-pass track, qualifying pace) come from qualifying. The other four only read races already run,
so `compute_pre_quali` fits them as their own model and forecasts the **next** race as soon as the previous one
is ingested (ADR 0015). The forecast stands all week and stays stored after qualifying, so the prediction
page shows how qualifying moved each driver's chance (`preQualiProbability`).

- **Features:** `gp_features_v4.PRE_QUALI_FEATURES`: driver form, team race pace, team qualifying pace, team-mate
  edge. Plain softmax, weights fitted separately (`scripts/fit_model_v4.py --pre-quali` →
  `src/models/gp_v4_prequali.json`); no importances on the page, so `docs/feature-weights.json` is unchanged.
- **Field:** `previous_lineup`, the drivers and teams of the season's last completed race. A season opener has no
  earlier race and gets no forecast; a mid-season swap shows up one race late.
- **Storage:** `pre_quali_predictions`, one row per driver (`features` JSONB, `win_probability`, rank).

`scripts/backtest.py` replays it over the 190 GPs from 2018 to 2026, each from races before it only:

| model | log loss | Brier | top-1 | top-3 |
|---|---|---|---|---|
| weighted-v4 (after qualifying) | 1.2084 | 0.5655 | 60.0% | 90.0% |
| **pre-quali** | **1.5187** | **0.6704** | 47.9% | 78.9% |
| pre-quali + FP2 long runs | 1.5308 | 0.6781 | 45.3% | 76.8% |
| driver form only | 1.5585 | 0.6733 | 46.3% | 77.4% |
| P(win \| grid slot), after qualifying | 1.4527 | 0.6425 | 55.3% | 87.9% |
| equal chances | 2.9997 | 0.9502 | 5.0% | 14.9% |

- Paired per race, pre-quali beats equal chances by 1.481 ± 0.152 log loss.
- **FP2 long runs make it worse,** as they did for v4, so practice data stays out.
- **It can't be told apart from driver form alone** (−0.040 ± 0.047). It ships because it reuses v4's own
  features and code and is nominally best on every metric.
- Qualifying is worth about 0.31 log loss (1.519 → 1.208).

---

## Data Availability by Era

| Years | Qualifying data | Lap times | Sprint data |
|-------|----------------|-----------|-------------|
| 2018–present | Full Q1/Q2/Q3 + sector times | Full per-lap telemetry | Full SQ times + sprint lap times |
| 2006–2017 | Q1/Q2/Q3 times | None | N/A (sprint format started 2021) |
| 2000–2005 | Single best lap time only | None | N/A |
| 1990–1999 | None (fell back to race starting grid) | None | N/A |

For races without qualifying data, `compute_features` cannot run: those races have no predictions.


## Championship title odds (`title-odds-v1`)

`compute_title_odds` (data-engine) turns race-by-race win probabilities into championship odds:

1. **Remaining sessions**: every GP not yet `completed`, plus the sprint on sprint weekends whose
   status is `scheduled`/`sprint_qualifying_done` (`build_remaining_races`).
2. **Win probabilities per session**: the session's own stored prediction when it exists
   (features exist once qualifying is in); otherwise each driver's mean predicted GP win probability
   over the last 5 predicted races (`form_win_probs`), floored at 0.001 so no driver is impossible.
3. **Finishing orders**: Plackett–Luce draws via the Gumbel-max trick: sort `log(p) + Gumbel noise`.
   The winner follows `p`; lower places follow the same softmax ranking, so each session keeps its own
   model's temperature (T = 1 for the GP, 0.3 for the sprint).
4. **Points**: GP 25-18-15-12-10-8-6-4-2-1 (no fastest-lap point, as from 2025); sprint 8-7-…-1.
   Current points are `total_points + sprint_total_points`.
5. **Aggregate**: 10,000 seasons, seeded by `(year, after_round)` so reruns are identical. A points
   tie splits the title (countback isn't simulated). Team odds sum each team's drivers within the
   same simulated seasons, so driver and constructor odds are consistent.

The web standings additionally show pure mathematical contention (`titleContention` in
`apps/web/src/lib/f1/championshipMath.ts`): a driver is eliminated once their points plus every point
still available (26 per GP 2019–2024, 25 otherwise; 8 per sprint, 3 in 2021) fall short of the leader.


## Backtest (walk-forward, leakage-free)

`scripts/backtest.py` replays every completed GP from a local snapshot of Neon
(`scripts/backtest_snapshot.py` → `docker-compose.backtest.yml`; it refuses Neon itself). Each race is
predicted through the same `utils/gp_model_v4.py` the live job and the backfill use: `training_races` →
`fit(before=race date)` → probabilities from the in-memory `RaceHistory`, and scored with `utils/backtest.py`: log loss, multi-class Brier,
top-1/top-3 (tie-aware) and a calibration table. Baselines: `grid-history`, P(win | grid slot) learned only
from earlier races (its top pick is the pole-sitter), and `uniform`. New candidates are one entry in
`CANDIDATES`.

Before 2026-10-22 every recomputed past prediction read whole-season stats and the race's own weather, so
it partly knew the result. First honest run, 190 races 2018–2026:

| model | log loss | Brier | top-1 | top-3 |
|---|---|---|---|---|
| weighted-v3 (honest) | 2.446 | 0.879 | 43.2% | 75.8% |
| grid-history | 1.457 | 0.651 | 55.3% | 87.9% |
| uniform | 3.000 | 0.950 | 5.0% | 14.9% |
| weighted-v3 stored (leaky) | 2.361 | 0.867 | 48.4% | 81.6% |

v3 loses to "the pole-sitter wins" and is badly under-confident: its favourites get ~11% and win ~51% of
the time. v4 has to beat `grid-history`, not just v3.

### weighted-v4

A conditional logit (`utils/conditional_logit.py`): the same softmax over a weighted sum as v3, but the
weights are fitted to past winners by maximum likelihood (damped Newton, L2 on standardized features), so the
temperature is part of the fit. The backtest refits it before every race on earlier races only, from 2010.
Features (`utils/gp_features_v4.py`, from an in-memory `utils/race_history.py`) are in real units, not
per-race min-max, and form is a decayed average over each person's / outfit's last 12 races across seasons
(identity: `utils/identity.py`, mirroring the API's `identity.ts`):

| feature | meaning | weight per SD (committed fit: 346 GPs, 2010 to 2026-10-11) |
|---|---|---|
| `grid` | −log(grid slot): pole vs P2 matters, P15 vs P16 barely | +0.63 |
| `grid_processional` | `grid` × (1 − circuit overtake rate) | +0.54 |
| `team_race_pace` | outfit's decayed gap to the fastest clean race-lap median (2018+ laps) | +0.57 |
| `driver_points` | decayed points per race, finish positions scored on the 2010+ table | +0.56 |
| `team_quali_pace` | outfit's decayed best qualifying gap to pole | +0.39 |
| `quali_pace` | this weekend's gap to the fastest time in the deepest session reached | +0.36 |
| `teammate_edge` | decayed qualifying gap to the team-mate | +0.14 |

Chosen on 2018–2021 and confirmed on 2022–2026. Also tried and left out, adding nothing beyond noise:
driver wins, team points, team DNF rate, practice long runs, this weekend's sprint result, the circuit's
safety-car rate; and stronger L2.

| model, 190 races 2018–2026 | log loss | Brier | top-1 | top-3 |
|---|---|---|---|---|
| weighted-v4 | 1.208 | 0.566 | 60.0% | 90.0% |
| v3 features, fitted weights | 1.457 | 0.668 | 48.4% | 87.4% |
| grid-history | 1.457 | 0.651 | 55.3% | 87.9% |
| weighted-v3 | 2.446 | 0.879 | 43.2% | 75.8% |

Paired against `grid-history`, v4's log loss is −0.249 ± 0.099 (2 SE). It is also calibrated: drivers given
10–20% win 12.5% of the time, 50–70% win 65%, 70%+ win 75%. (These baseline rows are from the run that
still included v3; the harness now seeds `grid-history` from 2007 on, which moves it to 1.453 / 55.3%.)

The predictions stored for 2018–2026 are fitted per season on earlier seasons only
(`scripts/backfill_all_predictions.py`), and score log loss 1.207 / top-1 58.9% / top-3 90.0%: as good as
refitting before every race. Upcoming races use the committed fit.

The site's Scorecard (`/prediction?tab=scorecard`) runs the same check live on those stored predictions
(`GET /api/predictions/accuracy` → `calibration`): a whole-field calibration chart over every season, and each
season's Brier and log loss next to two forecasts with no model, "the pole-sitter at the historical pole
win rate" and "equal chances".

## Rejected: measured overtake rate (2026-10-10)

Idea: replace the hand-seeded `circuits.overtake_rate` with one measured from `race_overtakes`
(mean passes per car-lap, ranked 0–1 across circuits, using only races before the one being predicted,
shrunk toward the seeded value with weight `n / (n + k)`). A since-removed script re-priced
every stored `weighted-v3` prediction exactly: only the two circuit-adjusted features depend on the
rate: and compares multi-class Brier and winner hit rate over 208 completed races:

| k | v3 Brier | v4 Brier | v3 hit | v4 hit |
|---|---|---|---|---|
| 2 | 0.8666 | 0.8667 | 47.1% | 46.6% |
| 1 | 0.8666 | 0.8666 | 47.1% | 46.2% |
| 0 | 0.8666 | 0.8666 | 47.1% | 47.6% |

No setting beat v3 beyond noise (±1 race of 208). These numbers came from stored, leaky v3 rows (see
Backtest above); to retry the idea, add it as a `Candidate` in `scripts/backtest.py`. The two features
carry only 10% of the weight, and overtakes are 2023+ only. Re-run the script when more seasons of
overtake data exist.

Observed while building it: `circuit_adj_start_pos` multiplies the start-position score by up to ~1.95
at low-overtake tracks and then clamps at 1.0, so at Monaco-like circuits the front of the grid all
scores 1.0: pole and P2 become indistinguishable on that feature. weighted-v4's −log(grid) features fix
this for the GP, and sprint-v3 uses them too.
