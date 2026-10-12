export interface PredictionAccent {
  hex: string;
  rgb: string;
}

export const GP_ACCENT: PredictionAccent = { hex: '#a855f7', rgb: '168,85,247' };
export const SPRINT_ACCENT: PredictionAccent = { hex: '#fb923c', rgb: '249,115,22' };

export interface PredictionDriverVM {
  driver: {
    id: number;
    code: string;
    lastName: string;
    fullName: string;
    team: { teamKey: string };
  };
  winProbability: string;
  features: Record<string, unknown>;
}

export interface PredictionResultRow {
  driver: { id: number };
  finishPosition: number | null;
  status?: string | null;
}

export type FeatureMeta = Record<string, { label: string; weight: number }>;

// Serialised into the What-If Lab's page so its client script can re-score without a fetch.
export interface WhatIfPayload {
  drivers: Array<{ id: number; code: string; fullName: string; winProbability: string; features: Record<string, unknown> }>;
  weights: Record<string, number>;
}

export type PredictionPageKind = 'gp' | 'sprint';
