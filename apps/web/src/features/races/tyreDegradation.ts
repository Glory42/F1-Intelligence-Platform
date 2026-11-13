import { getTeamColor } from '@/lib/f1/teamColors';
import type { Team, TyreDegradation } from '@/types';

export interface DegradationSeries {
  id: number;
  label: string;
  color: string;
  points: Array<{ x: number; y: number }>;
}

export interface DegradationChart {
  compound: string;
  series: DegradationSeries[];
}

export interface DegradationTableRow {
  team: Team;
  cells: Array<{ msPerLap: number; laps: number } | null>;
}

export function shortTeamName(name: string): string {
  return name.replace(/ (Racing|F1 Team)$/, '');
}

function compoundsOf(rows: TyreDegradation[]): string[] {
  return [...new Set(rows.map((r) => r.compound))];
}

// The API serves compounds softest first, so first appearance is the order to show them in.
export function degradationCharts(rows: TyreDegradation[]): DegradationChart[] {
  return compoundsOf(rows).map((compound) => ({
    compound,
    series: rows
      .filter((r) => r.compound === compound)
      .map((r) => ({
        id: r.team.id,
        label: shortTeamName(r.team.name),
        color: getTeamColor(r.team.teamKey),
        points: r.points.map((p) => ({ x: p.tyreAge, y: p.lossMs / 1000 })),
      })),
  }));
}

export function degradationTable(rows: TyreDegradation[]): { compounds: string[]; rows: DegradationTableRow[] } {
  const compounds = compoundsOf(rows);
  const byTeam = new Map<number, TyreDegradation[]>();
  for (const r of rows) byTeam.set(r.team.id, [...(byTeam.get(r.team.id) ?? []), r]);

  const meanWear = (own: TyreDegradation[]) => own.reduce((sum, r) => sum + r.msPerLap, 0) / own.length;
  const teams = [...byTeam.values()].sort((a, b) => meanWear(a) - meanWear(b));
  return {
    compounds,
    rows: teams.map((own) => ({
      team: own[0].team,
      cells: compounds.map((c) => {
        const cell = own.find((r) => r.compound === c);
        return cell ? { msPerLap: cell.msPerLap, laps: cell.laps } : null;
      }),
    })),
  };
}
