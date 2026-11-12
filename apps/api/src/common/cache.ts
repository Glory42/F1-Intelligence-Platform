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

export function maxAgeSeconds(cacheControl: string): number {
  return Number(/max-age=(\d+)/.exec(cacheControl)?.[1] ?? 0);
}

// Every scheduled Neon write falls in one: the worker's race weekend (until 24 h after a Sunday race)
// and the F1DB import (.github/workflows/f1db-import.yml, Wednesday 06:00 UTC; Actions cron runs late).
export function isWriteWindow(now: Date): boolean {
  const day = now.getUTCDay();
  const hour = now.getUTCHours();
  return day === 5 || day === 6 || day === 0 || day === 1 || (day === 3 && hour >= 6 && hour < 9);
}

const WRITE_WINDOW_STARTS = [{ day: 3, hour: 6 }, { day: 5, hour: 0 }];
const WEEK_MS = 7 * 86_400_000;

function nextWriteWindowStart(now: Date): number {
  return Math.min(...WRITE_WINDOW_STARTS.map(({ day, hour }) => {
    const daysAhead = (day - now.getUTCDay() + 7) % 7;
    const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysAhead, hour);
    return start > now.getTime() ? start : start + WEEK_MS;
  }));
}

// Between write windows Neon can't change, so a copy holds until the next one opens (a completed
// answer, for good); one written inside a window lasts only its max-age.
export function snapshotFreshUntil(cacheControl: string, now: Date): number {
  const byMaxAge = now.getTime() + maxAgeSeconds(cacheControl) * 1000;
  if (isWriteWindow(now)) return byMaxAge;
  if (cacheControl.includes('immutable')) return Infinity;
  return Math.max(byMaxAge, nextWriteWindowStart(now));
}

// Enrichment (race story, telemetry, history…) can arrive after the race via backfills; caching an
// empty answer for a day would hide the data once it lands.
export function cacheIfData(cacheControl: string, hasData: boolean): string {
  return hasData ? cacheControl : CACHE_ACTIVE;
}
