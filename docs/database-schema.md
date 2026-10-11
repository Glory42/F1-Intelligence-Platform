---
title: "Database Schema"
description: "All tables, column types, constraints, foreign keys, and conventions"
order: 3
---

# Database Schema

**Provider:** Neon PostgreSQL  
**ORM:** Drizzle  
**Schema source:** `apps/api/src/db/schema/`  
**Migrations:** `apps/api/drizzle/migrations/` (generated SQL files)

---

## Conventions

- All primary keys are `SERIAL` (auto-increment integer)
- All timestamps are `TIMESTAMPTZ DEFAULT now()`
- Lap times stored as `INTEGER` milliseconds: never float
- Feature scores stored as `NUMERIC(6,5)`: range 0.00000 to 1.00000
- All natural keys have `UNIQUE` constraints

---

## Table Overview

```
seasons
  └── teams          (season-scoped)
  └── drivers        (season-scoped, FK → teams)
  └── races          (FK → circuits)
        └── qualifying_results      (FK → drivers)
        └── race_results            (FK → drivers)
        └── race_control_messages   (no driver FK: driver_number is a raw OpenF1 car number)
        └── race_overtakes          (two FKs → drivers: overtaking_driver_id, overtaken_driver_id)
        └── team_radio_clips        (FK → drivers)
        └── race_stints             (FK → drivers)  ← 2018+ (OpenF1 2023+, FastF1 before), per session
        └── race_pit_stops          (FK → drivers)  ← 2018+ (OpenF1 2023+, FastF1 before), per session
        └── race_lap_traces         (FK → drivers)  ← FastF1 2018+, int[] per lap
        └── race_battles            (2 FKs → drivers)
        └── race_weather_traces     (no driver FK)  ← per-minute weather arrays
        └── lap_times               (FK → drivers)
        └── driver_prediction_features (FK → drivers)
        └── race_predictions        (FK → drivers)
        └── sprint_results          (FK → drivers)  ← sprint weekends only
        └── sprint_lap_times        (FK → drivers)  ← sprint weekends only
        └── driver_sprint_features  (FK → drivers)  ← sprint weekends only
        └── sprint_predictions      (FK → drivers)  ← sprint weekends only
  └── driver_season_stats  (FK → drivers)
  └── title_odds_drivers   (FK → drivers): one row per driver per round
  └── title_odds_teams     (FK → teams)  : one row per team per round
  └── team_season_stats    (FK → teams)

circuits      (static, seeded once)
data_quality_runs      (FK → races, race_id nullable for season aggregates)
  └── data_quality_issues  (FK → runs)
```

---

## Tables

### `seasons`
One row per calendar year.

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `year` | integer UNIQUE | e.g. 2026 |

---

### `circuits`
Static track data, seeded once. Not season-scoped.

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `circuit_key` | varchar(50) UNIQUE | e.g. `monza`, `silverstone` |
| `name` | varchar(100) | |
| `country` | varchar(50) | |
| `city` | varchar(50) | |
| `lap_count` | integer | |
| `track_length_km` | numeric(5,3) | |
| `overtake_rate` | numeric(4,3) | 0.0–1.0; used in prediction model |
| `number_of_corners` | integer | null for pre-DRS-era circuits |
| `drs_zones` | integer | null for pre-DRS-era circuits |
| `sc_probability` | numeric(4,3) | Historical SC deployment rate (completed races); null for circuits with no completed races |
| `image_url` | varchar(512) | Public R2 URL or custom path for track layout image |
| `track_category` | varchar(30) | `street` \| `high_speed` \| `high_downforce` \| `balanced`: drives `car_performance_at_circuit` blend |

---

### `teams`
Season-scoped: a team row exists per year it competed.

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `season_id` | FK → seasons | |
| `team_key` | varchar(50) | snake_case, e.g. `red_bull` |
| `name` | varchar(100) | Display name |
| `nationality` | varchar(50) | |
| UNIQUE | `(season_id, team_key)` | |

