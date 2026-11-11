---
name: build
description: Build and verify the web and API. Use when the user says "build", "check build", "verify", or after making code changes to confirm nothing is broken.
---

# Build Skill: F1 Intelligence Platform

Verify the web frontend and API compile, lint and test cleanly after changes. These are the same checks CI runs
(`.github/workflows/test.yml`); the pre-commit hook (`lint-staged.config.mjs`) runs typecheck + lint per app.

## Web (Astro: `apps/web/`)

```bash
cd /home/glory42/Projects/side-projects/F1-prediction/apps/web
bun run build        # astro build
bun run typecheck    # astro check
bun run lint         # eslint, includes the max-lines budgets
bun run test         # vitest
```

**Build success output:**
```
[build] Server built in X.XXs
[build] Complete!
```

## API (Hono: `apps/api/`)

No build step for Workers: type-check, lint and test:

```bash
cd /home/glory42/Projects/side-projects/F1-prediction/apps/api
bun run typecheck         # tsc --noEmit, expected to pass with zero errors
bun run lint              # eslint, includes the max-lines budgets
bun run test:unit         # no DB needed
bun run test:db:up        # local Postgres (docker-compose.test.yml), never Neon
bun run test:integration
```

## E2E (`apps/e2e/`)

```bash
cd /home/glory42/Projects/side-projects/F1-prediction/apps/e2e
bun run typecheck    # fixtures are typed against the API response types
bun run test         # Playwright smoke tests (or `bun run test:e2e` from the repo root)
```

## Data Engine (`data-engine/`)

```bash
cd /home/glory42/Projects/side-projects/F1-prediction/data-engine
source venv/bin/activate
pytest
```

## Local Dev

```bash
# Both, from repo root
bun run dev

# Frontend dev server on :4321
cd apps/web && bun run dev

# API local dev via wrangler
cd apps/api && bun run dev
```

Local dev reads the `docker-compose.dev.yml` DB (filled by `data-engine/scripts/dev_snapshot.py`), never Neon.

## Rules

- **Never run `bun run deploy` or `wrangler deploy`**: user pushes to GitHub, Cloudflare deploys automatically
- Always build the web after frontend changes to catch errors before committing
- Any new type or lint error is a failure: there is no known-error baseline
- A `max-lines` failure means extract (into `features/*/components`, `*.helpers.ts` or `common/`), not raise the limit

## DB Schema Changes

The DB is migrate-tracked: generate a migration and apply it, never `db:push`:

```bash
cd apps/api
bun run db:generate   # SQL from schema changes -> apps/api/drizzle/migrations/
bun run db:migrate    # applies to whatever DATABASE_URL points at
```
