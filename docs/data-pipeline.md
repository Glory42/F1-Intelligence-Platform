---
title: "Data Pipeline"
description: "ETL jobs, OpenF1 + Jolpica ingestion, worker schedule, and race status flow"
order: 2
---

# Data Pipeline

Live ingest reads finished sessions from OpenF1 and the official classification from Jolpica,
both free with no account (`utils/openf1_session.py`). FastF1 did this until FastF1 3.9
(October 2026) put its timing data behind a paid F1TV subscription; older FastF1 versions load
none. FastF1 is kept only for the event calendar, the pre-2018 `_legacy` jobs (results from
Ergast, still free) and the 2018–2022 backfills, which work from an existing cache. Why we don't pay or log in: ADR 0011.

## Jobs

All jobs live in `data-engine/src/jobs/`. They are invoked via `src/main.py --job <name>`.

### Main Race Jobs

| Job | Purpose |
|-----|---------|
| `sync_schedule` | Populates the `races` table for a season from FastF1 (includes sprint dates, event_format). Races are matched by event name first, so when FastF1 renumbers the calendar (an event added or dropped mid-season) each race keeps its row and only its `round_number` moves |
| `sync_season` | Populates `teams` and `drivers` for a season from OpenF1 (one round's lineup). Race, sprint, qualifying and sprint-qualifying ingests also register every driver and team their session lists (`utils/driver_registry.py`), so mid-season replacements are added as they appear; a result for a driver that still can't be matched fails the job instead of being dropped |
| `ingest_qualifying` | Ingests Q1/Q2/Q3 qualifying session data and sector times: 2018+ |
| `ingest_qualifying_legacy` | Ingests qualifying from Ergast: pre-2018 |
| `ingest_fp2` | Ingests practice long-run stints into `fp2_long_run_times`: FP2 primary, **FP1 fallback on sprint weekends** (recorded in `session_type`) |
| `ingest_race` | Ingests race results, lap times, and race conditions (weather, SC/VSC, temps): 2018+ |
| `ingest_race_legacy` | Ingests race results from Ergast (no lap data): pre-2018 |
| `compute_season_stats` | Aggregates `driver_season_stats` and `team_season_stats` for a year (includes sprint aggregates) |
| `compute_features` | The `weighted-v4` Prediction: 7 features, win probabilities, ranks and the predicted winner, in one transaction. Skips races inside the committed fit (`backfill_all_predictions.py` rebuilds those out-of-sample) |

### Sprint Race Jobs

| Job | Purpose |
|-----|---------|
| `ingest_sprint_qualifying` | Ingests SQ session: stores SQ1/SQ2/SQ3 times + sector times + speed in `sprint_results`; uses `messages=True`; has date guard |
| `ingest_sprint` | Ingests sprint race results, sprint lap times, and sprint conditions (weather, SC/VSC, temps) |
| `compute_sprint_features` | The `sprint-v2` Prediction: 8 Feature Scores, softmax (T=0.3), ranks and the predicted sprint winner, in one transaction |
| `data_quality_audit` | Measures per-table completeness/coverage across a season; writes `data_quality_runs` + `data_quality_issues` |
| `data_quality_repair` | Re-ingests data for open, `fixable` issues reported by the audit, then recomputes the affected features/predictions/season-stats |

### Race Events Jobs (OpenF1)

Enrich a completed race weekend with race control, overtakes, team radio, stints and pit stops from the free
[OpenF1 API](https://openf1.org). OpenF1 has no coverage before 2023, and its free
tier only serves data once a session is >30min past its end, so these jobs self-skip until
the *weekend* is `completed` and `race_date_utc` is safely past that window: the Saturday
sprint session is always well outside its own live window by then too, so one gate covers
both. Each accepts `--session Race` (default, the Sunday GP) or `--session Sprint` (the
Saturday sprint race on a sprint weekend); a `Sprint` request self-skips as a no-op on a
non-sprint weekend, since `races.sprint_date` is null there.

Wired into the `MAIN_RACE` chain (`src/weekend_pipeline.py`, see below): every completed race
weekend gets all of them, for both sessions where applicable, automatically. Each is an
`optional` `JobStep`, so a transient OpenF1 hiccup logs and moves on rather than blocking or
reverting the core race-completion pipeline it rides on.

| Job | Purpose |
|-----|---------|
| `ingest_race_control` | Ingests OpenF1 flags/safety-car/VSC/incident messages into `race_control_messages`: 2023+ only |
| `ingest_overtakes` | Ingests OpenF1 on-track overtakes into `race_overtakes`, resolving each driver number to a `drivers.id` via `season_drivers`: 2023+ only |
| `ingest_team_radio` | Ingests OpenF1 team radio clips into `team_radio_clips`, same driver-number resolution: 2023+ only; F1 doesn't release radio for every session (far fewer since 2026), so a partial or empty result is normal |
| `ingest_stints` | Ingests OpenF1 tyre stints into `race_stints` (compound, lap range, tyre age at start): 2023+ only |
| `ingest_pit_stops` | Ingests OpenF1 pit stops into `race_pit_stops` (pit-lane and stationary time in ms; stationary only from the 2024 US GP): 2023+ only |

Every row is tagged with `session_type` (`race`/`sprint`). The shared runner (`run_openf1_job`)
reads the race row, closes its connection, makes the OpenF1 calls, then reopens one to write:
it never holds a Neon connection across HTTP. It caches the resolved session key on
`races.openf1_{race,sprint}_session_key`, and skips writing entirely if `storage_guard` reports the
core-only tier. `openf1_client` paces requests 2 s apart, retries 429/5xx, and the worker caps each
cycle at 25 requests (ADR 0004).

Backfill any of them across a year range, locally (never on Render):
`python scripts/backfill_openf1.py <job> <start> <end> [--session Sprint] [--refresh]`. It only
touches seasons OpenF1 serves, skips races whose coverage is already there unless `--refresh` (team
radio has no coverage check, so it always reruns), and stops as soon as `storage_guard` leaves the
allow-all tier.

### Enrichment coverage (`src/enrichment_coverage.py`)

One definition per enrichment (table, session): the pipeline step that fills it, the ingest it waits
on, and the SQL that says a weekend has it. `read_coverage(conn, from, to, round)` returns one row per
race with a flag per coverage; `missing(row)` is what the row should have by now but doesn't;
`session_kind.source_for(year)` says who fills a season (FastF1 2018–2022, OpenF1 2023+). It also owns each
table's conflict key (`CONFLICT_KEYS`), compound normalisation (`normalize_compound`: one uppercase
spelling, `None` for `nan`/`UNKNOWN`, whichever source) and the backfills' storage check
(`backfill_allowed`). The worker's retries and both enrichment backfills read it.

### FastF1 enrichment (2018–2022)

Stints, pit stops, race control and qualifying telemetry also exist for 2018–2022, filled locally from
FastF1 by `python scripts/backfill_fastf1_enrichment.py 2018 2022 [--only stints,pits,race_control,telemetry] [--refresh]`
(the FastF1 adapter, `utils/fastf1_session.py`, returns the same `session_records` the OpenF1 jobs map). It only touches FastF1 seasons (`source_for`) and skips
what a race's coverage already has (Q telemetry counts as covered once every qualifier has a lap), so it
resumes after a stop and never overwrites OpenF1 data; `--refresh` rewrites the chosen parts. Pre-2023
pit stops carry pit-lane time only (`stationary_ms` null: FastF1 has none) and lane visits over 120 s
(red-flag waits) are dropped. 2018 stints keep Pirelli's named compounds (HYPERSOFT, ULTRASOFT, SUPERSOFT,
SOFT, MEDIUM, HARD, SUPERHARD).
Overtakes and team radio have no source before 2023, so they stay OpenF1-only.

