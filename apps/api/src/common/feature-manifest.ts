import type { driverPredictionFeatures, driverSprintFeatures } from '../db/schema';
import type { FeatureScores, SprintFeatureScores } from './types';

// apps/api never computes with weights, so no weight field here — just the key/column/label
// mapping. `column: keyof TRow` makes a stale column reference a compile error.
export interface FeatureManifestEntry<TRow, TKey extends string = string> {
  key: TKey;
  column: keyof TRow;
  label: string;
  nullable: boolean;
}

export const GP_FEATURE_MANIFEST: FeatureManifestEntry<typeof driverPredictionFeatures.$inferSelect, keyof FeatureScores>[] = [
  { key: 'carPerformance', column: 'carPerformanceScore', label: 'Car Performance', nullable: false },
  { key: 'driverRating', column: 'driverRatingScore', label: 'Driver Rating', nullable: false },
  { key: 'startingPosition', column: 'startingPositionScore', label: 'Starting Position', nullable: false },
  { key: 'winRate', column: 'winRateScore', label: 'Win Rate', nullable: false },
  { key: 'luckFactor', column: 'luckFactorScore', label: 'Luck Factor', nullable: false },
  { key: 'weatherImpact', column: 'weatherImpactScore', label: 'Weather Impact', nullable: false },
  { key: 'trackOvertake', column: 'trackOvertakeScore', label: 'Track Overtake', nullable: true },
  { key: 'positionGain', column: 'positionGainScore', label: 'Position Gain', nullable: false },
  { key: 'longRunPace', column: 'longRunPaceScore', label: 'Long Run Pace', nullable: true },
  { key: 'reliability', column: 'reliabilityScore', label: 'Reliability', nullable: true },
  { key: 'qualifyingDelta', column: 'qualifyingDeltaScore', label: 'Qualifying Delta', nullable: true },
  { key: 'sectorStrength', column: 'sectorStrengthScore', label: 'Sector Strength', nullable: true },
  { key: 'tyreDeg', column: 'tyreDegScore', label: 'Tyre Degradation', nullable: true },
  { key: 'circuitAdjStartPos', column: 'circuitAdjStartPosScore', label: 'Circuit-Adj. Start Position', nullable: true },
  { key: 'circuitAdjPositionGain', column: 'circuitAdjPositionGainScore', label: 'Circuit-Adj. Position Gain', nullable: true },
];

export const SPRINT_FEATURE_MANIFEST: FeatureManifestEntry<typeof driverSprintFeatures.$inferSelect, keyof SprintFeatureScores>[] = [
  { key: 'carPerformance', column: 'carPerformanceScore', label: 'Car Performance', nullable: false },
  { key: 'startingPosition', column: 'startingPositionScore', label: 'Starting Position', nullable: false },
  { key: 'driverRating', column: 'driverRatingScore', label: 'Driver Rating', nullable: false },
  { key: 'trackOvertake', column: 'trackOvertakeScore', label: 'Track Overtake', nullable: true },
  { key: 'shortRunPace', column: 'shortRunPaceScore', label: 'Short Run Pace', nullable: false },
  { key: 'circuitAdjStartPos', column: 'circuitAdjStartPosScore', label: 'Circuit-Adj. Start Position', nullable: true },
  { key: 'sqQualifyingDelta', column: 'sqQualifyingDeltaScore', label: 'SQ vs Teammate', nullable: true },
  { key: 'weatherImpact', column: 'weatherImpactScore', label: 'Weather Impact', nullable: false },
  { key: 'winRate', column: 'winRateScore', label: 'Win Rate', nullable: false },
  { key: 'luckFactor', column: 'luckFactorScore', label: 'Luck Factor', nullable: false },
];

export function mapFeatureRow<TRow extends Record<string, unknown>, TOut>(
  raw: TRow,
  manifest: FeatureManifestEntry<TRow>[],
): TOut {
  const out: Record<string, unknown> = {};
  for (const { key, column, nullable } of manifest) {
    out[key] = nullable ? (raw[column] ?? null) : raw[column];
  }
  return out as TOut;
}
