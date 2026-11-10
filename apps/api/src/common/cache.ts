// A completed race's results/predictions never change (idempotent ETL): safe to cache long
// and immutable. Anything still in progress changes only when the ETL runs: 10 minutes late is
// harmless, while a shorter TTL kept Neon awake all day (it sleeps after 5 quiet minutes).
export const CACHE_COMPLETED = 'public, max-age=86400, immutable';
export const CACHE_ACTIVE = 'public, max-age=600';
// Outside race weekends the ETL has nothing to ingest, so in-progress data can sit for an hour.
export const CACHE_QUIET = 'public, max-age=3600';
// Seasons, circuits, the search index and the model version change only when the ETL runs: an
// hour of staleness is harmless and saves a Neon wake on nearly every page view.
export const CACHE_REFERENCE = 'public, max-age=3600';

// Every session (Las Vegas included) ends between Friday and Sunday UTC, and the worker's
// ingests and retries finish by Monday morning.
export function isIngestWindow(now: Date): boolean {
  const day = now.getUTCDay();
  return day === 5 || day === 6 || day === 0 || (day === 1 && now.getUTCHours() < 12);
}

export function cacheControlForActive(now: Date = new Date()): string {
  return isIngestWindow(now) ? CACHE_ACTIVE : CACHE_QUIET;
}

export function cacheControlForStatus(status: string, now: Date = new Date()): string {
  return status === 'completed' ? CACHE_COMPLETED : cacheControlForActive(now);
}

export function cacheControlForYear(year: number, now: Date = new Date()): string {
  return year < now.getFullYear() ? CACHE_COMPLETED : cacheControlForActive(now);
}

// Enrichment (race story, telemetry, history…) can arrive after the race via backfills; caching an
// empty answer for a day would hide the data once it lands.
export function cacheIfData(cacheControl: string, hasData: boolean): string {
  return hasData ? cacheControl : CACHE_ACTIVE;
}