---

### Race story

`run_ingest_job` (`ingest_race` / `ingest_sprint`) also builds lap traces, battles and the weather
trace from the session it already loaded (no extra download) and writes them in the same
transaction unless `storage_guard` reports the core-only tier. It fetches the session with **no DB
connection open** (as do `run_qualifying_ingest_job` and `ingest_fp2`): a paced OpenF1 fetch takes minutes
and an open connection would keep Neon compute awake. Backfill past races locally with
`python scripts/backfill_race_story.py <start> <end>` (FastF1, so only from sessions already in the
local cache); it writes only the race-story
tables and stops at the storage guard's backfill threshold. `jobs/ingest_race_story.py` builds the race
story alone: the worker's retry uses it when the race ingest skipped the story under the storage tier.

### Qualifying telemetry

`ingest_qualifying_telemetry` (`--session Race|Sprint` → `Q`/`SQ` on the CLI) reads OpenF1 `/laps`,
picks each driver's fastest timed lap, then fetches `/car_data` and `/location` for that lap's time
window (~41 requests per session). Distance is integrated from speed, padded to the official lap
start/end and scaled to the circuit length, then everything is resampled every 10 m
(`utils/telemetry.py`). It runs as a non-fatal step at the end of the qualifying action it belongs to
(Q after `MAIN_QUALIFYING`, SQ after `SPRINT_QUALIFYING`), so telemetry is up before the race. It is
**resumable**: drivers already stored are skipped, and when the cycle's 25-request budget runs out it
writes what it has. `run()` returns `False` while work remains (budget spent, or the session not yet
past OpenF1's live window), which keeps the step pending for `_retry_missing_race_events`. Backfill
locally with `python scripts/backfill_openf1.py ingest_qualifying_telemetry 2023 2026` (unbudgeted,
paced); 2018–2022 comes from FastF1 (above).

### Historical data (F1DB)

`python scripts/import_f1db.py [--version vYYYY.RR.M]` downloads F1DB's `json-splitted` release,
checks its SHA-256 against the release's own checksum file, extracts it into a fresh temp dir and runs
`jobs/import_f1db.py`: driver bios + career totals + first race/podium/pole/win (computed from F1DB race
results), constructor totals, chassis/engine per season, and constructor lineage: ~700 KB in Neon.
Already-imported versions are skipped (`f1db_imports`), and the import respects `storage_guard`'s
backfill tier. Parsing the release needs more RAM than Render Free has, so it never runs on Render:
`.github/workflows/f1db-import.yml` runs it on GitHub's runner every Wednesday 06:00 UTC (plus manual
dispatch), a no-op when nothing is new. It needs a `DATABASE_URL` repository secret and skips cleanly
without one. Running it locally still works.

