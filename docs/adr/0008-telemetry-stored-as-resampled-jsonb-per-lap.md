# Qualifying telemetry is stored as one resampled JSONB row per driver lap

OpenF1 car data arrives at ~3.7 Hz with no distance channel, and storing raw samples would cost
~600 rows per lap per channel set. Instead `ingest_qualifying_telemetry` keeps only each driver's
fastest qualifying lap, integrates distance from speed (padded to the official lap start and finish
so per-driver sample timing can't skew deltas), scales it to the circuit length, and resamples every
channel onto a fixed 10 m grid as integers. One JSONB row per driver lap (~11 KB after TOAST, ~6 MB a
season) is always read whole for a comparison, so there is nothing to gain from a row per sample, and
a shared grid lets the web compare two laps index by index. The comparison page is server-rendered
from a GET form (`?a=&b=`), so it needs no client-side fetch.

## Consequences

Distance is approximate (speed integration, not GPS), good to a few metres per corner — fine for
speed traces and mini-sectors, not for racing-line analysis. Only fastest laps exist; race-lap
telemetry would need a different storage budget.
