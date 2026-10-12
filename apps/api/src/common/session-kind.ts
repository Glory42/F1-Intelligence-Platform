import {
  driverPredictionFeatures, driverSprintFeatures, lapTimes, racePredictions, raceResults, races, raceStatusEnum,
  sprintLapTimes, sprintPredictions, sprintResults,
} from '../db/schema';
import type { FeatureScores, RaceSession, SprintFeatureScores } from './types';
import { GP_FEATURE_MANIFEST, SPRINT_FEATURE_MANIFEST, type FeatureManifestEntry } from './feature-manifest';

export type RaceStatus = (typeof raceStatusEnum.enumValues)[number];
type FeatureTable = typeof driverPredictionFeatures | typeof driverSprintFeatures;

// A sprint weekend runs two predicted sessions on one race row; everything that differs between
// them (tables, date, which statuses mean "predicted" or "decided", features) lives here.
export interface AnySessionKind {
  session: RaceSession;
  predictions: typeof racePredictions | typeof sprintPredictions;
  features: FeatureTable;
  results: typeof raceResults | typeof sprintResults;
  laps: typeof lapTimes | typeof sprintLapTimes;
  date: typeof races.raceDate | typeof races.sprintDate;
  // A prediction is shown as upcoming while the race is in one of these and its session date is ahead.
  upcoming: readonly RaceStatus[];
  // From these on the session has a classified winner to score the prediction against.
  done: readonly RaceStatus[];
}

export interface SessionKind<TFeatures extends FeatureTable, TScores> extends AnySessionKind {
  features: TFeatures;
  manifest: FeatureManifestEntry<TFeatures['$inferSelect'], keyof TScores & string>[];
}

export const GP: SessionKind<typeof driverPredictionFeatures, FeatureScores> = {
  session: 'race',
  predictions: racePredictions,
  features: driverPredictionFeatures,
  manifest: GP_FEATURE_MANIFEST,
  results: raceResults,
  laps: lapTimes,
  date: races.raceDate,
  upcoming: ['qualifying_done'],
  done: ['completed'],
};

export const SPRINT: SessionKind<typeof driverSprintFeatures, SprintFeatureScores> = {
  session: 'sprint',
  predictions: sprintPredictions,
  features: driverSprintFeatures,
  manifest: SPRINT_FEATURE_MANIFEST,
  results: sprintResults,
  laps: sprintLapTimes,
  date: races.sprintDate,
  upcoming: ['sprint_qualifying_done', 'sprint_done', 'qualifying_done'],
  done: ['sprint_done', 'qualifying_done', 'completed'],
};

export function isDone(kind: AnySessionKind, status: string): boolean {
  return (kind.done as readonly string[]).includes(status);
}
