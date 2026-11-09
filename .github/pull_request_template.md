## Summary

<!-- What changes and why. Link the issue: "Closes #123". -->

## Areas touched

- [ ] `apps/web`
- [ ] `apps/api`
- [ ] `apps/e2e`
- [ ] `data-engine`
- [ ] DB schema / migrations
- [ ] Prediction model (weights, features)
- [ ] Docs only

## How it was tested

<!-- Commands run, pages checked, screenshots for UI changes. -->

## Checklist

- [ ] Tests added or updated under the app's `tests/` directory (never co-located)
- [ ] CI passes locally for the touched apps: `bun run test`, `typecheck`, `lint` (+ `build` for web), `pytest` for data-engine
- [ ] No tests, scripts or local dev touch Neon (local Postgres via `docker-compose.dev.yml` / `docker-compose.test.yml`)
- [ ] Stays inside the free tiers: no new polling, no held DB connections across HTTP calls, no Workers KV, heavy routes cached
- [ ] ETL writes stay idempotent (`INSERT ... ON CONFLICT DO UPDATE`)
- [ ] No TCP drivers in `apps/api`; web data fetching stays in Astro frontmatter
- [ ] Schema changes come with a generated migration (`bun run db:generate`)
- [ ] Model changes validated with `scripts/backtest.py` before refitting, and `feature-manifest.ts` mirrors `docs/feature-weights.json`
- [ ] Docs updated (`CLAUDE.md`, `docs/`, READMEs) where behaviour or routes changed
