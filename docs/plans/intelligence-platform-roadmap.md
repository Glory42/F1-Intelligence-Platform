# F1 Intelligence Platform — Roadmap

Goal: grow the site from a race-winner predictor into an F1 analysis platform, with no big-bang redesign.
Two hard constraints shape every item:

1. **Test-driven.** Every slice is red → green at an agreed seam (§3). No production code without a failing test first.
2. **Free tiers only.** Neon Free and Render Free must never be exceeded (§1–§2). Each slice states its budget cost.

Status: **implemented on branch `feat/intelligence-platform` (2026-10-10).** Decisions D1–D8 taken as
recommended; brand `F1 Intelligence Platform`.

## Implementation status

| Phase | Status | Notes / deviations |
|---|---|---|
| 0 Foundations | ✅ | Tests on local Postgres (ADR 0003); storage guard; quiet worker cycles; edge cache (ADR 0005); OpenF1 pacing/budget (ADR 0004); session-key cache; peak-RSS logs; chart kit; tyre tokens; shared race tabs + GP↔Sprint switcher; rebrand. Sprint page fetch stays sequential — the circuit lookup genuinely needs the sprint detail first. |
| 1 Strategy & pits | ✅ | `session_type` on race events (ADR 0006); stints + pit stops; strategy tab (derived pre-2023); pit-crew rankings; Friday pace; 2026 radio empty state. Strategy is an in-page tab (small payload), not a sub-route. |
| 2 Analysis | ✅ | Title odds (ADR 0007), contention maths, teammate battles, racecraft (API aggregate, no new columns). No lap-1 split — OpenF1 overtakes carry no lap number. |
| 3 Race story | ✅ | Lap traces, battles, weather from FastF1 full laps; grid drops from existing data (no `/starting_grid` needed). All FastF1 runners now load with no DB connection held. |
| 4 Telemetry | ✅ | Resumable OpenF1 ingest (ADR 0008); server-rendered comparison; circuit outline derived in the API from the latest pole lap (no new column). |
| 5 History | ✅ | Scoped F1DB import (~700 KB): bios, totals, milestones, chassis/engine lineage. Local-only import script (not in the worker — Render RAM). "On this day" uses core 1980+ races. Later: History page split into Records (headline tiles, record chases, strike rates, min 50 starts) / Milestones / On this day (date stepping, nearest-day fallback) / Lineage (F1DB chronology as a team family timeline) — `history/milestones` + `history/lineages`, no new tables. |
| 6 Home hub | ✅ | Last-race recap, championship card, on this day, next-session countdown. Later: season progress strip, next race with schedule + model top 3, last-race podium, championship top 5 with title odds. |
| 7 Model v4 | ⛔ rejected | Measured overtake rate backtested over 208 races: no gain (`docs/prediction-model.md`). SC/VSC split and wet pace not built — deferred until a candidate shows promise. |
| N4 skip-unchanged upserts | ✅ | `IS DISTINCT FROM` guard in `utils/upsert.py`, verified against local Postgres. |

### Actions only the owner can take
1. Apply migrations 0019–0026 to Neon (`cd apps/api && bun run db:migrate`) before deploying — all additive.
2. Neon console: cap compute autoscaling (prod 0.25→0.5 CU, test 0.25 fixed) — D8/N1.
3. Record the usage baseline (§7): Neon CU-h + egress, Render hours + bandwidth.
4. Attach the API Worker to a custom domain and point `PUBLIC_API_URL` at it — the edge cache is a no-op on `*.workers.dev`.
5. Run local backfills: `backfill_openf1.py ingest_stints|ingest_pit_stops|ingest_qualifying_telemetry 2023 2026`,
   `backfill_race_story.py 2018 2025`, `import_f1db.py`, `--job compute_title_odds --year Y`.
6. Delete the now-unused Neon test branch and the `TEST_DATABASE_URL` GitHub secret.
7. Decide on the pre-existing standings bug: `driver_season_stats.total_points` / championship position ignore sprint points.

---

## 1. Free-tier limits and current usage

