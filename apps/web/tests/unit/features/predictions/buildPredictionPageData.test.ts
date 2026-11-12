import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  api: {
    getPredictionByRace: vi.fn(),
    getRaceById: vi.fn(),
    getSprintByRaceId: vi.fn(),
    getSprintDetail: vi.fn(),
  },
}));

import { api } from '@/lib/api';
import { buildPredictionPageData } from '@/features/predictions/buildPredictionPageData';
import type {
  Circuit, Driver, Team, Race, RaceResult, RaceDetailResponse, PredictionResponse, GpFeatures,
  SprintResult, SprintDetailResponse, SprintPredictionResponse, FeatureInfo,
} from '@/types';

const team: Team = { id: 1, seasonId: 2025, teamKey: 'red-bull', name: 'Red Bull Racing', nationality: 'Austrian' };
const driver: Driver = {
  id: 10, seasonId: 2025, teamId: 1, driverNumber: 1, code: 'VER',
  firstName: 'Max', lastName: 'Verstappen', fullName: 'Max Verstappen',
  nationality: 'Dutch', headshotUrl: null, team,
};
const driverB: Driver = {
  id: 11, seasonId: 2025, teamId: 2, driverNumber: 16, code: 'LEC',
  firstName: 'Charles', lastName: 'Leclerc', fullName: 'Charles Leclerc',
  nationality: 'Monegasque', headshotUrl: null, team: { ...team, id: 2, teamKey: 'ferrari', name: 'Ferrari' },
};
const circuit: Circuit = {
  id: 5, circuitKey: 'monza', name: 'Autodromo Nazionale Monza', country: 'Italy', city: 'Monza',
  lapCount: 53, trackLengthKm: '5.793', overtakeRate: '0.850',
  numberOfCorners: 11, drsZones: 2, scProbability: '0.300', imageUrl: null,
};
const race: Race = {
  id: 1, seasonId: 2025, roundNumber: 5, name: 'Italian Grand Prix',
  raceDate: '2025-09-07T13:00:00Z', raceDateUtc: '2025-09-07T13:00:00Z',
  status: 'completed', eventFormat: 'conventional',
  qualifyingDate: null, sprintDate: '2025-09-06T13:00:00Z', sprintQualifyingDate: null, hasSprint: true,
  weather: null, safetyCarLaps: null, vscLaps: null, airTempAvg: null, trackTempAvg: null, humidityAvg: null,
  sprintWeather: null, sprintSafetyCarLaps: null, sprintVscLaps: null,
  sprintAirTempAvg: null, sprintTrackTempAvg: null, sprintHumidityAvg: null,
  circuit,
};

const term = (value: number, contribution: number) => ({ value, contribution });
// VER: on pole with the better race pace; LEC: P2, better recent form.
const verFeatures: GpFeatures = {
  grid: term(0, 0.6), qualiPace: term(0, 0.3), teamQualiPace: term(-0.1, 0.2), driverPoints: term(15, 0.3),
  teammateEdge: term(0.2, 0.05), gridProcessional: term(0, 0.4), teamRacePace: term(-0.08, 0.5),
};
const lecFeatures: GpFeatures = {
  grid: term(-0.69, 0.1), qualiPace: term(-0.1, 0.2), teamQualiPace: term(-0.3, 0.1), driverPoints: term(19, 0.5),
  teammateEdge: term(0.1, 0.02), gridProcessional: term(-0.35, 0.2), teamRacePace: term(-0.42, 0.1),
};
const sprintFeatures: GpFeatures = { ...verFeatures, grid: term(-0.69, 0.67), teamRacePace: term(-0.21, 0.4) };
const info = (key: string, label: string, importance: number, shortLabel = label): FeatureInfo => ({ key, label, shortLabel, importance });
const gpFeatureInfo: FeatureInfo[] = [
  info('grid', 'Grid Slot', 20), info('qualiPace', 'Qualifying Pace', 11, 'Quali Pace'),
  info('teamQualiPace', 'Team Qualifying Pace', 12, 'Team Quali'), info('driverPoints', 'Driver Form', 18),
  info('teammateEdge', 'Teammate Edge', 4), info('gridProcessional', 'Grid × Hard-to-Pass Track', 17, 'Grid × Track'),
  info('teamRacePace', 'Team Race Pace', 18, 'Race Pace'),
];
const sprintFeatureInfo = gpFeatureInfo;

function gpPrediction(predictedWinner: Driver = driver): PredictionResponse {
  return {
    race, predictedWinner, computedAt: '2025-09-07T12:00:00.000Z', modelVersion: 'weighted-v4',
    featureInfo: gpFeatureInfo as PredictionResponse['featureInfo'],
    drivers: [
      { driver, winProbability: '0.62000', podiumProbability: '0.88000', preQualiProbability: '0.45000', predictedPosition: 1, gridPosition: 1, features: verFeatures },
      { driver: driverB, winProbability: '0.38000', podiumProbability: '0.79000', preQualiProbability: null, predictedPosition: 2, gridPosition: 2, features: lecFeatures },
    ],
  };
}

