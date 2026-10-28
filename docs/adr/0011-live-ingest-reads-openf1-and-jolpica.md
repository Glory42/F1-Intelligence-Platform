# Live ingest reads OpenF1 and Jolpica, not FastF1

On 24 Oct 2026 FastF1 3.9 began requiring an F1TV subscription (Access or higher) for most of its
data, "following changes by Formula 1": the timing feed FastF1 reads now sits behind an F1TV
login. Older FastF1 releases lost that feed too: our pinned 3.5.3 loads no laps, weather, race
control or telemetry for any session, old seasons included. Only `get_event_schedule` and the
results FastF1 takes from Ergast (which the pre-2018 `_legacy` jobs read) still work.

## Why we don't just log in

The project runs at $0: free tiers only, nothing paid. Beyond the money, an F1TV login is a bad
fit for a project like this one:
- **It's a recurring bill for a hobby site.** F1TV is a monthly or yearly subscription, and the
  price and the plans on sale vary by country. The site would go dark the month it lapses.
- **It ties the pipeline to one person's account.** The worker needs `F1_USERNAME`/`F1_PASSWORD`
  in Render's env vars, because FastF1's tokens last about four days and can't be refreshed. A
  personal streaming password ends up on a third-party host, and a password change, a payment
  failure or an extra login check stops ingest with no warning.
- **It's a viewing subscription, not a data licence.** F1TV is sold for watching. Feeding a
  public site from it is a use F1 can close off whenever it likes.
- **Nobody else can run it.** Every fork, contributor or fresh machine would need its own paid
  account just to ingest a race or rebuild the data.
- **Pinning didn't protect us.** The change broke the version we already had installed, not just
  new ones. A source that can be locked after the fact will be locked again.

## Decision

Live ingest (qualifying, sprint qualifying, sprint, race, FP2 long runs, race story,
`sync_season`) now reads finished sessions from OpenF1's free tier through `openf1_session.py`,
via the paced, budgeted `openf1_client` (ADR 0004). The race and sprint classification (grid,
status text, points, times) comes from Jolpica, the Ergast successor that FastF1 itself used
for those fields. Both are free and need no account. Rows keep the shapes the FastF1 helpers
produced, so upserts, the Race Status flow and the models are unchanged. Checked against the
FastF1 rows for Bahrain and Singapore 2026:
- Results, weather, SC/VSC lap counts and qualifying times match exactly.
- The accurate-lap set matches FastF1's `pick_accurate()`, apart from a few laps per race.

Known differences:
- `tyre_life`/`fresh_tyre` follow OpenF1's tyre age. Nothing reads them, and `race_stints` was
  already OpenF1's for 2023+.
- Race-story positions are the order cars crossed the line. That fixes FastF1 rows that
  contradicted the result.
- SQ1-SQ3 come from the official classification instead of FastF1's lap split.

## Consequences

FastF1 stays a dependency for the event schedule, the pre-2018 `_legacy` jobs (Ergast results)
and the local 2018–2022 backfills, which work only from an existing FastF1 cache. The 2018–2022
laps already in the database stay, but they can't be re-ingested: OpenF1 starts in 2023.

A session reaches OpenF1's free tier about 30 min after it ends and Jolpica within hours, so a
stage may ingest a cycle or two later than before. That retry already exists.

OpenF1 also builds on F1's timing data, so the same thing could happen to it. Every OpenF1 and
Jolpica field the jobs read goes through `openf1_session.py` and `jolpica_client.py`, so moving
to another free source means rewriting those two modules, not the jobs. If FastF1's schedule
breaks too, Jolpica's `/{year}.json` calendar replaces it.

Since 2026-10-28 that boundary is enforced by structure: `openf1_session.py` is the only module that reads
OpenF1 or Jolpica fields, and it returns `session_records` (stints, pit stops, race-control messages,
overtakes, radio clips, car and position samples). `fastf1_session.py` returns the same records for the
2018–2022 backfills, so a third source is a third adapter with the same interface.
