---
title: "Frontend"
description: "Astro SSR app — routing, the server-only data-fetch rule, component layout, and styling"
order: 5.5
---

# Frontend

The `apps/web/` app is [Astro](https://astro.build) in SSR mode (`output: 'server'`) on the
Cloudflare adapter, deployed to Cloudflare Pages. React is available as an island renderer
(`@astrojs/react`) but is used sparingly — most of the UI is `.astro`.

## Stack

| Concern | Choice |
|---|---|
| Framework | Astro `output: 'server'`, `@astrojs/cloudflare` adapter |
| Islands | React 18 via `@astrojs/react` — only where interactivity is required |
| Styling | Tailwind, dark theme fixed on `<html class="dark">` |
| Icons | `lucide-react` |
| Fonts | Sora + JetBrains Mono (Google Fonts, preconnected in `BaseLayout`) |
| Path alias | `@/*` → `src/*` (Vite + tsconfig) |
| Data | `PUBLIC_API_URL` → the Hono API; no other backends |

Entry points: `astro.config.mjs` (adapter, sitemap, Vite aliases), `src/layouts/BaseLayout.astro`
(document shell, `<head>`, Sidebar/MobileNav/Footer, view transitions), `src/middleware.ts`
(301s for retired URLs via `lib/legacyRedirects.ts`).

## Data fetching is server-side only

**All data fetching happens in Astro frontmatter (`---` blocks), never in a `client:*` island.**
Pages call the typed client in `src/lib/api.ts` and pass plain data down as props. A page fans its
calls out with `Promise.allSettled` and degrades per-slice on failure:

```astro
---
import { api } from '@/lib/api';

const year = Number(Astro.url.searchParams.get('year') ?? new Date().getFullYear());

let history: PredictionHistoryItem[] = [];
const [historyResult] = await Promise.allSettled([api.getPredictionHistory(year)]);
if (historyResult.status === 'fulfilled') history = historyResult.value;
---
```

### The three sanctioned client-fetch exceptions

Client-side fetching is allowed **only** for UI whose data depends on arbitrary user input at view
time, so it can't be pre-rendered into frontmatter:

| Component | Directive | Why it fetches client-side |
|---|---|---|
| `features/search/components/GlobalSearch.tsx` | `client:idle` | live search query |
| `features/compare/components/DriverCompareTool.tsx` | `client:load` | arbitrary driver pair × year, picked on demand |
| `features/compare/components/TeamCompareTool.tsx` | `client:load` | arbitrary team pair × year, picked on demand |

These are the only client-side `fetch` calls in the app, and the only reason the e2e fixture server
sends CORS headers. Any *new* client fetch must fit the same shape — data genuinely unknowable until
the user interacts. If it's knowable at request time (a circuit's coordinates, a fixed list), it
belongs in frontmatter. `CircuitsGrid.tsx` is `client:load` but only for filtering/sorting a list
already passed in as a prop — it does not fetch.

## The API client

`src/lib/api.ts` is the single place any `fetch` to the API happens. Every page imports `api` and
calls a named method — never a raw `fetch`. `get<T>()` unwraps the `{ data, error }` envelope and
throws on `error` or a non-2xx status, so callers get `T` directly. Response types come from
`src/types/index.ts`.

## Directory layout

```
src/
├── pages/              file-based routes — one .astro per URL, frontmatter fetches + composes
├── layouts/            BaseLayout (app chrome)
├── components/         generic, cross-feature only
│   ├── layout/         Sidebar, MobileNav, NavGroups, Footer, nav model
│   ├── shared/         PageHeader, PageTabs, EmptyState, YearSelect, ConfidenceBadge, …
│   ├── docs/           OnThisPage TOC
│   └── ui/             Shadcn primitives (badge, button, card, table, search-select)
├── features/           domain UI, grouped by area
│   └── <area>/
│       ├── components/ the area's .astro / .tsx pieces
│       └── *.ts        pure logic + hooks (compareStats, useCompareController, raceTabs, …)
├── lib/                truly cross-feature helpers (api, teamColors, teamLogos, predictionMath, utils)
├── types/index.ts      all TypeScript types in one file
├── content/config.ts   Astro content collection for docs/ (globs ../../docs, minus adr/)
└── styles/globals.css  Tailwind base + CSS custom properties
```

Rule of thumb: **domain UI lives in `features/<area>/`; `components/` is only for pieces used across
unrelated areas.** A helper used by one feature stays in that feature; promote to `lib/` only when a
second unrelated feature needs it.

## Navigation and page tabs

- **Sidebar** — `Sidebar.astro` on `md+`, `MobileNav.astro` (top bar + drawer) below; both render `NavGroups`
  from `navLinks.ts`. Two groups: **Season** (home, calendar, drivers, teams, predictions) and **Explore**
  (circuits, compare, history). `activeDestination()` picks the longest owned prefix, so `/drivers/compare`
  lights Compare, not Drivers. Collapse state lives in the `sidebar` cookie (`lib/sidebarState.ts`) so the
  server renders the right width on first paint.
