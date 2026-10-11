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

**Caching:** race/prediction/sprint endpoints set `Cache-Control` based on whether the
underlying race is `completed` — `public, max-age=86400, immutable` once a race is done
(results and predictions for a finished race never change), otherwise `public, max-age=30`
while the weekend is still in progress. See `apps/api/src/common/cache.ts`.

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

The `Race` object includes:
- `eventFormat` — `conventional` | `sprint` | `sprint_qualifying` | `sprint_shootout`
- `hasSprint` — boolean derived from eventFormat
- `sprintDate` / `sprintQualifyingDate` — ISO strings, null for conventional weekends
- `sprintWeather`, `sprintSafetyCarLaps`, `sprintVscLaps`, `sprintAirTempAvg`, `sprintTrackTempAvg`, `sprintHumidityAvg` — sprint-specific conditions

### `GET /api/races/:id/race-control`

Returns race-control messages (flags, safety car/VSC, incidents) for a race, ordered by
timestamp ascending. Empty until `ingest_race_control` has run for that race — sourced from
OpenF1, which only has data for completed races from 2023 onward.

### `GET /api/races/:id/overtakes`

Returns on-track overtakes for a race, ordered by timestamp ascending. `overtakingDriverId`/
`overtakenDriverId` reference `drivers.id` (already resolved from OpenF1's car numbers) —
look them up in the race's own `results`/`qualifying` response rather than re-fetching driver
details. Empty until `ingest_overtakes` has run — same OpenF1 2023+/completed-only coverage
as race-control.

### `GET /api/races/:id/team-radio`

Returns team radio clips for a race, ordered by timestamp ascending. `driverId` references
`drivers.id` (resolved from OpenF1's car number) — look it up the same way as overtakes.
`recordingUrl` points directly at F1's own CDN. F1 doesn't release radio for every session,
so an empty or partial list is expected, not an error.

### `GET /api/races/circuits`

Returns a list of all circuits in the database, ordered alphabetically by name.

### `GET /api/races/circuit/:circuitKey`

Returns historical race results at a specific circuit across all years. Each item includes `hasSprint: boolean`.

---

## Drivers

### `GET /api/drivers?year=N&team_id=T`

| Param | Required | Default | Notes |
|-------|----------|---------|-------|
| `year` | no | current year | |
| `team_id` | no | all teams | Filter by team |

### `GET /api/drivers/standings?year=N`

Returns driver championship standings for the year, ordered by points.

### `GET /api/drivers/:id?year=N`

Returns a single driver with their season stats for the given year.

### `GET /api/drivers/:id/career`

Returns a driver's stats across all seasons they have data in. `drivers` rows are season-scoped and
FastF1's names vary by season, so seasons are linked by person (`common/driverIdentity.ts`): the same
name ignoring accents and case, or the same code with one name extending the other ("Andrea Kimi
Antonelli" / "Kimi Antonelli"). "Jr." still counts, so a father and son stay separate. `/api/search`
uses the same rule to list each person once, under their latest season.

---

## Teams

### `GET /api/teams?year=N`

Returns all teams for the season.

### `GET /api/teams/standings?year=N`

Returns constructor championship standings for the year, ordered by points.

### `GET /api/teams/:id?year=N`

Returns a single team with season stats for the given year.

### `GET /api/teams/:id/career`

Returns a team's stats across all seasons they have data in.

---

## Predictions (Grand Prix)

### `GET /api/predictions/model-info`

Returns the most recently computed model versions for GP and sprint predictions. Updates automatically whenever `compute_predictions` or `compute_sprint_predictions` runs — no deploy needed.

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

Returns the prediction for the next `qualifying_done` race with `race_date >= today`. Ordered ascending so the chronologically next race always wins — historical races stuck in `qualifying_done` from a partial backfill are excluded by the date guard.

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

### `GET /api/predictions/history?year=N`

Returns all predictions for the year — both grand prix and sprint races merged and sorted by date descending. Includes actual results alongside predicted results for accuracy tracking.

Each item includes `isSprint: boolean`. Sprint items link to `/races/:id/sprint`; main race items link to `/prediction/:id`.

`actualWinnerPredictedPosition` is the grid slot the model had put the actual winner in — non-null
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

Season-by-season accuracy breakdown, across every season with at least one decided race —
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

Returns the "Intelligence Standings" — driver rankings by average prediction score. Each row includes sprint aggregates (`sprintWins`, `sprintPodiums`, `sprintTotalPoints`).

---

## Sprint Predictions

### `GET /api/sprint/upcoming`

Returns the sprint prediction for the next upcoming sprint weekend. Same envelope as the grand prix upcoming prediction but uses sprint model features and `modelVersion: "sprint-v1"`.

### `GET /api/sprint/race/:raceId`

Returns the sprint prediction for a specific race ID. Includes sprint results if the sprint has been completed, and sprint lap summaries.

```json
{
  "data": {
    "race": { "id": 205, "name": "Chinese Grand Prix", "hasSprint": true, "sprintDate": "2026-03-15", ... },
    "prediction": {
      "predictedWinner": { "code": "ANT", ... },
      "modelVersion": "sprint-v1",
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

