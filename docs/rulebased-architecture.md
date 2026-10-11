---
title: "RuleBased Architecture, Feature Inventory"
description: "Every feature in the weighted-v3 RuleBased predictor: source, computation, weight, usage"
order: 4.5
---

# RuleBased Architecture: Current Feature Inventory

This is the **operational baseline**: the `weighted-v3` RuleBased model that is in
production (RuleBased Top-1 = **58.28%** on the frozen 163-race canonical benchmark).
If we improve this, it has to change `WEIGHTS` + `compute_features.py` and require a DB
backfill. Read this before proposing any change.

---

## Pipeline at a glance

```
FastF1 sessions ──► ingest jobs ──► raw tables
                                        │
compute_season_stats (after each race)  ──► driver_season_stats / team_season_stats
                                        │
compute_features (after qualifying)     ──► driver_prediction_features  (12 scored features)
                                        │
compute_predictions (after qualifying)  ──► softmax(raw_weighted_score, T=0.3)
                                             ──► race_predictions.predicted_winner_id
```

- **`compute_season_stats.py`**: running season aggregates after each completed race.
- **`compute_features.py`**: per-driver, per-GP feature scores (all 0–1) + weighted sum.
- **`compute_predictions.py`**: softmax over `raw_weighted_score` (T=0.3) → winner.

The **sprint pipeline** mirrors this with 8 features in `compute_sprint_features.py` /
`compute_sprint_predictions.py` (not the focus here; GP model below).

---

## The 12 weighted features (GP model)

Each feature is a `NUMERIC(6,5)` **0–1 score** per (race × driver). The raw score is the
weighted sum; classification uses softmax over the field.

### Belags (hardcoded in `compute_features.py`)

| Feature | Weight | Blended at |
|---|---|---|
| Car Performance | **0.20** | `team_season_stats.car_performance_score` |
| Long Run Pace | **0.15** | `fp2_long_run_times` → fallback `lap_times` |
| Tyre Degradation | **0.08** | `lap_times.tyre_life` (regression slope) |
| Reliability | **0.08** | `team_season_stats.reliability_score` + driver DNF rate |
| Qualifying Delta | **0.08** | `qualifying_results` → teammate gap (last 5) |
| Driver Rating | **0.08** | `driver_season_stats.total_points/races/25` |
| Win Rate | **0.08** | wins/races Bayesian |
| Luck Factor | **0.07** | finish vs expected (car rank + grid), last 5 |
| Circuit-Adj. Starting Position | **0.07** | `grid_position` × `overtake_rate` & SC prob |
| Sector Strength | **0.06** | `qualifying_results.sector1/2/3_ms` |
| Circuit-Adj. Position Gain | **0.03** | `avg_position_gain` × `overtake_rate` |
| Weather Impact | **0.02** | `races.weather` → historical wet finish avg |

Sum = 1.00. **Static context** (`circuits.overtake_rate`, `sc_probability`) is seeded once
per circuit, never changes.

---

## Feature-by-feature: source, computation, usage

### 1. GP: Car Performance 0.20
- **Table:** `team_season_stats.car_performance_score`, 1 per team per season.
- **Computed in:** `compute_season_stats._compute_team_stats`, blend of the team's
  **median** finish position (robust: one DNF no longer drags a dominant car down)
  and its **average grid position** (raw one-lap car speed): `0.6·minmax(21−median) +
  0.4·minmax(21−avg_grid)`, min-max normalized across the field.
- **Usage:** `compute_features.run` pulls the driver's team score, then **blends it
  with a circuit-category-specific score** (`compute_team_circuit_perf` via
  `blend_car_perf`): at race time the season score is nudged toward the driver's
  historical performance at this circuit's **track_category** (`circuits.track_category`),
  ramping from 0 to 40% as the driver accrues ≥2 category races. Rewards cars that are
  strong on a layout type (e.g. McLaren on high-downforce tracks) without inflating the
  season average.

### Sprint model note: `compute_sprint_features` applies the same `blend_car_perf`
### circuit-category blend to its car_performance feature (0.25 weight).

### 2. Long Run Pace: 0.15
- **Source:** `fp2_long_run_times.median_lap_ms` (FastF1 practice stint medians, medium-normalized).
- **Computed** (@ `compute_features._compute_long_run_pace`): takes `MIN(median_lap_ms)`
  per driver; if ≥70% of drivers have practice data → use it, else fallback to historical
  circuit lap-time median (`lap_times`, last 6 completed races at that circuit).
- **Normalization:** invert (lower time = better) + min-max → [0,1].
- **Ingest:** `ingest_fp2.py` (FP2 primary → **FP1 fallback on sprint weekends**, no FP2
  session exists there; recorded in `session_type`), COMPOUND_OFFSET_MS normalizes
  soft/hard to MEDIUM baseline.

### 3. Tyre Degradation: 0.08
- **Source:** `lap_times.tyre_life` + `lap_time_ms`. Historical only.
- **Computed** (`_compute_tyre_degradation`): compound-stratified `REGR_SLOPE(lap_time_ms, tyre_life)`
  calculated **independently for SOFT, MEDIUM, and HARD** over the **last 4 completed races at the
  same circuit** (`circuit_id`), laps `tyre_life >= 3`. Per-compound slopes are blended weighted by
  each driver's clean lap count on that compound via `blend_compound_slopes`.
