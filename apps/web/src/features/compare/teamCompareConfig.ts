import type { TeamSeasonStats } from '@/types';
import type { CareerTotals } from './compareStats';
import type { StatRowConfig } from './components/ComparisonRow';

export const seasonStatConfig: StatRowConfig<TeamSeasonStats>[] = [
  {
    label: 'Championship Points',
    value: (s) => Number(s.championshipPoints),
    format: (v) => v.toString(),
  },
  { label: 'Grand Prix Wins', value: (s) => s.wins },
  { label: 'Podiums Secured', value: (s) => s.podiums },
  {
    label: 'Car Performance Score',
    value: (s) => parseFloat(s.carPerformanceScore || '0'),
    format: (v) => v.toFixed(1),
  },
  {
    label: 'Reliability Score',
    value: (s) => parseFloat(s.reliabilityScore || '0') * 100,
    format: (v) => `${Math.round(v)}%`,
  },
  { label: 'Constructor DNFs', value: (s) => s.dnfCount, lowerBetter: true },
  {
    label: 'Avg Finish Position',
    value: (s) => parseFloat(s.avgFinishPosition || '20'),
    format: (v) => `P${v.toFixed(1)}`,
    lowerBetter: true,
  },
];

export const careerStatConfig: StatRowConfig<CareerTotals>[] = [
  {
    label: 'Best Championship Finish',
    value: (c) => c.bestFin || 10,
    format: (v) => (v === 10 ? '-' : `P${v}`),
    lowerBetter: true,
  },
  { label: 'Total Points', value: (c) => c.points, format: (v) => v.toFixed(1) },
  { label: 'Career Wins', value: (c) => c.wins },
  { label: 'Career Podiums', value: (c) => c.podiums },
  { label: 'Races Completed', value: (c) => c.entries },
  { label: 'Total DNFs', value: (c) => c.dnfs, lowerBetter: true },
];
