# API: Hono on Cloudflare Workers

Read-only REST API for the F1 Intelligence Platform. NestJS-style module structure (service / controller / module).

## Stack

- **Runtime**: Cloudflare Workers (V8 isolate, no TCP)
- **Framework**: Hono
- **ORM**: Drizzle ORM with `@neondatabase/serverless` (HTTP driver, mandatory)
- **DB**: Neon PostgreSQL
- **Cache**: edge cache (`src/common/edge-cache.ts`, ADR 0005); no Workers KV (ADR 0012, superseded)

## Local Dev

Local dev never touches Neon: it reads the `docker-compose.dev.yml` snapshot (filled by
`data-engine/scripts/dev_snapshot.py`) through its Neon HTTP proxy. Create `.dev.vars`:

```bash
DATABASE_URL=postgres://f1:f1@localhost:4446/f1_dev
NEON_FETCH_ENDPOINT=http://localhost:4446/sql
ENVIRONMENT=development   # allows the localhost CORS origins
```

```bash
bun install
bun run dev      # wrangler dev on :8787
```

## Environment Variables

| Variable | How to set |
|----------|-----------|
| `DATABASE_URL` | Cloudflare dashboard → Workers → Variables and Secrets → **Secret** (never in wrangler.toml) |
| `ENVIRONMENT` | `[vars]` in `wrangler.toml` (`production`); `.dev.vars` overrides it locally |
| `NEON_FETCH_ENDPOINT` | local only (`.dev.vars`, `.env.test`): routes the Neon driver to the local proxy |

## Type Check and Lint

```bash
bun run typecheck   # tsc --noEmit
bun run lint        # eslint, incl. the tiered max-lines budget
```

`max-lines` budgets (blank lines and comments excluded): controller 80, module 50, service and helpers 200,
`common/` and everything else under `src/` 150; schema, seed and tests are exempt. Both commands run
in the pre-commit hook (`lint-staged`) and in CI.

## Tests

```bash
bun run test:unit                              # tests/unit: no DB
bun run test:db:up && bun run test:integration  # tests/integration: local Postgres (docker-compose.test.yml)
bun run test:db:down
```

Integration tests read the committed `.env.test` and refuse `*.neon.tech` hosts. See [`docs/testing.md`](../../docs/testing.md).

## Seed Database

```bash
DATABASE_URL=<your-url> bun run db:seed
```

## Schema

Drizzle table definitions live in `src/db/schema/`, migrations in `drizzle/migrations/`. The database
is migrate-tracked, so use generate + migrate (not `db:push`):

```bash
bun run db:generate                       # after changing src/db/schema/
DATABASE_URL=<your-url> bun run db:migrate # apply the migration files
```

## Routes

```
GET /api/health                     # never touches the DB
GET /api/health/db

GET /api/races?year=N&status=S
GET /api/races/circuits
GET /api/races/circuit/:circuitKey
GET /api/races/circuit/:circuitKey/telemetry
GET /api/races/:id
GET /api/races/:id/long-runs
GET /api/races/:id/race-control?session=race|sprint
GET /api/races/:id/overtakes?session=race|sprint
GET /api/races/:id/team-radio?session=race|sprint
GET /api/races/:id/strategy?session=race|sprint
GET /api/races/:id/race-story?session=race|sprint
GET /api/races/:id/recap
GET /api/races/:id/telemetry?session=Q|SQ&a=CODE&b=CODE

GET /api/drivers?year=N&team_id=T
GET /api/drivers/standings?year=N
GET /api/drivers/racecraft?year=N
GET /api/drivers/:id?year=N
GET /api/drivers/:id/career
GET /api/drivers/:id/history
GET /api/drivers/:id/teammate-battle?year=N

GET /api/teams?year=N
GET /api/teams/standings?year=N
GET /api/teams/pit-stops?year=N
GET /api/teams/:id?year=N
GET /api/teams/:id/career
GET /api/teams/:id/history
GET /api/teams/:id/pit-stops?year=N

GET /api/predictions/model-info
GET /api/predictions/accuracy
GET /api/predictions/upcoming
GET /api/predictions/history?year=N
GET /api/predictions/standings?year=N
GET /api/predictions/title-odds?year=N
GET /api/predictions/race/:raceId

GET /api/sprint/upcoming
GET /api/sprint/race/:raceId
GET /api/sprint/race/:raceId/detail

GET /api/history/records
GET /api/history/milestones
GET /api/history/lineages
GET /api/history/on-this-day?date=MM-DD

GET /api/seasons
GET /api/search
GET /api/quality?year=N              # dev-only data-quality report
```

All responses: `{ data: T, error: null }` or `{ data: null, error: { code, message } }`

## Module Structure

```
src/modules/<name>/
  <name>.service.ts     # DB queries (Drizzle, no Hono context)
  <name>.controller.ts  # handlers built with raceRoute/seasonRoute/driverRoute/teamRoute (src/common/route.ts)
  <name>.module.ts      # Hono sub-router wiring routes to controllers
  <topic>.helpers.ts    # pure logic used only by this module (unit-tested)
```

`seasons`, `search` and `quality` are single files. Code shared by several modules lives in `src/common/`.

## Deploy

Push to GitHub: Cloudflare Workers deploys automatically. Never run `wrangler deploy` directly.
