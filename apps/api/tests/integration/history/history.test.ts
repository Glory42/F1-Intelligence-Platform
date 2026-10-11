import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { apiRequest } from '../../support/app/request';
import { getTestDb, truncateAll } from '../../support/db/test-db';
import { createSeason } from '../../support/factories/season.factory';
import { createTeam } from '../../support/factories/team.factory';
import { createDriver } from '../../support/factories/driver.factory';
import { createCircuit } from '../../support/factories/circuit.factory';
import { createRace } from '../../support/factories/race.factory';
import { createRaceResult } from '../../support/factories/raceResult.factory';
import {
  createHistoryConstructor, createHistoryConstructorSeason, createHistoryDriver, createHistoryLineage,
} from '../../support/factories/history.factory';
import type { ConstructorLineage, HistoryMilestones, HistoryRecords, OnThisDay } from '../../../src/common/types';

describe('history (integration)', () => {
  const db = getTestDb();
  let perezId: number;
  let redBullId: number;
  let schumacherId: number;
  let stewartId: number;
  let verstappenId: number;

  beforeAll(async () => {
    await truncateAll(db);
    await createHistoryDriver(db, { f1dbId: 'lewis-hamilton', name: 'Lewis Hamilton', nationality: 'united-kingdom', raceWins: 106,
      championships: 7, polePositions: 104, raceStarts: 380, dateOfBirth: '1985-01-07', firstWinDate: '2007-06-10', firstWinName: 'Canadian GP' });
    await createHistoryDriver(db, { f1dbId: 'michael-schumacher', name: 'Michael Schumacher', raceWins: 91, championships: 7, raceStarts: 306 });
    await createHistoryDriver(db, { f1dbId: 'max-verstappen', name: 'Max Verstappen', raceWins: 72, championships: 4, polePositions: 49,
      raceStarts: 230, dateOfBirth: '1997-09-30', firstRaceDate: '2015-03-15', firstRaceName: 'Australian GP',
      firstWinDate: '2016-05-15', firstWinName: 'Spanish GP' });
    await createHistoryDriver(db, { f1dbId: 'sergio-perez', name: 'Sergio Pérez', matchKey: 'sergio perez', raceWins: 6,
      raceStarts: 281, dateOfBirth: '1990-01-26', firstRaceDate: '2011-03-27', firstRaceName: 'Australian GP',
      firstWinDate: '2020-12-06', firstWinName: 'Sakhir GP' });
    await createHistoryDriver(db, { f1dbId: 'one-race-wonder', name: 'One Race Wonder', raceWins: 1, raceStarts: 1 });
    await createHistoryConstructor(db, { f1dbId: 'red-bull', name: 'Red Bull', raceWins: 130, championships: 6 });
    await createHistoryConstructor(db, { f1dbId: 'stewart', name: 'Stewart', raceWins: 1 });
    await createHistoryConstructorSeason(db, 'red-bull', 2026, 'RB22', 'Red Bull Ford');
    const redBullChain = [
      { constructorF1dbId: 'stewart', yearFrom: 1997, yearTo: 1999 },
      { constructorF1dbId: 'red-bull', yearFrom: 2005, yearTo: null },
    ];
    await createHistoryLineage(db, 'red-bull', redBullChain);
    await createHistoryLineage(db, 'stewart', redBullChain);

    const pastSeason = await createSeason(db, { year: 2070 });
    const stewart = await createTeam(db, pastSeason.id, { teamKey: 'stewart', name: 'Stewart' });
    stewartId = stewart.id;
    const schumacher = await createDriver(db, pastSeason.id, stewart.id, { driverNumber: 3, code: 'MSC', firstName: 'Michael', lastName: 'Schumacher' });
    schumacherId = schumacher.id;
    await createDriver(db, pastSeason.id, stewart.id, { driverNumber: 33, code: 'VER', firstName: 'Max', lastName: 'Verstappen' });

    const season = await createSeason(db, { year: 2085 });
    const team = await createTeam(db, season.id, { teamKey: 'red_bull_racing', name: 'Red Bull Racing' });
    redBullId = team.id;
    const perez = await createDriver(db, season.id, team.id, { driverNumber: 11, code: 'PER', firstName: 'Sergio', lastName: 'Perez' });
    perezId = perez.id;
    const verstappen = await createDriver(db, season.id, team.id, { driverNumber: 1, code: 'VER', firstName: 'Max', lastName: 'Verstappen' });
    verstappenId = verstappen.id;

    const circuit = await createCircuit(db);
    const race = await createRace(db, season.id, circuit.id, { name: 'Italian Grand Prix', raceDate: '2085-09-07' });
    await createRaceResult(db, race.id, verstappen.id);
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  it('ranks all-time leaders with nationality and flags drivers still on the grid', async () => {
    const res = await apiRequest('/api/history/records');
    const { data } = (await res.json()) as { data: HistoryRecords };

    expect(data.drivers.wins.map((r) => [r.name, r.value]).slice(0, 2)).toEqual([['Lewis Hamilton', 106], ['Michael Schumacher', 91]]);
    expect(data.drivers.championships.slice(0, 2).map((r) => r.name)).toEqual(['Lewis Hamilton', 'Michael Schumacher']);
    expect(data.drivers.wins[0]).toMatchObject({ nationality: 'united-kingdom', coreId: null, active: false });
    expect(data.drivers.wins.find((r) => r.f1dbId === 'max-verstappen')).toMatchObject({ coreId: verstappenId, active: true });
    expect(data.constructors.wins[0]).toEqual({
      f1dbId: 'red-bull', name: 'Red Bull', value: 130, nationality: null, coreId: redBullId, active: true,
    });
  });

  it('links former drivers and constructors that have a core page without marking them active', async () => {
    const res = await apiRequest('/api/history/records');
    const { data } = (await res.json()) as { data: HistoryRecords };

    expect(data.drivers.wins.find((r) => r.f1dbId === 'michael-schumacher')).toMatchObject({ coreId: schumacherId, active: false });
    expect(data.constructors.wins.find((r) => r.f1dbId === 'stewart')).toMatchObject({ coreId: stewartId, active: false });
  });

  it('ranks strike rates only among drivers with enough starts', async () => {
    const res = await apiRequest('/api/history/records');
    const { data } = (await res.json()) as { data: HistoryRecords };

    expect(data.rateMinStarts).toBe(50);
    expect(data.rates.winRate.map((r) => r.f1dbId)).not.toContain('one-race-wonder');
    expect(data.rates.winRate[0]).toMatchObject({ f1dbId: 'max-verstappen' });
    expect(data.rates.winRate[0].value).toBeCloseTo(72 / 230, 5);
  });

  it('pairs each record with the best active driver chasing it', async () => {
    const res = await apiRequest('/api/history/records');
    const { data } = (await res.json()) as { data: HistoryRecords };

    const wins = data.chases.find((c) => c.stat === 'wins');
    expect([wins?.record.name, wins?.chaser?.name, wins?.chaser?.value]).toEqual(['Lewis Hamilton', 'Max Verstappen', 72]);
  });

  it('lists milestone ages and the longest wait for a first win', async () => {
    const res = await apiRequest('/api/history/milestones');
    const { data } = (await res.json()) as { data: HistoryMilestones };

    expect(data.youngestWinner[0]).toMatchObject({ f1dbId: 'max-verstappen', days: 6802, raceName: 'Spanish GP' });
    expect(data.longestWaitForWin[0]).toMatchObject({ f1dbId: 'sergio-perez', raceName: 'Sakhir GP' });
    expect(data.youngestPole).toEqual([]);
  });

  it('groups constructor lineages into one family per team, linked to the current team', async () => {
    const res = await apiRequest('/api/history/lineages');
    const { data } = (await res.json()) as { data: ConstructorLineage[] };

    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ f1dbId: 'red-bull', name: 'Red Bull', active: true, coreTeam: { id: redBullId, teamKey: 'red_bull_racing' } });
    expect(data[0].members.map((m) => [m.name, m.yearFrom, m.yearTo, m.coreId])).toEqual([
      ['Stewart', 1997, 1999, stewartId], ['Red Bull', 2005, null, redBullId],
    ]);
  });

  it('returns races on the requested day with their winner', async () => {
    const res = await apiRequest('/api/history/on-this-day?date=09-07');
    const { data } = (await res.json()) as { data: OnThisDay };

    expect([data.requested, data.date]).toEqual(['09-07', '09-07']);
    expect(data.races.map((r) => [r.year, r.name, r.winner?.code])).toEqual([[2085, 'Italian Grand Prix', 'VER']]);
  });

  it('falls back to the nearest day with races when the requested day has none', async () => {
    const res = await apiRequest('/api/history/on-this-day?date=09-10');
    const { data } = (await res.json()) as { data: OnThisDay };

    expect([data.requested, data.date, data.races.length]).toEqual(['09-10', '09-07', 1]);
  });

  it('rejects a date that does not exist', async () => {
    const res = await apiRequest('/api/history/on-this-day?date=02-30');
    expect(res.status).toBe(400);
  });

  it("finds a core driver's all-time record despite accent differences", async () => {
    const res = await apiRequest(`/api/drivers/${perezId}/history`);
    const { data } = (await res.json()) as { data: { raceStarts: number; firstRaceName: string } };

    expect([data.raceStarts, data.firstRaceName]).toEqual([281, 'Australian GP']);
  });

  it("returns a core team's constructor history with chassis and engine by season", async () => {
    const res = await apiRequest(`/api/teams/${redBullId}/history`);
    const { data } = (await res.json()) as { data: { constructor: { raceWins: number }; seasons: Array<{ year: number; chassis: string; engine: string }> } };

    expect(data.constructor.raceWins).toBe(130);
    expect(data.seasons).toEqual([{ year: 2026, chassis: 'RB22', engine: 'Red Bull Ford' }]);
  });
});
