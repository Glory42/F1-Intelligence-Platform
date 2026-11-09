# Security Policy

## Supported versions

Only the live site and the `master` branch are supported. Fixes are deployed from `master`; there are no
versioned releases to backport to.

## Reporting a vulnerability

Please **don't open a public issue** for a security problem.

Report it privately through GitHub:
[**Report a vulnerability**](https://github.com/Glory42/F1-Intelligence-Platform/security/advisories/new)
(Security tab → Advisories → Report a vulnerability).

Include:

- what is affected (page, API route, ETL job, workflow)
- steps or a proof of concept to reproduce it
- the impact you think it has

This is a one-person side project, so expect a first reply within about a week. You'll hear back whether
the report is accepted, and you'll be credited in the fix unless you'd rather not be.

## Scope

In scope:

- the website and the public API (`apps/web`, `apps/api`)
- the data engine and its GitHub Actions workflows (`data-engine`, `.github/workflows`)
- leaked credentials or secrets anywhere in the repository

Out of scope:

- denial of service or load testing against the live site, API or database
- the third-party data sources (OpenF1, Jolpica, F1DB, FastF1): report those to their maintainers
- findings that need a compromised device or browser
- missing headers or best-practice notes with no demonstrable impact

The API is read-only and public by design: it has no authentication and no write endpoints, so reading
any data it serves is not a vulnerability.
