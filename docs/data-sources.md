---
title: "Data Sources"
description: "Where every number on the site comes from, what each season has, and how the sources are credited"
order: 1.5
---

# Data Sources

Every source is free and needs no account. The project pays for nothing, so a source that moves behind a
login or a paywall gets replaced, not paid for.

## The sources

| Source | What it provides | Used for |
|--------|------------------|----------|
| [OpenF1](https://openf1.org) | Laps, sectors, tyres, weather, race control, overtakes, team radio, car telemetry (2023+) | Live ingest of every finished session |
| [Jolpica](https://github.com/jolpica/jolpica-f1) | Official classification: grid, status, points | Live ingest, alongside OpenF1 |
| [F1DB](https://github.com/f1db/f1db) | Every world championship season since 1950 | History pages, careers, constructor lineages; results audit before 2018 |
| [FastF1](https://github.com/theOehrly/Fast-F1) | Event calendar; cached 2018–2022 timing | The schedule, and local backfills of 2018–2022 |
| [Open-Meteo](https://open-meteo.com) | 16-day weather forecast | The live weekend forecast on circuit pages |

FastF1 was the live source until October 2026, when version 3.9 put F1's timing data behind a paid F1TV
login. Live ingest moved to OpenF1 and Jolpica
([ADR 0011](https://github.com/Glory42/F1-Intelligence-Platform/blob/master/docs/adr/0011-live-ingest-reads-openf1-and-jolpica.md)).
Seasons ingested before then keep their FastF1 rows.

## What each era has

| Seasons | What the site shows |
|---------|---------------------|
| 1950 onward | All-time records, milestones, on this day, constructor lineages, career totals (F1DB) |
| 1980 onward | Race results and standings |
| 2006 onward | Q1/Q2/Q3 qualifying times |
| 2018 onward | Lap times, lap charts, race story, tyre stints, pit stops, race control, qualifying telemetry, predictions, title odds |
| 2019 onward | Driver photos |
| 2021 onward | Sprints |
| 2023 onward | Overtakes and team radio (OpenF1 only: no earlier source) |

Stored predictions start in 2018. Each season's were made by a model fitted on earlier seasons only, so past
picks are as honest as live ones.

## How it reaches the site

A Python worker on Render checks the race calendar and, once a session has finished, reads it from OpenF1
and Jolpica and writes it straight to the database. It then recomputes standings, prediction features,
win probabilities and title odds. F1DB is imported weekly by a GitHub Action. The site and API only read.
Job by job: [Data Pipeline](https://f1.gorkemkaryol.dev/docs/data-pipeline).

## Something looks wrong?

Sources occasionally publish late corrections or miss a driver. Open a
[data issue](https://github.com/Glory42/F1-Intelligence-Platform/issues/new/choose) with the race and
what you expected to see.

## Credits

- Historical data: [F1DB](https://github.com/f1db/f1db), licensed
  [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/). The site credits it wherever it's shown.
- Session data: [OpenF1](https://openf1.org) and [Jolpica](https://github.com/jolpica/jolpica-f1).
- Weather forecasts: [Open-Meteo](https://open-meteo.com).

This is an unofficial fan project and isn't associated with the Formula 1 companies.
