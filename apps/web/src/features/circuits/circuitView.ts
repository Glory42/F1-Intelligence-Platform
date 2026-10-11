import type { CircuitDetailResponse, Race } from '@/types';

// The forecast only matters for the circuit that hosts the next race (or the season's last one once it's over).
export function isRaceWeekCircuit(races: Race[], circuitKey: string): boolean {
  const byDate = (a: Race, b: Race) => new Date(a.raceDate).getTime() - new Date(b.raceDate).getTime();
  const upcoming = races.filter((r) => r.status !== 'completed').sort(byDate);
  const target = upcoming[0] ?? [...races].sort(byDate).at(-1);
  return target?.circuit.circuitKey === circuitKey;
}

export type WeatherSplit = { dry: number; mixed: number; wet: number; total: number };

export function weatherSplit({ dry, wet, mixed }: CircuitDetailResponse['weatherStats']): WeatherSplit {
  const total = dry + wet + mixed;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  return { dry: pct(dry), mixed: pct(mixed), wet: pct(wet), total };
}
