import { api } from '@/lib/api';
import {
  radarFeatures,
  GP_WEIGHTS,
  FEATURE_META,
  SPRINT_WEIGHTS,
  SPRINT_FEATURE_META,
  type Weights,
} from '@/lib/f1/predictionMath';
import { edgeBreakdown, fieldScaled, gpTerms, sprintTerms, type FeatureEdge, type Terms } from '@/lib/f1/predictionTerms';
import { GP_ACCENT, SPRINT_ACCENT, type PredictionAccent, type PredictionDriverVM, type FeatureMeta, type PredictionPageKind } from './types';
import type { Race, Driver, FridayPaceRow, GpFeatures, PredictionOf, SprintFeatureScores } from '@/types';

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
  drivers: PredictionDriverVM[];
}

interface RawDetail {
  race: Race;
  results?: RawResultRow[];
}

// How one model's features become what the page shows. Typed per model, so nothing downstream
// needs to know whether a prediction came from weighted-v4 or sprint-v2.
interface ModelView<F> {
  terms: (features: F) => Terms;
  pace: (features: F) => string;
}

const GP_VIEW: ModelView<GpFeatures> = {
  terms: gpTerms,
  // teamRacePace is stored as minus the % gap to the fastest outfit's race pace.
  pace: (f) => `${(-f.teamRacePace.value).toFixed(2)}%`,
};

const SPRINT_VIEW: ModelView<SprintFeatureScores> = {
  terms: (f) => sprintTerms(f, SPRINT_WEIGHTS),
  pace: (f) => String(Math.round(Number(f.carPerformance) * 100)),
};

function toView<F>(prediction: PredictionOf<F>, view: ModelView<F>): PredictionView {
  const terms = prediction.drivers.map((d) => view.terms(d.features));
  const radar = fieldScaled(terms);
  return {
    ...prediction,
    drivers: prediction.drivers.map((d, i) => ({
      driver: d.driver,
      winProbability: d.winProbability,
      gridPosition: d.gridPosition,
      terms: terms[i],
      radar: radar[i],
      pace: view.pace(d.features),
    })),
  };
}

// The behavioural axis between the GP and sprint prediction pages: which endpoints to
// hit, which weights/meta to show, which race field holds the date. Wording lives
// in predictionCopy.ts; the fetch, winner-pick and assembly below are identical for both.
interface PredictionBehaviour {
  fetchPrediction: (raceId: number) => Promise<PredictionView>;
  fetchDetail: (raceId: number) => Promise<RawDetail>;
  weights: Weights;
  featureMeta: FeatureMeta;
  accent: PredictionAccent;
  radarShortLabels: Partial<Record<string, string>>;
  dateField: (race: Race) => string;
  // Sprint weekends have no FP2 session, so only the GP page shows Friday long-run pace.
  fetchFridayPace: ((raceId: number) => Promise<FridayPaceRow[]>) | null;
}

const PREDICTION_BEHAVIOUR: Record<PredictionPageKind, PredictionBehaviour> = {
  gp: {
    fetchPrediction: async (raceId) => toView(await api.getPredictionByRace(raceId), GP_VIEW),
    fetchDetail: api.getRaceById,
    weights: GP_WEIGHTS,
    featureMeta: FEATURE_META,
    accent: GP_ACCENT,
    radarShortLabels: {
      qualiPace: 'Quali Pace',
      teamQualiPace: 'Team Quali',
      gridProcessional: 'Grid × Track',
      teamRacePace: 'Race Pace',
    },
    dateField: (race) => race.raceDate,
    fetchFridayPace: api.getFridayPace,
  },
  sprint: {
    fetchPrediction: async (raceId) => toView(await api.getSprintByRaceId(raceId), SPRINT_VIEW),
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