---

### `drivers`
Season-scoped: a driver row exists per year they raced.

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `season_id` | FK → seasons | |
| `team_id` | FK → teams | |
| `driver_number` | integer | |
| `code` | char(3) | e.g. `VER`, `HAM` |
| `first_name` | varchar(50) | |
| `last_name` | varchar(50) | |
| `nationality` | varchar(50) | |
| `headshot_url` | varchar(255) | Populated from FastF1 for 2018+ |
| UNIQUE | `(season_id, driver_number)` | |

---

### `races`
One row per race event. Sprint weekends have one race row (covering both the sprint and grand prix).

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `season_id` | FK → seasons | |
| `circuit_id` | FK → circuits | |
| `round_number` | integer | |
| `name` | varchar(100) | e.g. `Monaco Grand Prix` |
| `race_date` | date | Grand Prix date |
| `qualifying_date` | date | Saturday qualifying date |
| `sprint_date` | date | Sprint race date (sprint weekends only) |
| `sprint_qualifying_date` | date | SQ session date (sprint weekends only) |
| `event_format` | varchar(30) | `conventional` \| `sprint` \| `sprint_qualifying` \| `sprint_shootout` |
| `status` | varchar(30) | See status flow below |
| `weather` | varchar(30) | `dry` \| `wet` \| `mixed`: main race weather |
| `safety_car_laps` | integer | 2018+ only |
| `vsc_laps` | integer | 2018+ only |
| `air_temp_avg` | numeric(4,1) | 2018+ only |
| `track_temp_avg` | numeric(4,1) | 2018+ only |
| `humidity_avg` | numeric(4,1) | 2018+ only |
| `sprint_weather` | varchar(30) | Sprint-specific weather: sprint weekends only |
| `sprint_safety_car_laps` | integer | Sprint SC laps |
| `sprint_vsc_laps` | integer | Sprint VSC laps |
| `sprint_air_temp_avg` | numeric(4,1) | Sprint session air temp |
| `sprint_track_temp_avg` | numeric(4,1) | Sprint session track temp |
| `sprint_humidity_avg` | numeric(4,1) | Sprint session humidity |
| UNIQUE | `(season_id, round_number)` | |

#### Race Status Flow

```
conventional weekend:
  scheduled → qualifying_done → completed

sprint weekend:
  scheduled → sprint_qualifying_done → sprint_done → qualifying_done → completed
                      ↓                     ↓                ↓
               sprint features      ingest sprint       main qualifying
               sprint predictions   sprint season stats features + predictions
```

---

### `qualifying_results`
One row per driver per main qualifying session.

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `race_id` | FK → races | |
| `driver_id` | FK → drivers | |
| `grid_position` | integer | Final starting grid position |
| `q1_time_ms` | integer | Null if knocked out before Q2 |
| `q2_time_ms` | integer | Null if knocked out before Q3 |
| `q3_time_ms` | integer | Null if not in Q3 |
| `sector1_ms` | integer | Best sector times: 2018+ only |
| `sector2_ms` | integer | |
| `sector3_ms` | integer | |
| `speed_st` | numeric(5,1) | Speed trap km/h: 2018+ only |
| UNIQUE | `(race_id, driver_id)` | |

---

### `race_results`
One row per driver per grand prix.

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `race_id` | FK → races | |
| `driver_id` | FK → drivers | |
| `finish_position` | integer | Null = DNF/DSQ |
| `grid_position` | integer | |
| `points` | numeric(4,1) | Championship points scored |
| `status` | varchar(30) | Finishers: `Finished`, `Lapped`, `+1 Lap`, `+2 Laps`; DNFs: `Retired`, `Accident`, `Engine`, `Collision`, `Disqualified`, `Did not start`, etc. |
| `total_race_time_ms` | bigint | For winner only |
| `fastest_lap` | boolean | |
| UNIQUE | `(race_id, driver_id)` | |

---