function gpDetail(winnerDriver: Driver = driver): RaceDetailResponse {
  const results: RaceResult[] = [
    { id: 1, raceId: 1, driverId: winnerDriver.id, finishPosition: 1, gridPosition: 1, points: '25', status: 'Finished', fastestLap: true, driver: winnerDriver },
    { id: 2, raceId: 1, driverId: driverB.id, finishPosition: 2, gridPosition: 2, points: '18', status: 'Finished', fastestLap: false, driver: driverB },
  ];
  return { race, results, qualifying: [], laps: [] };
}

function sprintPrediction(): SprintPredictionResponse {
  return {
    race, predictedWinner: driver, computedAt: '2025-09-06T12:00:00.000Z', modelVersion: 'sprint-v2',
    featureInfo: sprintFeatureInfo as SprintPredictionResponse['featureInfo'],
    drivers: [
      { driver, winProbability: '0.55000', podiumProbability: null, preQualiProbability: null, predictedPosition: 1, gridPosition: 1, features: sprintFeatures },
      { driver: driverB, winProbability: '0.45000', podiumProbability: null, preQualiProbability: null, predictedPosition: 2, gridPosition: null, features: sprintFeatures },
    ],
  };
}

function sprintDetail(): SprintDetailResponse {
  const results: SprintResult[] = [
    {
      id: 1, raceId: 1, driverId: driver.id, finishPosition: 1, gridPosition: 1, points: '8', status: 'Finished',
      fastestLap: true, sq1TimeMs: null, sq2TimeMs: null, sq3TimeMs: null,
      sqSector1Ms: null, sqSector2Ms: null, sqSector3Ms: null, sqSpeedSt: null, driver,
    },
  ];
  return { race, prediction: null, results, laps: [] };
}

beforeEach(() => {
  vi.mocked(api.getPredictionByRace).mockReset();
  vi.mocked(api.getRaceById).mockReset();
  vi.mocked(api.getSprintByRaceId).mockReset();
  vi.mocked(api.getSprintDetail).mockReset();
});

describe('buildPredictionPageData: gp', () => {
  test('happy path assembles the full view model', async () => {
    vi.mocked(api.getPredictionByRace).mockResolvedValue(gpPrediction());
    vi.mocked(api.getRaceById).mockResolvedValue(gpDetail());

    const data = await buildPredictionPageData('gp', 1);

    expect(data.predictionFailed).toBe(false);
    expect(data.race?.id).toBe(1);
    expect(data.date).toBe(race.raceDate);
    expect(data.results).toHaveLength(2);
    expect(data.actualWinner?.driver.id).toBe(driver.id);
    expect(data.correct).toBe(true);
    expect(data.winner?.driver.id).toBe(driver.id);
    expect(data.radarFeatures).toHaveLength(7);
  });

  test('each driver is shown through per-feature terms: the why bar, radar and pace column', async () => {
    vi.mocked(api.getPredictionByRace).mockResolvedValue(gpPrediction());
    vi.mocked(api.getRaceById).mockResolvedValue(gpDetail());

    const data = await buildPredictionPageData('gp', 1);

    const [ver, lec] = data.prediction!.drivers;
    expect(ver.terms.grid).toBe(0.6);
    // Grid is VER's biggest edge over the field average ((0.6 - 0.35) of his positive edges).
    expect(data.breakdown[0].key).toBe('grid');
    expect(data.breakdown.find((b) => b.key === 'driverPoints')!.share).toBe(0);
    expect([ver.radar.teamRacePace, lec.radar.teamRacePace]).toEqual([1, 0]);
    expect([ver.pace, lec.pace, ver.gridPosition]).toEqual(['0.08%', '0.42%', 1]);
    expect([ver.podiumProbability, lec.podiumProbability]).toEqual(['0.88000', '0.79000']);
    expect([ver.preQualiProbability, lec.preQualiProbability]).toEqual(['0.45000', null]);
  });

  test('a cached prediction from before the podium forecast shows no podium chance', async () => {
    const stale = gpPrediction();
    for (const d of stale.drivers) delete (d as Partial<typeof d>).podiumProbability;
    vi.mocked(api.getPredictionByRace).mockResolvedValue(stale);
    vi.mocked(api.getRaceById).mockResolvedValue(gpDetail());

    const data = await buildPredictionPageData('gp', 1);

    expect(data.prediction!.drivers.map((d) => d.podiumProbability)).toEqual([null, null]);
  });

  test('labels, importances and radar labels come with the prediction, not from a web copy', async () => {
    vi.mocked(api.getPredictionByRace).mockResolvedValue(gpPrediction());
    vi.mocked(api.getRaceById).mockResolvedValue(gpDetail());

    const data = await buildPredictionPageData('gp', 1);

    expect(data.featureMeta.qualiPace).toEqual({ label: 'Qualifying Pace', weight: 11 });
    expect(data.weights.grid).toBe(20);
    expect(data.radarFeatures[1]).toEqual(['Quali Pace', 'qualiPace']);
  });

  test('prediction fetch failure falls back to the race detail response', async () => {
    vi.mocked(api.getPredictionByRace).mockRejectedValue(new Error('500'));
    vi.mocked(api.getRaceById).mockResolvedValue(gpDetail());

    const data = await buildPredictionPageData('gp', 1);

    expect(data.predictionFailed).toBe(true);
    expect(data.prediction).toBeNull();
    expect(data.race?.id).toBe(1);
    expect(data.winner).toBeNull();
    expect(data.breakdown).toEqual([]);
  });

  test('detail fetch failure leaves results/actualWinner empty but keeps the prediction', async () => {
    vi.mocked(api.getPredictionByRace).mockResolvedValue(gpPrediction());
    vi.mocked(api.getRaceById).mockRejectedValue(new Error('500'));

    const data = await buildPredictionPageData('gp', 1);

    expect(data.predictionFailed).toBe(false);
    expect(data.race?.id).toBe(1);
    expect(data.results).toBeUndefined();
    expect(data.actualWinner).toBeNull();
    expect(data.correct).toBeNull();
    expect(data.winner?.driver.id).toBe(driver.id);
  });

  test('winner falls back to the first driver when predictedWinner is not in the field', async () => {
    const stranger: Driver = { ...driver, id: 999 };
    vi.mocked(api.getPredictionByRace).mockResolvedValue(gpPrediction(stranger));
    vi.mocked(api.getRaceById).mockResolvedValue(gpDetail());

    const data = await buildPredictionPageData('gp', 1);

    expect(data.winner?.driver.id).toBe(driver.id);
  });

  test('correct is false when the actual winner differs from the predicted winner', async () => {
    vi.mocked(api.getPredictionByRace).mockResolvedValue(gpPrediction(driver));
    vi.mocked(api.getRaceById).mockResolvedValue(gpDetail(driverB));

    const data = await buildPredictionPageData('gp', 1);

    expect(data.correct).toBe(false);
  });

  test('no race is resolvable when both responses fail', async () => {
    vi.mocked(api.getPredictionByRace).mockRejectedValue(new Error('500'));
    vi.mocked(api.getRaceById).mockRejectedValue(new Error('500'));

    const data = await buildPredictionPageData('gp', 1);

    expect(data.race).toBeNull();
    expect(data.date).toBeNull();
    expect(data.predictionFailed).toBe(true);
    expect(data.winner).toBeNull();
  });
});

