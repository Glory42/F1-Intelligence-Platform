import { describe, expect, test } from 'vitest';
import { server } from '../../../support/msw/server';
import { apiError } from '../../../support/msw/routes';
import { circuit } from '../../../support/msw/fixtures';
import { http, HttpResponse } from 'msw';
import { buildRaceCalendar, raceCalendarEvents } from '@/features/races/raceCalendarFeed';
import type { Race } from '@/types';

const SITE = new URL('https://f1.example');
const NOW = new Date('2026-11-14T09:30:00.000Z');

const race = (overrides: Partial<Race> = {}) => ({
  id: 7, name: 'Italian Grand Prix', circuit, raceDate: '2025-09-07', raceDateUtc: '2025-09-07T13:00:00.000Z',
  qualifyingDate: '2025-09-06T14:00:00.000Z', sprintDate: null, sprintQualifyingDate: null, ...overrides,
}) as Race;

describe('raceCalendarEvents', () => {
  test('lists qualifying and the race with stable ids and their own pages', () => {
    const events = raceCalendarEvents([race()], SITE);

    expect(events.map((e) => [e.uid, e.summary, e.start.toISOString(), e.durationMinutes, e.url])).toEqual([
      ['race-7-qualifying@f1.example', 'Italian Grand Prix: Qualifying', '2025-09-06T14:00:00.000Z', 60, 'https://f1.example/races/7'],
      ['race-7-race@f1.example', 'Italian Grand Prix: Race', '2025-09-07T13:00:00.000Z', 120, 'https://f1.example/races/7'],
    ]);
    expect(events[0].location).toBe('Autodromo Nazionale Monza, Monza, Italy');
  });

  test('adds the sprint sessions on a sprint weekend, linked to the sprint page', () => {
    const events = raceCalendarEvents([race({
      sprintQualifyingDate: '2025-09-05T18:30:00.000Z', sprintDate: '2025-09-06T10:00:00.000Z',
    })], SITE);

    expect(events.map((e) => e.summary)).toEqual([
      'Italian Grand Prix: Sprint Qualifying', 'Italian Grand Prix: Sprint',
      'Italian Grand Prix: Qualifying', 'Italian Grand Prix: Race',
    ]);
    expect(events[1].url).toBe('https://f1.example/races/7/sprint');
  });

  test('skips sessions without a start time', () => {
    expect(raceCalendarEvents([race({ raceDateUtc: null, qualifyingDate: null })], SITE)).toEqual([]);
  });
});

describe('buildRaceCalendar', () => {
  test("carries next season's races once they exist", async () => {
    server.use(http.get('http://localhost:8787/api/races', ({ request }) => {
      const year = new URL(request.url).searchParams.get('year');
      const data = year === '2026' ? [race()] : [race({ id: 40, name: 'Australian Grand Prix' })];
      return HttpResponse.json({ data, error: null });
    }));

    const ics = await buildRaceCalendar(2026, SITE, NOW);

    expect(ics).toContain('UID:race-7-race@f1.example');
    expect(ics).toContain('UID:race-40-race@f1.example');
  });

  test("still serves this season when next season can't be read", async () => {
    server.use(http.get('http://localhost:8787/api/races', ({ request }) =>
      new URL(request.url).searchParams.get('year') === '2027'
        ? HttpResponse.json({ data: null, error: { code: 'X', message: 'down' } }, { status: 500 })
        : HttpResponse.json({ data: [race()], error: null })));

    expect(await buildRaceCalendar(2026, SITE, NOW)).toContain('UID:race-7-race@f1.example');
  });

  test("gives nothing rather than an empty feed when this season can't be read", async () => {
    server.use(apiError('/api/races'));

    expect(await buildRaceCalendar(2026, SITE, NOW)).toBeNull();
  });
});
