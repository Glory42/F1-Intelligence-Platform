# The GP model is a fitted conditional logit, judged only by a leak-free walk-forward backtest

weighted-v3 scored 12 per-race min-max features with hand-picked weights and a softmax at T = 0.3. Its
reported accuracy was inflated: recomputed past predictions read whole-season stats and the race's own
post-race weather, so they partly knew the result. Replayed honestly (every race from data before it), v3
picked 43% of winners against 55% for "the pole-sitter wins", and its favourites were shown at ~11% while
winning half the time.

weighted-v4 keeps v3's shape (a weighted sum per driver, softmax over the field) but fits the weights to
past winners by maximum likelihood, so the temperature is part of the fit, and replaces the features with
seven in real units built from an in-memory history: grid slot and its interaction with how hard the track
is to pass on, this weekend's qualifying gap, and decayed form across seasons by person and outfit (driver
points, team qualifying and race pace, team-mate gap). On 190 races (2018–2026) it picks 60% of winners,
90% in the top three, with calibrated probabilities. Every alternative feature we tried (wins, team points,
reliability, practice long runs, the sprint result, circuit safety-car rate, stronger regularisation)
added nothing beyond noise and was left out.

## Consequences

- No hand-set GP weights or temperature: `scripts/fit_model_v4.py` writes `src/models/gp_v4.json`, committed
  and reviewed like code, and only after `scripts/backtest.py` shows the change helps. CLAUDE.md's old
  "T = 0.3, do not increase T" rule now applies to the sprint model only.
- A feature must be computable from races before the one predicted. The backtest replays history, and a
  feature that peeks ahead makes it lie, as v3's numbers did.
- Feature rows are one JSONB object (value + contribution per feature), so a refit with other features needs
  no migration. The web shows each driver through those contributions: the "why" bar is the edge over the
  field, the What-If Lab scales contributions, the radar ranks features within the field.
- Stored past predictions are regenerated with weights fitted only on earlier seasons
  (`scripts/backfill_all_predictions.py`), so the scorecard stays out-of-sample.
- The sprint model stays `sprint-v2`: about 30 sprints are too few to fit weights.
