# API integration tests run on local Postgres, never on Neon

`apps/api` integration tests used to run against a dedicated Neon test branch. Neon Free gives each
project 100 CU-hours a month shared by every branch, every test run wakes the compute for at least
five minutes, and the project now works test-first — so the test loop alone could spend a large part
of the month's compute and take production down with it. The suite now runs against
`postgres:16-alpine` behind `ghcr.io/timowilhelm/local-neon-http-proxy` (`docker-compose.test.yml`),
both locally and in CI. The Worker code is unchanged: `@neondatabase/serverless` is pointed at the
proxy through `neonConfig.fetchEndpoint` (`src/config/localNeonProxy.ts`), which only the test setup
and the migration script call.

## Consequences

Docker is now required to run the integration suite. `apps/api/.env.test` is committed (docker-only
credentials) so `bun test` picks it up over `.env` automatically, and `tests/support/db/test-db.ts`
refuses `*.neon.tech` hosts unless `TEST_DB_ALLOW_NEON=1`. The `TEST_DATABASE_URL` GitHub secret and
the Neon test branch are no longer used and can be deleted.
