# Drivers are unique per person per season, and pre-2018 results are rebuilt from F1DB

`drivers` was unique on (season, car number) and only filled from one round's lineup, while every
ingest matched results by driver code and skipped unknowns. That lost 3,439 race results across
1980–2026: mid-season stand-ins never got a row; before 2014 numbers belonged to the car, so a
stand-in (Badoer in Massa's #3) couldn't exist next to the regular driver and an upsert overwrote
him (Senna's 1994 row became Mansell's); a driver who changed number got two rows; and FastF1's NaN
codes became "NAN", collapsing most 1991–2004 drivers into one.

We now key `drivers` on (season, first name, last name) — the person — with the car number a plain
index, and ingest registers every driver its session lists before mapping results, failing on any
it still can't place. History before FastF1 (1980–2017) is rebuilt from F1DB, which we already
import and credit, rather than re-fetching ~700 races from the rate-limited Ergast mirror;
2018+ is re-ingested from FastF1 so laps and race story come back too.

## Consequences

F1DB is the source of truth for pre-2018 results and codes (its abbreviations repeat within some
seasons — Bernard and Berger are both BER in 1990 — so codes are labels, not keys). A driver who
changed teams mid-season still has one row and one team per season. `scripts/audit_results_vs_f1db.py`
re-checks every race against F1DB after any backfill.
