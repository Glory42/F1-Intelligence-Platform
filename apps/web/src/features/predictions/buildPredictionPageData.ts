import { api } from '@/lib/api';
import {
  contributions,
  radarFeatures,
  GP_WEIGHTS,
  FEATURE_META,
  SPRINT_WEIGHTS,
  SPRINT_FEATURE_META,
  type FeatureContribution,
  type Weights,
} from '@/lib/f1/predictionMath';
import { GP_ACCENT, SPRINT_ACCENT, type PredictionAccent, type PredictionDriverVM, type FeatureMeta, type PredictionPageKind } from './types';
import type { Race, Driver, FridayPaceRow } from '@/types';

interface RawResultRow {
  driver: { id: number; fullName: string };
  finishPosition: number | null;
  status?: string | null;
}

interface RawPrediction {
  race: Race;
  predictedWinner: Driver;
  computedAt: string;
  modelVersion: string;
  drivers: PredictionDriverVM[];
}

interface RawDetail {
  race: Race;
  results?: RawResultRow[];
}

// The behavioural axis between the GP and sprint prediction pages: which endpoints to
// hit, which weights/meta to score with, which race field holds the date. Wording lives
// in predictionCopy.ts; the fetch, winner-pick and assembly below are identical for both.
interface PredictionBehaviour {
  fetchPrediction: (raceId: number) => Promise<RawPrediction>;
  fetchDetail: (raceId: number) => Promise<RawDetail>;
  weights: Weights;
  featureMeta: FeatureMeta;
  accent: PredictionAccent;
  radarShortLabels: Partial<Record<string, string>>;
  dateField: (race: Race) => string;
  // Sprint weekends have no FP2 long run feeding the sprint model, so only the GP shows it.
  fetchFridayPace: ((raceId: number) => Promise<FridayPaceRow[]>) | null;
}

const PREDICTION_BEHAVIOUR: Record<PredictionPageKind, PredictionBehaviour> = {
  gp: {
    fetchPrediction: api.getPredictionByRace,
    fetchDetail: api.getRaceById,
    weights: GP_WEIGHTS,
    featureMeta: FEATURE_META,
    accent: GP_ACCENT,
    radarShortLabels: {
      qualifyingDelta: 'Quali Delta',
      circuitAdjStartPos: 'Adj. Grid Pos',
      circuitAdjPositionGain: 'Adj. Pos Gain',
      weatherImpact: 'Weather',
    },
    dateField: (race) => race.raceDate,
    fetchFridayPace: api.getFridayPace,
  },
  sprint: {
    fetchPrediction: api.getSprintByRaceId,
    fetchDetail: api.getSprintDetail,
    weights: SPRINT_WEIGHTS,
    featureMeta: SPRINT_FEATURE_META,
    accent: SPRINT_ACCENT,
    radarShortLabels: {
      circuitAdjStartPos: 'Adj. Grid Pos',
      weatherImpact: 'Weather',
    },
    dateField: (race) => race.sprintDate ?? race.raceDate,
    fetchFridayPace: null,
  },
};

export interface PredictionPageData {
  race: Race | null;
  date: string | null;
  prediction: RawPrediction | null;
  results: RawResultRow[] | undefined;
  predictionFailed: boolean;
  raceYear: number;
  actualWinner: RawResultRow | null;
  correct: boolean | null;
  winner: PredictionDriverVM | null;
  breakdown: FeatureContribution[];
  radarFeatures: [string, string][];
  weights: Weights;
  featureMeta: FeatureMeta;
  accent: PredictionAccent;
  fridayPace: FridayPaceRow[];
}

export async function buildPredictionPageData(kind: PredictionPageKind, raceId: number): Promise<PredictionPageData> {
  const behaviour = PREDICTION_BEHAVIOUR[kind];

  let prediction: RawPrediction | null = null;
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
  const breakdown = winner ? contributions(winner.features, behaviour.weights) : [];

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
    radarFeatures: radarFeatures(behaviour.featureMeta, behaviour.radarShortLabels),
    weights: behaviour.weights,
    featureMeta: behaviour.featureMeta,
    accent: behaviour.accent,
    fridayPace: fridayPaceResult.status === 'fulfilled' ? fridayPaceResult.value : [],
  };
}
