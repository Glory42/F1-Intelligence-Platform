import type { PredictionPageKind } from './types';

// All wording that differs between the GP and sprint prediction pages. The page views
// own this; the data builder returns facts, not phrasing.
export interface PredictionCopy {
  pageTitle: (raceName: string) => string;
  fallbackTitle: string;
  kicker: (roundNumber: number) => string;
  notFoundMessage: string;
  fetchErrorMessage: string;
  actualLabel: string;
  actualWinnerLabel: string;
  gridColLabel: string;
  weightsHeading: string;
  weightsNote?: string;
  sliderMax: number;
  whatIfBlurb: string;
}

export const PREDICTION_COPY: Record<PredictionPageKind, PredictionCopy> = {
  gp: {
    pageTitle: (raceName) => `${raceName} Prediction`,
    fallbackTitle: 'Race Prediction',
    kicker: (roundNumber) => `./round-${String(roundNumber).padStart(2, '0')}`,
    notFoundMessage: 'No prediction for this race',
    fetchErrorMessage: 'No prediction available for this race',
    actualLabel: 'actual winner',
    actualWinnerLabel: 'actual winner',
    gridColLabel: 'Qual Pos',
    weightsHeading: './model weights',
    sliderMax: 30,
    whatIfBlurb:
      'Drag the weights to see how the predicted order shifts. Recomputed live in your browser: the model itself is unchanged.',
  },
  sprint: {
    pageTitle: (raceName) => `Sprint Prediction · ${raceName}`,
    fallbackTitle: 'Sprint Prediction',
    kicker: (roundNumber) => `./round-${String(roundNumber).padStart(2, '0')} · sprint prediction`,
    notFoundMessage: 'No sprint prediction for this race',
    fetchErrorMessage: 'No sprint prediction available for this race',
    actualLabel: 'actual sprint winner',
    actualWinnerLabel: 'sprint winner',
    gridColLabel: 'Grid',
    weightsHeading: './sprint weights',
    weightsNote: 'Grid position weighted higher, since a ~17 lap sprint has no pit stop strategy.',
    sliderMax: 35,
    whatIfBlurb:
      'Drag the weights to see how the predicted sprint order shifts. Recomputed live in your browser: the model itself is unchanged.',
  },
};
