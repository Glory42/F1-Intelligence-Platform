---
title: "API Reference"
description: "All REST endpoints, request parameters, and response shapes"
order: 5
---

# API Reference

**Base URL:** `https://f1-prediction-platform-api.gorkemkaryol03.workers.dev`  
**Local dev:** `http://localhost:8787`

All responses follow this envelope:

```json
{ "data": <T>, "error": null }
{ "data": null, "error": { "code": "ERROR_CODE", "message": "..." } }
```

No authentication. All endpoints are read-only GET.

**Caching:** every route's `Cache-Control` comes from the data it returns, never from a client
parameter (`apps/api/src/common/route.ts`, rules in `common/cache.ts`):

- **Race-scoped** routes (`/api/races/:id/*`, `/api/predictions/race/:raceId*`, `/api/sprint/race/:raceId*`):
  `public, max-age=86400, immutable` once the race is `completed`, otherwise `public, max-age=30`.
- **Season-scoped** routes (`?year=N` lists, and `/api/drivers/:id*` / `/api/teams/:id*`, whose ids belong
  to one season): immutable for a past season, 30 s for the current one. For the `:id` routes the
  season is the driver's/team's own: `?year=` never changes the lifetime. Careers use their newest season.
- **Reference data** (`/api/seasons`, `/api/search`, `/api/races/circuits`, `/api/races/circuit/:key`,
  `/api/predictions/model-info`): `public, max-age=3600`.
- An empty answer (no rows yet, enrichment not backfilled) is always cached for 30 s only.

A non-numeric `:id` / `:raceId` answers 400 `INVALID_ID`, a non-numeric `year` 400 `INVALID_YEAR`, an
unknown `session` 400 `INVALID_SESSION`, and an unknown race, driver or team 404 `NOT_FOUND`.

---

## Health

### `GET /api/health`

Checks API and DB connectivity.

```json
{
  "data": {
    "status": "ok",
    "db": "connected",
    "timestamp": "2026-06-04T12:00:00.000Z"
  }
}
```

---

## Seasons

### `GET /api/seasons`

Returns all seasons with data.

```json
{
  "data": [
    { "id": 1, "year": 2000 },
    { "id": 27, "year": 2026 }
  ]
}
```

---

## Races

### `GET /api/races?year=N&status=S`

| Param | Required | Default | Notes |
|-------|----------|---------|-------|
| `year` | no | current year | |
| `status` | no | all | `scheduled` \| `sprint_qualifying_done` \| `sprint_done` \| `qualifying_done` \| `completed` |

Returns all races for the year. Each race includes `eventFormat`, `hasSprint`, `sprintDate`, and sprint condition fields for sprint weekends.

### `GET /api/races/:id`

Returns a single race with circuit, results (if completed), qualifying, and lap summaries.

`laps` (the same rule for the sprint detail's `laps`): one `{ driverId, driver, fastestLapMs, avgLapMs,
totalLaps }` per driver, fastest first. Pit in/out laps and laps without a time are left out of all
three numbers, so `totalLaps` counts clean timed laps only. All three are integers.

The `Race` object includes:
- `eventFormat`: `conventional` | `sprint` | `sprint_qualifying` | `sprint_shootout`
- `hasSprint`: boolean derived from eventFormat
- `sprintDate` / `sprintQualifyingDate`: ISO strings, null for conventional weekends
- `sprintWeather`, `sprintSafetyCarLaps`, `sprintVscLaps`, `sprintAirTempAvg`, `sprintTrackTempAvg`, `sprintHumidityAvg`: sprint-specific conditions

### `GET /api/races/:id/race-control`

Returns race-control messages (flags, safety car/VSC, incidents) for a race, ordered by
timestamp ascending. Covers 2018+: OpenF1 for completed races from 2023 onward (empty until
`ingest_race_control` has run), FastF1's race control feed for 2018–2022.

### `GET /api/races/:id/overtakes`

Returns on-track overtakes for a race, ordered by timestamp ascending. `overtakingDriverId`/
`overtakenDriverId` reference `drivers.id` (already resolved from OpenF1's car numbers):
look them up in the race's own `results`/`qualifying` response rather than re-fetching driver
details. Empty until `ingest_overtakes` has run: OpenF1 only, so 2023+ and completed races only
(no source before 2023).

### `GET /api/races/:id/team-radio`

Returns team radio clips for a race, ordered by timestamp ascending. `driverId` references
`drivers.id` (resolved from OpenF1's car number): look it up the same way as overtakes.
`recordingUrl` points directly at F1's own CDN. F1 doesn't release radio for every session,
so an empty or partial list is expected, not an error: and since 2026 F1 releases far fewer clips.

All three race-event routes take `?session=race|sprint` (default `race`): both sessions of a
sprint weekend share one `race_id`, and each row carries its `session_type`. Any other value → 400
`INVALID_SESSION`.

### `GET /api/races/:id/strategy?session=race|sprint`

Tyre strategy for one session, drivers in finishing order (`race_results` or `sprint_results`):

```json
{ "source": "openf1", "drivers": [{ "driver": { "...": "Driver" }, "finishPosition": 1,
  "stints": [{ "stintNumber": 1, "compound": "MEDIUM", "lapStart": 1, "lapEnd": 15, "tyreAgeAtStart": 0 }],
  "pitStops": [{ "lapNumber": 15, "pitLaneMs": 24500, "stationaryMs": null }] }] }