describe('buildPredictionPageData: sprint', () => {
  test('happy path uses the sprint behaviour axis (date field, radar count)', async () => {
    vi.mocked(api.getSprintByRaceId).mockResolvedValue(sprintPrediction());
    vi.mocked(api.getSprintDetail).mockResolvedValue(sprintDetail());

    const data = await buildPredictionPageData('sprint', 1);

    expect(data.predictionFailed).toBe(false);
    expect(data.date).toBe(race.sprintDate);
    expect(data.radarFeatures).toHaveLength(7);
    expect(data.correct).toBe(true);
    expect(data.prediction!.drivers.map((d) => d.pace)).toEqual(['0.21%', '0.21%']);
  });

  test('a sprint driver is shown through the contributions the API serves, pace from team race pace', async () => {
    vi.mocked(api.getSprintByRaceId).mockResolvedValue(sprintPrediction());
    vi.mocked(api.getSprintDetail).mockResolvedValue(sprintDetail());

    const data = await buildPredictionPageData('sprint', 1);

    const [ver] = data.prediction!.drivers;
    expect(ver.terms.grid).toBe(0.67);
    expect(ver.pace).toBe('0.21%');
  });

  test('a sprint-v2 response from an API not yet redeployed shows no pace instead of failing', async () => {
    const old = sprintPrediction();
    for (const d of old.drivers) d.features = { carPerformance: { value: 0.8, contribution: 0.67 } } as unknown as GpFeatures;
    vi.mocked(api.getSprintByRaceId).mockResolvedValue(old);
    vi.mocked(api.getSprintDetail).mockResolvedValue(sprintDetail());

    const data = await buildPredictionPageData('sprint', 1);

    expect(data.prediction!.drivers.map((d) => d.pace)).toEqual(['-', '-']);
  });

  test('sprint fetch failure flags predictionFailed with no prediction', async () => {
    vi.mocked(api.getSprintByRaceId).mockRejectedValue(new Error('500'));
    vi.mocked(api.getSprintDetail).mockResolvedValue(sprintDetail());

    const data = await buildPredictionPageData('sprint', 1);

    expect(data.predictionFailed).toBe(true);
    expect(data.prediction).toBeNull();
  });
});
