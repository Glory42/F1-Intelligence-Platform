import type { CalibrationBin, ForecastScore, SeasonCalibration } from '../../common/types';

export type FieldProbability = { raceId: number; year: number; driverId: number; winProbability: number };
export type RaceDriver = { raceId: number; driverId: number };

type Field = Map<number, number>;
type ScoredRace = { year: number; field: Field; winnerId: number; poleId: number | undefined };

// Probabilities are stored to 5 decimals: a winner rounded to 0 would make the log loss infinite.
const MIN_PROBABILITY = 0.00001;
const BANDS = 10;

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

function score(field: Field, winnerId: number): ForecastScore {
  let brier = 0;
  for (const [driverId, p] of field) brier += (p - (driverId === winnerId ? 1 : 0)) ** 2;
  return { brier, logLoss: -Math.log(Math.max(field.get(winnerId) ?? 0, MIN_PROBABILITY)) };
}

function uniformField(field: Field): Field {
  return new Map([...field.keys()].map((driverId) => [driverId, 1 / field.size]));
}

function poleField(field: Field, poleId: number | undefined, poleWinRate: number): Field {
  if (poleId === undefined || !field.has(poleId) || field.size < 2) return uniformField(field);
  const rest = (1 - poleWinRate) / (field.size - 1);
  return new Map([...field.keys()].map((driverId) => [driverId, driverId === poleId ? poleWinRate : rest]));
}

function scoredRaces(probabilities: FieldProbability[], winners: RaceDriver[], poles: RaceDriver[]): ScoredRace[] {
  const winnerOf = new Map(winners.map((w) => [w.raceId, w.driverId]));
  const poleOf = new Map(poles.map((p) => [p.raceId, p.driverId]));
  const fields = new Map<number, { year: number; field: Field }>();
  for (const row of probabilities) {
    const race = fields.get(row.raceId) ?? { year: row.year, field: new Map() };
    race.field.set(row.driverId, row.winProbability);
    fields.set(row.raceId, race);
  }
  return [...fields.entries()].flatMap(([raceId, { year, field }]) => {
    const winnerId = winnerOf.get(raceId);
    return winnerId !== undefined && field.has(winnerId) ? [{ year, field, winnerId, poleId: poleOf.get(raceId) }] : [];
  });
}

function bins(races: ScoredRace[]): CalibrationBin[] {
  const bands = Array.from({ length: BANDS }, (_, i) => ({ from: i / BANDS, predictions: 0, wins: 0, probabilitySum: 0 }));
  for (const { field, winnerId } of races) {
    for (const [driverId, p] of field) {
      const band = bands[Math.min(BANDS - 1, Math.floor(p * BANDS + 1e-9))];
      band.predictions += 1;
      band.wins += driverId === winnerId ? 1 : 0;
      band.probabilitySum += p;
    }
  }
  return bands
    .filter((band) => band.predictions > 0)
    .map((band) => ({ ...band, probabilitySum: round4(band.probabilitySum) }));
}

function mean(races: ScoredRace[], forecast: (race: ScoredRace) => Field): ForecastScore {
  const scores = races.map((race) => score(forecast(race), race.winnerId));
  const average = (pick: (s: ForecastScore) => number) => round4(scores.reduce((sum, s) => sum + pick(s), 0) / scores.length);
  return { brier: average((s) => s.brier), logLoss: average((s) => s.logLoss) };
}

// How well the GP model's whole-field win probabilities match what happened, per season, next to
// two forecasts that need no model: equal chances, and the pole-sitter at the historical pole win rate.
export function calibrationBySeason(
  probabilities: FieldProbability[],
  winners: RaceDriver[],
  poles: RaceDriver[],
): Map<number, SeasonCalibration> {
  const races = scoredRaces(probabilities, winners, poles);
  const withPole = races.filter((race) => race.poleId !== undefined);
  const poleWinRate = withPole.length > 0
    ? withPole.filter((race) => race.poleId === race.winnerId).length / withPole.length
    : 0;

  const byYear = new Map<number, ScoredRace[]>();
  for (const race of races) byYear.set(race.year, [...(byYear.get(race.year) ?? []), race]);

  return new Map([...byYear.entries()].map(([year, seasonRaces]) => [year, {
    races: seasonRaces.length,
    poleWinRate: round4(poleWinRate),
    bins: bins(seasonRaces),
    model: mean(seasonRaces, (race) => race.field),
    pole: mean(seasonRaces, (race) => poleField(race.field, race.poleId, poleWinRate)),
    uniform: mean(seasonRaces, (race) => uniformField(race.field)),
  }]));
}
