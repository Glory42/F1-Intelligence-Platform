import { api } from '@/lib/api';
import type { Weights } from '@/lib/f1/predictionMath';
import { edgeBreakdown, fieldScaled, termsOf, type FeatureEdge } from '@/lib/f1/predictionTerms';
import { GP_ACCENT, SPRINT_ACCENT, type PredictionAccent, type PredictionDriverVM, type FeatureMeta, type PredictionPageKind } from './types';
import type { Race, Driver, FeatureInfo, FeatureTerm, FridayPaceRow, GpFeatures, PredictionOf, SprintFeatures } from '@/types';

interface RawResultRow {
  driver: { id: number; fullName: string };
  finishPosition: number | null;
  status?: string | null;
}

interface PredictionView {
  race: Race;
  predictedWinner: Driver;
  computedAt: string;
  modelVersion: string;
  featureInfo: FeatureInfo[];
  drivers: PredictionDriverVM[];
}

interface RawDetail {
  race: Race;
  results?: RawResultRow[];
}

// The API serves both models' features as {value, contribution} with their labels and importances, so
// the only model-specific thing left is the driver table's pace column.
type Pace<F> = (features: F) => string;

// teamRacePace is stored as minus the % gap to the fastest outfit's race pace.
const GP_PACE: Pace<GpFeatures> = (f) => `${(-f.teamRacePace.value).toFixed(2)}%`;
const SPRINT_PACE: Pace<SprintFeatures> = (f) => String(Math.round(f.carPerformance.value * 100));

function toView<F extends Record<string, FeatureTerm>>(prediction: PredictionOf<F>, pace: Pace<F>): PredictionView {
  const terms = prediction.drivers.map((d) => termsOf(d.features));
  const radar = fieldScaled(terms);
  return {
    ...prediction,
    drivers: prediction.drivers.map((d, i) => ({
      driver: d.driver,
      winProbability: d.winProbability,
      gridPosition: d.gridPosition,
      terms: terms[i],
      radar: radar[i],
      pace: pace(d.features),
    })),
  };
}

// The behavioural axis between the GP and sprint prediction pages: which endpoints to hit and which
// race field holds the date. Wording lives in predictionCopy.ts; features, labels and importances
// come with the prediction, and the fetch, winner-pick and assembly below are identical for both.
interface PredictionBehaviour {
  fetchPrediction: (raceId: number) => Promise<PredictionView>;
  fetchDetail: (raceId: number) => Promise<RawDetail>;
  accent: PredictionAccent;
  dateField: (race: Race) => string;
  // Sprint weekends have no FP2 session, so only the GP page shows Friday long-run pace.
  fetchFridayPace: ((raceId: number) => Promise<FridayPaceRow[]>) | null;
}

const PREDICTION_BEHAVIOUR: Record<PredictionPageKind, PredictionBehaviour> = {
  gp: {
    fetchPrediction: async (raceId) => toView(await api.getPredictionByRace(raceId), GP_PACE),
    fetchDetail: api.getRaceById,
    accent: GP_ACCENT,
    dateField: (race) => race.raceDate,
    fetchFridayPace: api.getFridayPace,
  },
  sprint: {
    fetchPrediction: async (raceId) => toView(await api.getSprintByRaceId(raceId), SPRINT_PACE),
    fetchDetail: api.getSprintDetail,
    accent: SPRINT_ACCENT,
    dateField: (race) => race.sprintDate ?? race.raceDate,
    fetchFridayPace: null,
  },
};

export interface PredictionPageData {
  race: Race | null;
  date: string | null;
  prediction: PredictionView | null;
  results: RawResultRow[] | undefined;
  predictionFailed: boolean;
  raceYear: number;
  actualWinner: RawResultRow | null;
  correct: boolean | null;
  winner: PredictionDriverVM | null;
  breakdown: FeatureEdge[];
  radarFeatures: [string, string][];
  weights: Weights;
  featureMeta: FeatureMeta;
  accent: PredictionAccent;
  fridayPace: FridayPaceRow[];
}

export async function buildPredictionPageData(kind: PredictionPageKind, raceId: number): Promise<PredictionPageData> {
  const behaviour = PREDICTION_BEHAVIOUR[kind];

  let prediction: PredictionView | null = null;
  let detail: RawDetail | null = null;
  let predictionFailed = false;

  const [predResult, detailResult, fridayPaceResult] = await Promise.allSettled([
    behaviour.fetchPrediction(raceId),
    behaviour.fetchDetail(raceId),
    behaviour.fetchFridayPace ? behaviour.fetchFridayPace(raceId) : Promise.resolve([]),
  ]);

  if (predResult.status === 'fulfilled') prediction = predResult.value;
  else predictionFailed = true;
  if (detailResult.status === 'fulfilled') detail = detailResult.value;

  const race = prediction?.race ?? detail?.race ?? null;
  const raceYear = race ? new Date(race.raceDate).getFullYear() : new Date().getFullYear();
  const results = detail?.results;
  const actualWinner = results?.find((r) => r.finishPosition === 1) ?? null;
  const correct = prediction && actualWinner ? prediction.predictedWinner.id === actualWinner.driver.id : null;

  const winner = prediction
    ? (prediction.drivers.find((d) => d.driver.id === prediction!.predictedWinner.id) ?? prediction.drivers[0] ?? null)
    : null;
  const breakdown = winner && prediction ? edgeBreakdown(winner.terms, prediction.drivers.map((d) => d.terms)) : [];
  const info = prediction?.featureInfo ?? [];

  return {
    race,
    date: race ? behaviour.dateField(race) : null,
    prediction,
    results,
    predictionFailed,
    raceYear,
    actualWinner,
    correct,
    winner,
    breakdown,
    radarFeatures: info.map((f): [string, string] => [f.shortLabel, f.key]),
    weights: Object.fromEntries(info.map((f) => [f.key, f.importance])),
    featureMeta: Object.fromEntries(info.map((f) => [f.key, { label: f.label, weight: f.importance }])),
    accent: behaviour.accent,
    fridayPace: fridayPaceResult.status === 'fulfilled' ? fridayPaceResult.value : [],
  };
}
