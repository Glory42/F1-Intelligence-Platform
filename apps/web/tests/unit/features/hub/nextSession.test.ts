import { describe, expect, it } from 'vitest';
import { nextSession, weekendSessions } from '@/features/hub/nextSession';

const sprintWeekend = {
  sprintQualifyingDate: '2026-11-06T18:30:00.000Z',
  sprintDate: '2026-11-07T14:00:00.000Z',
  qualifyingDate: '2026-11-07T18:00:00.000Z',
  raceDateUtc: '2026-11-08T17:00:00.000Z',
  raceDate: '2026-11-08',
};

describe('nextSession', () => {
  it('counts down to whichever session of the weekend comes next', () => {
    expect(nextSession(sprintWeekend, new Date('2026-11-07T12:00:00Z'))).toEqual({ label: 'Sprint', date: '2026-11-07T14:00:00.000Z' });
    expect(nextSession(sprintWeekend, new Date('2026-11-07T16:00:00Z'))).toEqual({ label: 'Qualifying', date: '2026-11-07T18:00:00.000Z' });
  });

  it('falls back to the race date when no session time is known', () => {
    const bare = { sprintQualifyingDate: null, sprintDate: null, qualifyingDate: null, raceDateUtc: null, raceDate: '2026-11-08' };

    expect(nextSession(bare, new Date('2026-11-01T00:00:00Z'))).toEqual({ label: 'Race', date: '2026-11-08' });
  });
});

describe('weekendSessions', () => {
  it('lists every session of the weekend in order, marking what is done and what is next', () => {
    expect(weekendSessions(sprintWeekend, new Date('2026-11-07T16:00:00Z'))).toEqual([
      { label: 'Sprint Qualifying', date: '2026-11-06T18:30:00.000Z', state: 'done' },
      { label: 'Sprint', date: '2026-11-07T14:00:00.000Z', state: 'done' },
      { label: 'Qualifying', date: '2026-11-07T18:00:00.000Z', state: 'next' },
      { label: 'Race', date: '2026-11-08T17:00:00.000Z', state: 'upcoming' },
    ]);
  });

  it('leaves out sessions a conventional weekend does not have', () => {
    const conventional = { ...sprintWeekend, sprintQualifyingDate: null, sprintDate: null };

    expect(weekendSessions(conventional, new Date('2026-11-01T00:00:00Z')).map((s) => s.label)).toEqual(['Qualifying', 'Race']);
  });

  it('marks every session done once the race has started', () => {
    const states = weekendSessions(sprintWeekend, new Date('2026-11-08T18:00:00Z')).map((s) => s.state);

    expect(states).toEqual(['done', 'done', 'done', 'done']);
  });
});