### `race_control_messages`
One row per flag/safety-car/incident event per race, 2018+. From 2023 it comes from OpenF1, ingested
once a race is `completed` and past OpenF1's live-data window; 2018–2022 was backfilled from FastF1's
race control feed (`scripts/backfill_fastf1_enrichment.py`).

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `race_id` | FK → races | |
| `date` | timestamptz | Message timestamp, from OpenF1 |
| `category` | varchar(30) | `Flag`, `SafetyCar`, `Drs`, `SessionStatus`, `CarEvent`, `Other` |
| `flag` | varchar(20) | e.g. `YELLOW`, `DOUBLE YELLOW`, `RED`, `GREEN`; null for non-flag messages |
| `lap_number` | integer | Nullable |
| `driver_number` | integer | Raw OpenF1 car number, not a `drivers` FK: no reliable per-season mapping stored here |
| `scope` | varchar(20) | e.g. `Track`, `Sector`, `Driver`; nullable |
| `sector` | integer | Nullable |
| `message` | text | Raw OpenF1 message text |
| `session_type` | varchar(10) | `race` (default) or `sprint`: both sessions of a sprint weekend share `race_id` |
| UNIQUE | `(race_id, date, message)` | |

---

### `race_overtakes`
One row per on-track position exchange per race, sourced from OpenF1: same 2023+/completed/
past-live-window coverage as `race_control_messages`. Unlike that table, OpenF1's driver
numbers here are resolved to `drivers.id` at ingest time (via `build_driver_number_map`),
since both sides of the exchange are needed for a usable UI.

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `race_id` | FK → races | |
| `date` | timestamptz | Overtake timestamp, from OpenF1 |
| `overtaking_driver_id` | FK → drivers | The driver who gained the position |
| `overtaken_driver_id` | FK → drivers | The driver who lost the position |
| `position` | integer | Track position after the overtake |
| `session_type` | varchar(10) | `race` (default) or `sprint`: both sessions of a sprint weekend share `race_id` |
| UNIQUE | `(race_id, date, overtaking_driver_id, overtaken_driver_id)` | |

---

### `team_radio_clips`
One row per team radio clip per race, sourced from OpenF1: same 2023+/completed/
past-live-window coverage as the other OpenF1 tables. F1 doesn't release radio for every
session, so sparse or missing coverage for a given race is expected, not a data gap.

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `race_id` | FK → races | |
| `driver_id` | FK → drivers | Resolved from OpenF1's car number via `build_driver_number_map` |
| `date` | timestamptz | Clip timestamp, from OpenF1 |
| `recording_url` | text | Direct link to F1's own audio CDN |
| `session_type` | varchar(10) | `race` (default) or `sprint`: both sessions of a sprint weekend share `race_id` |
| UNIQUE | `(race_id, driver_id, date)` | |

---

### `race_stints`
One row per tyre stint per driver per session, 2018+: OpenF1 `/stints` from 2023, FastF1 laps for
2018–2022 (`scripts/backfill_fastf1_enrichment.py`). A race with no rows falls back to stints rebuilt
on the fly from `lap_times` by the API (see `/api/races/:id/strategy`).

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `race_id` | FK → races | |
| `session_type` | varchar(10) | `race` or `sprint` |
| `driver_id` | FK → drivers | Resolved from OpenF1's car number (FastF1 driver code pre-2023) |
| `stint_number` | integer | 1-based |
| `compound` | varchar(20) | `SOFT`/`MEDIUM`/`HARD`/`INTERMEDIATE`/`WET`; 2018 keeps Pirelli's named compounds (`HYPERSOFT`/`ULTRASOFT`/`SUPERSOFT`/`SUPERHARD` too); nullable |
| `lap_start` / `lap_end` | integer | Inclusive lap range |
| `tyre_age_at_start` | integer | Laps already on the set (> 0 = used set) |
| UNIQUE | `(race_id, session_type, driver_id, stint_number)` | |

---