```

`source` is `openf1` (recorded stints: OpenF1 from 2023, FastF1 for 2018–2022), `derived` (fallback when
a race has no recorded stints: rebuilt from accurate `lap_times`, so stints span first..last *timed* lap
and `tyreAgeAtStart` is null), or `none`. 2018 stints keep Pirelli's named compounds (`HYPERSOFT`,
`ULTRASOFT`, `SUPERSOFT`, `SUPERHARD` alongside `SOFT`/`MEDIUM`/`HARD`). `stationaryMs` is only
available from the 2024 US GP onward; pre-2023 stops carry `pitLaneMs` only. Cached like other race routes (`cacheControlForStatus`).

### `GET /api/races/:id/race-story?session=race|sprint`

Lap-by-lap story from FastF1 full laps (2018+), drivers in finishing order:

```json
{ "drivers": [{ "driver": { "...": "Driver" }, "finishPosition": 1,
    "positions": [2, 1, 1], "gapsMs": [800, 0, 0], "intervalsMs": [800, null, null], "lapsDown": [0, 0, 0] }],
  "battles": [{ "chaser": { "...": "Driver" }, "leader": { "...": "Driver" }, "lapStart": 12, "lapEnd": 19, "minGapMs": 310 }],
  "weather": { "minuteOffsets": [0, 1], "airTempC": [25, 25.1], "trackTempC": [41.2, 40.8], "rainfall": [false, false] } }
```

Array index 0 is lap 1. `gapsMs` is null while a car is lapped (`lapsDown > 0`); `intervalsMs` is
null for the leader. A battle is 3+ consecutive laps within 1.0 s of the same car ahead. `weather`
is null when FastF1 had no samples. About 40 KB per race before gzip.

### `GET /api/races/:id/telemetry?session=Q|SQ&a=CODE&b=CODE`

Fastest-lap telemetry for a qualifying session (2018+: OpenF1 from 2023, FastF1 `Q` laps before). `drivers` lists everyone with a
stored lap (fastest first, no samples); `laps` holds full samples for only the two requested codes:
defaulting to the two fastest: to keep the payload (and Neon egress) small:

```json
{ "session": "Q",
  "drivers": [{ "driver": { "...": "Driver" }, "lapTimeMs": 79327 }],
  "laps": [{ "driver": { "...": "Driver" }, "lapNumber": 11, "lapTimeMs": 79327,
    "samples": { "distanceM": [0, 10], "timeMs": [0, 112], "speed": [321, 322], "throttle": [99, 100],
                 "brake": [0, 0], "gear": [8, 8], "x": [-1359, -1351], "y": [-498, -460] } }] }
