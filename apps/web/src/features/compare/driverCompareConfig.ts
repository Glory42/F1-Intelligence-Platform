import type { DriverSeasonStats } from '@/types';
import type { CareerTotals } from './compareStats';
import type { StatRowConfig } from './components/ComparisonRow';

export const seasonStatConfig: StatRowConfig<DriverSeasonStats>[] = [
  {
    label: 'Championship Points',
    value: (s) => Number(s.championshipPoints),
    format: (v) => v.toString(),
  },
  { label: 'Grand Prix Wins', value: (s) => s.wins },
  { label: 'Podium Finishes', value: (s) => s.podiums },
  { label: 'Poles Secured', value: (s) => s.poles },
  {
    label: 'Avg Finish Position',
    value: (s) => parseFloat(s.avgFinishPosition || '20'),
    format: (v) => `P${v.toFixed(1)}`,
    lowerBetter: true,
  },
  { label: 'Races Entered', value: (s) => s.racesEntered },
  { label: 'Total DNFs', value: (s) => s.dnfCount, lowerBetter: true },
  {
    label: 'Avg Sector 1',
    value: (s) => s.avgSector1Ms || 99999,
    format: (v) => (v === 99999 ? '-' : `${(v / 1000).toFixed(3)}s`),
    lowerBetter: true,
    show: (a, b) => !!(a.avgSector1Ms || b.avgSector1Ms),
  },
  {
    label: 'Avg Sector 2',
    value: (s) => s.avgSector2Ms || 99999,
    format: (v) => (v === 99999 ? '-' : `${(v / 1000).toFixed(3)}s`),
    lowerBetter: true,
    show: (a, b) => !!(a.avgSector2Ms || b.avgSector2Ms),
  },
  {
    label: 'Avg Sector 3',
    value: (s) => s.avgSector3Ms || 99999,
    format: (v) => (v === 99999 ? '-' : `${(v / 1000).toFixed(3)}s`),
    lowerBetter: true,
    show: (a, b) => !!(a.avgSector3Ms || b.avgSector3Ms),
  },
];

export const careerStatConfig: StatRowConfig<CareerTotals>[] = [
  {
    label: 'Best Championship Finish',
    value: (c) => c.bestFin || 20,
    format: (v) => (v === 20 ? '-' : `P${v}`),
    lowerBetter: true,
  },
  { label: 'Total Points', value: (c) => c.points, format: (v) => v.toFixed(1) },
  { label: 'Career Wins', value: (c) => c.wins },
  { label: 'Career Podiums', value: (c) => c.podiums },
  { label: 'Career Poles', value: (c) => c.poles },
  { label: 'Career Entries', value: (c) => c.entries },
  { label: 'Total DNFs', value: (c) => c.dnfs, lowerBetter: true },
];
