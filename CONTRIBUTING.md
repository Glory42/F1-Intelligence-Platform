# Contributing

## Prerequisites

- [Bun](https://bun.sh/) (API, frontend, e2e)
- Python 3.12 (pinned in `data-engine/.python-version`)
- Docker (local dev and API integration tests run against local Postgres, never Neon)
- Read access to Neon (`PROD_DATABASE_URL`), only to fill the local snapshot

## Local Setup

```bash
# All at once (apps/api, apps/web, apps/e2e)
bun run install:all

# API
cd apps/api && bun install

# Frontend
cd apps/web && bun install

# Data engine
cd data-engine
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # points at the local snapshot by default

# Local database: one read-only dump of Neon into docker-compose.dev.yml
PROD_DATABASE_URL=postgresql://...neon.tech/... python scripts/dev_snapshot.py
```

Then point `apps/api/.dev.vars` at the snapshot: `DATABASE_URL=postgres://f1:f1@localhost:4446/f1_dev`
and `NEON_FETCH_ENDPOINT=http://localhost:4446/sql`. Schema changes: `bun run db:generate` +
`bun run db:migrate` in `apps/api/` (the DB is migrate-tracked: not `db:push`).

## Before Pushing

A husky pre-commit hook (`lint-staged.config.mjs`) runs `typecheck` + `lint` for whichever of
`apps/api/` / `apps/web/` has staged files. `lint` enforces each app's tiered ESLint `max-lines`
budget: extract code rather than raising it.

**API**: type-check, lint, tests:
```bash
cd apps/api && bun run typecheck && bun run lint
cd apps/api && bun run test:unit
cd apps/api && bun run test:db:up && bun run test:integration
```

**Frontend**: build to catch TypeScript errors, then lint and test:
```bash
cd apps/web && bun run build && bun run typecheck && bun run lint && bun run test
cd apps/e2e && bun run test   # Playwright smoke tests against a fixture API
```

**Python**: `cd data-engine && pytest`, and run any affected jobs locally against the local snapshot
(never Neon). See [`docs/testing.md`](docs/testing.md).

## Code Style

- TypeScript strict mode everywhere: no `any`
- Python type hints on all function signatures
- No comments explaining what code does: name things clearly
- Only comment WHY when it's non-obvious (a hidden constraint, a workaround)
- No `console.log` in production code

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/) with project scopes:

```
feat(prediction): ...
fix(web): ...
style(navbar): ...
data(etl): ...
chore(db): ...
```

Scopes: `web`, `api`, `db`, `etl`, `navbar`, `prediction`, `races`, `drivers`, `teams`, `ui`, `config`

## Critical Rules

- **Never use TCP drivers (`pg`, `postgres`) in `apps/api/`**: Cloudflare Workers require `@neondatabase/serverless`
- **Never deploy via CLI**: push to GitHub; Cloudflare deploys automatically
- **Never write through the API from Python**: ETL writes directly to Neon
- **All ETL jobs must stay idempotent**: `INSERT ... ON CONFLICT DO UPDATE` always
- **All data fetching in Astro frontmatter**: never in `client:*` islands (only `GlobalSearch`,
  `DriverCompareTool` and `TeamCompareTool` are exempt: their data depends on user input)
- **Schema lives in `apps/api/src/db/schema/`**: never inline in route files
- **Stay inside the free tiers**: local dev and tests never touch Neon, no Workers KV, heavy routes cached
  (see `docs/plans/intelligence-platform-roadmap.md` §1–§2)

## Project Docs

- [`CLAUDE.md`](CLAUDE.md): full architecture reference and constraints
- [`CODEMAP.md`](CODEMAP.md): full file-level reference map
- [`apps/api/README.md`](apps/api/README.md): API setup, routes, and migration workflow
- [`apps/web/README.md`](apps/web/README.md): frontend setup and pages
- [`data-engine/README.md`](data-engine/README.md): ETL jobs and worker schedule

## Community

- [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md): expected behaviour in issues, PRs and discussions
- [`SECURITY.md`](SECURITY.md): report vulnerabilities privately, never in a public issue
- Issues use the templates under [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/); PRs get [`.github/pull_request_template.md`](.github/pull_request_template.md) automatically
