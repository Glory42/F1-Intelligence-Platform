# Title odds sample finishing orders from the model's win probabilities

The model only produces a win probability per driver per race: there is no stored
finishing-position distribution: but championship odds need whole finishing orders. Rather than
build a second model, `compute_title_odds` samples orders with Plackett–Luce (pick the winner by
`p`, remove them, renormalise, repeat), implemented as the Gumbel-max trick so 10,000 seasons run as
one vectorised `argsort` per race on Render's 0.1 CPU. Plackett–Luce is the natural extension of the
softmax the model already uses, so lower places stay consistent with its ranking. Races not yet
predicted (features only exist after qualifying) use each driver's mean win probability over the
last 5 predicted races. The RNG is seeded from `(year, after_round)` so reruns write identical rows,
keeping the job idempotent like every other ETL job.

## Consequences

Odds inherit the model's biases, including its grid-dominance (`docs/rulebased-architecture.md`).
Reliability isn't modelled separately: a DNF only appears through low win probability. Ties are
split rather than resolved on countback.
