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
  paceColLabel: string;
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
    paceColLabel: 'Race Pace',
    weightsHeading: './model weights',
    weightsNote:
      'Fitted to every Grand Prix since 2010: each feature\'s share of how far a typical difference in it moves the prediction.',
    sliderMax: 40,
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
    paceColLabel: 'Race Pace',
    weightsHeading: './model weights',
    weightsNote:
      'The Grand Prix model\'s fitted weights, applied to the sprint grid: refitting on sprints alone scored no better.',
    sliderMax: 35,
    whatIfBlurb:
      'Drag the weights to see how the predicted sprint order shifts. Recomputed live in your browser: the model itself is unchanged.',
  },
};
