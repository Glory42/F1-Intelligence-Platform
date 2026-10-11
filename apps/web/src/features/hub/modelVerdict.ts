interface PredictionCall<D> {
  raceId: number;
  isSprint: boolean;
  correct: boolean | null;
  winProbability: string;
  actualWinnerPredictedPosition: number | null;
  predictedWinner: D;
}

export interface ModelVerdict<D> {
  pick: D;
  probability: number;
  hit: boolean | null;
  winnerRank: number | null;
  seasonCorrect: number;
  seasonDecided: number;
}

export function modelVerdict<D>(history: PredictionCall<D>[], raceId: number): ModelVerdict<D> | null {
  const grandsPrix = history.filter((h) => !h.isSprint);
  const call = grandsPrix.find((h) => h.raceId === raceId);
  if (!call) return null;
  const decided = grandsPrix.filter((h) => h.correct != null);
  return {
    pick: call.predictedWinner,
    probability: Number(call.winProbability),
    hit: call.correct,
    winnerRank: call.actualWinnerPredictedPosition,
    seasonCorrect: decided.filter((h) => h.correct).length,
    seasonDecided: decided.length,
  };
}
