---
name: refactor-hunt
description: Finds refactoring opportunities in F1 Prediction, duplicated logic between the GP and sprint model pipelines, repeated Map-aggregation patterns in Hono services, duplicate frontend API callers, and helpers that belong in a shared layer. Use when the user says "find refactoring opportunities", "look for duplication", "/refactor-hunt", or after adding a new feature/prediction pipeline alongside an existing one.
---

# Refactor Hunt: F1 Prediction

Scans for code that would benefit from simplification, consolidation, or better placement. This skill finds opportunities: it does not apply fixes unless explicitly asked.

## Scope

Default: the diff since the last commit or the modules the user names. For a broader hunt, use the `Explore` agent to search across `apps/api/src`, `apps/web/src`, and `data-engine/src`.

If the user says "hunt in the sprint pipeline" or names a module, scope to that.

---

## What to look for

### 1. GP/sprint pipeline drift (data-engine/)

This codebase runs two parallel model pipelines, GP (`weighted-v3`) and sprint (`sprint-v2`), that mirror each other structurally:
- `compute_features.py` / `compute_sprint_features.py`
- `compute_predictions.py` / `compute_sprint_predictions.py`
- `ingest_qualifying.py` / `ingest_sprint_qualifying.py`
- `ingest_race.py` / `ingest_sprint.py`

Diff the shared logic between each pair (query shape, normalization calls, softmax call, upsert call). Where both files repeat the exact same computation with only the input table changed (e.g. both call `normalize_minmax()` → `clamp()` → `softmax(..., 0.3)` the same way), flag it as a candidate for a shared helper in `data-engine/src/utils/`. Do **not** flag the weight tables (`WEIGHTS` dicts) themselves, since those are intentionally distinct per CLAUDE.md's model spec. Only flag the surrounding mechanical logic (grid fetch, DB row assembly, upsert call shape).

Also check `math_utils.py`: if a new normalization/scoring formula is added to one job, check whether the equivalent already exists there under a different name before it gets reimplemented inline.

### 2. Repeated Map-aggregation pattern in Hono services

`predictions.service.ts` has two instances of the same shape: collect ids → batch query with `inArray` → build a `Map<key, value>` → synchronous `.map()` to assemble the response (see `findHistory()`'s `probMap`/`posMap`/`sprintProbMap`/`sprintPosMap`, and `findIntelStandings()`'s `byCode` Map). Check `races.service.ts`, `drivers.service.ts`, `teams.service.ts`, and `sprint.service.ts` for the same shape reimplemented ad hoc (e.g. building a lookup map inline for one query result). If it appears 2+ times with the same key-construction convention (`` `${raceId}:${driverId}` ``), flag it as a candidate for a small shared helper (e.g. `toKeyedMap(rows, keyFn)`).

### 3. Duplicate mapper logic

`apps/api/src/common/mappers.ts` holds `toDriver`, `toRace`, `toCircuit`: the canonical row-to-response-shape converters. Grep service files for inline object construction that duplicates what a mapper already does (e.g. manually building a `{ id, name, ... }` driver-shaped object instead of calling `toDriver(row.drivers, row.teams)`). Flag any service file reconstructing a shape mappers.ts already covers.

### 4. Frontend: duplicate API caller definitions

`apps/web/src/lib/api.ts` is the single source of truth for backend calls: every method is a one-liner around the shared `get<T>()` helper. Grep `apps/web/src/pages/**/*.astro` and `apps/web/src/components/**/*.tsx` for raw `fetch(` calls that bypass `api.ts`. Every backend route should have exactly one caller definition there; pages/components should only import from `api`.

### 5. Frontend: duplicate display-formatting logic

`apps/web/src/lib/f1/teamColors.ts`, `teamLogos.ts`, `countryFlags.ts` are the canonical lookup tables for team/country/circuit display data. Grep components for inline color hex codes, flag emoji, or circuit stat literals that duplicate what's already in one of these files (a sign a lookup was hand-rolled instead of imported).

### 6. Compare-tool duplication

`DriverCompareTool.tsx` (626 lines) and `TeamCompareTool.tsx` (562 lines) are the two largest frontend files and structurally similar (side-by-side stat comparison UI). Diff their internals for identical helper functions (formatting, delta calculation, winner-highlighting logic) that could move to a shared `apps/web/src/lib/` helper or a shared `.tsx` subcomponent instead of being duplicated in both files.

### 7. Premature abstraction / over-engineered indirection

Flag any service method that only forwards to another method with no added logic (a one-line passthrough with no transformation), or any new module folder created for a single trivial route. NestJS-style module/controller/service separation is the convention here: but a controller method should still do real parsing/validation, not just `return service.x(c.req.query('y'))` with zero logic duplicated three times where a shared query-param helper would do.

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
