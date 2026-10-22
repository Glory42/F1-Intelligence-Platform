import type { GpFeatures, SprintFeatureScores } from '@/types';
import { softmax, SPRINT_SOFTMAX_TEMPERATURE, SPRINT_WEIGHTS, type Weights } from './predictionMath';

// A driver's score split by feature, on the log-odds scale: softmax over the field of the summed
// terms is the driver's win probability. Both models are shown through this one shape.
export type Terms = Record<string, number>;

export type FeatureEdge = {
  key: string;
  // The driver's term minus the field's average term for this feature.
  edge: number;
  // Share of the driver's summed positive edges: what puts them ahead of the field.
  share: number;
};

export function gpTerms(features: GpFeatures): Terms {
  return Object.fromEntries(Object.entries(features).map(([key, f]) => [key, f.contribution]));
}

// sprint-v2's softmax(Σ weight × score / T) written as per-feature terms with T folded in.
export function sprintTerms(features: SprintFeatureScores, weights: Weights = SPRINT_WEIGHTS): Terms {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  return Object.fromEntries(
    Object.entries(weights).map(([key, weight]) => [
      key,
      (weight * Number(features[key as keyof SprintFeatureScores] ?? 0)) / (total * SPRINT_SOFTMAX_TEMPERATURE),
    ]),
  );
}

export function edgeBreakdown(driver: Terms, field: Terms[]): FeatureEdge[] {
  const rows = Object.keys(driver).map((key) => {
    const mean = field.reduce((sum, t) => sum + (t[key] ?? 0), 0) / Math.max(field.length, 1);
    return { key, edge: driver[key] - mean };
  });
  const positive = rows.reduce((sum, r) => sum + Math.max(r.edge, 0), 0);
  return rows
    .map((r) => ({ ...r, share: positive > 0 ? Math.max(r.edge, 0) / positive : 0 }))
    .sort((a, b) => b.edge - a.edge);
}

// Each feature rescaled to 0–1 across this field (best = 1), for the radar: only shows standing
// within the race, which is all a comparison of two drivers needs.
export function fieldScaled(field: Terms[]): Terms[] {
  const keys = Object.keys(field[0] ?? {});
  const range = Object.fromEntries(
    keys.map((key) => {
      const values = field.map((t) => t[key]);
      return [key, [Math.min(...values), Math.max(...values)]];
    }),
  );
  return field.map((t) =>
    Object.fromEntries(
      keys.map((key) => {
        const [lo, hi] = range[key];
        return [key, hi > lo ? (t[key] - lo) / (hi - lo) : 0.5];
      }),
    ),
  );
}

// What-If Lab: each slider scales its feature's term relative to the model's own weight. Dividing by
// the slider total keeps "raise everything equally" a no-op, as it was with the hand weights.
export function whatIfProbabilities(field: Terms[], modelWeights: Weights, sliders: Weights): number[] {
  const modelTotal = Object.values(modelWeights).reduce((a, b) => a + b, 0);
  const sliderTotal = Object.values(sliders).reduce((a, b) => a + b, 0);
  if (sliderTotal <= 0) return field.map(() => 1 / field.length);
  const scale = modelTotal / sliderTotal;
  return softmax(
    field.map((t) =>
      Object.keys(modelWeights).reduce(
        (sum, key) => sum + (t[key] ?? 0) * (sliders[key] / modelWeights[key]) * scale,
        0,
      ),
    ),
  );
}
