# OpenF1 requests are paced, retried and budgeted per worker cycle

CLAUDE.md used to forbid `sleep()` in jobs because Render cron jobs had a timeout. The data engine
no longer runs as cron jobs — it is one long-running Render web service whose worker loop already
sleeps between cycles — while OpenF1's free tier allows only about 3 requests a second and 30 a
minute. `openf1_client` therefore spaces requests 2 s apart, retries 429/5xx/connection errors up to
three attempts with 1 s and 2 s backoff, and the worker gives each cycle a budget of 25 requests
(`DEFAULT_REQUEST_BUDGET`). Work that needs more than one cycle's budget (e.g. telemetry) must be
resumable and finish on later cycles; manual CLI runs are unbudgeted but still paced.

This is the only sanctioned wait in ETL code. Waiting for data that isn't published yet is still
done by retrying on the next worker cycle, never by sleeping inside a job.
