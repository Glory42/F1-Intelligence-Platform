---
title: "Frontend"
description: "Astro SSR app, routing, the server-only data-fetch rule, component layout, and styling"
order: 5.5
---

# Frontend

The `apps/web/` app is [Astro](https://astro.build) in SSR mode (`output: 'server'`) on the
Cloudflare adapter, deployed to Cloudflare Pages. React is available as an island renderer
(`@astrojs/react`) but is used sparingly: most of the UI is `.astro`.

## Stack

| Concern | Choice |
|---|---|
| Framework | Astro `output: 'server'`, `@astrojs/cloudflare` adapter |
| Islands | React 18 via `@astrojs/react`: only where interactivity is required |
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

### Page-data loaders

Pages with tabs, fallbacks or shaping keep that logic out of frontmatter: a loader in
`features/<area>/` takes the request URL (and `now`, so tests can pin the date) and returns a typed
view model; the page destructures it and only renders. The loader is still called from frontmatter,
so fetching stays server-side.

| Loader | Page | Owns |
|---|---|---|
| `drivers/loadDriverPageData` | `/drivers/[id]` | career-year resolution, active-tab fetch (teammate / career / model), headshot/titles/flag, season links |
| `teams/loadTeamPageData` | `/teams/[id]` | career-year resolution, active-tab fetch (standings / pit crew / history), teammate head-to-head rows, season links |
| `races/loadRacePageData(kind)` | `/races/[id]` + `/races/[id]/sprint` | status badge, visible tabs, prediction verdict, hero data; GP vs sprint differences live in one descriptor (`races/raceSessionBehaviour.ts`) |
| `history/loadHistoryPageData` | `/history` | per-tab fetch, leaderboard rows, headline tiles, on-this-day date, lineage start year |
| `predictions/buildPredictionPageData(kind)` | `/prediction/[id]` + `/prediction/sprint/[id]` | prediction + detail fetch, winner, breakdown |

Each loader degrades optional data to typed empties (`null` / `[]`) and reports a missing main
resource as `error`, never a throw. Career-year resolution (requested season if they raced in it,
else this season, else their last) is `lib/careerYear.ts`; season links keep the open tab through
`seasonTabHref` in `lib/pageTabs.ts`.

### The three sanctioned client-fetch exceptions

Client-side fetching is allowed **only** for UI whose data depends on arbitrary user input at view
time, so it can't be pre-rendered into frontmatter:

| Component | Directive | Why it fetches client-side |
|---|---|---|
| `features/search/components/GlobalSearch.tsx` | `client:idle` | live search query |
| `features/compare/components/DriverCompareTool.tsx` | `client:load` | arbitrary driver pair × year, picked on demand |
| `features/compare/components/TeamCompareTool.tsx` | `client:load` | arbitrary team pair × year, picked on demand |

These are the only client-side `fetch` calls in the app, and the only reason the e2e fixture server
sends CORS headers. Any *new* client fetch must fit the same shape: data genuinely unknowable until
the user interacts. If it's knowable at request time (a circuit's coordinates, a fixed list), it
belongs in frontmatter. `CircuitsGrid.tsx` is `client:load` but only for filtering/sorting a list
already passed in as a prop: it does not fetch. Nor does `TitleWhatIf.tsx` (`client:idle`, title-fight
tab): standings, finish counts and the remaining rounds come in as props and it only re-scores them.

## The API client

`src/lib/api.ts` is the single place any `fetch` to the API happens. Every page imports `api` and
calls a named method: never a raw `fetch`. `get<T>()` unwraps the `{ data, error }` envelope and
throws on `error` or a non-2xx status, so callers get `T` directly. Response types come from
`@/types`.

## Directory layout

```
src/
├── pages/              file-based routes: one .astro per URL, frontmatter fetches + composes
├── layouts/            BaseLayout (app chrome)
├── components/         generic, cross-feature only: grouped by role
│   ├── layout/         Sidebar, MobileNav, NavGroups, Footer, nav model
│   ├── page/           page chrome: PageHeader, PageTabs, TabIntro, SectionKicker, EmptyState, YearSelect(Links)
│   ├── data/           data display: DataList/DataRow, StatTiles, RankCell, HeadToHead, LineChart (+ chartScale, labelLayout), LocalTime
│   ├── identity/       DriverIdentity, TeamIdentity
│   └── ui/             Shadcn primitives (table, search-select)
├── features/           domain UI, grouped by area (one per sidebar section, plus docs, search, standings, telemetry)
│   └── <area>/
│       ├── components/ the area's .astro / .tsx pieces
│       └── *.ts        pure logic, hooks and page-data loaders (compareStats, useCompareController, loadRacePageData, …)
├── lib/                app plumbing: api client, utils, site, pageTabs, careerYear, sidebarState, legacyRedirects
│   └── f1/             F1 reference data and maths shared by features: teamColors, teamLogos, countryFlags,
│                       championshipMath, predictionMath, predictionTerms, tyres
├── types/            API response types: each file re-exports apps/api common/types/ (type-only), index.ts barrel
├── content/config.ts   Astro content collection for docs/ (globs ../../docs, minus adr/ and plans/)
└── styles/globals.css  Tailwind base + CSS custom properties
```

