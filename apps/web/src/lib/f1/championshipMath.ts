export interface StandingPoints {
  id: number;
  points: number;
}

export interface RemainingRaces {
  year: number;
  grandsPrix: number;
  sprints: number;
}

export interface Contention {
  alive: boolean;
  maxPoints: number;
  gapToLeader: number;
}

// The fastest-lap bonus point existed 2019–2024; from 2025 a GP win is worth at most 25.
function maxGrandPrixPoints(year: number): number {
  return year >= 2019 && year <= 2024 ? 26 : 25;
}

// Sprint wins paid 3 points in 2021 (top 3 scored); from 2022 the top 8 score and a win pays 8.
function maxSprintPoints(year: number): number {
  return year <= 2021 ? 3 : 8;
}

export function titleContention(standings: StandingPoints[], remaining: RemainingRaces): Map<number, Contention> {
  const leaderPoints = Math.max(...standings.map((s) => s.points));
  const available =
    remaining.grandsPrix * maxGrandPrixPoints(remaining.year) + remaining.sprints * maxSprintPoints(remaining.year);
  return new Map(
    standings.map((s) => [
      s.id,
      { alive: s.points + available >= leaderPoints, maxPoints: s.points + available, gapToLeader: leaderPoints - s.points },
    ]),
  );
}

const SPRINT_STILL_TO_RUN = new Set(['scheduled', 'sprint_qualifying_done']);

export function remainingSessions(races: Array<{ status: string; hasSprint: boolean }>): { grandsPrix: number; sprints: number } {
  return {
    grandsPrix: races.filter((r) => r.status !== 'completed').length,
    sprints: races.filter((r) => r.hasSprint && SPRINT_STILL_TO_RUN.has(r.status)).length,
  };
}

export function formatTitleOdds(p: number): string {
  if (p >= 0.995) return '100%';
  if (p > 0 && p < 0.01) return '<1%';
  return `${Math.round(p * 100)}%`;
}