### Neon Free (per project; the test branch shares the same quotas)
| Limit | Value | What happens when exceeded |
|---|---|---|
| Storage | **1 GB** per project | Inserts/updates/deletes **fail** until space is freed |
| Compute | **100 CU-hours / month** (= 400 h at 0.25 CU) | Compute **suspended until next month** — site and ETL go down |
| Egress | **5 GB / month** (all reads leaving Neon) | Compute **suspended until next month** |
| Scale to zero | after 5 min idle (can't disable) | — every wake costs ≥ 5 min of compute |
| Branches | 10 | Branch creation fails |
| History | 6 h restore window, capped at 1 GB-month of changes | — |

**Measured 2026-10-10 (read-only queries):**
- Production DB: **70 MB (7 % of 1 GB)**. `lap_times` is 42 MB of it (174k rows, ~250 B/row including indexes). Every other table is ≤ 3.6 MB.
- Test branch: 9 MB.
- `max_connections = 901`, which corresponds to a 2 CU maximum. **The compute is probably allowed to autoscale to 2 CU**, which burns CU-hours 8× faster than 0.25 CU. Verify in the console (§2 rule N1).
- Not measurable without the console: CU-hours used this month and egress. **Record both as a baseline before Phase 0 ships** (slice 0.0).

**Where compute goes today:**
- The worker (`auto_runner.run_cycle`) touches the DB **only inside a race-weekend window** (first session − 1 h to race + 24 h, ≈ 75 h). Inside the window it polls every 20 min, so each poll wakes compute for ≥ 5 min. That's ≈ 19 h awake per weekend, ≈ 5 CU-h at 0.25 CU, up to ≈ 20 CU-h/month in a 4-race month.
- API traffic from the site: every response not cached at the edge wakes compute.
- `apps/api` integration tests run against the Neon test branch. CI runs `db:migrate` plus tests on every push and PR. **TDD multiplies test runs**, so this is the cost the new workflow would grow the most (rule N6).

### Render Free (web service `f1-data-engine`)
| Limit | Value | Consequence for us |
|---|---|---|
| RAM | **512 MB** | FastF1 session loads are the peak. Never hold two sessions at once |
| CPU | 0.1 | Heavy maths must be vectorised and bounded |
| Instance hours | **750 h / month per workspace** | UptimeRobot keeps the service awake 24/7 (≈ 744 h). **No room for a second free service** |
| Outbound bandwidth | **5 GB / month** (Hobby workspace) | Mostly our SQL writes to Neon. Overage without a card suspends free services |
| Pipeline minutes | 500 / month | Each deploy builds numpy/pandas. Fine at current deploy rate |
| Disk | Ephemeral | FastF1 cache and any downloads vanish on restart |
| Spin-down | 15 min without inbound traffic | Already handled by UptimeRobot pings (`/` → login redirect, no DB) |

### Other external limits
- **OpenF1:** free history from 2023 on, about 3 req/s and 30 req/min (third-party figure, unverified). Live data is paid.
- **Cloudflare Workers Free:** 100k requests/day. Client-side fetches count against this.

---

## 2. Budget rules — every slice must follow these

**Neon**
- **N1 — Cap compute size.** Set the production branch to autoscale 0.25 → 0.5 CU max, and the test branch to a fixed 0.25 CU. One-time console change, done before any new job ships.
- **N2 — Connect late, close early.** Fetch and transform outside the DB connection; open it only for the write. Never hold a connection while waiting on FastF1 or OpenF1 HTTP.
- **N3 — No new wake-ups.** New steps ride the existing cycle inside the race-weekend window. Nothing new polls outside it.
- **N4 — Skip unchanged writes.** Upserts use `ON CONFLICT … DO UPDATE … WHERE (cols) IS DISTINCT FROM (excluded cols)`. Retries that rewrite a whole race every 20 min then stop creating dead tuples and history.
- **N5 — Compact storage.** Data that is always read as a whole race goes in one row per (race, session, driver) with arrays or JSONB, not one row per lap or sample (§5). TOAST compresses large values for free.
- **N6 — Tests never touch Neon.** Run `apps/api` integration tests against local Postgres behind a Neon HTTP proxy, locally and in CI (decision D7). Python, web and e2e tests are already DB-free.
- **N7 — Storage guard.** `storage_guard` reads `pg_database_size()` once per cycle and decides:
  - < 50 % (500 MB): allow everything;
  - 50–75 %: block backfills and optional feature tables;
  - > 75 %: core pipeline only (results, features, predictions).
  The decision appears on `/health-quality`.

**Egress (Neon 5 GB)**
- **E1 — Edge-cache completed races.** Data for a completed race never changes. Every new heavy route uses the existing `cacheControlForStatus`. Slice 0.4 verifies Cloudflare actually caches (`cf-cache-status: HIT`); if not, add `caches.default` in the Worker for completed-race responses.
- **E2 — Payload ceilings.** Targets for one completed race (gzip ≈ 5× smaller on the wire):

  | Route | Max size |
  |---|---|
  | strategy | 15 KB |
  | race story | 40 KB |
  | telemetry pair | 60 KB |
  | title odds | 20 KB |

  Telemetry returns only the two requested drivers.

**Render**
- **R1 — One process.** All new jobs live in the existing worker. No new Render services.
- **R2 — Memory headroom.** Each step logs peak RSS (`resource.getrusage`) in its structured log line. A step that peaks above 400 MB gets fixed before more work is added to it. FastF1 sessions are released (`del` + `gc.collect()`) before the next step.
- **R3 — Backfills run locally**, never on Render: in bounded chunks (one season per run), each logging rows written and DB size afterwards. This keeps Render's RAM and 5 GB outbound free for the live pipeline.
- **R4 — Bounded CPU.** Monte Carlo uses the vectorised Gumbel-top-k trick (one `argsort` per batch). 10,000 simulations × 20 drivers × remaining races takes seconds at 0.1 CPU.

**OpenF1**
- **O1 — Request budget per cycle** (default 25), plus bounded backoff on 429/5xx. Work that needs more, like telemetry, is resumable across cycles.

---

## 3. TDD workflow

### Seams (to confirm before any test is written)
| ID | Layer | Seam (public interface) | How it's tested |
|---|---|---|---|
| PY-1 | data-engine | `_to_rows(raw, race_id, driver_map)` in each OpenF1 job | pytest. Input is a **recorded real OpenF1 response** in `tests/fixtures/openf1/` |
| PY-2 | data-engine | Pure domain modules: `race_story`, `telemetry`, `title_odds`, `storage_guard`, `circuit_rates`, `openf1_budget` | pytest with worked examples as expected values |
| PY-3 | data-engine | Job runners (`run_openf1_job`, `run_ingest_job`, new runners) | `FakeConnection` + monkeypatched `execute_batch`; assert on written params |
| PY-4 | data-engine | `auto_runner.run_cycle` with injected `schedule_provider` / `conn_factory` | Which steps ran; whether a connection was opened |
| PY-5 | data-engine | `openf1_client` | Monkeypatched `requests.get` (existing `_FakeResponse`) |
| API-1 | apps/api | HTTP: `app.request('/api/...')` | Integration test with factories, local Postgres (D7) |
| API-2 | apps/api | `src/common` pure mappers/aggregators | `bun test` unit |
| WEB-1 | apps/web | `lib/` pure functions (scales, tyres, championship maths, telemetry comparison) | Vitest, `node` env |
| WEB-2 | apps/web | Rendered pages, as a user sees them | Playwright smoke against the fixture API. Assert on text and accessible names, not SVG coordinates |

**Not seams:** Drizzle schema files, services called directly, Astro component internals, private helpers, SVG path data. Migrations get verified through API-1 tests running against the migrated schema.

### Slice template
Every item in §4 is a list of vertical slices. Each slice is one red test at one seam, then the minimal code to pass it:
```
Slice N.M — <behaviour in domain words>
  Seam:   <ID>
  Red:    <test name> — expected value from <independent source>
  Green:  <minimal change, incl. migration if needed>
  Budget: storage / compute / egress / OpenF1 requests
```
- Expected values come from independent sources (recorded API payloads, worked examples, known historical results), never recomputed the way the code computes them.
- Refactoring happens in review after green, not inside the loop.

---

## 4. Phases as slices

### Phase 0 — Foundations and guardrails
| Slice | Behaviour | Seam | Red test / truth source |
|---|---|---|---|
| 0.0 | Usage baseline recorded (Neon CU-h + egress, Render hours + bandwidth) | — | Manual: numbers go into the §7 table |
| 0.1 | Tests run without Neon (local Postgres + Neon HTTP proxy, docker-compose, CI service container) | API-1 | Existing `races`/`drivers` integration suite passes with `TEST_DATABASE_URL` pointing at the proxy |
| 0.2 | Storage guard returns allow / block-backfill / core-only for given DB sizes | PY-2 | 400 MB → allow; 600 MB → block-backfill; 800 MB → core-only |
| 0.3 | Worker skips the DB when no session is ready inside the window | PY-4 | In-window cycle, cached race status, no session past its ready time → `conn_factory` never called |
| 0.4 | Completed-race responses are edge-cached | API-2 / manual | Unit test on `cacheControlForStatus('completed')`; manual `cf-cache-status` check in prod |
| 0.5 | OpenF1 client retries 429/5xx with bounded backoff and stops at the cycle budget | PY-5 | `_FakeResponse` 429, 429, 200 → data; 26th call in a cycle → `BudgetExceeded` |
| 0.6 | OpenF1 session keys are cached on `races` | PY-3 | Second job for the same race makes 0 `/sessions` calls |
| 0.7 | Step logs include peak RSS | PY-3 | Structured log line has an integer `peak_rss_mb` |
| 0.8 | Chart scales: `linearScale`, `niceTicks`, `formatLapMs` | WEB-1 | `niceTicks(0, 87, 5)` → `[0, 20, 40, 60, 80]`; `formatLapMs(83456)` → `"1:23.456"` |
| 0.9 | Compound string → tyre token (FastF1 + OpenF1 spellings) | WEB-1 | `"SOFT"`, `"soft"` → `tyre-soft`; `"UNKNOWN"`/null → `tyre-unknown` |
| 0.10 | Shared `RaceTabs` on GP and sprint pages; sprint switcher on the GP hero | WEB-2 | Existing `race-detail.spec.ts` stays green; new: `/races/2` shows "Sprint" link → `/races/2/sprint` |
| 0.11 | Rebrand; tab title shows the brand once | WEB-2 | `/` title is exactly `"Dashboard — <Brand>"` |
| 0.12 | `drivers/[id]` and sprint page fetch in parallel | — | Refactor under existing green e2e; no new test |

Phase 0 budget: no new storage; compute should **drop** (0.3, N1, N6).

### Phase 1 — Strategy and pit stops
| Slice | Behaviour | Seam | Red test / truth source |
|---|---|---|---|
| 1.1 | Race events carry `session_type`; existing rows backfilled by date | API-1 | Seed a GP + sprint weekend; `/:id/overtakes?session=sprint` returns only sprint rows |
| 1.2 | Retry check sees sprint-only gaps | PY-4 | GP events present, sprint events missing → sprint steps re-run |
| 1.3 | OpenF1 stint → row mapping | PY-1 | Recorded `/stints` payload (2024 Monza) → expected rows, `tyre_age_at_start` preserved |
| 1.4 | Stints job writes to `race_stints` per session | PY-3 | `execute_batch` params include `session_type='sprint'` for a Sprint run |
| 1.5 | Stints step runs after `ingest_race`, best-effort | PY-4 | Step raising doesn't fail the action; logged as failed |
| 1.6 | OpenF1 pit → row mapping; `stationary_ms` null before the 2024 US GP | PY-1 | Recorded `/pit` payloads, one before and one after the 2024 US GP |
| 1.7 | `GET /races/:id/strategy` returns stints + stops, ordered by finish | API-1 | Seeded race: P1 driver first, 2 stints, 1 stop |
| 1.8 | Strategy falls back to `lap_times`-derived stints pre-2023, flagged `derived` | API-1 | Seeded 2019 race with only `lap_times` → `source: 'derived'` |
| 1.9 | Strategy page shows one row per driver with compound labels | WEB-2 | Fixture API → "VER" row has "SOFT" then "HARD"; pit table shows lap 18 |
| 1.10 | Team pit leaderboard (median stationary time) | API-1, WEB-2 | Seeded stops 2.1/2.4/2.9 s → median 2.4 s ranked first |
| 1.11 | Friday pace returned with the prediction and shown | API-1, WEB-2 | Seeded `fp2_long_run_times` → ordered by `median_lap_ms`, delta to fastest |
| 1.12 | Radio empty state for 2026+ | WEB-2 | Fixture 2026 race with no clips → explanatory message |

Phase 1 budget:
- Storage ≈ 3 MB for 2023–2026 (`race_stints` ~2k rows/season, `race_pit_stops` ~1.5k).
- OpenF1: +4 requests per race (stints + pit for GP and sprint).
- Compute: rides the existing ingest cycle.

### Phase 2 — Analysis from own data (no new sources)
| Slice | Behaviour | Seam | Red test / truth source |
|---|---|---|---|
| 2.1 | Championship maths: alive/eliminated, points still available | WEB-1 | Worked example: 2021 before Abu Dhabi, VER and HAM both on 369.5 with 26 points left → both alive; a driver 30 behind → eliminated |
| 2.2 | Plackett–Luce sampler matches its probabilities | PY-2 | p = [1, 0, 0] → always first; p = [0.5, 0.5] over 10k seeded draws → 0.5 ± 0.02 |
| 2.3 | Title odds: certain leader → 1.0; mathematically eliminated → 0.0 | PY-2 | Fixed seed; hand-built 3-driver season |
| 2.4 | Re-running title odds gives identical results (seed from season + round) | PY-2 | Two runs → equal arrays |
| 2.5 | Title-odds job writes one row per driver per round | PY-3 | `execute_batch` params |
| 2.6 | `GET /predictions/title-odds?year=N` returns latest + history | API-1 | Seeded rounds 1–3 |
| 2.7 | Standings pages show odds + odds-over-time chart | WEB-2 | Fixture → "VER 64%" |
| 2.8 | Teammate H2H (quali, race, points split) | API-1 | Seeded 3 races: A out-qualifies B 2–1, beats B 3–0 |
| 2.9 | Racecraft: overtakes made/suffered in season stats (lap 1 separate) | PY-3 | Seeded overtakes → made 5, suffered 2, lap-1 1 |

Phase 2 budget:
- Storage < 1 MB (`title_odds_*` ≈ 720 rows/season).
- CPU: seconds per run (R4).
- Backfilling 2023–2025 runs locally (R3).

### Phase 3 — Race story (FastF1, already loaded during ingest)
| Slice | Behaviour | Seam | Red test / truth source |
|---|---|---|---|
| 3.1 | Per-lap position / gap / interval traces from **full** laps | PY-2 | Hand-built 3-driver × 4-lap laps frame with known cumulative times → known gaps; lapped car → null gap + `laps_down` |
| 3.2 | Traces written in the same ingest transaction | PY-3 | `race_lap_traces` params: one row per driver |
| 3.3 | Battles: within 1.0 s for ≥ 3 consecutive laps | PY-2 | Interval series [0.8, 0.9, 0.7, 1.4] → one battle, laps 1–3 |
| 3.4 | Pit-cycle outcome (undercut success) | PY-2 | Worked example: A pits lap 20, B lap 22, A ahead after → undercut won |
| 3.5 | Weather trace (temps + rain bands) | PY-2 | Recorded FastF1 `weather_data` slice → rain from minute 34 |
| 3.6 | Grid penalties: classified quali position vs race grid | API-1 | Seeded P3 qualifier starting P13 → penalty +10. First verify what `qualifying_results.grid_position` holds |
| 3.7 | `GET /races/:id/race-story` | API-1 | Seeded traces → payload under the E2 ceiling |
| 3.8 | Race-story page: gap chart, position chart, battles list, SC shading | WEB-2 | Fixture → "Battle: NOR vs PIA, laps 12–19" |

Phase 3 budget:
- `race_lap_traces` uses arrays (N5): ~20 rows/race, about 6 MB for 2018–2026. One row per lap would be ~90 MB.
- `race_weather_traces`: one row per session.
- Backfilling 2018–2025 is local and season by season (R3). It's the largest FastF1 job, so check storage after each season.

### Phase 4 — Telemetry and track maps (OpenF1, 2023+)
| Slice | Behaviour | Seam | Red test / truth source |
|---|---|---|---|
| 4.1 | Lap window from `/laps` for each driver's fastest Q/SQ lap | PY-1 | Recorded `/laps` payload → expected window |
| 4.2 | Distance from speed integration, scaled to track length | PY-2 | Constant 180 km/h for 10 s → 500 m before scaling; scaled sum = `track_length_km` |
| 4.3 | Resample to a 10 m grid; quantise channels to ints | PY-2 | Known 5-sample trace → expected grid values |
| 4.4 | Resumable: each cycle fetches only drivers still missing, within the request budget | PY-3, PY-4 | 20 drivers, budget 25 → cycle 1 does 12 drivers (2 calls each), cycle 2 the remaining 8 |
| 4.5 | `GET /races/:id/telemetry?a=&b=` returns two traces only | API-1 | Seeded 3 drivers → 2 returned; size under the E2 ceiling |
| 4.6 | Comparison maths: aligned delta + mini-sector winners | WEB-1 | Two hand-built traces → A wins sectors 1 and 3 |
| 4.7 | Server-rendered comparison page (GET form) | WEB-2 | `/races/1/telemetry?a=VER&b=LEC` → "VER faster in 2 of 3 sectors" |
| 4.8 | Circuit outline path from the pole lap's x/y | PY-2, WEB-2 | Square trace → closed path; circuit page renders the outline with an accessible title |

Phase 4 budget:
- `qualifying_lap_telemetry` is JSONB of int arrays (N5): ~10 KB per row after TOAST, ~6 MB/season, ~24 MB for 2023–2026.
- OpenF1: ~41 requests per session, spread over ~2 cycles (O1).
- Egress: ≤ 60 KB per uncached comparison. E1 matters most here.

### Phase 5 — History (F1DB)
| Slice | Behaviour | Seam | Red test / truth source |
|---|---|---|---|
| 5.1 | F1DB driver → `history_drivers` row (bio + career totals) | PY-1-style mapper | Recorded F1DB JSON for 2–3 drivers |
| 5.2 | Import is idempotent and skips already-imported releases | PY-3 | `f1db_imports` already has the version → 0 writes |
| 5.3 | Core ↔ F1DB id mapping | PY-2 | Known pairs (e.g. VER) map; unknown → unmatched list |
| 5.4 | Constructor lineage (chassis + engine by season) | PY-1-style mapper | Recorded constructor payload |
| 5.5 | `GET /history/records` | API-1 | Seeded totals → ordered list |
| 5.6 | Records page, driver milestones, team lineage, "on this day" | WEB-2 | Fixture → "Most wins" heading lists the expected leader |

Budget scope (decision D5):
- Import **bios, career totals and lineage only**, plus results **before 1980**. The DB already holds 1980–2026 results, so nothing is duplicated.
- Estimated 10–20 MB.
- The initial import runs locally (R3). The worker applies only the current-season delta after each F1DB release, checked weekly.
- Credit F1DB in the footer (CC-BY-4.0).

### Phase 6 — Home hub
| Slice | Behaviour | Seam | Red test |
|---|---|---|---|
| 6.1 | Hub cards degrade independently when one API call fails | WEB-2 | Fixture with title-odds route 500 → other cards still render |
| 6.2 | Next session countdown covers any session type | WEB-1 | Schedule with FP3 next → "FP3" |
| 6.3 | Last-race recap: winner, prediction hit/miss, fastest stop, top battle | WEB-2 | Fixture race → expected text |

Budget: page fetches use `Promise.allSettled` over already-cached routes, so no new DB queries.

### Phase 7 — Model v4 (backtest-gated)
| Slice | Behaviour | Seam | Red test / truth source |
|---|---|---|---|
| 7.1 | Measured overtake rate, shrunk toward the seeded prior `w = n/(n+k)` | PY-2 | n = 0 → prior exactly; n = k → midpoint |
| 7.2 | SC / VSC / red-flag counts from race control | PY-2 | Recorded race-control payload → 1 SC, 2 VSC |
| 7.3 | Wet pace vs teammate on INTER/WET laps | PY-2 | Hand-built laps → expected delta |
| 7.4 | Backtest harness: v3 vs v4 on 2023–2025 (Brier, top-1/3/5) | PY-2 | Two hand-built prediction sets with known Brier values |
| 7.5 | Ship v4 only if the backtest wins | — | Decision |

- Weight changes flow through the existing invariant tests (`test_weights.py`, `predictionMath.test.ts`).
- Fix the docs that call `sc_probability` static.
- Budget: backtests run locally against a snapshot, not in a loop against Neon.

---

## 5. Storage design changes (versus the first draft)

| Data | First draft | Now | Why |
|---|---|---|---|
| Per-lap positions/gaps | row per lap (~360k rows, ~90 MB) | `race_lap_traces` row per driver per session with `int[]` arrays (~6 MB) | Always read whole-race (N5) |
| Weather samples | row per minute | `race_weather_traces` row per session with arrays | Same |
| Telemetry | JSONB floats | JSONB **int-quantised** arrays, TOAST-compressed | ~2× smaller |
| F1DB | full results import | bios, totals, lineage, pre-1980 results only | Avoid duplicating 1980–2026 |
| Gaps/positions source | OpenF1 `/intervals` + `/position` | FastF1 full laps | Already loaded, covers 2018+, 0 HTTP calls |

**Projected total after all phases: about 130–150 MB (13–15 % of 1 GB).** Storage is the safest of the three budgets. The real risks are **compute CU-hours** (autoscaling, polling, tests) and **egress** (uncached heavy routes), and rules N1–N6 and E1–E2 address them.

---

## 6. Open decisions

| # | Decision | Recommendation |
|---|---|---|
| D1 | Strategy source: OpenF1 `/stints` (2023+) + derived fallback, or re-ingest all FastF1 laps with `is_accurate` | OpenF1 now; revisit `is_accurate` in Phase 7 |
| D2 | Telemetry storage: JSONB per lap or row per sample | JSONB int arrays |
| D3 | OpenF1 pacing. CLAUDE.md bans `sleep()` in jobs, but that rule came from Render cron timeouts, and the worker loop now `sleep`s between cycles itself (`server.py:183`) | Per-cycle request budget + resumable work. Allow ≤ 0.4 s spacing between OpenF1 calls; record it in an ADR and update CLAUDE.md |
| D4 | Telemetry comparison: server-rendered GET form or client island | Server-rendered (no new §3 exception) |
| D5 | F1DB scope: separate `history_*` tables with a scoped import, or merge into core | Separate + scoped |
| D6 | Brand name | Your call |
| D7 | API integration tests on local Postgres + Neon HTTP proxy instead of the Neon test branch | Yes. Removes all test compute from the Neon quota. Spike it as slice 0.1 and fall back to the Neon branch if the proxy misbehaves |
| D8 | Neon compute cap: 0.25 fixed or 0.25 → 0.5 autoscale | 0.25 → 0.5 for prod, 0.25 fixed for test |

---

## 7. Usage log (fill in monthly)

| Month | Neon storage | Neon CU-h | Neon egress | Render hours | Render outbound | Notes |
|---|---|---|---|---|---|---|
| 2026-10 | 70 MB (measured) | ? | ? | ? | ? | Baseline before Phase 0 |
