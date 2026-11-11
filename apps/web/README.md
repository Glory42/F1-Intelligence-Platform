# Web: Astro SSR on Cloudflare Pages

Server-side rendered frontend for the F1 Intelligence Platform. Full guide: [`docs/frontend.md`](../../docs/frontend.md).

## Stack

- **Framework**: Astro (`output: 'server'`)
- **Adapter**: `@astrojs/cloudflare`
- **Styling**: Tailwind CSS
- **UI components**: Shadcn (`.tsx` islands, `client:load`/`client:idle` only when required)

## Local Dev

```bash
bun install
bun run dev      # Astro dev server on :4321
```

Expects the API on `http://localhost:8787` (`bun run dev` in `apps/api`, against the local
`docker-compose.dev.yml` snapshot, never Neon).

## Environment Variables

| Variable | How to set |
|----------|-----------|
| `PUBLIC_API_URL` | `[vars]` in `apps/web/wrangler.toml` (it overrides the Pages dashboard: see `docs/deployment.md`) |

For local dev, create `.env` from `.env.example` (`PUBLIC_API_URL=http://localhost:8787`):
```bash
cp .env.example .env
```

## Build, Check, Test

```bash
bun run build      # production build: catches TypeScript errors
bun run typecheck  # astro check
bun run lint       # eslint, incl. the tiered max-lines budget (pages 300 / components 250 / other 200)
bun run test       # Vitest + MSW (tests/unit/)
```

`typecheck` and `lint` also run in the pre-commit hook and in CI. E2E smoke tests live in `apps/e2e/`.

## Pages

| Route | Data source |
|-------|------------|
| `/` | Home hub: `GET /api/races?year=N`, `/api/predictions/upcoming`, standings, title odds, last race + recap |
| `/prediction` | `GET /api/predictions/upcoming` (+ sprint, model standings); `?tab=scorecard`: history + accuracy |
| `/prediction/[id]` · `/prediction/sprint/[id]` | `GET /api/predictions/race/:id` · `GET /api/sprint/race/:id` |
| `/races` | `GET /api/races?year=N` |
| `/races/[id]` · `/races/[id]/sprint` | `GET /api/races/:id` (+ long runs, strategy, race events) · `GET /api/sprint/race/:id/detail` |
| `/races/[id]/race-story` | `GET /api/races/:id/race-story` |
| `/races/[id]/telemetry` | `GET /api/races/:id/telemetry` |
| `/circuits` · `/circuits/[key]` | `GET /api/races/circuits` · `GET /api/races/circuit/:key` (+ `/telemetry`) |
| `/drivers` · `/drivers/[id]` | `GET /api/drivers/standings?year=N` · `GET /api/drivers/:id?year=N` (+ teammate battle, career, model tabs) |
| `/teams` · `/teams/[id]` | `GET /api/teams/standings?year=N` · `GET /api/teams/:id?year=N` (+ pit crew, history tabs) |
| `/compare/drivers` · `/compare/teams` | season lists in frontmatter; the compare island fetches the pair client-side |
| `/history` | `GET /api/history/records` (+ milestones, on this day, lineage tabs) |
| `/docs` · `/docs/[slug]` | Astro content collection over `docs/` |
| `/health-quality` | `GET /api/quality?year=N`: dev-only |

## Rules

- All data fetching happens in Astro frontmatter (`---` blocks): never in client islands. The only
  exceptions are `GlobalSearch`, `DriverCompareTool` and `TeamCompareTool` (data depends on user input)
- Pages with tabs or fallbacks load through a page-data loader (`features/<area>/load*PageData.ts`)
- No chart libraries: `LapChart.astro` uses plain SVG
- No heavy animation libraries
- `.astro` components for display; `.tsx` for interactive Shadcn islands

## Deploy

Push to GitHub: Cloudflare Pages deploys automatically. Never run `wrangler pages deploy` directly.
