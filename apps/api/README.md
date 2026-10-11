# API: Hono on Cloudflare Workers

Read-only REST API for the F1 prediction platform. NestJS-style module structure (service / controller / module).

## Stack

- **Runtime**: Cloudflare Workers (V8 isolate, no TCP)
- **Framework**: Hono
- **ORM**: Drizzle ORM with `@neondatabase/serverless` (HTTP driver, mandatory)
- **DB**: Neon PostgreSQL

## Local Dev

```bash
bun install
bun run dev      # wrangler dev on :8787
```

## Environment Variables

| Variable | How to set |
|----------|-----------|
| `DATABASE_URL` | `wrangler secret put DATABASE_URL` (never in wrangler.toml) |

## Type Check

```bash
bunx tsc --noEmit
```

Pre-existing errors in `drizzle.config.ts` and `src/db/seed.ts` (missing node types) are expected: ignore them. Only fail on new errors in `src/modules/` or `src/common/`.

## Seed Database

```bash
DATABASE_URL=<your-url> bun run src/db/seed.ts
```

## Schema

Drizzle table definitions live in `src/db/schema/`. To push schema changes to Neon:

```bash
DATABASE_URL=<your-url> bunx drizzle-kit push
```

Migrations are generated into `drizzle/migrations/`:

```bash
DATABASE_URL=<your-url> bunx drizzle-kit generate   # after changing src/db/schema/
DATABASE_URL=<your-url> bunx drizzle-kit migrate    # apply via migration files (prod)
```

## Routes

```
GET /api/health
GET /api/seasons
GET /api/races?year=N&status=S
GET /api/races/:id
GET /api/races/circuit/:circuitKey
GET /api/drivers?year=N&team_id=T
GET /api/drivers/standings?year=N
GET /api/drivers/:id?year=N
GET /api/drivers/:id/career
GET /api/teams?year=N
GET /api/teams/standings?year=N
GET /api/teams/:id?year=N
GET /api/teams/:id/career
GET /api/predictions/upcoming
GET /api/predictions/race/:raceId
GET /api/predictions/history?year=N
GET /api/predictions/standings?year=N
```

All responses: `{ data: T, error: null }` or `{ data: null, error: { code, message } }`

## Module Structure

```
src/modules/<name>/
  <name>.service.ts     # DB queries (Drizzle, no Hono context)
  <name>.controller.ts  # Parse Hono context → call service → return JSON
  <name>.module.ts      # Hono sub-router wiring routes to controllers
```

## Deploy

Push to GitHub: Cloudflare Workers deploys automatically. Never run `wrangler deploy` directly.
