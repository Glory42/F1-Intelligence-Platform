---
name: codebase-audit
description: Full health audit of the F1 Prediction codebase, critical-constraint violations (TCP drivers in apps/api/, inline schema, client-side data fetching), ETL idempotency gaps, schema/migration drift, missing "any" types, and stale race-status flow handling. Use when the user says "audit the codebase", "health check", "/codebase-audit", or before a season backfill or after a long feature sprint.
---

# Codebase Audit: F1 Prediction

A structured health check across `apps/api/`, `apps/web/`, `data-engine/`, and `db/`. Run before a big backfill, before a release, or when the codebase feels like it's accumulated debt. Reports issues grouped by severity; does not auto-fix anything unless the user asks.

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
- **Client-side data fetching**: grep `apps/web/src` for `client:load`, `client:idle`, `client:visible` directives combined with a `.tsx` island that calls `fetch(`. CLAUDE.md mandates all data fetching happens in Astro frontmatter, never in `client:*` islands.
- **API write endpoints**: grep `apps/api/src/modules/*/controller.ts` (or `*.controller.ts`) for `app.post(`, `app.put(`, `app.delete(`, `app.patch(`. The API is documented as read-only: Python writes directly to Neon. Any write route is a constraint violation unless the user has explicitly changed this rule.
- **Non-idempotent ETL writes**: grep `data-engine/src/jobs/*.py` for raw `INSERT INTO` strings that don't go through `upsert()` (`data-engine/src/utils/upsert.py`) and don't contain `ON CONFLICT`. Every job must be safe to re-run.

### 2. Schema / migration drift
Cross-check `apps/api/src/db/schema/*.ts` table definitions against `apps/api/drizzle/migrations/*.sql`. For each column defined in a schema file, confirm a corresponding `ADD COLUMN` or `CREATE TABLE` exists in some migration. A column present in schema but absent from any migration means `drizzle-kit generate` was skipped after a schema edit.
```bash
ls apps/api/drizzle/migrations/*.sql
cat apps/api/drizzle/migrations/meta/_journal.json
```
Also flag any `.sql` file in `apps/api/drizzle/migrations/` whose tag doesn't appear in `meta/_journal.json`: an untracked migration that won't run.

### 3. Race status flow consistency
CLAUDE.md documents two status flows (conventional: `scheduled → qualifying_done → completed`; sprint: `scheduled → sprint_qualifying_done → sprint_done → qualifying_done → completed`). Grep `apps/api/src` and `data-engine/src/jobs` for string literals matching race statuses (`'scheduled'`, `'qualifying_done'`, `'sprint_done'`, etc.) and confirm no code branches on a status string not in either documented flow: a typo'd status silently breaks the ETL cron chain or an API filter.
```bash
grep -rn "'scheduled'\|'qualifying_done'\|'sprint_qualifying_done'\|'sprint_done'\|'completed'" apps/api/src data-engine/src --include="*.ts" --include="*.py"
```

### 4. `any` types (CLAUDE.md Code Style: "No `any` types")
```bash
grep -rn ": any\b\|<any>\|as any" apps/api/src apps/web/src --include="*.ts" --include="*.tsx"
```
Group by file. Known existing spots as of this audit's baseline: `apps/api/src/main.ts` (env passthrough), `apps/api/src/common/mappers.ts` (globalThis process access), `apps/api/src/modules/races/races.service.ts` (era/dominance aggregation types). Flag any *new* `any` beyond a previously-reported baseline as the priority; long-standing ones can be listed as existing debt.

### 5. Oversized files (informational: no hard limit documented)
CLAUDE.md doesn't set a line-count ceiling for this repo, so don't treat this as a rule violation: just flag outliers for the user to judge:
```bash
find apps/api/src apps/web/src data-engine/src -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.astro" -o -name "*.py" \) | xargs wc -l | sort -rn | head -15
```
Note which layer each large file is in (service vs. page vs. ETL job): a large `.astro` page with a lot of markup is normal; a large `.service.ts` doing several unrelated things is worth a mention.

### 6. Structured logging in ETL jobs
CLAUDE.md requires ETL failures use structured logging (`{"job": ..., "status": "failed", "error": ...}`) and jobs exit with code 1 on failure. Check each `data-engine/src/jobs/*.py` file:
- Does it wrap its body in `try/except` and call `sys.exit(1)` (or raise, letting `main.py` exit non-zero) on failure?
- Does the failure path log a structured dict, or a bare `print(f"error: {e}")`? Flag bare prints in the failure path: success-path `print(f"[job_name] ...")` progress logs (as seen in `compute_features.py`) are fine and match existing convention.
- Grep for `sleep(` / `time.sleep(`: CLAUDE.md explicitly forbids this inside jobs due to Render's job timeout.
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

### 9. Softmax temperature / weight integrity
`compute_features.py` and `compute_sprint_features.py` hardcode `WEIGHTS` dicts that must each sum to 1.00, and both call `softmax(..., temperature=0.3)`. Read both `WEIGHTS` dicts and sum the values: flag if either doesn't sum to 1.00 (within floating point tolerance) or if `T` was changed from `0.3` anywhere (CLAUDE.md: "Do not increase T").

---

## Report format

Group findings by severity:

**Critical**: violates a documented "Critical Constraint" (TCP driver, inline schema, client-side fetch, write endpoint, non-idempotent job), broken status-flow handling, or a `WEIGHTS`/temperature integrity break

**Warning**: schema/migration drift, new `any` types, missing structured logging on a failure path, `sleep()` in a job

**Info**: oversized files, unresolved TODOs, existing/known `any` debt

For each finding: file path (with line number where applicable), one-sentence description of the issue, and the fix action needed.

End the report with a summary line: "X critical, Y warnings, Z info items found."