### `race_pit_stops`
One row per pit stop per driver per session, 2018+: OpenF1 `/pit` from 2023, FastF1 in/out-lap times
for 2018–2022 (pit-lane time only; lane visits over 120 s, red-flag waits, are dropped).

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `race_id` | FK → races | |
| `session_type` | varchar(10) | `race` or `sprint` |
| `driver_id` | FK → drivers | Resolved from OpenF1's car number (FastF1 driver code pre-2023) |
| `lap_number` | integer | Lap the stop happened on |
| `pit_lane_ms` | integer | Total pit-lane time, ms |
| `stationary_ms` | integer | Time stopped in the box, ms: only from the 2024 US GP onward (FastF1 has none) |
| `date` | timestamptz | |
| UNIQUE | `(race_id, session_type, driver_id, lap_number)` | |

---

### `race_lap_traces`
One row per driver per session holding per-lap arrays (index 0 = lap 1), built by
`race_story.build_lap_traces` from FastF1's **full** `session.laps` (unlike `lap_times`, which only
keeps accurate laps). ~20 rows and ~18 KB per race: row-per-lap would be ~1,200 rows.

| Column | Type | Notes |
|--------|------|-------|
| `race_id`, `session_type`, `driver_id` | | UNIQUE together |
| `positions` | integer[] | Position at the end of each lap |
| `gaps_ms` | integer[] | Gap to that lap's leader; NULL while lapped |
| `intervals_ms` | integer[] | Gap to the car directly ahead; NULL for the leader |
| `laps_down` | integer[] | Laps behind the leader |

### `race_battles`
3+ consecutive laps within 1.0 s of the same car ahead (`race_story.find_battles`).
Columns: `race_id`, `session_type`, `chaser_driver_id`, `leader_driver_id`, `lap_start`, `lap_end`,
`min_gap_ms`. UNIQUE `(race_id, session_type, chaser_driver_id, lap_start)`.

### `race_weather_traces`
One row per session: `minute_offsets` integer[], `air_temp_tenths` / `track_temp_tenths` integer[]
(tenths of °C), `rainfall` boolean[]. UNIQUE `(race_id, session_type)`.

---

### `qualifying_lap_telemetry`
Each driver's fastest qualifying (`Q`) / sprint-qualifying (`SQ`) lap from OpenF1 `/laps` + `/car_data`
+ `/location` (2023+), or FastF1 car/position data for 2018–2022 `Q` laps. `samples` is JSONB of int arrays on a 10 m distance grid: `distanceM`,
`timeMs`, `speed`, `throttle`, `brake` (0/100), `gear`, `x`, `y`. ~11 KB per row after TOAST.
UNIQUE `(race_id, session_type, driver_id)`; also `lap_number`, `lap_time_ms`.

---

### History tables (F1DB, CC-BY-4.0)
Imported by `import_f1db`; separate from the season-scoped core tables that feed the model.

- `history_drivers`: one row per F1DB driver: `f1db_id` (UNIQUE), `match_key` (normalised name,
  indexed: the join to core drivers), bio (`date_of_birth`, `nationality`), career totals
  (`championships`, `race_starts`, `race_wins`, `podiums`, `pole_positions`, `fastest_laps`,
  `career_points`, `sprint_wins`, `grand_slams`) and `first_{race,podium,pole,win}_{date,name}`.
- `history_constructors`: `f1db_id` (UNIQUE), name, country, career totals.
- `history_constructor_seasons`: `(constructor_f1db_id, year)` UNIQUE; `chassis`, `engine` display names.
- `history_constructor_lineage`: F1DB chronology: `(parent_f1db_id, position)` UNIQUE, member
  `constructor_f1db_id`, `year_from`/`year_to`.
- `f1db_imports`: imported release `version` (UNIQUE), so a release is never imported twice.

---

### `lap_times`
One row per lap per driver: 2018+ only.