Rule of thumb: **domain UI lives in `features/<area>/`; `components/` is only for pieces used across
unrelated areas.** A helper used by one feature stays in that feature; promote to `lib/` only when a
second unrelated feature needs it.

## Navigation and page tabs

- **Sidebar**: `Sidebar.astro` on `md+`, `MobileNav.astro` (top bar + drawer) below; both render `NavGroups`
  from `navLinks.ts`. Two groups: **Season** (home, calendar, drivers, teams, predictions) and **Explore**
  (circuits, compare, history). Compare (`/compare/drivers`, `/compare/teams`) and History (`/history`) are their
  own sections; `activeDestination()` picks the longest owned prefix. Collapse state lives in the `sidebar` cookie (`lib/sidebarState.ts`) so the
  server renders the right width on first paint.
- **One question per page**: each page leads with one main view; everything else is a `?tab=` link tab
  (`PageTabs.astro`, `resolveTab`/`tabHref` in `lib/pageTabs.ts`). The default tab keeps the plain URL, other
  params (e.g. `year`) are preserved, and the frontmatter fetches only what the open tab needs. A tab can
  point at its own route instead (`href`: Compare's Drivers/Teams). `TabIntro.astro` opens a tab with a one-line
  lead-in and optional term definitions (racecraft, title odds, pit crews, teammate battle, …).
- **Compare layout**: `CompareLayout.tsx`: head-to-head stats on the left, a sticky panel on the right with
  the two pickers, season/career controls and both entity cards (A/B badges match the stat columns, so
  team-mates with the same colour stay tellable apart). Stacks panel-first below `lg`.
- **Season picker**: `YearSelect` in `PageHeader`'s `aside` slot, `?year=` in the URL, default current season.
  Tabbed pages pass `hrefFor` built with `seasonTabHref`, so switching season keeps the open tab and the default
  tab keeps the plain URL.
- **Retired URLs**: `/prediction/recap[/year]` 301s to the Predictions Scorecard tab; `/compare`, `/drivers/compare`,
  `/teams/compare` and `/records` 301 to their new pages, query string kept (`src/middleware.ts` + `lib/legacyRedirects.ts`).

## Routes

| Route | Data source (per `?tab=` where the page has tabs) |
|---|---|
| `/` | `races?year=` + `predictions/upcoming` + `races/:id` + `races/:id/recap` + `predictions/history?year=` + `drivers/standings` + `teams/standings` + `predictions/title-odds`: season progress strip, next race, last race, championship top 5 |
| `/prediction` | Upcoming tab: `predictions/upcoming` + `sprint/upcoming` + `predictions/standings` · Scorecard tab: `predictions/history?year=` + `predictions/accuracy` |
| `/prediction/[id]` | `predictions/race/:id` |
| `/prediction/sprint/[id]` | `sprint/race/:id` |
| `/races` · `/races/[id]` · `/races/[id]/sprint` | `races?year=` · `races/:id` + `predictions/race/:id` + `races/:id/long-runs` (Long Runs tab) + `races/circuit/:key` + `strategy` (+ `strategy-insights`) / `race-control` / `overtakes` / `team-radio` (each tab shown only when it has data) · `sprint/race/:id/detail` |
| `/races/[id]/race-story` | `races/:id/race-story` (`?session=sprint` for the sprint) |
| `/races/[id]/telemetry` | `races/:id/telemetry?session=&a=&b=`: drivers picked with a plain GET form |
| `/circuits` · `/circuits/[key]` | `races/circuits` · `races/circuit/:key` (Overview / Winners / Dominance tabs) + `races/circuit/:key/telemetry` (Telemetry tab) |
| `/drivers` | Standings / Title fight / Racecraft tabs: `drivers/standings` · `predictions/title-odds` · `drivers/racecraft` |
| `/drivers/[id]` | Season: `drivers/:id?year=` · Teammate: `drivers/:id/teammate-battle` · Career: `drivers/:id/career` + `drivers/:id/history` · Model: `predictions/history` |
| `/teams` | Standings / Title odds / Pit crews tabs: `teams/standings` · `predictions/title-odds` + `teams/standings` + `races` (clinch sentence) · `teams/pit-stops` |
| `/teams/[id]` | Season: `teams/:id?year=` · Pit crew: `teams/pit-stops` + `teams/:id/pit-stops` · History: `teams/:id/career` + `teams/:id/history` |
| `/compare/drivers` · `/compare/teams` | `seasons` + `drivers?year=` / `teams?year=` + `search` in frontmatter; the compare island then fetches `:id?year=` / `:id/career` client-side |
| `/history` | Records: `history/records` · Milestones: `history/milestones` · On this day: `history/on-this-day?date=MM-DD` (`?date=` param, nearest-day fallback) · Lineage: `history/lineages` |
| `/docs` · `/docs/[slug]` | Astro content collection (`prerender = true`) |
| `/health-quality` | `quality?year=`: dev-only, 404-guarded outside `import.meta.env.DEV` |
| `/calendar.ics` | `races?year=` for this season and the next: every Sprint Qualifying, Sprint, Qualifying and Race start as an RFC 5545 feed (`lib/icalendar.ts`), linked from `/races` as `webcal://` and Google Calendar. No practice sessions: they aren't stored. 503 rather than an empty feed if this season can't be read, so subscribers never lose their events. Edge-cached like a page |
| `/sitemap-dynamic.xml` | `races?year=` + `predictions/history?year=` + `drivers?year=` + `teams?year=` + `races/circuits`: the current season's detail pages, which the build-time `@astrojs/sitemap` can't list (`customSitemaps` adds it to `sitemap-index.xml`). Edge-cached like a page |

Year-scoped pages read `?year=` from `Astro.url.searchParams`, defaulting to the current year;
`YearSelect` / `RaceYearSelect` navigate by changing that param.

## Component conventions

- **`.astro` for display, `.tsx` for interactive islands.** Prefer `.astro`.
- A `client:*` directive is added **only** when interactivity is strictly required. Current islands:
  `GlobalSearch` / `TitleWhatIf` (`client:idle`), `DriverCompareTool` / `TeamCompareTool` / `CircuitsGrid`
  (`client:load`). Everything else is server-rendered.
- React hooks correctness is linted (`react-hooks/rules-of-hooks` error, `exhaustive-deps` warn).
- **Charts are images with words.** Each chart `<svg>` has `role="img"` and an `aria-label`; `LineChart`
  adds a `<desc>` with every line's last value, and dashes a line whose colour repeats (team-mates share a
  team colour), so nothing relies on colour alone. End-of-line labels name each line directly.
