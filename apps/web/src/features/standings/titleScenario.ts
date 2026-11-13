import { pointsSystem } from '@/lib/f1/championshipMath';
import type { Race } from '@/types';

export type Entrant = 'driver' | 'team';

export interface Contender {
  id: number;
  name: string;
  points: number;
  // finishes[i] = grand prix finishes in position i + 1: the countback for a tie on points.
  finishes: number[];
}

// One round still to run: its grand prix, plus its sprint while that hasn't been run yet.
export interface Weekend {
  round: number;
  name: string;
  grandPrix: boolean;
  sprint: boolean;
}

export type ClinchOutlook =
  | { kind: 'champion'; leader: Contender }
  | { kind: 'next'; leader: Contender; weekend: Weekend; margins: Array<{ rival: Contender; points: number }> }
  | { kind: 'later'; leader: Contender; weekend: Weekend };

export interface ScenarioPick {
  id: number;
  round: number;
  gp: number | null;
  sprint: number | null;
}

const SPRINT_STILL_TO_RUN = new Set<Race['status']>(['scheduled', 'sprint_qualifying_done']);

export function remainingWeekends(races: Array<Pick<Race, 'roundNumber' | 'name' | 'status' | 'hasSprint'>>): Weekend[] {
  return races
    .filter((r) => r.status !== 'completed')
    .sort((a, b) => a.roundNumber - b.roundNumber)
    .map((r) => ({ round: r.roundNumber, name: r.name, grandPrix: true, sprint: r.hasSprint && SPRINT_STILL_TO_RUN.has(r.status) }));
}

// A team's best weekend is a one-two; a driver's is a win (plus fastest lap while it scored).
export function weekendMaxPoints(weekend: Weekend, year: number, entrant: Entrant): number {
  const system = pointsSystem(year);
  const cars = entrant === 'team' ? 2 : 1;
  const top = (table: number[]) => table.slice(0, cars).reduce((sum, p) => sum + p, 0);
  return (weekend.grandPrix ? top(system.grandPrix) + system.fastestLap : 0) + (weekend.sprint ? top(system.sprint) : 0);
}

export function rankWithCountback<T extends Contender>(rows: T[]): T[] {
  const countback = (a: T, b: T) => {
    for (let i = 0; i < Math.max(a.finishes.length, b.finishes.length); i++) {
      const diff = (b.finishes[i] ?? 0) - (a.finishes[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  };
  return [...rows].sort((a, b) => b.points - a.points || countback(a, b));
}

// Clinched means strictly ahead of every rival's best case: a rival who can only draw level is still
// alive, because countback might go their way.
export function clinchOutlook(contenders: Contender[], weekends: Weekend[], year: number, entrant: Entrant): ClinchOutlook | null {
  if (weekends.length === 0 || contenders.length === 0) return null;
  const [leader, ...others] = rankWithCountback(contenders);
  const maxima = weekends.map((w) => weekendMaxPoints(w, year, entrant));
  const total = maxima.reduce((sum, p) => sum + p, 0);
  const rivals = others.filter((r) => r.points + total >= leader.points);
  if (rivals.length === 0) return { kind: 'champion', leader };

  let scoredSoFar = 0;
  for (const [k, weekend] of weekends.entries()) {
    scoredSoFar += maxima[k];
    const stillToScore = total - scoredSoFar;
    if (!rivals.every((r) => leader.points - r.points + scoredSoFar > stillToScore)) continue;
    if (k > 0) return { kind: 'later', leader, weekend };
    const margins = rivals.map((rival) => ({ rival, points: stillToScore - (leader.points - rival.points) + 1 }));
    return { kind: 'next', leader, weekend, margins };
  }
  return null;
}

const points = (n: number) => `${n} point${n === 1 ? '' : 's'}`;

export function clinchSentence(outlook: ClinchOutlook, entrant: Entrant): string {
  const title = entrant === 'team' ? "the constructors' title" : 'the title';
  const { leader } = outlook;
  if (outlook.kind === 'champion') return `No one can catch ${leader.name} any more: ${title} is decided.`;
  if (outlook.kind === 'later') return `The earliest ${leader.name} can clinch ${title} is the ${outlook.weekend.name}.`;

  const terms = outlook.margins.map(({ rival, points: margin }) =>
    margin > 0 ? `outscoring ${rival.name} by ${points(margin)} or more`
      : margin === 0 ? `scoring at least as many points as ${rival.name}`
        : `losing no more than ${points(-margin)} to ${rival.name}`);
  return `${leader.name} clinches ${title} at the ${outlook.weekend.name} by ${terms.join(' and ')}.`;
}

export function titleRaceSentence(
  contenders: Contender[], races: Parameters<typeof remainingWeekends>[0], year: number, entrant: Entrant,
): string | null {
  const outlook = clinchOutlook(contenders, remainingWeekends(races), year, entrant);
  return outlook ? clinchSentence(outlook, entrant) : null;
}

// Picks set grand prix and sprint places for the remaining rounds; only grand prix places count back.
export function applyScenario(contenders: Contender[], picks: ScenarioPick[], weekends: Weekend[], year: number): Contender[] {
  const system = pointsSystem(year);
  const weekendOf = new Map(weekends.map((w) => [w.round, w]));
  const scored = contenders.map((c) => {
    const finishes = [...c.finishes];
    let total = c.points;
    for (const pick of picks.filter((p) => p.id === c.id)) {
      const weekend = weekendOf.get(pick.round);
      if (!weekend) continue;
      if (weekend.grandPrix && pick.gp != null) {
        total += system.grandPrix[pick.gp - 1] ?? 0;
        finishes[pick.gp - 1] = (finishes[pick.gp - 1] ?? 0) + 1;
      }
      if (weekend.sprint && pick.sprint != null) total += system.sprint[pick.sprint - 1] ?? 0;
    }
    return { ...c, points: total, finishes: Array.from(finishes, (n) => n ?? 0) };
  });
  return rankWithCountback(scored);
}