| Column | Type | Notes |
|--------|------|-------|
| `id` | bigserial PK | Large table: bigserial not serial |
| `race_id` | FK → races | |
| `driver_id` | FK → drivers | |
| `lap_number` | integer | |
| `lap_time_ms` | integer | |
| `sector1_ms` | integer | |
| `sector2_ms` | integer | |
| `sector3_ms` | integer | |
| `speed_st` | numeric(5,1) | Speed trap km/h |
| `compound` | varchar(20) | `SOFT`, `MEDIUM`, `HARD`, `INTER`, `WET` |
| `tyre_life` | integer | Laps on current tyre |
| `fresh_tyre` | boolean | |
| `is_pit_lap` | boolean | Excluded from pace calculations |
| `stint_number` | integer | Stint index within the race: used for tyre degradation slope |
| UNIQUE | `(race_id, driver_id, lap_number)` | |

---

### `sprint_results`
One row per driver per sprint race. Also stores sprint qualifying (SQ) session times.

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `race_id` | FK → races | |
| `driver_id` | FK → drivers | |
| `finish_position` | integer | Null = DNF/DSQ |
| `grid_position` | integer | Set from SQ result |
| `points` | numeric(4,1) | Sprint points scored |
| `status` | varchar(30) | e.g. `Finished`, `+1 Lap` |
| `total_sprint_time_ms` | bigint | For sprint winner only |
| `fastest_lap` | boolean | |
| `sq1_time_ms` | integer | SQ1 lap time: null if eliminated in SQ1 |
| `sq2_time_ms` | integer | SQ2 lap time: null if not in SQ2 |
| `sq3_time_ms` | integer | SQ3 lap time: null if not in SQ3 |
| `sq_sector1_ms` | integer | Best S1 from SQ session |
| `sq_sector2_ms` | integer | Best S2 from SQ session |
| `sq_sector3_ms` | integer | Best S3 from SQ session |
| `sq_speed_st` | numeric(5,1) | Max speed trap from SQ session |
| UNIQUE | `(race_id, driver_id)` | |

---

### `sprint_lap_times`
Per-lap data for sprint races: mirrors `lap_times` structure. 2018+ only.

| Column | Type | Notes |
|--------|------|-------|
| `id` | bigserial PK | |
| `race_id` | FK → races | |
| `driver_id` | FK → drivers | |
| `lap_number` | integer | |
| `lap_time_ms` | integer | |
| `sector1_ms` | integer | |
| `sector2_ms` | integer | |
| `sector3_ms` | integer | |
| `speed_st` | numeric(5,1) | |
| `compound` | varchar(20) | |
| `tyre_life` | integer | |
| `fresh_tyre` | boolean | |
| `is_pit_lap` | boolean | |
| `stint_number` | integer | Stint index within the sprint |
| UNIQUE | `(race_id, driver_id, lap_number)` | |

---

### `fp2_long_run_times`
FP2 long-run stint data per driver per race. Populated by `ingest_fp2`. 2018+ only.

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `race_id` | FK → races | |
| `driver_id` | FK → drivers | |
| `compound` | varchar(20) | `SOFT`, `MEDIUM`, `HARD` |
| `session_type` | varchar(4) | `FP2` (primary) \| `FP1` (sprint-weekend fallback: those weekends have no FP2) |
| `median_lap_ms` | integer | MEDIUM-normalised median stint lap time (Soft +500ms, Hard −400ms) |
| `stint_length` | integer | Number of laps in the long-run stint (≥5) |
| `fp2_best_lap_ms` | integer | Driver's single fastest raw lap in FP2 |
| UNIQUE | `(race_id, driver_id, compound)` | Best (shortest) stint per compound kept |

---

### `driver_season_stats`
Aggregated after each race via `compute_season_stats`. Includes sprint-specific aggregates.

