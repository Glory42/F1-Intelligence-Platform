// unknown (not string|number|null) so PredictionDriverVM['features'] passes through directly.
type FeatureInput = Record<string, unknown>;
export type Weights = Record<string, number>;

export const FEATURE_META: Record<string, { label: string; weight: number }> = {
  carPerformance:           { label: 'Car Performance',    weight: 20 },
  longRunPace:              { label: 'Long Run Pace',      weight: 15 },
  tyreDeg:                  { label: 'Tyre Degradation',   weight: 8 },
  reliability:              { label: 'Reliability',        weight: 8 },
  qualifyingDelta:          { label: 'Quali vs Teammate',  weight: 8 },
  driverRating:             { label: 'Driver Rating',      weight: 8 },
  winRate:                  { label: 'Win Rate',           weight: 8 },
  luckFactor:               { label: 'Luck Factor',        weight: 7 },
  sectorStrength:           { label: 'Sector Strength',    weight: 6 },
  circuitAdjStartPos:       { label: 'Adj. Grid Position', weight: 7 },
  circuitAdjPositionGain:   { label: 'Adj. Position Gain', weight: 3 },
  weatherImpact:            { label: 'Weather Impact',     weight: 2 },
};

export const GP_WEIGHTS: Weights = Object.fromEntries(
  Object.entries(FEATURE_META).map(([key, meta]) => [key, meta.weight]),
);

export const SPRINT_FEATURE_META: Record<string, { label: string; weight: number }> = {
  carPerformance:      { label: 'Car Performance',    weight: 25 },
  circuitAdjStartPos:  { label: 'Adj. Grid Position', weight: 25 },
  shortRunPace:        { label: 'Short Run Pace',     weight: 10 },
  driverRating:        { label: 'Driver Rating',      weight: 10 },
  weatherImpact:       { label: 'Weather Impact',     weight: 8 },
  winRate:             { label: 'Win Rate',           weight: 8 },
  luckFactor:          { label: 'Luck Factor',        weight: 8 },
  sqQualifyingDelta:   { label: 'SQ vs Teammate',     weight: 6 },
};

export const SPRINT_WEIGHTS: Weights = Object.fromEntries(
  Object.entries(SPRINT_FEATURE_META).map(([key, meta]) => [key, meta.weight]),
);

export const SOFTMAX_TEMPERATURE = 0.3;

// Derives RADAR_FEATURES' key set from FEATURE_META instead of a second hand-typed list.
// `shortLabels` keeps the radar chart's intentionally shorter labels.
export function radarFeatures(
  meta: Record<string, { label: string; weight: number }>,
  shortLabels: Partial<Record<string, string>> = {},
): [string, string][] {
  return Object.keys(meta).map((key) => [shortLabels[key] ?? meta[key].label, key]);
}

export type FeatureContribution = {
  key: string;
  weight: number;
  score: number;
  contribution: number;
  share: number;
};

type HistoryOutcome = { winProbability: string; correct: boolean | null };

export function brierScore(items: HistoryOutcome[]): number | null {
  const completed = items.filter((i) => i.correct !== null);
  if (completed.length === 0) return null;
  const sum = completed.reduce((acc, i) => {
    const outcome = i.correct ? 1 : 0;
    return acc + (Number(i.winProbability) - outcome) ** 2;
  }, 0);
  return sum / completed.length;
}

export type CalibrationBucket = {
  lo: number;
  hi: number;
  count: number;
  meanPredicted: number;
  actualRate: number;
};

export function calibrationBuckets(items: HistoryOutcome[], size = 0.2): CalibrationBucket[] {
  const binCount = Math.round(1 / size);
  const bins: HistoryOutcome[][] = Array.from({ length: binCount }, () => []);
  for (const item of items) {
    if (item.correct === null) continue;
    const p = Number(item.winProbability);
    const index = Math.min(binCount - 1, Math.floor(p / size + 1e-9));
    bins[index].push(item);
  }
  return bins
    .map((bucket, index) => {
      const lo = round6(index * size);
      const predictedSum = bucket.reduce((acc, i) => acc + Number(i.winProbability), 0);
      const correctCount = bucket.filter((i) => i.correct).length;
      return {
        lo,
        hi: round6(lo + size),
        count: bucket.length,
        meanPredicted: bucket.length ? predictedSum / bucket.length : 0,
        actualRate: bucket.length ? correctCount / bucket.length : 0,
      };
    })
    .filter((bucket) => bucket.count > 0);
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

type TippedRace = {
  raceId: number;
  raceName: string;
  roundNumber: number;
  isSprint: boolean;
  predictedWinner: { id: number };
  correct: boolean | null;
};

export type DriverPredictionRecord = {
  tipped: number;
  decided: number;
  correct: number;
  races: Omit<TippedRace, 'predictedWinner'>[];
};

export function driverPredictionRecord(
  items: TippedRace[],
  driverId: number,
): DriverPredictionRecord {
  const races = items
    .filter((i) => i.predictedWinner.id === driverId)
    .sort((a, b) => a.roundNumber - b.roundNumber)
    .map(({ predictedWinner: _predictedWinner, ...rest }) => rest);
  return {
    tipped: races.length,
    decided: races.filter((r) => r.correct !== null).length,
    correct: races.filter((r) => r.correct === true).length,
    races,
  };
}

export function bestCall<T extends HistoryOutcome>(items: T[]): T | null {
  const correct = items.filter((i) => i.correct === true);
  if (correct.length === 0) return null;
  return correct.reduce((lowest, i) =>
    Number(i.winProbability) < Number(lowest.winProbability) ? i : lowest,
  );
}

export function worstMiss<T extends HistoryOutcome>(items: T[]): T | null {
  const wrong = items.filter((i) => i.correct === false);
  if (wrong.length === 0) return null;
  return wrong.reduce((highest, i) =>
    Number(i.winProbability) > Number(highest.winProbability) ? i : highest,
  );
}

export function longestStreak(items: { roundNumber: number; correct: boolean | null }[]): number {
  const ordered = [...items].sort((a, b) => a.roundNumber - b.roundNumber);
  let longest = 0;
  let current = 0;
  for (const item of ordered) {
    if (item.correct === true) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

export type ConfidenceTier = 'lock' | 'likely' | 'tossup';

export function confidenceTier(p1: number, p2: number | undefined | null): ConfidenceTier {
  const gap = p1 - (p2 ?? 0);
  if (gap >= 0.2) return 'lock';
  if (gap >= 0.08) return 'likely';
  return 'tossup';
}

export function contributions(features: FeatureInput, weights: Weights): FeatureContribution[] {
  const rows = Object.keys(weights).map((key) => {
    const weight = weights[key];
    const score = Number(features[key] ?? 0);
    return { key, weight, score, contribution: weight * score };
  });
  const total = rows.reduce((sum, r) => sum + r.contribution, 0);
  return rows
    .map((r) => ({ ...r, share: total > 0 ? r.contribution / total : 0 }))
    .sort((a, b) => b.contribution - a.contribution);
}

export function weightedScore(features: FeatureInput, weights: Weights): number {
  let total = 0;
  for (const key of Object.keys(weights)) {
    total += weights[key] * Number(features[key] ?? 0);
  }
  return total;
}

export function softmax(scores: number[], temperature = SOFTMAX_TEMPERATURE): number[] {
  const scaled = scores.map((s) => s / temperature);
  const max = Math.max(...scaled);
  const exps = scaled.map((s) => Math.exp(s - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}
