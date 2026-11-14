---
title: "Deployment"
description: "Cloudflare Pages, Workers, the Render worker, and environment variables"
order: 6
---

# Deployment

## Overview

| Layer | Platform | How it deploys |
|-------|----------|----------------|
| `apps/web/` | Cloudflare Pages | Push to `master` → GitHub integration auto-builds |
| `apps/api/` | Cloudflare Workers | Push to `master` → GitHub integration auto-builds |
| `data-engine/` | Render | Web Service running the worker loop (`python -m src.server`) |
| DB migrations | Neon | Manual: `bun run db:generate` + `bun run db:migrate` from `apps/api/` |

**Never run `wrangler deploy` or `bun run deploy` from the CLI.** Push to GitHub and let Cloudflare pick it up automatically.

---

## Environment Variables

### API: Cloudflare Workers Dashboard

| Variable | How to set | Notes |
|----------|-----------|-------|
| `DATABASE_URL` | Workers → Settings → Variables and Secrets → **Secret** | Neon connection string |

`keep_vars = true` is set in `apps/api/wrangler.toml` so deploys never erase dashboard-set variables.

Set this as a **Secret** (not plaintext) so it's encrypted at rest.

### Frontend: `apps/web/wrangler.toml` (not the Pages dashboard)

| Variable | How to set | Notes |
|----------|-----------|-------|
| `PUBLIC_API_URL` | `[vars]` in `apps/web/wrangler.toml` | The API's custom domain |
| `PUBLIC_OG_IMAGE_URL` | `[vars]` in `apps/web/wrangler.toml` | Public URL of the share-image bucket; unset = default image (see Share images) |

**This is set in the committed `wrangler.toml`, not the Cloudflare Pages dashboard.** A Pages
project's `wrangler.toml` `[vars]` block overrides whatever is set in Settings → Environment
Variables: setting `PUBLIC_API_URL` in the dashboard has no effect while this file also sets it.
(This is the opposite of `apps/api`, where secrets *are* dashboard-only: see below.)

It must match the custom domain in `apps/api/wrangler.toml`'s `routes`. The API's `workers.dev` address
is turned off (`workers_dev = false`), so there is no second URL to fall back to. Changing the domain in
`apps/api/wrangler.toml` does **not** update this value automatically; it's a separate file that silently
goes stale if you forget it (this happened for real with an earlier Worker rename, which left the old URL
here for months before anyone noticed the API calls were failing).

Pages configs don't support `keep_vars` (and don't need it for *secrets*: Pages deployments never
erase dashboard-set secrets), so `apps/web/wrangler.toml` omits it. `PUBLIC_API_URL` isn't a
secret, so it lives directly in this file instead of the dashboard either way.

### Data Engine: Render Dashboard

| Variable | How to set |
|----------|-----------|
| `DATABASE_URL` | Render → Service → Environment → Environment Variables |
| `DASHBOARD_PASSWORD` | Render → Service → Environment → Environment Variables |
| `DASHBOARD_USER` | Render → Service → Environment → Environment Variables (optional, defaults to `admin`) |

`DASHBOARD_PASSWORD` gates the live activity dashboard behind a login form at `/login` that sets a signed session cookie (7-day expiry, keyed on `DASHBOARD_PASSWORD`: rotating the password signs everyone out). Without it set, the dashboard returns 503 for everyone: the `HEAD` health-check endpoint used by UptimeRobot stays open regardless.

---

## CORS

The API allows requests only from `https://f1.gorkemkaryol.dev` in production. `http://localhost:4321` and `http://localhost:8787` are only allowed when the `ENVIRONMENT` var is not `"production"`, `wrangler.toml` sets `ENVIRONMENT = "production"` for the deployed Worker, and `.dev.vars` overrides it to `"development"` for local `wrangler dev`.

Configured in `apps/api/src/main.ts`. Only `GET` and `OPTIONS` methods are allowed.

---

## Security

### Response headers