```

All sample arrays share one 10 m distance grid, so two laps compare index by index.

### `GET /api/races/circuits`

Returns a list of all circuits in the database, ordered alphabetically by name.

### `GET /api/races/circuit/:circuitKey`

Also returns `outlinePath`: an SVG path (1000×1000 viewBox) drawn from the latest stored pole lap's
x/y at the circuit, or null before any telemetry exists (car data starts in 2018).


Returns historical race results at a specific circuit across all years. Each item includes `hasSprint: boolean`.

### `GET /api/races/circuit/:circuitKey/telemetry`

Track character from one real lap: the circuit's latest pole lap (falling back to that race's fastest
stored qualifying lap when the pole sitter's telemetry is missing: `isPoleLap` says which). Returns
`{ raceId, year, raceName, driver, lapTimeMs, isPoleLap, profile, trace }` or `null` when the circuit
has no telemetry (car data starts in 2018). `profile` (`modules/circuits/track-profile.helpers.ts`): full-throttle share (≥98%), longest flat-out run, top
speed, braking zones, and corners: every lift or brake, classed by apex speed (low < 130, medium
< 210 km/h). `trace` is speed/throttle/brake thinned to every 50 m.

---

## Drivers

### `GET /api/drivers?year=N&team_id=T`

| Param | Required | Default | Notes |
|-------|----------|---------|-------|
| `year` | no | current year | |
| `team_id` | no | all teams | Filter by team |

### `GET /api/drivers/standings?year=N`

Returns driver championship standings for the year: `[{ driver, stats }]`, ordered by championship
position, then `championshipPoints`.

Every driver stats object (here, `/api/drivers/:id` `seasonStats`, and each `/career` entry) carries
`totalPoints` (GP only), `sprintTotalPoints` (sprints only) and `championshipPoints` (their sum, what
the championship counts). All three are one-decimal strings, e.g. `"300.0"`, `"24.0"`, `"324.0"`;
`"0"` when the driver has no stats row yet. Team stats carry the same three fields.

### `GET /api/drivers/racecraft?year=N`

GP-session overtakes per driver from `race_overtakes` (2023+), ranked by net: `[{ driver, made,
suffered, net }]`. Sprint passes are excluded. OpenF1 marks overtakes as possibly incomplete.

### `GET /api/drivers/:id/teammate-battle?year=N`

Head-to-head against the team-mate with the most shared races that season (`:id` is the
season-scoped driver id): `{ teammate, sharedRaces, qualifying, race, points }`, each a
`{ driver, teammate }` count. `qualifying` compares classified qualifying position; `race` only
counts races both drivers finished (`Finished`/`Lapped`/`+N Lap(s)`, ADR 0002); `points` are GP
points. `races` lists every shared race in round order: `{ raceId, roundNumber, raceName, qualiGapMs,
driver, teammate }`, each side `{ qualiPosition, finishPosition, status, points }`. `qualiGapMs` compares
lap times in the deepest session both reached (Q3, else Q2, else Q1); negative means the driver was
faster. `medianQualiGapMs` is the median of those gaps. `year` is accepted but ignored: the
driver's own season sets the cache lifetime.

### `GET /api/drivers/:id?year=N`

Returns a single driver with their season stats for the given year.

### `GET /api/drivers/:id/career`

Returns a driver's stats across all seasons they have data in. `drivers` rows are season-scoped and
FastF1's names vary by season, so seasons are linked by person (`common/identity.ts`, golden cases in `docs/identity-cases.json`): the same
name ignoring accents and case, or the same code with one name extending the other ("Andrea Kimi
Antonelli" / "Kimi Antonelli"). "Jr." still counts, so a father and son stay separate. `/api/search`
uses the same rule to list each person once, under their latest season.

---

## Teams

### `GET /api/teams?year=N`

Returns all teams for the season.

### `GET /api/teams/standings?year=N`

Returns constructor championship standings for the year: `[{ team, stats }]`, ordered by championship
position, then `championshipPoints` (GP + sprint; see driver standings for the three points fields).

### `GET /api/teams/pit-stops?year=N`

Pit crews ranked by **median** stationary time (one botched stop can't skew it): `[{ team, stops,
medianStationaryMs, fastestStationaryMs }]`. Stops without a stationary time (pre-2024 US GP) are
ignored. Long-cached for past seasons (`cacheControlForYear`).

### `GET /api/teams/:id/pit-stops?year=N`

Every timed grand prix stop by one team's drivers (`:id` is season-scoped; `year` is accepted but
ignored, the team's own season sets the cache lifetime): `[{ raceId, roundNumber, raceName, driver, lapNumber, stationaryMs }]` in round
and lap order. Sprint stops and stops without a stationary time are left out.

### `GET /api/teams/:id?year=N`

Returns a single team with season stats for the given year.

### `GET /api/teams/:id/career`

Returns a team's stats across all seasons they have data in, following the outfit through its
rebrands (`constructorKey` in `common/identity.ts`): RB's career includes AlphaTauri and Toro Rosso,
but never its sister team Red Bull. Each entry keeps its own season's `teamId`.

---

## Predictions (Grand Prix)

### `GET /api/predictions/model-info`

Returns the most recently computed model versions for GP and sprint predictions. Updates automatically whenever `compute_predictions` or `compute_sprint_predictions` runs: no deploy needed.

```json
{
  "data": {
    "gpVersion": "weighted-v3",
    "sprintVersion": "sprint-v2"
  }
}
```

---

### `GET /api/predictions/upcoming`

Returns the prediction for the next `qualifying_done` race with `race_date >= today`. Ordered ascending so the chronologically next race always wins: historical races stuck in `qualifying_done` from a partial backfill are excluded by the date guard.

```json
{
  "data": {
    "race": { "id": 200, "name": "Monaco Grand Prix", "raceDate": "2026-06-07", "hasSprint": false, ... },
    "predictedWinner": { "id": 42, "fullName": "Max Verstappen", ... },
    "modelVersion": "weighted-v3",
    "drivers": [
      {
        "predictedPosition": 1,
        "winProbability": "0.28500",
        "driver": { "id": 42, "code": "VER", "fullName": "Max Verstappen", "team": { ... } },
        "features": {
          "carPerformance": "0.91200",
          "longRunPace": "0.81000",
          "tyreDeg": "0.85000",
          "reliability": "0.90000",
          "qualifyingDelta": "0.68000",
          "driverRating": "0.88000",
          "winRate": "0.77000",
          "luckFactor": "0.62000",
          "circuitAdjStartPos": "0.95000",
          "sectorStrength": "0.74000",
          "circuitAdjPositionGain": "0.55000",
          "weatherImpact": "0.50000"
        }
      }
    ]
  }
}
```

### `GET /api/predictions/race/:raceId`

Returns the prediction for a specific grand prix by race ID. Same shape as `/upcoming`.

### `GET /api/predictions/title-odds?year=N`

Latest Monte Carlo championship odds plus their per-round history (written by `compute_title_odds`):

```json
{ "afterRound": 19,
  "drivers": [{ "driver": { "...": "Driver" }, "titleProbability": 0.88, "expectedPoints": 452.3, "pointsP10": 420, "pointsP90": 475 }],
  "teams":   [{ "team": { "...": "Team" }, "titleProbability": 0.81, "expectedPoints": 690, "pointsP10": 650, "pointsP90": 720 }],
  "history": [{ "afterRound": 18, "driverId": 10, "titleProbability": 0.93 }] }
