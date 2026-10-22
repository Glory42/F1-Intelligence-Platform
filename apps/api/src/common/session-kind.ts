import {
  driverPredictionFeatures, driverSprintFeatures, lapTimes, qualifyingResults, racePredictions, raceResults, races,
  raceStatusEnum, sprintLapTimes, sprintPredictions, sprintResults,
} from '../db/schema';
import type { GpFeatures, RaceSession, SprintFeatureScores } from './types';
import { mapFeatureRow, mapGpFeatures, SPRINT_FEATURE_MANIFEST } from './feature-manifest';

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
  // The sheet the session's grid comes from: qualifying for the GP, sprint qualifying for the sprint.
  grid: typeof qualifyingResults | typeof sprintResults;
  date: typeof races.raceDate | typeof races.sprintDate;
  // A prediction is shown as upcoming while the race is in one of these and its session date is ahead.
  upcoming: readonly RaceStatus[];
  // From these on the session has a classified winner to score the prediction against.
  done: readonly RaceStatus[];
}

// The two models store their features differently (GP: one JSONB object; sprint: a column per score),
// so each kind says how to read a feature row into its API shape.
export interface SessionKind<TFeatures extends FeatureTable, TScores> extends AnySessionKind {
  features: TFeatures;
  mapFeatures: (row: TFeatures['$inferSelect']) => TScores;
}

export const GP: SessionKind<typeof driverPredictionFeatures, GpFeatures> = {
  session: 'race',
  predictions: racePredictions,
  features: driverPredictionFeatures,
  mapFeatures: (row) => mapGpFeatures(row.features),
  results: raceResults,
  laps: lapTimes,
  grid: qualifyingResults,
  date: races.raceDate,
  upcoming: ['qualifying_done'],
  done: ['completed'],
};

export const SPRINT: SessionKind<typeof driverSprintFeatures, SprintFeatureScores> = {
  session: 'sprint',
  predictions: sprintPredictions,
  features: driverSprintFeatures,
  mapFeatures: (row) => mapFeatureRow(row, SPRINT_FEATURE_MANIFEST),
  results: sprintResults,
  laps: sprintLapTimes,
  grid: sprintResults,
  date: races.sprintDate,
  upcoming: ['sprint_qualifying_done', 'sprint_done', 'qualifying_done'],
  done: ['sprint_done', 'qualifying_done', 'completed'],
};

export function isDone(kind: AnySessionKind, status: string): boolean {
  return (kind.done as readonly string[]).includes(status);
}