- **One question per page** — each page leads with one main view; everything else is a `?tab=` link tab
  (`PageTabs.astro`, `resolveTab`/`tabHref` in `lib/pageTabs.ts`). The default tab keeps the plain URL, other
  params (e.g. `year`) are preserved, and the frontmatter fetches only what the open tab needs. A tab can
  point at its own route instead (`href` — Compare's Drivers/Teams). `TabIntro.astro` opens a tab with a one-line
  lead-in and optional term definitions (racecraft, title odds, pit crews, teammate battle, …).
- **Compare layout** — `CompareLayout.tsx`: head-to-head stats on the left, a sticky panel on the right with
  the two pickers, season/career controls and both entity cards (A/B badges match the stat columns, so
  team-mates with the same colour stay tellable apart). Stacks panel-first below `lg`.
- **Season picker** — `YearSelect` in `PageHeader`'s `aside` slot, `?year=` in the URL, default current season.
- **Retired URLs** — `/prediction/recap[/year]` 301s to the Predictions Scorecard tab (`src/middleware.ts`).

## Routes

| Route | Data source (per `?tab=` where the page has tabs) |
|---|---|
| `/` | `races?year=` + `predictions/upcoming` + `races/:id` + `races/:id/recap` + `predictions/history?year=` + `drivers/standings` + `teams/standings` + `predictions/title-odds` — season progress strip, next race, last race, championship top 5 |
| `/prediction` | Upcoming tab: `predictions/upcoming` + `sprint/upcoming` + `predictions/standings` · Scorecard tab: `predictions/history?year=` + `predictions/accuracy` |
| `/prediction/[id]` | `predictions/race/:id` |
| `/prediction/sprint/[id]` | `sprint/race/:id` |
| `/races` · `/races/[id]` · `/races/[id]/sprint` | `races?year=` · `races/:id` + per tab `strategy` / `race-control` / `overtakes` / `team-radio` / `predictions/race/:id` / `races/circuit/:key` · `sprint/race/:id/detail` |
| `/races/[id]/race-story` | `races/:id/race-story` (`?session=sprint` for the sprint) |
| `/races/[id]/telemetry` | `races/:id/telemetry?session=&a=&b=` — drivers picked with a plain GET form |
| `/circuits` · `/circuits/[key]` | `races/circuits` · `races/circuit/:key` (Overview / Winners / Dominance tabs) + `races/circuit/:key/telemetry` (Telemetry tab) |
| `/drivers` | Standings / Title fight / Racecraft tabs: `drivers/standings` · `predictions/title-odds` · `drivers/racecraft` |
| `/drivers/[id]` | Season: `drivers/:id?year=` · Teammate: `drivers/:id/teammate-battle` · Career: `drivers/:id/career` + `drivers/:id/history` · Model: `predictions/history` |
| `/teams` | Standings / Title odds / Pit crews tabs: `teams/standings` · `predictions/title-odds` · `teams/pit-stops` |
| `/teams/[id]` | Season: `teams/:id?year=` · Pit crew: `teams/pit-stops` + `teams/:id/pit-stops` · History: `teams/:id/career` + `teams/:id/history` |
| `/drivers/compare` · `/teams/compare` | `seasons` + `drivers?year=` / `teams?year=` + `search` in frontmatter; the compare island then fetches `:id?year=` / `:id/career` client-side |
| `/records` (History) | Records: `history/records` · Milestones: `history/milestones` · On this day: `history/on-this-day?date=MM-DD` (`?date=` param, nearest-day fallback) · Lineage: `history/lineages` |
| `/docs` · `/docs/[slug]` | Astro content collection (`prerender = true`) |
| `/health-quality` | `quality?year=` — dev-only, 404-guarded outside `import.meta.env.DEV` |

Year-scoped pages read `?year=` from `Astro.url.searchParams`, defaulting to the current year;
`YearSelect` / `RaceYearSelect` navigate by changing that param.

## Component conventions

- **`.astro` for display, `.tsx` for interactive islands.** Prefer `.astro`.
- A `client:*` directive is added **only** when interactivity is strictly required. Current islands:
  `GlobalSearch` (`client:idle`), `DriverCompareTool` / `TeamCompareTool` / `CircuitsGrid`
  (`client:load`). Everything else is server-rendered.
- React hooks correctness is linted (`react-hooks/rules-of-hooks` error, `exhaustive-deps` warn).
- No chart libraries — charts are hand-rolled SVG (`LapChart.astro`, `CalibrationChart.astro`,
  `DriverRadarCompare.astro`). No heavy animation libraries.
- Small co-located `<script>` blocks in `.astro` files are fine for view-local behaviour
  (tab toggles, countdowns — see `features/races/raceTabs.ts`).

## Styling

Tailwind for everything; the dark theme is fixed (`<html class="dark">`), colour tokens are CSS
custom properties in `styles/globals.css`. `lib/teamColors.ts` and `lib/teamLogos.ts` map a
`team_key` to an official hex colour / static logo path under `public/teams/`.

## File-size budget

`eslint.config.js` enforces a tiered `max-lines` (`error`, blank lines and comments excluded), run
via `bun run lint` and in CI:

| Glob | Budget |
|---|---:|
| `src/pages/**`, `src/layouts/**` (`.astro`) | 300 |
| `src/**/components/**` (`.astro`, `.tsx`) | 250 |
| default `src/**` (`.ts`, `.tsx`, `.astro`) | 200 |
| `src/types/**`, `tests/**`, `*.config.*` | off |

When a page or component grows past its budget, extract sections into `features/<area>/components/`
rather than raising the limit. (`apps/api` has its own parallel budget — see the Testing doc and
`apps/api/eslint.config.js`.)

## Types

`src/types/index.ts` holds **all** frontend types in one file. It is a hand-maintained mirror of the
API's response shapes (`apps/api/src/common/types/`) — the two are separate files and can drift, so
when an endpoint's response changes, update both. Same applies to `lib/predictionMath.ts`, whose
`GP_WEIGHTS` / `SPRINT_WEIGHTS` are hand-copied from the Python model.

## Local development

```bash
cd apps/web
bun install
bun run dev          # astro dev on :4321
bun run build        # production build (also the CI gate)
bun run typecheck    # astro check
bun run lint         # eslint (max-lines)
```

`bun run dev` from the repo root runs `apps/web` and `apps/api` together. The web app expects
`PUBLIC_API_URL` pointing at a running API (`http://localhost:8787` by default).
