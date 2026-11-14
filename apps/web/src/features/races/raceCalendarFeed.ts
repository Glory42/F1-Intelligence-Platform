import { api } from '@/lib/api';
import { serializeCalendar, type CalendarEvent } from '@/lib/icalendar';
import { SITE_NAME } from '@/lib/site';
import { unwrapSettled } from '@/lib/utils';
import type { Race } from '@/types';

type FeedSession = {
  key: string;
  label: string;
  minutes: number;
  start: (race: Race) => string | null;
  page: (race: Race) => string;
};

// Practice sessions aren't stored, so the feed carries only the sessions the ETL schedules around.
const SESSIONS: FeedSession[] = [
  { key: 'sprint-qualifying', label: 'Sprint Qualifying', minutes: 45, start: (r) => r.sprintQualifyingDate, page: (r) => `/races/${r.id}/sprint` },
  { key: 'sprint', label: 'Sprint', minutes: 60, start: (r) => r.sprintDate, page: (r) => `/races/${r.id}/sprint` },
  { key: 'qualifying', label: 'Qualifying', minutes: 60, start: (r) => r.qualifyingDate, page: (r) => `/races/${r.id}` },
  { key: 'race', label: 'Race', minutes: 120, start: (r) => r.raceDateUtc, page: (r) => `/races/${r.id}` },
];

export function raceCalendarEvents(races: Race[], site: URL): CalendarEvent[] {
  return races.flatMap((race) => SESSIONS.flatMap((session): CalendarEvent[] => {
    const start = session.start(race);
    if (!start) return [];
    const { circuit } = race;
    return [{
      // Stable across renders so a subscribed calendar updates the event instead of duplicating it.
      uid: `race-${race.id}-${session.key}@${site.host}`,
      summary: `${race.name}: ${session.label}`,
      start: new Date(start),
      durationMinutes: session.minutes,
      location: `${circuit.name}, ${circuit.city}, ${circuit.country}`,
      url: new URL(session.page(race), site).href,
    }];
  }));
}

// This season and the next, so a subscription carries over the winter once next year's calendar lands.
// Null when this season can't be read: an empty feed would wipe every subscriber's events.
export async function buildRaceCalendar(year: number, site: URL, now: Date): Promise<string | null> {
  const [current, next] = await Promise.allSettled([api.getRaces(year), api.getRaces(year + 1)]);
  if (current.status === 'rejected') return null;
  const races = [...current.value, ...unwrapSettled(next, [])];
  return serializeCalendar({ name: `${SITE_NAME}: F1 sessions`, events: raceCalendarEvents(races, site), stampedAt: now });
}
