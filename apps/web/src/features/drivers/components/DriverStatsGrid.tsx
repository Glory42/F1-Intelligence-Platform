import { championshipPoints } from '@/lib/f1/championshipMath';
import type { DriverSeasonStats } from '@/types';


interface Props {
  stats: DriverSeasonStats;
}

export function DriverStatsGrid({ stats }: Props) {
  const winRate = stats.winRate ? `${(Number(stats.winRate) * 100).toFixed(1)}%` : '-';
  const avgGain = stats.avgPositionGain
    ? (Number(stats.avgPositionGain) > 0 ? '+' : '') + Number(stats.avgPositionGain).toFixed(1)
    : '-';
  const dnfDisplay = `${stats.dnfCount}${stats.dnfRate ? ` (${(Number(stats.dnfRate) * 100).toFixed(0)}%)` : ''}`;
  const topSpeed = stats.topSpeedAvg ? `${Math.round(Number(stats.topSpeedAvg))} km/h` : '-';
  const tmDelta = stats.teammateQualiDelta
    ? (Number(stats.teammateQualiDelta) >= 0 ? '+' : '') + (Number(stats.teammateQualiDelta) * 100).toFixed(2) + '%'
    : '-';

  const cells: [string, string | number][] = [
    ['Championship', stats.championshipPosition ? `P${stats.championshipPosition}` : '-'],
    ['Points', Math.round(championshipPoints(stats))],
    ['Wins', stats.wins],
    ['Podiums', stats.podiums],
    ['Poles', stats.poles],
    ['Races', stats.racesEntered],
    ['Win Rate', winRate],
    ['Avg Gain', avgGain],
    ['DNFs', dnfDisplay],
    ['Top Speed', topSpeed],
    ['vs Teammate', tmDelta],
    ['Avg Finish', stats.avgFinishPosition ? `P${Math.round(Number(stats.avgFinishPosition))}` : '-'],
  ];

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-px bg-white/[0.06]">
        {cells.map(([label, val]) => (
          <div key={label} className="bg-black p-4">
            <div className="text-[11px] text-muted-foreground mb-1">{label}</div>
            <div className="font-bold text-xl">{val}</div>
          </div>
        ))}
      </div>

    </div>
  );
}