### Title odds

`compute_title_odds --year N` runs as a non-fatal step at the end of every worker action (after
predictions on qualifying weekends, after `compute_season_stats` on sprint/race completion) and
writes `title_odds_drivers` / `title_odds_teams`. Method: `docs/prediction-model.md`.

`run(year, after_round=N)` replays the season as it stood after round N: points from results up to
that round, later races still to run, and only predictions up to that round feed the form fallback.
`python scripts/backfill_title_odds.py 2018 2026` replays every completed round (local only), which
gives the title fight chart its per-round history.

---

## Job Chain

### Conventional Weekend

```
sync_schedule        races table must exist before ingest can find rounds
      ↓
sync_season          teams and drivers must exist before results can reference them
      ↓
ingest_qualifying    qualifying_results must exist before compute_features
      ↓
ingest_qualifying_telemetry  non-fatal, end of the qualifying action; resumable
      ↓
ingest_race          race_results and lap_times ingested; race.status → completed
      ↓
compute_season_stats driver_season_stats and team_season_stats must be fresh
                     before compute_features reads them
      ↓
ingest_race_control, ingest_overtakes, ingest_team_radio, ingest_stints, ingest_pit_stops
                     (Race, then Sprint if applicable) Race Events (OpenF1): non-fatal, 2023+ only
      ↓
compute_features     driver_prediction_features (values, contributions, probabilities)
                     + race_predictions, in one transaction
```

### Sprint Weekend

