# F1 Intelligence Platform

Follows, predicts and explores Formula 1 (current-season race weekends, championship standings and all-time history) with race and sprint winner predictions (weighted feature models: the GP's weights fitted to past winners, the sprint's hand-picked) as one lens among several.

## Language

### Race & Session Structure

**Race**:
The weekend-scoped entity: one row per event, covering qualifying, an optional sprint, and the Grand Prix. Matches the `races` table and the `race_id` FK used throughout the schema, including sprint tables.
_Avoid_: "Race" to mean specifically the Sunday session, say "Grand Prix" or "GP session" instead.

**Grand Prix (GP)**:
The main Sunday race session specifically, distinct from Qualifying and Sprint sessions within a Race weekend.
_Avoid_: "Race" alone when the Sunday session specifically is meant.

**Circuit**:
The static, seeded-once venue entity a Race is held at (overtake rate, safety car probability, layout data).
_Avoid_: Track, a casual synonym that leaked into a few column names historically; don't use it for new naming.

**Sprint Qualifying (SQ)**:
The session that sets the sprint grid (SQ1/SQ2/SQ3), distinct from main Qualifying. Same concept as "Sprint Shootout": F1's 2023-only name for this session, kept in `event_format` as a year-dependent label, not a distinct concept.
_Avoid_: Sprint Shootout, except when specifically referring to the 2023 season's naming.

**Season**:
One calendar year of competition (`seasons.year`); F1 seasons never span two calendar years, so "Season" and "Year" refer to the same span of time here.
_Avoid_: Treating "Season" as a distinct span from "Year", they're interchangeable in this domain.

**Race Status**:
The weekend's pipeline progress state (`scheduled` → `sprint_qualifying_done` → `sprint_done` → `qualifying_done` → `completed`), stored on `races.status`. Drives which ETL job runs next.
_Avoid_: Confusing with Classification, they're unrelated concepts that happen to share the column name "status" on different tables.

**Classification**:
A driver's per-session finishing result (`Finished`, `Retired`, `Disqualified`, etc.), stored on `race_results.status`/`sprint_results.status`. Feeds into DNF.
_Avoid_: "Status" alone when Classification is meant, see Race Status.

**DNF**:
Any Grand Prix classification other than finishing on the lead lap or within a lap of the leader: deliberately includes disqualifications (DSQ) and non-starts (DNS), not just mechanical/accident retirements. Counts against `dnf_rate` and `reliability_score` the same as any other non-finish. See [ADR-0002](docs/adr/0002-dnf-includes-dsq-and-dns.md).
_Avoid_: Treating DSQ/DNS as excluded from "DNF", in this codebase they are not distinct categories for reliability purposes.

**Stint**:
A continuous run of laps on a single tyre Compound between pit stops. Long Run Pace (the Friday pace table) and Short Run Pace (Sprint model) are both derived from stint-level lap data: "long" vs "short" describes the session the stint came from (FP2/FP1 practice vs. Sprint Qualifying), not the stint's length.

**Race Event**:
A timestamped, race-scoped happening sourced from OpenF1 rather than FastF1: race-control messages (flags/SC/VSC), Overtakes, and Team Radio clips. Matches the `apps/api/src/modules/race-events/` module name; all three are ingested only once a Race is `completed` and past OpenF1's live-data window (2023+ only: OpenF1 has no earlier coverage).
_Avoid_: Confusing with Classification or Race Status, a Race Event is an incident/moment within a session, not a pipeline state or finishing result.

**Recap**:
A short summary of one completed Race: winner, whether the Prediction picked it, standout moments (fastest stop, top battle). Always Race-scoped.
_Avoid_: "Recap" for a Season-level view of the model's performance, that is the Scorecard.

### Prediction Model

**RuleBased (model)**:
The `sprint-v2` approach (and the retired GP model `weighted-v3`): hand-weighted feature scores combined by a fixed formula and softmax, as opposed to a model that learns its weights from data, like the GP's `weighted-v4` (a fitted conditional logit, [ADR-0010](docs/adr/0010-gp-model-is-a-fitted-conditional-logit.md)). Not a synonym for "the prediction model."

**Feature Score**:
One of the 8 Sprint normalized 0.00000–1.00000 inputs to a Prediction (e.g. "Car Performance score," "Luck Factor score"). Combined by fixed weights into `raw_weighted_score`, then softmax'd into `win_probability`. The GP model's 7 features are in real units instead (e.g. Grid Slot, Driver Form): each is stored with its value and its contribution (fitted weight × standardized value), and the contributions sum to `raw_weighted_score`.
_Avoid_: Bare "score", always qualify with the feature name, or use "Health Score" if data quality is meant.

**Starting Position**:
The raw, unadjusted Sprint grid-position score. Shown for transparency but does not feed the weighted model directly.

**Circuit-Adjusted Starting Position**:
Starting Position scaled by the Circuit's overtake rate and safety-car probability. This is the actual Sprint model feature. `weighted-v4` uses Grid Slot and Grid × Hard-to-Pass Track instead.
_Avoid_: "Starting Position" when the circuit-adjusted (weighted) version is meant, they are numerically different scores.

**Model Version**:
A string (`weighted-v4`, `sprint-v2`, ...) identifying exactly which weight/formula revision produced a given Prediction. GP and Sprint models version independently and intentionally: they iterate on separate schedules and are never expected to share a version number or ship together.

**Prediction**:
The full, race-scoped ranked list of drivers with win probabilities and feature breakdowns: assembled from `race_predictions` (predicted winner + model version) joined with `driver_prediction_features` (per-driver features). Not just the predicted winner.
_Avoid_: Equating "Prediction" with the `race_predictions` row alone, that table only holds the winner-pointer half of it.

**Scorecard**:
How the Predictions performed across one Season: race-by-race hits and misses, top-3/top-5 hit rates, Brier score and calibration.
_Avoid_: "Recap", "season record" or "accuracy" as separate names for parts of it, they are all the Scorecard.

### History

**Records**:
All-time F1 achievements (most wins, poles, titles, ...) drawn from the full history of the sport, not just the seasons this platform ingests.
_Avoid_: "Record" for the model's prediction performance, that is the Scorecard.

### Data Operations

**Backfill**:
Bulk, range-based historical data population (e.g. `backfill_full.py`, `backfill_sprint.py`): run once to onboard a new season, era, or table.
_Avoid_: Calling a Repair a "backfill."

**Repair**:
Targeted re-ingestion of data for specific `fixable` issues flagged by a `data_quality_audit` run, followed by recomputing the affected features/predictions/season stats. Scoped to flagged gaps, not a year range.

**Health Score**:
A 0–100 data-completeness metric produced by the data quality audit (`data_quality_runs.health_score`): unrelated to Feature Scores and to a driver's chance of winning anything.
_Avoid_: Bare "score", this and Feature Score share no scale or meaning despite the name.
