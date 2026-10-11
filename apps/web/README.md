# Web: Astro SSR on Cloudflare Pages

Server-side rendered frontend for the F1 prediction platform.

## Stack

- **Framework**: Astro (`output: 'server'`)
- **Adapter**: `@astrojs/cloudflare`
- **Styling**: Tailwind CSS
- **UI components**: Shadcn (`.tsx` islands, `client:load` only when required)

## Local Dev

```bash
bun install
bun run dev      # Astro dev server on :4321
```

## Environment Variables

| Variable | How to set |
|----------|-----------|
| `PUBLIC_API_URL` | Cloudflare Pages env vars (e.g. `https://your-api.workers.dev`) |

For local dev, create `.env` from `.env.example`:
```bash
cp .env.example .env
```

## Build

```bash
bun run build    # production build: catches TypeScript errors
```

## Pages

| Route | Data source |
|-------|------------|
| `/` | Static (no API call) |
| `/prediction` | `GET /api/predictions/upcoming` |
| `/prediction/[id]` | `GET /api/predictions/race/:id` |
| `/races` | `GET /api/races?year=N` |
| `/races/[id]` | `GET /api/races/:id` |
| `/drivers` | `GET /api/drivers/standings?year=N` |
| `/drivers/[id]` | `GET /api/drivers/:id?year=N` |
| `/teams` | `GET /api/teams/standings?year=N` |
| `/teams/[id]` | `GET /api/teams/:id?year=N` |

## Rules

- All data fetching happens in Astro frontmatter (`---` blocks): never in client islands
- No chart libraries: `LapChart.astro` uses plain SVG
- No heavy animation libraries
- `.astro` components for display; `.tsx` for interactive Shadcn islands

## Deploy

Push to GitHub: Cloudflare Pages deploys automatically. Never run `wrangler pages deploy` directly.
