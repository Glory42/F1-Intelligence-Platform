---
name: refactor-hunt
description: Finds refactoring opportunities in F1 Intelligence Platform, duplicated logic between the GP and sprint model pipelines, repeated Map-aggregation patterns in Hono services, duplicate frontend API callers, and helpers that belong in a shared layer. Use when the user says "find refactoring opportunities", "look for duplication", "/refactor-hunt", or after adding a new feature/prediction pipeline alongside an existing one.
---

# Refactor Hunt: F1 Intelligence Platform

Scans for code that would benefit from simplification, consolidation, or better placement. This skill finds opportunities: it does not apply fixes unless explicitly asked.

## Scope

Default: the diff since the last commit or the modules the user names. For a broader hunt, use the `Explore` agent to search across `apps/api/src`, `apps/web/src`, and `data-engine/src`.

If the user says "hunt in the sprint pipeline" or names a module, scope to that.

---

## What to look for

### 1. GP/sprint pipeline drift (data-engine/)

This codebase runs two model pipelines, GP (`weighted-v4`) and sprint (`sprint-v3`). Both apply the fitted conditional logit (`src/models/gp_v4.json`) through `gp_model_v4.predict` over an in-memory `race_history`, to `gp_features` and `sprint_features` respectively, and share `compute_features.model_rows` / `store_prediction`. Flag any logic that drifts back into one of the two jobs instead of those shared pieces. The ingest pairs already share one runner each in `data-engine/src/utils/ingest_runner.py`, and are meant to be thin configs over it:
- `ingest_qualifying.py` / `ingest_sprint_qualifying.py` → `run_qualifying_ingest_job` (`QualifyingJobConfig`)
- `ingest_race.py` / `ingest_sprint.py` → `run_ingest_job` (`IngestJobConfig`)
- the OpenF1 race-event jobs (`ingest_race_control`, `ingest_overtakes`, `ingest_team_radio`, `ingest_stints`, `ingest_pit_stops`) → `run_openf1_job` (`OpenF1JobConfig`)

Flag logic that has leaked back into one side of a pair (session loading, row assembly, upsert call shape) instead of living in the runner or its config. GP vs sprint as data is `src/session_kind.py` (`RACE`/`SPRINT`): flag `if sprint:` branches that should be a field there. Where two jobs repeat the exact same computation with only the input table changed (e.g. both call `normalize_minmax()` → `clamp()` the same way), flag it as a candidate for a shared helper in `data-engine/src/utils/`. Do **not** flag the weights themselves (`src/models/gp_v4.json`, shared by both models): they change only through a backtested refit. Only flag the surrounding mechanical logic (grid fetch, DB row assembly, upsert call shape).

Also check `math_utils.py`: if a new normalization/scoring formula is added to one job, check whether the equivalent already exists there under a different name before it gets reimplemented inline.

### 2. Repeated Map-aggregation pattern in Hono services

The predictions module has the canonical shape: collect ids → batch query with `inArray` → build a `Map<key, value>` → synchronous `.map()` to assemble the response (see `prediction-history.helpers.ts`'s `buildProbPosMaps`/`buildWinnerMap`, and `intel-standings.helpers.ts`'s per-person aggregation). Check the other services (`races`, `drivers`, `racecraft`, `teammate-battle`, `teams`, `sprint`, `circuits`, `history`...) for the same shape reimplemented ad hoc (e.g. building a lookup map inline for one query result). If it appears 2+ times with the same key-construction convention (`` `${raceId}:${driverId}` ``), flag it as a candidate for a small shared helper (e.g. `toKeyedMap(rows, keyFn)`), placed in `common/` only once a second module needs it.

Also flag GP vs sprint branching in API services that should go through `common/session-kind.ts` (`GP`/`SPRINT`) and `common/session-reads.ts`, and any ad hoc "same driver / same team" key (comparing codes, names or ids by hand) instead of `common/identity.ts` (`personKey`, `isSamePerson`, `constructorKey`...).

### 3. Duplicate mapper logic

`apps/api/src/common/mappers.ts` holds `toTeam`, `toDriver`, `toCircuit`, `toRace`, `toRaceResult`, `toQualifyingResult`, `toSprintResult`: the canonical row-to-response-shape converters. Grep service files for inline object construction that duplicates what a mapper already does (e.g. manually building a `{ id, name, ... }` driver-shaped object instead of calling `toDriver(row.drivers, row.teams)`). Flag any service file reconstructing a shape mappers.ts already covers.

### 4. Frontend: duplicate API caller definitions

`apps/web/src/lib/api.ts` is the single source of truth for backend calls: every method is a one-liner around the shared `get<T>()` helper. Grep `apps/web/src/pages/`, `apps/web/src/components/` and `apps/web/src/features/` for raw `fetch(` calls that bypass `api.ts` (`features/circuits/weather.ts` calls an external weather API, not the backend: that's fine). Every backend route should have exactly one caller definition there; pages/components should only import from `api`.

### 5. Frontend: duplicate display-formatting logic

`apps/web/src/lib/f1/teamColors.ts`, `teamLogos.ts`, `countryFlags.ts`, `tyres.ts` are the canonical lookup tables for team/country/tyre display data. Grep components for inline color hex codes, flag emoji, or circuit stat literals that duplicate what's already in one of these files (a sign a lookup was hand-rolled instead of imported).

### 6. Compare-tool duplication

`DriverCompareTool.tsx` and `TeamCompareTool.tsx` (`apps/web/src/features/compare/components/`) already share their state and fetching (`useCompareController.ts`, `compareReducer.ts`), stat logic (`compareStats.ts`) and per-side config (`driverCompareConfig.ts`, `teamCompareConfig.ts`). Flag helpers, formatting or winner-highlighting logic that has crept back into one tool instead of living in those shared files or a shared subcomponent.

### 7. Premature abstraction / over-engineered indirection

Flag any service method that only forwards to another method with no added logic (a one-line passthrough with no transformation), or any new module folder created for a single trivial route. NestJS-style module/controller/service separation is the convention here, and controllers declare handlers with the `raceRoute`/`seasonRoute`/`driverRoute`/`teamRoute` factories (`common/route.ts`), which own id/year/session validation, the 404, Cache-Control and the response envelope. Flag a controller that hand-rolls any of those instead of using a factory. Single-route modules (`seasons`, `search`, `quality`) stay one file by design: don't flag them.

### 8. Dead parameters

Look for function parameters (TS or Python) accepted but never read in the body: including service methods where a `year` or `status` filter param is accepted but never applied to the query. These create a false API contract.

---

## Report format

Group by category. For each finding:
- **File(s)** with line numbers
- **One-line description** of the duplication or smell
- **Suggested consolidation**: where the shared version should live and what it should look like (a function signature is enough, no need to write the full implementation)

Prioritise findings where consolidation removes the most lines or prevents the most future drift between the GP and sprint pipelines specifically: that's the pairing most likely to silently diverge as one side gets a bugfix the other doesn't.

End with: "X consolidation opportunities found across Y categories."