```
sync_schedule + sync_season
      ↓
ingest_sprint_qualifying   → sprint_results (sq1/sq2/sq3 times + grid)
                             race.status → sprint_qualifying_done
      ↓
compute_sprint_features    → driver_sprint_features + sprint_predictions
ingest_qualifying_telemetry (SQ) → non-fatal, resumable
      ↓
ingest_sprint              → sprint_results (finish positions, points)
                             → sprint_lap_times, races (sprint conditions)
                             race.status → sprint_done
      ↓
compute_season_stats       → updates sprint_wins, sprint_total_points, etc.
      ↓
ingest_qualifying          → qualifying_results
                             race.status → qualifying_done
      ↓
compute_features                        → main race prediction
ingest_qualifying_telemetry (Q)         → non-fatal, resumable
      ↓
ingest_race                → race_results + lap_times
                             race.status → completed
      ↓
compute_season_stats       → final season stats update
      ↓
ingest_race_control, ingest_overtakes, ingest_team_radio, ingest_stints, ingest_pit_stops
                            (Race, then Sprint) Race Events (OpenF1): non-fatal, 2023+ only; the Sprint pass
                            covers Saturday's sprint session under the same race_id
```

`compute_season_stats` should be re-run after each race so that rolling stats
(win rate, DNF rate, avg position gain, sprint aggregates) are up to date before the next prediction.

## Automated Polling (Render)

Instead of relying on fixed days and times (which is fragile due to global timezones and API delays), the pipeline uses an automated polling architecture hosted on a free Render Web Service.

A persistent web service runs continuously:

| Service Type | Command | Purpose |
|--------------|---------|---------|
| Web Service | `python -m src.server` | Hosts a live HTML dashboard (and health check) to monitor the engine's status, and runs `auto_runner.py` in the background: every 20 minutes inside a race-weekend window, every 6 hours outside it. |

`src/weekend_pipeline.py` is the only interpreter of Race Status: `plan(status, is_sprint, event, now)`
picks the chain a status calls for and whether its session is over, `chain(kind)` lists that chain's
`JobStep`s (the ingest that commits the next status, then its core steps, then optional ones), and
`JOBS` maps every step name to the job it runs. `due_statuses(job)` / `statuses_after(ingest)`, the
CLI's auto-detect, the worker's coverage retries, repair and the backfills all derive from those chains.

### How `auto_runner.py` works:
1. Queries the database for the most recent active race (where `status != 'completed'`).
2. Fetches the official F1 schedule via FastF1 to get exact UTC session times. If the race stored at that round has a different name from FastF1's event there (the calendar changed since the last sync), it re-runs `sync_schedule` with that schedule and stops the cycle instead of ingesting another event's sessions: every job finds its session from the stored race's date and round.
3. Checks if a session ended recently (`weekend_pipeline.STAGES`):
   - Sprint Qualifying + 1.5 hours
   - Sprint Race + 1.5 hours
   - Main Qualifying + 2 hours
   - Main Race + 3 hours
4. If the time has passed, it attempts to download the data. 
   - **If the data isn't published yet** (OpenF1 has no session or too few laps, or Jolpica has no classification), the job raises. The script catches this, exits cleanly, and tries again next cycle.