| Column | Type | Notes |
|--------|------|-------|
| `season_id` | FK → seasons | |
| `driver_id` | FK → drivers | |
| `races_entered` | integer | Grand prix count |
| `wins` | integer | Grand prix wins |
| `podiums` | integer | |
| `poles` | integer | Grid position = 1 |
| `total_points` | numeric | Grand prix points |
| `championship_position` | integer | Ranked by total_points + sprint_total_points (the championship counts sprints) |
| `win_rate` | numeric(5,4) | Bayesian smoothed |
| `avg_position_gain` | numeric(4,2) | grid_position − finish_position avg |
| `dnf_rate` | numeric(4,3) | dnf_count / races_entered |
| `avg_sector1/2/3_ms` | integer | Median: 2018+ only |
| `teammate_quali_delta` | numeric(6,4) | Mean delta vs teammate across season |
| `sprint_races_entered` | integer | Sprint race count |
| `sprint_wins` | integer | |
| `sprint_podiums` | integer | |
| `sprint_total_points` | numeric | Sprint points |
| `sprint_win_rate` | numeric(5,4) | Bayesian smoothed sprint win rate |
| UNIQUE | `(season_id, driver_id)` | |

---

### `team_season_stats`
Aggregated after each race. Drives `car_performance_score` in predictions.

| Column | Type | Notes |
|--------|------|-------|
| `season_id` | FK → seasons | |
| `team_id` | FK → teams | |
| `car_performance_score` | numeric(5,4) | Blend of robust race pace (median finish) + qualifying pace (avg grid): `0.6·minmax(21−median) + 0.4·minmax(21−avg_grid)` |
| `reliability_score` | numeric(5,4) | Normalized from 1 − dnf_rate |
| `championship_position` | integer | Ranked by GP + sprint points |
| UNIQUE | `(season_id, team_id)` | |

---

### `title_odds_drivers` / `title_odds_teams`
Monte Carlo championship odds written by `compute_title_odds` after every qualifying, sprint and
race. One row per contender per `after_round` (the last completed round when computed, 0 before the
opener), so the odds can be charted across the season: about 720 rows a season in total.
`scripts/backfill_title_odds.py` replays past rounds (`run(year, after_round)`), so 2018–2026 has
full per-round history.

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `season_id` | FK → seasons | |
| `after_round` | integer | Last completed round at compute time, or the replayed round |
| `driver_id` / `team_id` | FK → drivers / teams | |
| `title_probability` | numeric(6,5) | Share of simulated seasons won (ties split) |
| `expected_points` | numeric(6,1) | Mean final points, GP + sprint |
| `points_p10` / `points_p90` | numeric(6,1) | 10th / 90th percentile final points |
| `simulations` | integer | 10,000 |
| `model_version` | varchar(30) | `title-odds-v1` |
| UNIQUE | `(season_id, after_round, driver_id)` / `(season_id, after_round, team_id)` | |

---

### `driver_prediction_features`
One row per driver per grand prix race. Written by `compute_features`, updated by `compute_predictions`.

| Column | Type | Notes |
|--------|------|-------|
| `race_id` | FK → races | |
| `driver_id` | FK → drivers | |
| `car_performance_score` | numeric(6,5) | 0–1 |
| `driver_rating_score` | numeric(6,5) | |
| `starting_position_score` | numeric(6,5) | |
| `win_rate_score` | numeric(6,5) | |
| `luck_factor_score` | numeric(6,5) | |
| `weather_impact_score` | numeric(6,5) | |
| `track_overtake_score` | numeric(6,5) | **Deprecated**: always NULL in weighted-v3; value baked into circuit-adjusted scores |
| `position_gain_score` | numeric(6,5) | Raw avg position gain (kept for display only) |
| `long_run_pace_score` | numeric(6,5) | Practice (FP2/FP1) primary, historical fallback |
| `reliability_score` | numeric(6,5) | |
| `qualifying_delta_score` | numeric(6,5) | Rolling 5-race weighted teammate delta |
| `sector_strength_score` | numeric(6,5) | |
| `tyre_deg_score` | numeric(6,5) | REGR_SLOPE-derived degradation score: lower slope = higher score |
| `circuit_adj_start_pos_score` | numeric(6,5) | Starting position scaled by overtake_rate × sc_probability |
| `circuit_adj_position_gain_score` | numeric(6,5) | Position gain scaled by overtake_rate |
| `raw_weighted_score` | numeric(8,6) | Weighted sum before softmax |
| `long_run_used_fp` | boolean | Whether `long_run_pace_score` came from a practice session (FP2 or FP1 fallback; true) or the historical circuit fallback (false/null) |
| `win_probability` | numeric(6,5) | After softmax: sums to 1.0 per race |
| `predicted_position` | integer | 1 = predicted winner |
| UNIQUE | `(race_id, driver_id)` | |

