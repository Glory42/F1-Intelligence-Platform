// A completed race's results/predictions never change (idempotent ETL): safe to cache long
// and immutable. Anything still in progress can change as the weekend progresses.
export const CACHE_COMPLETED = 'public, max-age=86400, immutable';
export const CACHE_ACTIVE = 'public, max-age=30';

export function cacheControlForStatus(status: string): string {
  return status === 'completed' ? CACHE_COMPLETED : CACHE_ACTIVE;
}

export function cacheControlForYear(year: number, now: Date = new Date()): string {
  return year < now.getFullYear() ? CACHE_COMPLETED : CACHE_ACTIVE;
}

// Enrichment (race story, telemetry, history…) can arrive after the race via backfills; caching an
// empty answer for a day would hide the data once it lands.
export function cacheIfData(cacheControl: string, hasData: boolean): string {
  return hasData ? cacheControl : CACHE_ACTIVE;
}
