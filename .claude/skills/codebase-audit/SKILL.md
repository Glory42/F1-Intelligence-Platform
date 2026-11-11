---
name: codebase-audit
description: Full health audit of the F1 Intelligence Platform codebase, critical-constraint violations (TCP drivers in apps/api/, inline schema, client-side data fetching), ETL idempotency gaps, schema/migration drift, missing "any" types, and stale race-status flow handling. Use when the user says "audit the codebase", "health check", "/codebase-audit", or before a season backfill or after a long feature sprint.
---

# Codebase Audit: F1 Intelligence Platform

A structured health check across `apps/api/` (including its Drizzle schema and migrations), `apps/web/`, and `data-engine/`. Run before a big backfill, before a release, or when the codebase feels like it's accumulated debt. Reports issues grouped by severity; does not auto-fix anything unless the user asks.

## Scope

Default: full `apps/api/src`, `apps/web/src`, `data-engine/src` trees plus `apps/api/drizzle/migrations`.
If the user scopes it ("just the API", "just the data engine"), honour that.

Use the `Explore` agent for the search legwork: it keeps the main context window clean.

---

## Audit areas

### 1. Critical constraint violations (CLAUDE.md "Critical Constraints")
These are hard rules: treat any hit as Critical, not Warning:

- **TCP driver in `apps/api/`**: grep `apps/api/` for `from 'pg'`, `require('pg')`, `postgres(` (the `postgres` npm package), or any import that isn't `@neondatabase/serverless`. Cloudflare Workers have no TCP support: this breaks at runtime, not compile time.
  ```bash
  grep -rn "from 'pg'\|from \"pg\"\|require('pg')\|from 'postgres'" apps/api/src
  ```