5. Once ingestion succeeds, it automatically chains the downstream jobs (features, predictions, stats). If any job in the sequence fails, it sets the race `status` to whatever the sequence actually last committed (not blindly back to the pre-sequence value) so the next hour's retry resumes from where it left off instead of redoing already-completed steps.
6. Qualifying telemetry rides the qualifying actions as a non-fatal step (Q at the end of `MAIN_QUALIFYING`, SQ at the end of `SPRINT_QUALIFYING`). After `MAIN_RACE`'s core steps (`ingest_race`, `compute_season_stats`) commit `completed`, it also runs the OpenF1 Race Events jobs (race control, overtakes, team radio, stints, pit stops) for both the Race and Sprint sessions. These are optional steps: a failure here is logged but never reverts `status` or fails the cycle, since Race Events are supplementary and safe to pick up on a later manual run if OpenF1 has a transient issue.
7. Because that failure is swallowed rather than retried, and the race is already `completed` by the time it runs (so it drops out of step 1's query on the next poll), `run_cycle` also re-checks the *current* race-weekend window's race on every cycle it's still inside that window (`RaceWeekendWindow`'s 24h tail: see `_retry_missing_race_events`). `enrichment_coverage.read_coverage` checks each table on its own and `missing` decides what is due: race control, overtakes, stints, pit stops and race story per race/sprint session once `completed`; Q telemetry from `qualifying_done`; SQ telemetry on sprint weekends from `sprint_qualifying_done` (complete when it matches the `sprint_results` rows with an SQ1 time); season stats freshness (latest `team_season_stats.races_completed` vs completed races); and title odds for the race's round. Only the job whose table is empty reruns. Team radio is left out on purpose (F1 often publishes none). A job that finishes cleanly is recorded in `WorkerMemo.settled` as `(race_id, step)`, so a legitimately empty table (a sprint with no stops) doesn't keep the worker opening Neon; a job returning `False` (telemetry with the budget spent or still inside the live window) stays pending. Once nothing is pending and no session is due, later cycles skip the DB entirely (`WorkerMemo`). This is the safety net for the case where FastF1's and OpenF1's timing genuinely diverge: e.g. a red-flag-delayed race pushes the real session end past `OPENF1_LIVE_WINDOW_BUFFER`, so OpenF1 wasn't actually ready the first time.

---

## Running Jobs Locally

```bash
cd data-engine
source venv/bin/activate

# Sync
python -m src.main --job sync_schedule     --year 2026
python -m src.main --job sync_season       --year 2026 --round 1

# Main race pipeline. Session ingests without --year/--round auto-detect the latest round whose
# Race Status says the job is due (weekend_pipeline.due_statuses): e.g. ingest_race → qualifying_done.
python -m src.main --job ingest_qualifying --year 2026 --round 6
python -m src.main --job ingest_race       --year 2026 --round 6
python -m src.main --job compute_season_stats --year 2026
python -m src.main --job compute_features  --race_id 42

# Sprint pipeline
python -m src.main --job ingest_sprint_qualifying --year 2026 --round 9
python -m src.main --job compute_sprint_features  --race_id 55
python -m src.main --job ingest_sprint            --year 2026 --round 9

# Race Events (OpenF1) and race story: --session defaults to Race; pass Sprint for the sprint session
python -m src.main --job ingest_race_control --year 2026 --round 9 --session Sprint
python -m src.main --job ingest_race_story   --year 2026 --round 9 --session Sprint
python -m src.main --job ingest_overtakes    --year 2026 --round 9 --session Sprint
python -m src.main --job ingest_team_radio   --year 2026 --round 9 --session Sprint

# Data-quality audit
python -m src.main --job data_quality_audit --year 2026     # latest season
python -m src.main --job data_quality_audit --all            # every season in the DB

# Repair fixable gaps found by the audit (act on the latest run for the year)
python -m src.main --job data_quality_repair --year 2026
python -m src.main --job data_quality_repair --year 2026 --resolve_run 5
```

Repair maps each fixable issue to the step that writes its table and re-runs that step's chain from
there (`weekend_pipeline.repair_plan`): a `race_results` gap reruns everything the worker runs after
the race, title odds and Race Events included. Several issues on one race share one pass, chains in
weekend order, and no connection is held while the jobs run. It does NOT attempt data the source
API doesn't provide: e.g. FP2 long-run coverage is flagged as informational (the
model falls back to historical circuit pace) rather than re-ingested, because a driver
that ran no long-run stint can't be reconstructed.

For pre-2018:

```bash
python -m src.main --job ingest_qualifying_legacy --year 2015 --round 5
python -m src.main --job ingest_race_legacy       --year 2015 --round 5
```

---

## Historical Backfill

### Results audit and F1DB rebuild (`scripts/audit_results_vs_f1db.py`, `scripts/backfill_results_from_f1db.py`)