- **Site** (`apps/web/src/lib/securityHeaders.ts`, applied in `src/middleware.ts` to every SSR response,
  edge-cache hits and redirects included): HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`,
  `Permissions-Policy`, and an enforced CSP limited to `frame-ancestors`, `base-uri`, `object-src` and
  `form-action`. Script, style, font, image and connect sources are in `Content-Security-Policy-Report-Only`:
  watch the browser console on each page type, and once it's clean for a week move them into the enforced
  header. Prerendered `/docs` pages and static assets are served by Pages directly and don't get these headers.
- **API** (`apps/api/src/main.ts`): `X-Content-Type-Options: nosniff` on every response.

### Cache keys

Neither cache keys on the raw URL, so padding a URL with extra params can't multiply Neon wakes or renders:
- **API:** each handler declares the query params it reads (`query: [...]` on the `common/route.ts`
  factories, `readsQuery([...], handler)` on hand-written ones). `edgeCache()` keys on those alone, in a fixed
  order (`common/query-params.ts`). Ids with leading zeros are rejected with 400.
- **Site:** a URL carrying a param no page reads (`PAGE_QUERY_PARAMS` in `apps/web/src/lib/pageQuery.ts`)
  is redirected (301) to the same URL without it, and the page cache keys on the params in a fixed order.

### Snapshot store (R2)

Behind the edge cache, `snapshotStore()` keeps one global copy of every public answer in the private R2
bucket `f1-api-snapshots` (binding `SNAPSHOTS` in `apps/api/wrangler.toml`), so Neon is read once per URL
per write window instead of once per data centre (ADR 0013). One-time setup, in R2 → `f1-api-snapshots`:
- **Public access:** leave it off (no `r2.dev` URL, no custom domain). Only the Worker reads it.
- **Settings → Object lifecycle rules → Add rule:** apply to the whole bucket, delete objects 90 days after
  upload. This removes old versions and re-reads every completed answer once a quarter.

**After a backfill, a manual job run or a manual F1DB import against Neon,** or a change to a response's
shape, bump `SNAPSHOT_VERSION` in `apps/api/wrangler.toml` (`2` → `3`, ...) and let the change deploy. It is part
of every edge-cache and R2 key, so the new deploy starts both caches empty. Scheduled writes (the worker's
race weekends, the Wednesday F1DB import) need nothing: copies only hold until the next of those windows opens.

R2 bills past its free allowance (1M writes, 10M reads, 10 GB a month) instead of refusing, so check
R2 → Overview after the first weeks. Answers from the store carry `x-snapshot: hit`.

### Dev-only routes

`GET /api/quality` and `GET /api/health/db` return 404 when `ENVIRONMENT = "production"`: both read Neon
uncached on every hit. `/api/health` (no DB) stays public for uptime checks.

### Rate limiting (Cloudflare dashboard, one-time)

Cloudflare's Free plan includes one rate-limiting rule. It's what stops a single client from walking through
cache misses (`/api/races/1`, `/api/races/2`, ...), which canonical keys can't. Set it up under the
`gorkemkaryol.dev` zone → Security → WAF → Rate limiting rules:

| Field | Value |
|---|---|
| Match | Hostname equals `f1-api.gorkemkaryol.dev` |
| Characteristics | IP |
| Rate | 100 requests per 10 seconds |
| Action | Block for 10 seconds |

The site's own server-side fetches come from Cloudflare's network, not a visitor's IP. Check the rule's
analytics after a race weekend and raise the rate if SSR fetches are ever blocked. Bot Fight Mode is left
off: it can challenge those same Worker-to-Worker requests.

---

### Share images (R2 + GitHub Action, one-time)

Per-race and per-prediction share images come from `.github/workflows/og-images.yml` (ADR 0016). Until
the steps below are done, the workflow skips itself and pages keep `/og-image.jpg`.

1. **R2 → Create bucket** `f1-og-images`, then under Settings turn on public access: either the
   `r2.dev` URL or a custom domain such as `og.f1.gorkemkaryol.dev`.
2. **API token:** My Profile → API Tokens → Create, with permission *Account → Workers R2 Storage → Edit*.
3. **GitHub → Settings → Secrets and variables → Actions:**
   - secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`;
   - variable `OG_PUBLIC_URL` set to the bucket's public URL;
   - variable `OG_BUCKET`, only if the bucket isn't called `f1-og-images`.
4. Run the workflow by hand once (Actions → og-images → Run workflow), and once more with `year` set to
   last season if you want that season too.
5. Set `PUBLIC_OG_IMAGE_URL` to the same public URL in `apps/web/wrangler.toml` and push, so pages start
   pointing at the images.

## First-Time Setup

### 1. Database

```bash
cd apps/api
bun install
# Set DATABASE_URL in your shell or .env
bun run db:migrate   # applies drizzle/migrations/ to Neon (the DB is migrate-tracked: don't db:push)
```

Then seed circuits and seasons:

```bash
cd data-engine
source venv/bin/activate
python -m src.main --job sync_schedule --year 2025
python -m src.main --job sync_season   --year 2025 --round 1
```

### 2. API (Cloudflare Workers)

1. Connect the `apps/api/` directory to a Cloudflare Worker via the GitHub integration in the
   Cloudflare dashboard (set "Root directory" to `apps/api`).
2. In the Worker's dashboard, add `DATABASE_URL` as a Secret.
3. Push to `master` to trigger the first deploy. `wrangler.toml`'s `routes` attaches the custom domain
   `f1-api.gorkemkaryol.dev`, which the edge cache needs: it does nothing on `*.workers.dev`.

### 3. Frontend (Cloudflare Pages)

1. Connect the `apps/web/` directory to Cloudflare Pages via the GitHub integration (set "Root
   directory" to `apps/web`).
2. Set build command: `bun run build`
3. Set output directory: `dist`
4. Set `PUBLIC_API_URL` in `apps/web/wrangler.toml`'s `[vars]` block (not the Pages dashboard:
   see the Environment Variables section above) to the API's custom domain, `https://f1-api.gorkemkaryol.dev`.
5. Push to `master` to trigger the first deploy.

### 4. Data Engine (Render)

1. Create a new Render service from the `data-engine/` directory.
2. Add `DATABASE_URL` and `DASHBOARD_PASSWORD` as environment variables, plus `NEON_API_KEY` and
   `NEON_PROJECT_ID` (listed in `render.yaml`) for the budget watchdog.
3. Configure as a **Web Service** (not a cron job) to utilize the free tier.
4. Set the Build Command: `pip install -r requirements.txt`
5. Set the Start Command: `python -m src.server`
   - Python is pinned to **3.12** via `data-engine/.python-version` (and `PYTHON_VERSION` in `render.yaml`). Don't let Render use its newer default: `numpy`/`pandas`/`psycopg2-binary` have no wheels there, so pip builds them from source and OOMs the 512 MB free instance.
6. **Important**: Since Render free tier web services spin down after 15 minutes of inactivity, set up an UptimeRobot HTTP monitor pointing to your Render URL (e.g. `https://f1-data-engine.onrender.com/`) to ping it every 5 minutes. This keeps the worker alive so it can check for newly published OpenF1/Jolpica session data automatically. The root URL only responds to `HEAD` for the uptime ping: navigating to it in a browser redirects to `/login`, where the `DASHBOARD_USER`/`DASHBOARD_PASSWORD` credentials unlock the live HTML dashboard of the engine's activities and logs.

   The worker is **schedule-gated** to keep Neon compute inside the free tier: it derives the current/next Grand Prix's race-weekend window purely from the FastF1 event schedule (no DB), runs `auto_runner.run_cycle` every ~20 min while inside that window, and every ~6 h otherwise. Outside a race weekend it never opens a Neon connection, so the database stays scaled to zero. Which jobs are due is decided by `src/weekend_pipeline.py` from each race's status. See `src/utils/schedule_window.py` and `auto_runner.poll_interval_for_window()`.

---

## Production Domain

Frontend: `https://f1.gorkemkaryol.dev` (custom domain on Cloudflare Pages)
API: `https://f1-api.gorkemkaryol.dev` (Workers custom domain, the only place the edge cache works).
`workers_dev = false`: the old `*.workers.dev` address is off, since every request there skipped the edge
cache and could wake Neon. `apps/web/wrangler.toml`'s `PUBLIC_API_URL` points at the custom domain.

---

## Local Development

Local dev never reads Neon: it uses a local copy (`docker-compose.dev.yml`), filled once from Neon
with one read-only dump:

```bash
cd data-engine && PROD_DATABASE_URL=postgresql://...neon.tech/... python scripts/dev_snapshot.py
```

Then point `apps/api/.dev.vars` at it (`DATABASE_URL=postgres://f1:f1@localhost:4446/f1_dev` and
`NEON_FETCH_ENDPOINT=http://localhost:4446/sql`), and `data-engine/.env` at
`postgresql://f1:f1@localhost:5435/f1_dev`. Scripts that must write production take
`DATABASE_URL=$PROD_DATABASE_URL` explicitly.

```bash
# All at once (from repo root)
bun run install:all
bun run dev

# API
cd apps/api
bun install
bun run dev        # starts on http://localhost:8787

# Frontend
cd apps/web
bun install
bun run dev        # starts on http://localhost:4321

# Data engine
cd data-engine
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # points at the local snapshot by default
```