- **Inline schema definitions**: grep route/controller/service files in `apps/api/src/modules/` for `pgTable(`, schema must live only in `apps/api/src/db/schema/`.
- **Client-side data fetching**: grep `apps/web/src` for `client:load`, `client:idle`, `client:visible` directives combined with a `.tsx` island that fetches (calls `api.*` from `src/lib/api.ts` or `fetch(`). CLAUDE.md mandates all data fetching happens in Astro frontmatter, never in `client:*` islands. The only sanctioned exceptions are `GlobalSearch.tsx`, `DriverCompareTool.tsx` and `TeamCompareTool.tsx` (CLAUDE.md §3); `CircuitsGrid` is an island but doesn't fetch. Any other fetching island is Critical.
- **API write endpoints**: grep `apps/api/src/modules/` (`*.module.ts`, plus the single-file `seasons.ts`/`search.ts`/`quality.ts`) and `apps/api/src/main.ts` for `.post(`, `.put(`, `.delete(`, `.patch(`. The API is documented as read-only: Python writes directly to Neon. Any write route is a constraint violation unless the user has explicitly changed this rule.
- **Non-idempotent ETL writes**: grep `data-engine/src/jobs/*.py`, `data-engine/src/utils/` and `data-engine/scripts/` for raw `INSERT INTO` strings that don't go through `upsert()` (`data-engine/src/utils/upsert.py`) and don't contain `ON CONFLICT`. Every job must be safe to re-run.
- **Free-tier rules (CLAUDE.md §6)**: flag any use of Workers KV (ADR 0012, superseded: Free's write cap). Flag a DB connection held open across an OpenF1/Jolpica/FastF1 HTTP call, any new polling loop outside `auto_runner.py`'s worker cycle, and new row-per-lap tables (whole-race data goes in one row per race/session/driver).

### 2. Schema / migration drift
Cross-check `apps/api/src/db/schema/*.ts` table definitions against `apps/api/drizzle/migrations/*.sql`. For each column defined in a schema file, confirm a corresponding `ADD COLUMN` or `CREATE TABLE` exists in some migration. A column present in schema but absent from any migration means `drizzle-kit generate` was skipped after a schema edit.
```bash
ls apps/api/drizzle/migrations/*.sql
cat apps/api/drizzle/migrations/meta/_journal.json
```
Also flag any `.sql` file in `apps/api/drizzle/migrations/` whose tag doesn't appear in `meta/_journal.json`: an untracked migration that won't run.

### 3. Race status flow consistency
CLAUDE.md documents two status flows (conventional: `scheduled → qualifying_done → completed`; sprint: `scheduled → sprint_qualifying_done → sprint_done → qualifying_done → completed`). `data-engine/src/weekend_pipeline.py` is the only place that maps a Race Status to the jobs due next: flag any job, script or worker code that branches on a status to decide what runs instead of asking it. Grep `apps/api/src` and `data-engine/src` for string literals matching race statuses (`'scheduled'`, `'qualifying_done'`, `'sprint_done'`, etc.) and confirm no code uses a status string not in either documented flow: a typo'd status silently stalls the worker's weekend chain or an API filter.
```bash
grep -rn "'scheduled'\|'qualifying_done'\|'sprint_qualifying_done'\|'sprint_done'\|'completed'" apps/api/src data-engine/src --include="*.ts" --include="*.py"
```

### 4. `any` types (CLAUDE.md Code Style: "No `any` types")
```bash
grep -rn ": any\b\|<any>\|as any" apps/api/src apps/web/src --include="*.ts" --include="*.tsx"
```
Group by file. The baseline is zero `any` in `apps/api/src` and `apps/web/src`, so every hit is new. Types belong in the app's `types/` folder (API: `apps/api/src/common/types/`, one file per domain behind `index.ts`; web: `apps/web/src/types/` re-exports them type-only).

### 5. File-size budgets
`apps/web` and `apps/api` enforce ESLint `max-lines` (blank lines and comments don't count) in CI and pre-commit: web pages/layouts 300, components 250, other `.ts`/`.tsx` 200; API controllers 80, modules 50, services/helpers 200, `common/` 150 (`eslint.config.js` in each app). Run `bun run lint` in both apps: any failure is a Warning, and the fix is to extract (`features/*/components`, `*.helpers.ts`, `common/`), never to raise the limit. `data-engine/` has no budget: just flag outliers there for the user to judge:
```bash
find data-engine/src -type f -name "*.py" | xargs wc -l | sort -rn | head -10
```

### 6. Structured logging in ETL jobs
CLAUDE.md requires ETL failures use structured logging (`{"job": ..., "status": "failed", "error": ...}`) and jobs exit with code 1 on failure. Jobs raise and `src/main.py` logs the failure through `log_job_failure` (`src/utils/logging_utils.py`) and exits 1. Check each `data-engine/src/jobs/*.py` file:
- Does it raise on failure, rather than swallowing the exception or calling `sys.exit` itself?
- A source that hasn't published the session yet must raise `SessionNotReady` (`src/utils/session_records.py`): the worker retries only that, a spent OpenF1 budget and network errors.
- Does any failure path use a bare `print(f"error: {e}")` instead? Success-path `print(f"[job_name] ...")` progress logs (as seen in `compute_features.py`) are fine and match existing convention.
- Grep for `sleep(` / `time.sleep(`: CLAUDE.md forbids waiting for data inside jobs (retry on the next worker cycle instead); the only sanctioned waits are `openf1_client`'s request pacing/backoff (ADR 0004).
```bash
grep -rn "time.sleep\|sleep(" data-engine/src/jobs
```

### 7. CORS / environment gating
Check `apps/api/src/main.ts`: `PROD_ORIGINS` / `DEV_ORIGINS` gating should stay behind `c.env.ENVIRONMENT === 'production'`. Flag if a new hardcoded origin was added without going through this gate, or if `DEV_ORIGINS` leaked into the production branch.

### 8. Unresolved TODOs and FIXMEs
```bash
grep -rn "TODO\|FIXME\|HACK\|XXX" apps/api/src apps/web/src data-engine/src --include="*.ts" --include="*.tsx" --include="*.py"
```
Group by area. Distinguish `TODO` (intentional deferral) from `FIXME`/`HACK` (known broken/workaround, needs resolution).

### 9. Model weight integrity
- **GP (weighted-v4)**: weights are fitted, not hand-set. They live only in `data-engine/src/models/gp_v4.json` (written by `scripts/fit_model_v4.py`), the probability is a plain softmax (T = 1), and `utils/gp_model_v4.py` is the only path to a GP Prediction. Flag hand-edited weights, a reintroduced temperature, a second prediction path, or a feature in `utils/gp_features_v4.py` that reads the race being predicted or later ones.
- **Sprint (sprint-v2)**: `SPRINT_FEATURES` in `data-engine/src/utils/feature_manifest.py` must sum to 1.00 and `SPRINT_SOFTMAX_TEMPERATURE` must stay `0.3`.
- Both must match `docs/feature-weights.json` and the API's `apps/api/src/common/feature-manifest.ts`: run `pytest tests/test_weights.py` in `data-engine/` and `bun test tests/unit/common/feature-manifest.test.ts` in `apps/api/`.

---

## Report format

Group findings by severity:

**Critical**: violates a documented "Critical Constraint" (TCP driver, inline schema, client-side fetch, write endpoint, non-idempotent job), broken status-flow handling, or a model weight/temperature integrity break

**Warning**: schema/migration drift, new `any` types, `max-lines` lint failures, missing structured logging on a failure path, `sleep()` in a job

**Info**: oversized `data-engine/` files, unresolved TODOs

For each finding: file path (with line number where applicable), one-sentence description of the issue, and the fix action needed.

End the report with a summary line: "X critical, Y warnings, Z info items found."