---

### `race_predictions`
One row per grand prix: the single predicted winner.

| Column | Type | Notes |
|--------|------|-------|
| `race_id` | FK → races UNIQUE | |
| `predicted_winner_id` | FK → drivers | |
| `computed_at` | timestamptz | |
| `model_version` | varchar(20) | `weighted-v3` |

---

### `driver_sprint_features`
One row per driver per sprint weekend. Written by `compute_sprint_features`, updated by `compute_sprint_predictions`.

| Column | Type | Notes |
|--------|------|-------|
| `race_id` | FK → races | |
| `driver_id` | FK → drivers | |
| `car_performance_score` | numeric(6,5) | 0–1 |
| `starting_position_score` | numeric(6,5) | Raw SQ grid score (kept for display) |
| `driver_rating_score` | numeric(6,5) | Sprint-specific when ≥3 sprint races recorded |
| `track_overtake_score` | numeric(6,5) | **Deprecated**: always NULL in sprint-v2 |
| `short_run_pace_score` | numeric(6,5) | Best SQ lap time, falls back to main qualifying |
| `weather_impact_score` | numeric(6,5) | Based on sprint_weather field; cross-season |
| `win_rate_score` | numeric(6,5) | Sprint-specific when ≥3 sprint races recorded |
| `luck_factor_score` | numeric(6,5) | Rolling 5-race delta: cross-season |
| `circuit_adj_start_pos_score` | numeric(6,5) | SQ grid scaled by overtake_rate × sc_probability |
| `sq_qualifying_delta_score` | numeric(6,5) | Rolling 5-sprint SQ teammate delta |
| `raw_weighted_score` | numeric(8,6) | |
| `win_probability` | numeric(6,5) | After softmax |
| `predicted_position` | integer | |
| UNIQUE | `(race_id, driver_id)` | |

---

### `sprint_predictions`
One row per sprint weekend: the single predicted sprint winner.

| Column | Type | Notes |
|--------|------|-------|
| `race_id` | FK → races UNIQUE | |
| `predicted_winner_id` | FK → drivers | |
| `computed_at` | timestamptz | |
| `model_version` | varchar(20) | `sprint-v2` |

---

### `data_quality_runs`
One row per audit pass (season aggregate) or per-race audit. Written by `data_quality_audit`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `year` | integer | Season audited (0 when an all-years scan ran) |
| `race_id` | FK → races, nullable | Null = season aggregate pass |
| `generated_at` | timestamptz | |
| `health_score` | numeric(5,2) | 0–100, per-pass average |
| `summary` | jsonb | `races_audited`, `issue_count`, `fixable_count`, `by_severity`, `by_table` |

### `data_quality_issues`
One row per flagged gap. Written by `data_quality_audit`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `run_id` | FK → data_quality_runs | |
| `race_id` | FK → races, nullable | |
| `round_number` | integer | |
| `year` | integer | |
| `table_name` | varchar(40) | Source table the issue belongs to |
| `check_name` | varchar(60) | e.g. `driver_coverage`, `lap_coverage`, `row_count` |
| `severity` | varchar(10) | `high` \| `medium` \| `low` |
| `detail` | varchar(500) | Human-readable summary |
| `fixable` | boolean | Whether re-ingest/recompute can close it |
| `is_sprint` | boolean | Sprint-weekend issue |
| `resolved` | boolean | Manual triage flag (default false) |
| `created_at` | timestamptz | |
