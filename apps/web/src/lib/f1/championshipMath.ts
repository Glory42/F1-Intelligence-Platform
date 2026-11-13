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

export interface PointsSystem {
  grandPrix: number[];
  sprint: number[];
  fastestLap: number;
}

const GRAND_PRIX_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

// The fastest-lap bonus point existed 2019–2024. Sprints paid the top 3 in 2021 and the top 8 from 2022.
export function pointsSystem(year: number): PointsSystem {
  return {
    grandPrix: GRAND_PRIX_POINTS,
    sprint: year <= 2021 ? [3, 2, 1] : [8, 7, 6, 5, 4, 3, 2, 1],
    fastestLap: year >= 2019 && year <= 2024 ? 1 : 0,
  };
}

function maxGrandPrixPoints(year: number): number {
  const system = pointsSystem(year);
  return system.grandPrix[0] + system.fastestLap;
}

function maxSprintPoints(year: number): number {
  return pointsSystem(year).sprint[0];
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
