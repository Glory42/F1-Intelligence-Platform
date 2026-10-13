import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { apiRequest } from '../../support/app/request';
import { getTestDb, truncateAll } from '../../support/db/test-db';
import { createSeason } from '../../support/factories/season.factory';
import { createTeam } from '../../support/factories/team.factory';
import { createDriver } from '../../support/factories/driver.factory';
import { createCircuit } from '../../support/factories/circuit.factory';
import { createRace } from '../../support/factories/race.factory';
import { createRacePitStop } from '../../support/factories/racePitStop.factory';
import { createRaceControlMessage } from '../../support/factories/raceControlMessage.factory';

const IMMUTABLE = 'public, max-age=86400, immutable';
const SHORT = 'public, max-age=30';

type ErrorBody = { data: null; error: { code: string; message: string } };

// Cache lifetime must come from the data's own season or race status, never from the client's ?year=.
describe('route policy (integration)', () => {
  const db = getTestDb();
  const currentYear = new Date().getFullYear();
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    await truncateAll(db);
    const current = await createSeason(db, { year: currentYear });
    const currentTeam = await createTeam(db, current.id, { teamKey: 'route-now' });
    ids.currentTeam = currentTeam.id;
    ids.currentDriver = (await createDriver(db, current.id, currentTeam.id, { code: 'NOW' })).id;
    const circuit = await createCircuit(db, { circuitKey: 'route-circuit' });
    const completedNow = await createRace(db, current.id, circuit.id, { roundNumber: 1, status: 'completed' });
    await createRacePitStop(db, completedNow.id, ids.currentDriver, { lapNumber: 20, stationaryMs: 2300 });
    const sprintWeekend = await createRace(db, current.id, circuit.id, { roundNumber: 2, status: 'sprint_done', eventFormat: 'sprint' });
    ids.sprintWeekend = sprintWeekend.id;
    await createRaceControlMessage(db, sprintWeekend.id, { sessionType: 'sprint' });

    const past = await createSeason(db, { year: 2020 });
    const pastTeam = await createTeam(db, past.id, { teamKey: 'route-past' });
    ids.pastTeam = pastTeam.id;
    ids.pastDriver = (await createDriver(db, past.id, pastTeam.id, { code: 'OLD' })).id;
    await createRace(db, past.id, circuit.id, { roundNumber: 1, raceDate: '2020-07-05', status: 'completed' });
    const veteran = { code: 'VET', firstName: 'Vera', lastName: 'Veteran' };
    ids.veteranIn2020 = (await createDriver(db, past.id, pastTeam.id, veteran)).id;
    await createDriver(db, current.id, currentTeam.id, veteran);
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  it("caches a current-season driver's teammate battle briefly, whatever ?year= says", async () => {
    const res = await apiRequest(`/api/drivers/${ids.currentDriver}/teammate-battle?year=2020`);

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(SHORT);
  });

  it("caches a current-season team's pit stops briefly, whatever ?year= says", async () => {
    const res = await apiRequest(`/api/teams/${ids.currentTeam}/pit-stops?year=2020`);

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(SHORT);
  });

  it('rejects a year that is not a number with 400 INVALID_YEAR', async () => {
    const res = await apiRequest('/api/drivers/standings?year=abc');
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(400);
    expect(body).toEqual({ data: null, error: { code: 'INVALID_YEAR', message: 'year must be a number' } });
  });

  it('caches a race sub-resource by the race status, so a weekend in progress is cached briefly', async () => {
    const res = await apiRequest(`/api/races/${ids.sprintWeekend}/race-control?session=sprint`);
    const { data } = (await res.json()) as { data: unknown[] };

    expect(data).toHaveLength(1);
    expect(res.headers.get('Cache-Control')).toBe(SHORT);
  });

  it("caches a past season's race calendar long, filtered or not", async () => {
    const res = await apiRequest('/api/races?year=2020');
    const { data } = (await res.json()) as { data: unknown[] };

    expect(data).toHaveLength(1);
    expect(res.headers.get('Cache-Control')).toBe(IMMUTABLE);
  });

  it("caches a past-season driver's detail long, whatever ?year= says", async () => {
    const res = await apiRequest(`/api/drivers/${ids.pastDriver}?year=${currentYear}`);

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(IMMUTABLE);
  });

  it("caches a past-season team's detail long, whatever ?year= says", async () => {
    const res = await apiRequest(`/api/teams/${ids.pastTeam}?year=${currentYear}`);

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(IMMUTABLE);
  });

  it("caches a career by its newest season, even when asked through an old season's id", async () => {
    const res = await apiRequest(`/api/drivers/${ids.veteranIn2020}/career`);
    const { data } = (await res.json()) as { data: Array<{ year: number }> };

    expect(data.map((d) => d.year)).toEqual([currentYear, 2020]);
    expect(res.headers.get('Cache-Control')).toBe(SHORT);
  });

  it("caches a team that stopped racing before this season's career long", async () => {
    const res = await apiRequest(`/api/teams/${ids.pastTeam}/career`);
    const { data } = (await res.json()) as { data: Array<{ year: number }> };

    expect(data.map((d) => d.year)).toEqual([2020]);
    expect(res.headers.get('Cache-Control')).toBe(IMMUTABLE);
  });

  it.each(['/api/drivers', '/api/drivers/standings', '/api/teams', '/api/teams/standings'])(
    "caches %s for a past season long and for this season briefly",
    async (path) => {
      const past = await apiRequest(`${path}?year=2020`);
      const now = await apiRequest(`${path}?year=${currentYear}`);

      expect((await past.json() as { data: unknown[] }).data.length).toBeGreaterThan(0);
      expect([past.headers.get('Cache-Control'), now.headers.get('Cache-Control')]).toEqual([IMMUTABLE, SHORT]);
    },
  );

  it.each([
    ['/api/races/1.5/strategy', 'id must be a number'],
    ['/api/predictions/race/abc/friday-pace', 'raceId must be a number'],
    ['/api/drivers/abc/career', 'id must be a number'],
    ['/api/teams/99999999999', 'id must be a number'],
  ])('rejects the id in %s with 400 INVALID_ID', async (path, message) => {
    const res = await apiRequest(path);

    expect(res.status).toBe(400);
    expect((await res.json()) as ErrorBody).toEqual({ data: null, error: { code: 'INVALID_ID', message } });
  });

  it('rejects a session the route does not know with 400 INVALID_SESSION', async () => {
    const res = await apiRequest(`/api/races/${ids.sprintWeekend}/telemetry?session=R`);
    const { error } = (await res.json()) as { error: { code: string } };

    expect([res.status, error.code]).toEqual([400, 'INVALID_SESSION']);
  });

  it('answers 404 for a race that does not exist before loading anything else', async () => {
    const res = await apiRequest('/api/races/999999/recap');

    expect(res.status).toBe(404);
    expect((await res.json()) as ErrorBody).toEqual({ data: null, error: { code: 'NOT_FOUND', message: 'Race 999999 not found' } });
  });

  // Seasons, the search index, circuits and the model version only change when the ETL runs.
  it.each(['/api/seasons', '/api/search', '/api/races/circuits', '/api/races/circuit/route-circuit', '/api/predictions/model-info'])(
    'caches the reference data at %s for an hour',
    async (path) => {
      const res = await apiRequest(path);

      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
    },
  );
});
