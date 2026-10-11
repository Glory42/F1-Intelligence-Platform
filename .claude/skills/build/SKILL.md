---
name: build
description: Build and verify the web and API. Use when the user says "build", "check build", "verify", or after making code changes to confirm nothing is broken.
---

# Build Skill: F1 Prediction

Verify the web frontend and API compile correctly after changes.

## Web (Astro: `apps/web/`)

```bash
cd /home/glory42/Projects/side-projects/F1-prediction/apps/web
bun run build
```

**Success output:**
```
[build] Server built in X.XXs
[build] Complete!
```

## API (Hono: `apps/api/`)

TypeScript type-check only (no build step needed for Workers):

```bash
cd /home/glory42/Projects/side-projects/F1-prediction/apps/api
bun run typecheck
```

Expected pre-existing errors (ignore these):
- `drizzle.config.ts`: `process` not found (node types missing, not our code)
- `src/db/seed.ts`: same

## Local Dev

```bash
# Both, from repo root
bun run dev

# Frontend dev server on :4321
cd apps/web && bun run dev

# API local dev via wrangler
cd apps/api && bun run dev
```

## Rules

- **Never run `bun run deploy` or `wrangler deploy`**: user pushes to GitHub, Cloudflare deploys automatically
- Always build the web after frontend changes to catch TypeScript errors before committing
- API type errors in `drizzle.config.ts` and `seed.ts` are pre-existing: only fail on NEW errors in `src/modules/` or `src/common/`

## DB Schema Changes

If schema changed, push to Neon before building:

```bash
cd apps/api
DATABASE_URL=$(cat .env | grep DATABASE_URL | cut -d'=' -f2-) bunx drizzle-kit push
```
