import type { Terms } from '@/lib/f1/predictionTerms';

export interface PredictionAccent {
  hex: string;
  rgb: string;
}

export const GP_ACCENT: PredictionAccent = { hex: '#a855f7', rgb: '168,85,247' };
export const SPRINT_ACCENT: PredictionAccent = { hex: '#fb923c', rgb: '249,115,22' };

// One driver of a GP or sprint prediction, already reduced to what the page shows: the two models
// store different features, so the data builder turns each into per-feature terms first.
export interface PredictionDriverVM {
  driver: {
    id: number;
    code: string;
    lastName: string;
    fullName: string;
    team: { teamKey: string };
  };
  winProbability: string;
  gridPosition: number | null;
  terms: Terms;
  // Each feature 0–1 within this field, for the radar.
  radar: Terms;
  // The driver table's pace column, formatted by the model (GP: team race-pace gap, sprint: car score).
  pace: string;
}

export interface PredictionResultRow {
  driver: { id: number };
  finishPosition: number | null;
  status?: string | null;
}

export type FeatureMeta = Record<string, { label: string; weight: number }>;

// Serialised into the What-If Lab's page so its client script can re-score without a fetch.
export interface WhatIfPayload {
  drivers: Array<{ id: number; code: string; fullName: string; winProbability: string; terms: Terms }>;
  weights: Record<string, number>;
}

export type PredictionPageKind = 'gp' | 'sprint';