- **Dual-threshold logic:** primary path requires ≥ 8 laps per compound; if no compound qualifies but
  total laps ≥ 10, a fallback path includes all compounds with valid slopes. Drivers with insufficient
  data fall back to the field median.
- Lower blended slope (less falloff) = better. Field-normalized [0,1].
- **This is per-DRIVER-per-circuit, but pooled from prior visits (cross-season via driver.code).**

### 4. Reliability: 0.08
- **Source:** `team_season_stats.reliability_score` (0.7) + driver `dnf_rate` (0.3).
- **Formula:** `team_rel * 0.7 + (1 - dnf_rate) * 0.3`, then min-max.

### 5. Qualifying Delta: 0.08
- **Source:** `qualifying_results` (Q1/Q2/Q3 times).
- **Computed** (`_compute_qualifying_delta`): rolling **teammate** delta (`LEAST(q3,q2,q1)`),
  last **5** races, weighted (most recent=5 … oldest=1), cross-season via `driver.code`.
  High = faster than teammate. Min-max [0,1].
- **This is the driver's quali form vs teammate: seasonal/rolling, NOT circuit-specific.**

### 6. Driver Rating: 0.08
- **Source:** `driver_season_stats.total_points / races_entered / 25`, clamped [0,1].
- Season form, driver-level.

### 7. Win Rate: 0.08
- **Source:** `driver_season_stats.wins / races_entered`.
- Bayesian: `(wins + 0.5) / (races + 2)`.

### 8. Luck Factor: 0.07
- **Source:** `race_results.finish_position` vs expected (car rank + grid).
- **Computed** (`_compute_luck`): avg of `(grid + car_rank)/2 - finish_position`, last **5**
  completed races, cross-season via `driver.code`. Positive = over-performed. Min-max.

### 9. Circuit-Adjusted Starting Position: 0.07
- **Source:** `qualifying_results.grid_position` x static circuit.
- **Formula:** `start_pos = (21 - grid)/20` then × `(1 + (1 - overtake_rate)) × (1 - 0.3 × sc_probability)`.
- **Reason:** grid matters more at low-overtake (Monaco), SC probability blunts grid).

### 10. Sector Strength: 0.06
- **Source:** `qualifying_results.sector1/2/3_ms`.
- **Computed** (`_compute_sector_strength`): current race's Q sector times, inverted + min-max
  per sector, averaged.

### 11. Circuit-Adjusted Position Gain: 0.03
- **Source:** `driver_season_stats.avg_position_gain` x `circuits.overtake_rate`.
- `position_gain = (avg_gain + 15) / 30` then × overtake_rate.

### 12. Weather Impact: 0.02
- **Source:** `races.weather` flag (`'wet'`/`'mixed'`, from FastF1 rainfall).
- **Computed** (`_compute_weather`): dry → all 0.5 neutral; else driver's historical avg
  wet finish inverted, min-max. Only 2%: weighted barely.

---

## How it becomes a prediction

`compute_predictions.py`:
```
raw = Σ (feature_score_i × weight_i)          -- per driver
win_probability = softmax(raw, temperature=0.3)   -- softmax across field, one winner
predicted_winner = argmax(win_probability)
```

## What the data is NOT yet capturing (candidate gaps for improving Rule)

From the 3 sprint post-mortems (Sprint 13/19/20 all converge to ~61%; within-gate
selection is the bottleneck), the concrete signal gaps are:

1. **Car×circuit matrix (biggest).** `car_performance_score` is season-level and
   circuit-agnostic. **Now partially addressed:** season score is blended at feature time
   with a `track_category`-scoped performance term (`car_performance_at_circuit`
   via `compute_team_circuit_perf` + `blend_car_perf`). Still per-category, not
   per-exact-circuit: a per-circuit-key table would be the next refinement.
2. **Wet-adjusted pace** is binary and only 2%. No wet-vs-dry pace split.
3. **Sprint-specific form** (sprint weekends are a −3…−11pp failure mode). No speed
   short-run/SQ-based pace feature for the GP model on sprint weekends.
4. **Driver × circuit quali delta (rolling)**: `qualifying_delta` is teammate-based
   season-wide; a driver's delta *at this specific circuit* would isolate layout comfort.
5. **Grid>3 winners** (worst segment, −10…−31pp): no feature rewards a driver who can win
   from outside the front row; the model is grid-dominated.

---

## Reproduce / regenerate

- Rule feature computation: `data-engine/src/jobs/compute_features.py`
- Backfill driver invoked via `src/main.py` (jobs: `compute_features`, `compute_season_stats`).
- Benchmark eval: `data-engine/scripts/benchmark_car_perf.py`, replays predictions against completed
  races under an old vs. new formula, reports Top-1 accuracy, then restores DB state.

Note: earlier revisions of this doc referenced `experiments/sprint{13,16,19,20,21}/` report
folders and a specific 58.28% / 163-race benchmark figure. That `experiments/` directory has
never existed in this repo's git history: those were local, untracked run reports. Treat the
"RuleBased Top-1" figure and the sprint post-mortem numbers below as historical/unverified
until a new benchmark run (via `benchmark_car_perf.py` or a successor script) reproduces them
and the result is committed somewhere in this repo.