- No chart libraries: charts are hand-rolled SVG (`LapChart.astro`, `CalibrationChart.astro`,
  `DriverRadarCompare.astro`). No heavy animation libraries.
- Small co-located `<script>` blocks in `.astro` files are fine for view-local behaviour
  (tab toggles, countdowns: see `features/races/raceTabs.ts`).
- **Times go through `<LocalTime datetime format>`** (`components/data/`), never `toLocaleString()` in
  frontmatter, which formats in the Worker's zone. The server writes UTC with a "UTC" label; one script in
  `BaseLayout` rewrites every `time[data-local-time]` into the visitor's zone on each `astro:page-load`.
  A bare `YYYY-MM-DD` stays as it is: it's a calendar day, not an instant.

## Styling

Tailwind for everything; the dark theme is fixed (`<html class="dark">`), colour tokens are CSS
custom properties in `styles/globals.css`. `lib/f1/teamColors.ts` and `lib/f1/teamLogos.ts` map a
`team_key` to an official hex colour / static logo path under `public/teams/`.

Text meets WCAG AA (4.5:1) on the black page, and the axe smoke test enforces it:
- Secondary text is `text-muted-foreground` at full strength (5.8:1), never `/40`–`/70`.
- Kickers (`./section` labels) use the accent at full colour, not a translucent tint.
- Text in a team colour goes through `readableOnBlack()`, which lightens dark team colours just
  enough. Lines, dots and bars keep the official colour.
- Purely decorative text (watermarks) is drawn with CSS `content`, so it isn't read or checked.

## File-size budget

`eslint.config.js` enforces a tiered `max-lines` (`error`, blank lines and comments excluded), run
via `bun run lint`, in CI and in the pre-commit hook (`lint-staged`):

| Glob | Budget |
|---|---:|
| `src/pages/**`, `src/layouts/**` (`.astro`) | 300 |
| `src/**/components/**` (`.astro`, `.tsx`) | 250 |
| default `src/**` (`.ts`, `.tsx`, `.astro`) | 200 |
| `src/types/**`, `tests/**`, `*.config.*` | off |

When a page or component grows past its budget, extract sections into `features/<area>/components/`
rather than raising the limit. (`apps/api` has its own parallel budget: see `apps/api/README.md` and
`apps/api/eslint.config.js`.)

## Types

`src/types/` holds the API response types, one file per domain behind an `index.ts` barrel (import
from `@/types`). Each file re-exports the matching `apps/api/src/common/types/` file by relative path,
type-only (`export type * from '../../../api/src/common/types/…'`): the API owns the contract, so a
response change is made once there and `astro check` (and the e2e fixtures' `tsc`) fail wherever the web
or its fixtures disagree. No workspace or package is involved; type-only imports are erased at build.
The one web-defined response type is `GlobalSearchResponse` (`types/search.ts`), because `/api/search`
builds its shape inline. Feature-only view models stay in that feature's `types.ts`.
The web keeps no copy of either model's weights or labels: every Prediction carries `featureInfo` (label, short
label, importance) and each driver's per-feature contributions, for the GP and sprint alike, so
`buildPredictionPageData` turns both into the same view and only the driver table's pace column differs.

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