Both download a checksum-verified F1DB release (`scripts/f1db_release.py`). The audit is read-only: it compares
every completed race's race / qualifying / sprint results with F1DB and lists the drivers we're missing;
`--modern-plan` prints the 2018+ races to re-ingest (only 2023+ can be now: OpenF1 has nothing earlier, ADR 0011). The rebuild covers 1980–2017 only (ADR 0009): it
fixes driver codes, adds missing drivers and teams, merges a person's duplicate rows, upserts every result,
deletes results filed under the wrong driver and marks rebuilt races `completed`. Dry run unless `--apply`;
it refuses a season with unmatched drivers or mismatched race dates, and checks `storage_guard` first.

```bash
python scripts/audit_results_vs_f1db.py [--modern-plan]
python scripts/backfill_results_from_f1db.py --from 1980 --to 2017 [--apply]
python -m src.main --job compute_season_stats --year 1992   # after a rebuild
```

Other backfill scripts in `data-engine/scripts/`:

### Full backfill (`scripts/backfill_full.py`)

Runs the complete pipeline (sync → ingest → sprint ingest → season stats → predictions) for every round in a year range. Each year goes to the jobs that can serve it (`session_kind.results_ingest_for`): the `_legacy` Ergast jobs before 2018, the OpenF1 + Jolpica jobs from 2023; 2018–2022 is skipped, since its timing can't be re-ingested (ADR 0011) and its stored rows stay. Each completed round then rebuilds its Predictions with `weekend_pipeline.prediction_steps`: the sprint chain's steps after its ingest (sprint features + predictions) on sprint weekends, then the GP chain's (FP2/FP1 long runs, features, predictions) on every weekend.

```bash
cd data-engine
source venv/bin/activate

python scripts/backfill_full.py                        # 2000–2017 legacy results, 2018–2022 skipped, 2023–2026 live
python scripts/backfill_full.py --start 2023           # 2023–2026: OpenF1 has no earlier sessions (ADR 0011)
python scripts/backfill_full.py --start 2025 --end 2025
```

### Sprint-only backfill (`scripts/backfill_sprint.py`)

Re-runs just the sprint pipeline for specific years (useful after sprint schema changes).

```bash
python scripts/backfill_sprint.py --years 2021 2022 2024 2026
python scripts/backfill_sprint.py --years 2026          # single year
```

**Data coverage by era:**

| Years | Qualifying | Lap times | Sprint |
|-------|-----------|-----------|--------|
| 2018–present | Full Q1/Q2/Q3 + sector times | Full per-lap | Full SQ + sprint lap times |
| 2006–2017 | Q1/Q2/Q3 times | None | None (sprint format started 2021) |
| 2000–2005 | Single best lap only | None | None |
| 1990–1999 | None (fell back to race starting grid) | None | None |

**Sprint format years:** 2021 (3 rounds), 2022 (3 rounds), 2023 (6 rounds), 2024 (6 rounds), 2025 (6 rounds), 2026+.

Both scripts use `_run()` wrappers: a single failing round does not abort the whole year. Failures print as `[SKIP]` lines.

---

## FastF1 Cache

The 2018–2022 backfills only work from sessions already in this cache (new timing downloads need
F1TV, ADR 0011):

```python
import fastf1
fastf1.Cache.enable_cache('./cache')
```

The cache is already enabled via `src/config.py`. The `cache/` directory is gitignored.

---

## Idempotency

Every job uses `INSERT ... ON CONFLICT DO UPDATE`. Running any job twice produces
identical results: no duplicate rows. This makes retries safe.

The sprint qualifying ingest uses `exclude_update` to prevent SQ data from overwriting
already-ingested sprint race finish positions (`finish_position`, `points`, `status`,
`total_sprint_time_ms`, `fastest_lap` are never overwritten by SQ ingest).

`ingest_qualifying` and `ingest_sprint_qualifying` both have a **date guard**: they check
`qualifying_date`/`sprint_qualifying_date <= today` before loading the session, and raise an
error if no results came back. This prevents future rounds from being incorrectly set to
`qualifying_done`/`sprint_qualifying_done` by a backfill run.

---

## Error Handling

- Jobs exit with code 1 on failure so Render marks the job failed for manual retrigger.
- Never use `sleep()` inside jobs: Render has a job timeout.
- Use structured logging: `{"job": "ingest_race", "round": 14, "status": "failed", "error": "..."}`.
