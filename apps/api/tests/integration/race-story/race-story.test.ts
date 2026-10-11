import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { apiRequest } from '../../support/app/request';
import { getTestDb, truncateAll } from '../../support/db/test-db';
import { createSeason } from '../../support/factories/season.factory';
import { createCircuit } from '../../support/factories/circuit.factory';
import { createTeam } from '../../support/factories/team.factory';
import { createDriver } from '../../support/factories/driver.factory';
import { createRace } from '../../support/factories/race.factory';
import { createRaceResult } from '../../support/factories/raceResult.factory';
import { createBattle, createLapTrace, createWeatherTrace } from '../../support/factories/raceStory.factory';

interface StoryBody {
  data: {
    drivers: Array<{ driver: { code: string }; positions: number[]; gapsMs: Array<number | null> }>;
    battles: Array<{ chaser: { code: string }; leader: { code: string }; lapStart: number; lapEnd: number; minGapMs: number }>;
    weather: { minuteOffsets: number[]; airTempC: number[]; trackTempC: number[]; rainfall: boolean[] } | null;
  };
}

describe('race story (integration)', () => {
  const db = getTestDb();
  let raceId: number;
  let notBackfilledId: number;

  beforeAll(async () => {
    await truncateAll(db);
    const season = await createSeason(db, { year: 2088 });
    const circuit = await createCircuit(db, { circuitKey: 'story-circuit' });
    const team = await createTeam(db, season.id);
    const nor = await createDriver(db, season.id, team.id, { driverNumber: 4, code: 'NOR' });
    const pia = await createDriver(db, season.id, team.id, { driverNumber: 81, code: 'PIA' });
    const race = await createRace(db, season.id, circuit.id, { status: 'completed' });
    raceId = race.id;

    await createRaceResult(db, race.id, pia.id, { finishPosition: 2 });
    await createRaceResult(db, race.id, nor.id, { finishPosition: 1 });
    await createLapTrace(db, race.id, nor.id, { positions: [2, 1, 1], gapsMs: [800, 0, 0], intervalsMs: [800, null, null], lapsDown: [0, 0, 0] });
    await createLapTrace(db, race.id, pia.id, { positions: [1, 2, 2], gapsMs: [0, 600, 900], intervalsMs: [null, 600, 900], lapsDown: [0, 0, 0] });
    await createBattle(db, race.id, pia.id, nor.id, { lapStart: 2, lapEnd: 3, minGapMs: 600 });
    const notBackfilled = await createRace(db, season.id, circuit.id, { roundNumber: 2, status: 'completed' });
    notBackfilledId = notBackfilled.id;
    await createWeatherTrace(db, race.id, { minuteOffsets: [0, 1], airTempTenths: [250, 250], trackTempTenths: [412, 398], rainfall: [false, true] });
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  it('returns lap-by-lap traces in finishing order and the battles between named drivers', async () => {
    const res = await apiRequest(`/api/races/${raceId}/race-story`);
    const { data } = (await res.json()) as StoryBody;

    expect(data.drivers.map((d) => [d.driver.code, d.positions, d.gapsMs])).toEqual([
      ['NOR', [2, 1, 1], [800, 0, 0]],
      ['PIA', [1, 2, 2], [0, 600, 900]],
    ]);
    expect(data.battles.map((b) => [b.chaser.code, b.leader.code, b.lapStart, b.lapEnd, b.minGapMs])).toEqual([
      ['PIA', 'NOR', 2, 3, 600],
    ]);
  });

  it('returns the minute-by-minute weather with temperatures in °C', async () => {
    const res = await apiRequest(`/api/races/${raceId}/race-story`);
    const { data } = (await res.json()) as StoryBody;

    expect(data.weather).toEqual({ minuteOffsets: [0, 1], airTempC: [25, 25], trackTempC: [41.2, 39.8], rainfall: [false, true] });
  });

  it('only briefly caches a completed race whose story has not been backfilled yet', async () => {
    const res = await apiRequest(`/api/races/${notBackfilledId}/race-story`);

    expect(res.headers.get('Cache-Control')).toBe('public, max-age=30');
  });
});
