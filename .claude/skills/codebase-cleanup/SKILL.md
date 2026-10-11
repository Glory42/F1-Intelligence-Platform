---
name: codebase-cleanup
description: Removes dead code, unused imports, stale constants, debug console.log/print statements, and orphaned migrations from F1 Prediction. Use when the user says "clean up the codebase", "remove dead code", "/codebase-cleanup", or after deleting a feature, retiring a legacy ingest job, or doing a big refactor.
---

# Codebase Cleanup — F1 Prediction

Safely removes code that is provably unused. Every deletion must be verified — do not remove something just because a grep returns zero hits if the export could be used dynamically (e.g. a Python job dispatched by name from `main.py`, or a Drizzle schema export used only by `drizzle-kit`).

## Scope

Default: the changed files in the current diff, plus any files they import from. For a full-tree cleanup, use the `Explore` agent — say so explicitly so the user knows it will be thorough but slower.

---

## Cleanup areas

### 1. Unused TypeScript imports

In every changed `.ts` / `.tsx` / `.astro` file, look for imported names never referenced in the file body (including JSX/template props and type positions). Run a targeted grep before removing: `grep -n "ImportedName" file.ts` — if only the import line hits, it's dead.

### 2. Unused Python imports

Same check for changed `.py` files in `data-engine/src/`. Common leftovers after refactors: unused `numpy`/`defaultdict` imports in `compute_*.py` jobs after logic moves to `math_utils.py`.

### 3. Unused exported constants and types

Grep for exported constants/types in `apps/api/src/common/types/`, `apps/api/src/common/constants.ts`, and `apps/web/src/types/`. For each export, check if it has any import anywhere in the project:
```bash
grep -rn "ImportName" apps/api/src apps/web/src --include="*.ts" --include="*.tsx" --include="*.astro"
```
Remove only if the sole hit is the definition itself. Do **not** remove if:
- It's a Drizzle schema export from `apps/api/src/db/schema/` — these are used by `drizzle-kit` tooling even with zero direct code imports.
- It's a response-shape type consumed only structurally by JSON parsing (no explicit import needed at the call site in some cases) — verify against `apps/web/src/lib/api.ts` return types first.

### 4. Legacy ingest job leftovers

`ingest_qualifying_legacy.py` and `ingest_race_legacy.py` exist deliberately for pre-2018 seasons (documented in the `backfill` skill) — never flag these as dead even with low recent usage. Only flag genuinely orphaned jobs: a `data-engine/src/jobs/*.py` file not referenced in `data-engine/src/main.py`'s job dispatch table and not mentioned in the `backfill` skill.

### 5. Orphaned migration files
```bash
ls apps/api/drizzle/migrations/*.sql
grep '"tag"' apps/api/drizzle/migrations/meta/_journal.json
```
Flag any `.sql` file whose tag doesn't appear in the journal — it won't run and clutters the directory. Do not delete automatically; confirm with the user, since it might be an in-progress migration.

### 6. Commented-out code blocks
```bash
grep -n "^[[:space:]]*//" apps/api/src apps/web/src -r --include="*.ts" --include="*.tsx" | grep -v "TODO\|FIXME\|NOTE\|eslint\|prettier"
grep -n "^[[:space:]]*#" data-engine/src -r --include="*.py" | grep -v "TODO\|FIXME\|NOTE"
```
Flag clusters of 3+ consecutive commented lines. Distinguish dead code (old implementation, clearly replaced — safe to remove) from an explanatory comment describing *why* (keep).

### 7. console.log / debug print statements

CLAUDE.md: "No console.log in production code — use structured logging patterns."
```bash
grep -rn "console\.log" apps/api/src apps/web/src --include="*.ts" --include="*.tsx"
```
`console.error` inside `app.onError` (`apps/api/src/main.ts`) is the documented error-handling path — keep it. Flag any other `console.log`/`console.warn` left from debugging. `apps/api/src/db/seed.ts` uses `console.log` for one-off seed progress output — that's a standalone script run manually, not production request-path code, so it's fine; don't flag it.

For Python, bare `print()` calls are the existing convention for job progress (`print(f"[compute_features] race_id={race_id}")` — see every job's `run()` entry). Only flag `print()` used in place of the structured-logging failure path CLAUDE.md requires on error, not progress prints.

### 8. Stale feature flags / always-false branches
```bash
grep -rn "if (false\|if (0\|&& false" apps/api/src apps/web/src --include="*.ts" --include="*.tsx"
grep -rn "if False:\|if 0:" data-engine/src --include="*.py"
```
Usually leftover from debugging sessions.

### 9. Unregistered API routes

Check `apps/api/src/main.ts` — every module under `apps/api/src/modules/` should have a corresponding `app.route('/api/...', xModule)` line. Flag any module directory present in `modules/` but never mounted (dead code that can't be reached), and any `app.route()` call whose imported module file no longer exists.

---

## Safety rules

Before removing anything:

1. **Grep first** — confirm zero usages outside the definition file.
2. **Don't touch `apps/api/src/db/schema/`** — Drizzle uses these exports for migration generation even with no direct code import.
3. **Don't touch `ingest_*_legacy.py`** — deliberately kept for pre-2018 backfills.
4. **Don't remove migration files** — even orphaned ones; confirm with the user first.
5. **One file at a time** — don't batch delete across unrelated modules in a single pass; stage and verify each area before moving to the next.

After cleanup, run the `build` skill (or directly: `bun run typecheck` in `apps/api/`, `bun run build` in `apps/web/`) to confirm zero new type errors.

---

## Report format (before making changes)

List every candidate removal grouped by category with file:line. For each:
- What it is
- Why it appears unused (zero grep hits / replaced by X / leftover from feature Y)
- Confidence: **Safe** (zero hits anywhere, not a schema/legacy exception), **Likely** (no external hits but dynamic use possible), **Confirm** (needs user verification — migrations, anything DB-adjacent)

Only proceed with removals after the user has reviewed the report and confirmed.
