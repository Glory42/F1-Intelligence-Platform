# A forecast before qualifying, from the race before it

weighted-v4 needs a qualifying sheet: until Saturday's qualifying is ingested the site has no prediction
for the next race, and the week between races shows nothing new. Of v4's seven features, three are set by
qualifying (grid slot, grid × hard-to-pass track, qualifying pace). The other four (driver form, team race
pace, team qualifying pace, team-mate edge) only read races already run, so they can be computed as soon as
the previous race is in.

`scripts/backtest.py` replayed those four as their own fitted model (`pre-quali`), with FP2 long runs added,
and with driver form alone, over the 190 GPs from 2018 to 2026, each from races before it only:

| model | log loss | Brier | top-1 | top-3 |
|---|---|---|---|---|
| weighted-v4 (after qualifying) | 1.2084 | 0.5655 | 60.0% | 90.0% |
| **pre-quali** (shipped) | **1.5187** | **0.6704** | 47.9% | 78.9% |
| pre-quali + FP2 long runs | 1.5308 | 0.6781 | 45.3% | 76.8% |
| driver form only | 1.5585 | 0.6733 | 46.3% | 77.4% |
| P(win \| grid slot), after qualifying | 1.4527 | 0.6425 | 55.3% | 87.9% |
| equal chances | 2.9997 | 0.9502 | 5.0% | 14.9% |

Paired per race, pre-quali beats equal chances by 1.481 ± 0.152 log loss. Against driver form alone it gains
0.040 ± 0.047 (noise), and adding FP2 long runs makes it worse, as it did for v4. Qualifying is worth about
0.31 log loss (1.519 → 1.208).

pre-quali-v1 ships those four features (`gp_features_v4.PRE_QUALI_FEATURES`): it reuses v4's code, is nominally
best on every metric, and can't be told apart from form alone. It is fitted separately
(`scripts/fit_model_v4.py --pre-quali` → `src/models/gp_v4_prequali.json`) and scored over `previous_lineup`:
the drivers and teams of the season's last completed race.

## Consequences

- `compute_pre_quali` runs in the race chain after the race is ingested and forecasts the next race in the
  season, so the forecast stands all week. No new worker wake-ups; it also reruns on a race-results Repair.
- It lives in its own table, `pre_quali_predictions` (migration `0033`), so `race_predictions` stays one row per
  race and the forecast survives qualifying: GP prediction rows carry `preQualiProbability`, and the page shows
  how qualifying moved each driver's chance.
- The lineup is an approximation: a driver swapped in mid-season isn't in it until he has raced, and a dropped
  driver stays in it for one race. The post-qualifying prediction uses the real field.
- A season opener has no earlier race that season, so it gets no forecast.
- `backfill_all_predictions.py` writes past forecasts with weights fitted on earlier seasons; the forecast has no
  weights grid on the page, so `docs/feature-weights.json` stays the GP model's alone.
