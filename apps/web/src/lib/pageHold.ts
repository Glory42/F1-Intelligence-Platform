// Mirrors the API's isWriteWindow (apps/api/src/common/cache.ts): every scheduled Neon write lands in
// one, the worker's race weekend (Friday to Monday UTC) or the Wednesday 06:00 UTC F1DB import.
export function isWriteWindow(now: Date): boolean {
  const day = now.getUTCDay();
  const hour = now.getUTCHours();
  return day === 5 || day === 6 || day === 0 || day === 1 || (day === 3 && hour >= 6 && hour < 9);
}

const WRITE_WINDOW_STARTS = [{ day: 3, hour: 6 }, { day: 5, hour: 0 }];
const DAY_MS = 86_400_000;

function nextWriteWindowStart(now: Date): number {
  return Math.min(...WRITE_WINDOW_STARTS.map(({ day, hour }) => {
    const daysAhead = (day - now.getUTCDay() + 7) % 7;
    const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysAhead, hour);
    return start > now.getTime() ? start : start + 7 * DAY_MS;
  }));
}

function nextUtcMidnight(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
}

// Same as the API's CACHE_ACTIVE: the worker ingests on a 20-minute cycle inside a window.
const IN_WINDOW_SECONDS = 600;
const MIN_SECONDS = 60;

// Between windows the data can't change, so a page holds until the next one opens. Midnight UTC caps
// it too: pages pick today's date (On this day, the default season) when they render.
export function pageHoldSeconds(now: Date): number {
  if (isWriteWindow(now)) return IN_WINDOW_SECONDS;
  const until = Math.min(nextWriteWindowStart(now), nextUtcMidnight(now));
  return Math.max(MIN_SECONDS, Math.floor((until - now.getTime()) / 1000));
}