```

`history` has one entry per contender per completed round (2018–2026 replayed by
`scripts/backfill_title_odds.py`). 404 if no odds exist for the season yet.

### `GET /api/predictions/race/:raceId/friday-pace`

Each driver's quickest practice long run (`fp2_long_run_times`, the Long Run Pace feature's raw
input), fastest first: `[{ driver, compound, sessionType, medianLapMs, stintLength, deltaToFastestMs }]`.
`sessionType` is `FP2`, or `FP1` on sprint weekends. 404 if the race doesn't exist.

### `GET /api/predictions/history?year=N`

Returns all predictions for the year: both grand prix and sprint races merged and sorted by date descending. Includes actual results alongside predicted results for accuracy tracking.

Each item includes `isSprint: boolean`. Sprint items link to `/races/:id/sprint`; main race items link to `/prediction/:id`.

`actualWinnerPredictedPosition` is the grid slot the model had put the actual winner in: non-null
only once the race is decided; used by the frontend to show "model had them P4" on a missed call.

```json
{
  "data": [
    {
      "raceId": 210,
      "raceName": "Canadian Grand Prix",
      "raceDate": "2026-05-24",
      "roundNumber": 5,
      "isSprint": false,
      "predictedWinner": { "code": "ANT", ... },
      "actualWinner": { "code": "ANT", ... },
      "correct": true,
      "winProbability": "0.31200",
      "actualWinnerPredictedPosition": 1,
      "computedAt": "2026-05-23T20:00:00.000Z"
    },
    {
      "raceId": 205,
      "raceName": "Chinese Grand Prix",
      "raceDate": "2026-03-15",
      "roundNumber": 2,
      "isSprint": true,
      "predictedWinner": { "code": "ANT", ... },
      "actualWinner": { "code": "RUS", ... },
      "correct": false,
      "winProbability": "0.29000",
      "actualWinnerPredictedPosition": 3,
      "computedAt": "2026-03-14T18:00:00.000Z"
    }
  ]
}
```

### `GET /api/predictions/accuracy`

Season-by-season accuracy breakdown, across every season with at least one decided race:
no `year` param; a single call returns the full history. Built from the same predicted/actual
comparison as `/history`, aggregated per year and split into `gp`/`sprint`/`overall` buckets.
A season with no decided races yet (e.g. it's just started) is omitted entirely. `accuracyPct`
is `null` when a bucket has zero races (e.g. `sprint` for a season with no sprint weekends).

```json
{
  "data": [
    {
      "year": 2026,
      "gp": { "races": 12, "correct": 7, "accuracyPct": 58 },
      "sprint": { "races": 5, "correct": 3, "accuracyPct": 60 },
      "overall": { "races": 17, "correct": 10, "accuracyPct": 59 }
    },
    {
      "year": 2025,
      "gp": { "races": 24, "correct": 13, "accuracyPct": 54 },
      "sprint": { "races": 6, "correct": 3, "accuracyPct": 50 },
      "overall": { "races": 30, "correct": 16, "accuracyPct": 53 }
    }
  ]
}
```

### `GET /api/predictions/standings?year=N`

Returns the "Intelligence Standings": driver rankings by average prediction score. Each row includes sprint aggregates (`sprintWins`, `sprintPodiums`, `sprintTotalPoints`) and `championshipPoints` (GP + sprint season points).

---

## Sprint Predictions

### `GET /api/sprint/upcoming`

Returns the sprint prediction for the next upcoming sprint weekend. Same envelope as the grand prix upcoming prediction but uses sprint model features and `modelVersion: "sprint-v2"`.

### `GET /api/sprint/race/:raceId`

The sprint prediction for that race weekend: same envelope as `/api/sprint/upcoming`. 404 when the
weekend has no sprint prediction.

### `GET /api/sprint/race/:raceId/detail`

Everything the sprint page needs: `{ race, prediction, results, laps }`, `prediction` is null
before sprint qualifying, `results`/`laps` are empty until the sprint has run. 404 for a
conventional (non-sprint) weekend.

```json
{
  "data": {
    "race": { "id": 205, "name": "Chinese Grand Prix", "hasSprint": true, "sprintDate": "2026-03-15", ... },
    "prediction": {
      "predictedWinner": { "code": "ANT", ... },
      "modelVersion": "sprint-v2",
      "drivers": [
        {
          "predictedPosition": 1,
          "winProbability": "0.29000",
          "driver": { ... },
          "features": {
            "carPerformance": "0.88000",
            "circuitAdjStartPos": "1.00000",
            "shortRunPace": "0.91000",
            "driverRating": "0.75000",
            "weatherImpact": "0.50000",
            "winRate": "0.65000",
            "luckFactor": "0.55000",
            "sqQualifyingDelta": "0.68000"
          }
        }
      ]
    },
    "results": [ ... ],
    "laps": [ ... ]
  }
}
```

---

## Search

### `GET /api/search`

Returns all unique drivers (their latest profiles), teams, and circuits across all seasons for autocomplete search.

```json
{
  "data": {
    "drivers": [
      {
        "id": 420,
        "seasonId": 27,
        "teamId": 10,
        "driverNumber": 1,
        "code": "VER",
        "firstName": "Max",
        "lastName": "Verstappen",
        "fullName": "Max Verstappen",
        "nationality": "Dutch",
        "headshotUrl": "https://...",
        "team": {
          "id": 10,
          "seasonId": 27,
          "teamKey": "red_bull",
          "name": "Red Bull Racing",
          "nationality": "Austrian"
        }
      }
    ],
    "teams": [
      {
        "id": 10,
        "seasonId": 27,
        "teamKey": "red_bull",
        "name": "Red Bull Racing",
        "nationality": "Austrian"
      }
    ],
    "circuits": [
      {
        "id": 1,
        "circuitKey": "albert_park",
        "name": "Albert Park Circuit",
        "country": "Australia",
        "city": "Melbourne",
        "lapCount": 58,
        "trackLengthKm": "5.278",
        "overtakeRate": "0.320",
        "numberOfCorners": 14,
        "drsZones": 4,
        "scProbability": "0.600"
      }
    ]
  }
}
```

---

## History (F1DB)

All-time data imported from [F1DB](https://github.com/f1db/f1db) (CC-BY-4.0). Cached for a day.

### `GET /api/history/records`

Top-10 leaders `{ f1dbId, name, value, nationality, coreId, active }` for drivers (`wins`, `championships`,
`poles`, `podiums`, `starts`) and constructors (`wins`, `championships`, `poles`). `nationality` is
an F1DB country id. `coreId` is the core driver/team id for the page link (null before 1980, when core
data starts): a driver's latest season, and for a constructor its current core key or else its
longest-running one. `active` is true only for the latest season's grid.
Ties sort by wins, then name. Also:
- `rates`: top-10 `winRate`/`poleRate`/`podiumRate` (`value` is a 0–1 ratio), only drivers with
  at least `rateMinStarts` (50) starts.
- `chases`: per driver stat, the `record` holder and the best active `chaser` who doesn't hold it
  (null when no active driver has scored).

### `GET /api/history/milestones`

Five drivers each for `youngestWinner`, `youngestPole`, `youngestPodium`, `youngestStarter`,
`oldestFirstWin` and `longestWaitForWin` (debut to first win): `{ f1dbId, name, nationality,
coreId, active, days, raceName }`.

### `GET /api/history/lineages`

Constructors that raced under more than one name (F1DB chronology), one family per team keyed by
its latest name: `{ f1dbId, name, coreTeam: { id, teamKey } | null, active, members: [{ f1dbId, name,
yearFrom, yearTo, raceWins, championships, coreId }] }`. Member totals are per constructor, so a name that
recurs (Renault, Sauber) repeats them. Active families first.

### `GET /api/history/on-this-day?date=MM-DD`

`{ requested, date, races }`: up to 10 completed races (core DB, 1980+) held on that calendar
day, newest first, with the winner. When the day has none, `date` is the nearest day that does.
400 for a day that doesn't exist.

### `GET /api/drivers/:id/history`

The core driver's all-time F1DB record (career totals, first race / podium / pole / win), matched
by normalised full name. 404 if the driver isn't in the imported release.

### `GET /api/teams/:id/history`

The constructor's all-time totals plus chassis and engine per season, matched via
`f1dbConstructorId(team_key)`. 404 if unmatched.

### `GET /api/races/:id/recap`

Home-hub summary: `{ winner, predictedWinner, predictionHit, fastestStop: { driver, stationaryMs },
topBattle }`: the longest race battle. Each part is null when its data doesn't exist.

## Data Quality

### `GET /api/quality?year=N`

Returns the latest data-quality audit report for a season (records produced by the
`data_quality_audit` data-engine job). 404 when no report exists for the year yet.

```json
{
  "data": {
    "year": 2026,
    "generatedAt": "2026-08-24T12:00:00.000Z",
    "healthScore": "91.00",
    "racesAudited": 13,
    "issueCount": 7,
    "fixableCount": 3,
    "bySeverity": { "high": 2, "medium": 3, "low": 2 },
    "byTable": { "fp2_long_run_times": 2, "lap_times": 3 },
    "issues": [
      {
        "raceId": 420,
        "roundNumber": 13,
        "year": 2026,
        "tableName": "fp2_long_run_times",
        "checkName": "driver_coverage",
        "severity": "high",
        "detail": "FP2 coverage 0.00% (0/~20 drivers)",
        "fixable": true,
        "isSprint": false
      }
    ]
  }
}
```

---

## Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| `NOT_FOUND` | 404 | Route doesn't exist |
| `DB_ERROR` | 503 | Database unreachable |
| `INTERNAL_ERROR` | 500 | Unhandled server error |

