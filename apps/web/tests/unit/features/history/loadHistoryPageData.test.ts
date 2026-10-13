import { describe, expect, test } from 'vitest';
import { server } from '../../../support/msw/server';
import { apiError, apiOk, recordApiRequests } from '../../../support/msw/routes';
import { loadHistoryPageData } from '@/features/history/loadHistoryPageData';
import type {
  ConstructorLineage, HistoryMilestones, HistoryRecords, MilestoneEntry, OnThisDay, RecordEntry,
} from '@/types';

const NOW = new Date('2025-09-08T10:00:00Z');

function entry(name: string, value: number, coreId: number | null, active = false): RecordEntry {
  return { f1dbId: name.toLowerCase().replace(/ /g, '-'), name, value, nationality: 'germany', coreId, active };
}

const hamilton = entry('Lewis Hamilton', 105, 44, true);
const schumacher = entry('Michael Schumacher', 91, null);

const records: HistoryRecords = {
  drivers: {
    wins: [hamilton, schumacher],
    championships: [entry('Michael Schumacher', 7, null), entry('Lewis Hamilton', 7, 44, true), entry('Sebastian Vettel', 4, 5)],
    poles: [entry('Lewis Hamilton', 104, 44, true)],
    podiums: [],
    starts: [entry('Fernando Alonso', 400, 14, true)],
  },
  constructors: { wins: [entry('Ferrari', 248, 3, true)], championships: [entry('Williams', 9, null)], poles: [] },
  rates: { winRate: [entry('Juan Manuel Fangio', 0.4706, null)], poleRate: [], podiumRate: [] },
  rateMinStarts: 50,
  chases: [],
};

function page(query = '') {
  return new URL(`http://localhost/history${query}`);
}

describe('loadHistoryPageData: records', () => {
  test('the default records tab fetches only the records and links drivers we track', async () => {
    const requested = recordApiRequests();
    server.use(apiOk('/api/history/records', records));

    const data = await loadHistoryPageData(page(), NOW);

    expect(data.tab).toBe('records');
    expect(requested).toEqual(['/api/history/records?v=3']);
    expect(data.records?.drivers.wins).toEqual([
      { name: 'Lewis Hamilton', value: 105, display: undefined, nationality: 'germany', href: '/drivers/44', active: true },
      { name: 'Michael Schumacher', value: 91, display: undefined, nationality: 'germany', href: undefined, active: false },
    ]);
  });

  test('formats rates, links constructors to team pages and builds the headline tiles', async () => {
    server.use(apiOk('/api/history/records', records));

    const data = await loadHistoryPageData(page(), NOW);

    expect(data.records?.rates.winRate[0]).toMatchObject({ name: 'Juan Manuel Fangio', display: '47.1%' });
    expect(data.records?.constructors.wins[0]).toMatchObject({ name: 'Ferrari', href: '/teams/3' });
    expect(data.records?.constructors.championships[0].href).toBeUndefined();
    expect(data.records?.headline.championships).toEqual({
      value: '7',
      holders: [
        { name: 'Michael Schumacher', nationality: 'germany', href: undefined, active: false },
        { name: 'Lewis Hamilton', nationality: 'germany', href: '/drivers/44', active: true },
      ],
    });
    expect(data.records?.headline.wins.holders.map((h) => h.name)).toEqual(['Lewis Hamilton']);
    expect(data.records?.headline.starts.value).toBe('400');
  });

  test('records that fail to load leave the tab empty, titled for the tab', async () => {
    server.use(apiError('/api/history/records'));

    const data = await loadHistoryPageData(page(), NOW);

    expect(data.records).toBeNull();
    expect(data.title).toBe('All-time records');
  });
});

function milestone(name: string, days: number, raceName: string, coreId: number | null): MilestoneEntry {
  return { f1dbId: name, name, nationality: 'netherlands', coreId, active: coreId != null, days, raceName };
}

describe('loadHistoryPageData: on this day', () => {
  test('asks for the requested day, or today when the date is missing or invalid', async () => {
    const requested = recordApiRequests();
    const day: OnThisDay = { requested: '12-25', date: '12-13', races: [] };
    server.use(apiOk('/api/history/on-this-day', day));

    const christmas = await loadHistoryPageData(page('?tab=on-this-day&date=12-25'), NOW);
    const bogus = await loadHistoryPageData(page('?tab=on-this-day&date=02-30'), NOW);

    expect(christmas).toMatchObject({ requestedDay: '12-25', currentYear: 2025, onThisDay: day, title: 'On this day' });
    expect(bogus.requestedDay).toBe('09-08');
    expect(requested).toEqual(['/api/history/on-this-day?date=12-25&v=2', '/api/history/on-this-day?date=09-08&v=2']);
  });
});

describe('loadHistoryPageData: lineage', () => {
  test('starts the timeline at the decade of the earliest member', async () => {
    const member = (f1dbId: string, yearFrom: number, yearTo: number | null) => ({
      f1dbId, name: f1dbId, yearFrom, yearTo, raceWins: 0, championships: 0, coreId: null,
    });
    const lineages: ConstructorLineage[] = [
      { f1dbId: 'red-bull', name: 'Red Bull', coreTeam: null, active: true, members: [member('stewart', 1997, 1999), member('red-bull', 2005, null)] },
      { f1dbId: 'alpine', name: 'Alpine', coreTeam: null, active: true, members: [member('toleman', 1981, 1985)] },
    ];
    server.use(apiOk('/api/history/lineages', lineages));

    const data = await loadHistoryPageData(page('?tab=lineage'), NOW);

    expect(data.lineages).toHaveLength(2);
    expect(data.lineageStart).toBe(1980);
  });

  test('with no lineages the timeline starts at the current decade', async () => {
    server.use(apiError('/api/history/lineages'));

    const data = await loadHistoryPageData(page('?tab=lineage'), NOW);

    expect(data.lineages).toEqual([]);
    expect(data.lineageStart).toBe(2020);
  });
});

describe('loadHistoryPageData: milestones', () => {
  test('fetches only milestones and shows each as an age with the race it came at', async () => {
    const requested = recordApiRequests();
    const verstappen = milestone('Max Verstappen', 6_802, '2016 Spanish Grand Prix', 10);
    const milestones: HistoryMilestones = {
      youngestWinner: [verstappen], youngestPole: [], youngestPodium: [verstappen], youngestStarter: [],
      oldestFirstWin: [milestone('Luigi Fagioli', 19_301, '1951 French Grand Prix', null)], longestWaitForWin: [],
    };
    server.use(apiOk('/api/history/milestones', milestones));

    const data = await loadHistoryPageData(page('?tab=milestones'), NOW);

    expect(requested).toEqual(['/api/history/milestones?v=2']);
    expect(data.records).toBeNull();
    expect(data.milestones?.rows.youngestWinner).toEqual([{
      name: 'Max Verstappen', value: 6_802, display: '18 y 228 d', detail: '2016 Spanish Grand Prix',
      nationality: 'netherlands', href: '/drivers/10', active: true,
    }]);
    expect(data.milestones?.headline.youngestPole).toBeNull();
    expect(data.milestones?.headline.oldestFirstWin).toEqual({
      value: '52 y 308 d', detail: '1951 French Grand Prix',
      holders: [{ name: 'Luigi Fagioli', nationality: 'netherlands', href: undefined, active: false }],
    });
  });
});
