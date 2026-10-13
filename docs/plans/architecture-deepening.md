# Architecture deepening: plan

From the 2026-10-13 architecture review. Nine deepening candidates plus five bugs found on the way.
Every change is built test-first (red → green, one vertical slice at a time) at the seams listed
under each candidate; tests at shallow internals that the new interface replaces are deleted.

## Execution

Three tracks, each on its own worktree branch, merged into `refactor/deepen-architecture`:

| Track | Candidates | Area |
|-------|-----------|------|
| A: data engine | 01 → 06 → 08 | `data-engine/` |
| B: API | 05 → 03 → 04 → 02 (API half) | `apps/api/` |
| C: web | 07, then 02 (web half) + 09 once B lands | `apps/web/`, `apps/e2e/`, CI |

One commit per candidate. Cross-cutting docs (`CLAUDE.md`, `CODEMAP.md`, `docs/*.md`) are updated
in the commit that changes the behaviour they describe.

## Bugs (each gets a failing test first)

| Bug | Fixed by |
|-----|----------|
| `main.py` `--job ingest_race` auto-detect excludes `qualifying_done`, the only status it should find | 01 |
| Repair of `ingest_race` skips title odds and Race Events the worker runs | 01 |
| `backfill_full.py` never computes GP features for sprint weekends | 01 |
| Sprint `LapSummary` counts pit laps in the average and null-time laps in `totalLaps` | 03 |
| Driver/team edge-cache lifetime derived from the client's `?year=` | 05 |

## 01 · Race-weekend pipeline module (data engine)

New `src/weekend_pipeline.py`: the only interpreter of Race Status.
- `plan(status, is_sprint, event, now) -> Action | None` (today's `decide_next_action`, moved).
- `chain(kind) -> tuple[JobStep, ...]`, `due_status_for(job)`, `SPRINT_FORMATS`, readiness delays.
- `repair_steps(table, check)` derived from the chains instead of a hand-typed table.

Callers: `auto_runner.run_cycle`, `main.py` auto-detect + dispatch, `quality_utils`/`data_quality_repair`,
`scripts/backfill_full.py`, `scripts/run_backfill.py`, `scripts/backfill_sprint.py`.

**Seams under test**
- `weekend_pipeline.plan` / `chain` / `repair_steps`: pure, no fakes.
- `main.auto_detect_*` through `tests/support/fake_db.py` (existing `test_main_auto_detect.py`).
- `auto_runner.run_cycle` keeps its existing tests; job monkeypatching shrinks to one job table.

## 02 · Standings response owns championship points

API driver/team stats gain `championshipPoints` (GP + sprint, summed server-side). Web callers read it;
`championshipPoints()` in `lib/f1/championshipMath.ts` is deleted.

**Seams under test**
- API integration: `GET /api/drivers/standings`, `/api/teams/standings`, `/api/drivers/:id`, `/api/teams/:id`.
- Web: compare configs (`driverCompareConfig`, team config extracted from `TeamCompareTool.tsx`) unit tests.

## 03 · Session-kind module for GP vs Sprint reads (API)

New `common/session-kind.ts` (GP/Sprint descriptors: tables, date column, upcoming/done statuses
tied to the Race Status enum, manifest) and `common/session-reads.ts` (prediction assembly and lap
summaries for a kind). `predictions`, `sprint`, `races`, `recap` consume it.

**Seams under test**
- HTTP integration: `/api/races/:id` laps and `/api/sprint/race/:id/detail` laps (same assertions per
  kind), `/api/predictions/*`, `/api/sprint/*` (existing suites keep passing).

## 04 · Identity module (API + data engine)

New `common/identity.ts`: `personKey`, `constructorKey`, `f1dbPersonKey`, `f1dbConstructorId`; replaces
`driver-identity.ts`, `f1db-match.helpers` normalisation, `circuit-era` keys/aliases, headshot
last-name match, intel standings' code grouping and teams' exact `teamKey` career join.
Golden cases live in `docs/identity-cases.json`, read by both the TS unit test and the Python
`normalize_person_name` test.

**Seams under test**
- `identity.ts` unit tests against the golden cases.
- `data-engine/tests/test_f1db.py` against the same golden file.
- Integration: team career joins across a rebrand.

## 05 · Route module for request parsing, existence and cache policy (API)

New `common/route.ts`: `raceRoute` (generalises `raceSubResource`) and `seasonRoute`. They validate
id/year/session, load the race once, 404, choose Cache-Control from the loaded race/season, wrap the
envelope. Controllers become declarations.

**Seams under test**
- HTTP integration: invalid id/year → 400, unknown race → 404, Cache-Control derived from data
  (teammate battle with a mismatching `?year=` is not `immutable`).

## 06 · Enrichment coverage module (data engine)

New `src/enrichment_coverage.py`: one coverage definition per (table, session), `source_for(year)`
(FastF1 2018–2022, OpenF1 2023+), `missing(coverage_row)`, shared conflict keys and compound
normalisation, one `storage_guard` check. Worker retries and both enrichment backfills call it.

**Seams under test**
- `missing` / `source_for`: pure.
- Coverage query through `fake_db`.
- Stint rows from either source normalise compounds the same way.

## 07 · Page-data modules (web)

Pure loaders, following `buildPredictionPageData`: `loadDriverPageData`, `loadTeamPageData`,
`loadRacePageData(kind)` (shared by GP and sprint race pages), `loadHistoryPageData`. They own the
active-tab fetch, optional-data degradation and career-year resolution; pages only render.

**Seams under test**
- Each loader under Vitest with MSW (`tests/support/msw/`).

## 08 · Feature runner (data engine)

New `utils/feature_runner.run_feature_job(spec, race_id)`; `compute_features` and
`compute_sprint_features` become specs, mirroring `prediction_runner`.

**Seams under test**
- `run_feature_job` via `fake_db` + monkeypatched `execute_batch` (existing pattern); existing feature
  tests keep passing unchanged in their expectations.

## 09 · One contract source

- `apps/web/src/types/*` re-export the API's `common/types` by relative path (type-only, no workspaces).
- e2e fixtures get type-checked in CI (`bun run typecheck` in the e2e job).
- `docs/feature-weights.json` gains labels and the softmax temperature; the Python, API and web
  drift tests check them.

**Seams under test**
- Existing weight drift tests, extended to labels + temperature.
- `tsc --noEmit` in `apps/e2e` and `astro check` in `apps/web`.
