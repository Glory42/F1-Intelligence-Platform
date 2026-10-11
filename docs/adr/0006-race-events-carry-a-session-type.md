# Race events carry a session type instead of a separate sprint table

A sprint weekend's sprint and grand prix share one `races` row, so OpenF1 race events
(race control, overtakes, team radio) and the newer stints/pit-stop tables need to say which
session they came from. Rather than duplicating each table for sprints (as `sprint_results` /
`sprint_lap_times` did for FastF1 data), every OpenF1 table has a `session_type` column (`race`
default, or `sprint`) written by the shared `run_openf1_job`, and the API filters on it via
`?session=`. For the three original tables it is not part of the unique key: their natural keys
already include the event timestamp, which differs between sessions: so re-running a sprint
ingest simply re-tags rows through the existing upsert. Rows that existed before the column were
backfilled by time: on a sprint weekend, anything stamped more than 12 h before the GP start is
the sprint (migration 0020). For `race_stints` / `race_pit_stops` the stint number and lap number
repeat across sessions, so there `session_type` is part of the unique key.
