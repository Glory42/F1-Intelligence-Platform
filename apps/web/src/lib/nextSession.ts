interface WeekendTimes {
  sprintQualifyingDate: string | null;
  sprintDate: string | null;
  qualifyingDate: string | null;
  raceDateUtc: string | null;
  raceDate: string;
}

export interface UpcomingSession {
  label: string;
  date: string;
}

export function nextSession(race: WeekendTimes, now: Date): UpcomingSession {
  const sessions: Array<[string, string | null]> = [
    ['Sprint Qualifying', race.sprintQualifyingDate],
    ['Sprint', race.sprintDate],
    ['Qualifying', race.qualifyingDate],
    ['Race', race.raceDateUtc],
  ];
  const upcoming = sessions.find(([, date]) => date != null && new Date(date) > now);
  return upcoming ? { label: upcoming[0], date: upcoming[1]! } : { label: 'Race', date: race.raceDateUtc ?? race.raceDate };
}

export type SessionState = 'done' | 'next' | 'upcoming';
export interface WeekendSession extends UpcomingSession {
  state: SessionState;
}

export function weekendSessions(race: WeekendTimes, now: Date): WeekendSession[] {
  const sessions: Array<[string, string | null]> = [
    ['Sprint Qualifying', race.sprintQualifyingDate],
    ['Sprint', race.sprintDate],
    ['Qualifying', race.qualifyingDate],
    ['Race', race.raceDateUtc ?? race.raceDate],
  ];
  let nextFound = false;
  return sessions
    .filter((s): s is [string, string] => s[1] != null)
    .map(([label, date]) => {
      if (new Date(date) <= now) return { label, date, state: 'done' as const };
      const state: SessionState = nextFound ? 'upcoming' : 'next';
      nextFound = true;
      return { label, date, state };
    });
}
