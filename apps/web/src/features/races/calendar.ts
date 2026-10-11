import type { Race } from '@/types';

export type CalendarFilter = 'all' | 'sprint' | 'gp';
export type CalendarSort = 'asc' | 'desc';

// A sprint weekend is two entries: the sprint (earlier, links to /sprint) then the grand prix.
export type CalendarEntry = { race: Race; sprint: boolean; href: string; date: string };

export function parseCalendarFilter(value: string | null): CalendarFilter {
  return value === 'sprint' || value === 'gp' ? value : 'all';
}

export function parseCalendarSort(value: string | null): CalendarSort {
  return value === 'desc' ? 'desc' : 'asc';
}

export function calendarEntries(races: Race[], filter: CalendarFilter, sort: CalendarSort): CalendarEntry[] {
  const entries = races.flatMap((race): CalendarEntry[] => {
    const gp = { race, sprint: false, href: `/races/${race.id}`, date: race.raceDate };
    return race.hasSprint
      ? [{ race, sprint: true, href: `/races/${race.id}/sprint`, date: race.sprintDate ?? race.raceDate }, gp]
      : [gp];
  });
  const filtered = filter === 'all' ? entries : entries.filter((e) => e.sprint === (filter === 'sprint'));
  return sort === 'desc' ? filtered.reverse() : filtered;
}

// Each link keeps the other params; defaults stay out of the URL.
export function calendarQuery(year: number, filter: CalendarFilter, sort: CalendarSort): string {
  return `?year=${year}${filter !== 'all' ? `&filter=${filter}` : ''}${sort !== 'asc' ? `&sort=${sort}` : ''}`;
}

export function calendarSummary(filter: CalendarFilter, completed: { races: number; entries: number }, upcoming: { races: number; entries: number }): string {
  if (filter === 'sprint') return `${completed.entries} sprint completed · ${upcoming.entries} remaining`;
  return `${completed.races} ${filter === 'gp' ? 'GP' : 'races'} completed · ${upcoming.races} remaining`;
}
