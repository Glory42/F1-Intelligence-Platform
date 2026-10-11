import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import type { RaceResult, LapSummary } from '@/types';
import { getTeamColor } from '@/lib/f1/teamColors';
import { formatMs } from '@/lib/utils';

interface Props {
  results: RaceResult[];
  year: number;
  laps?: LapSummary[];
  flColor?: string;
}

export function RaceResultsTable({ results, year, laps, flColor = '#a855f7' }: Props) {
  const lapMsMap = new Map(laps?.map((l) => [l.driverId, l.fastestLapMs]) ?? []);

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">Pos</TableHead>
            <TableHead className="w-12">Code</TableHead>
            <TableHead>Driver</TableHead>
            <TableHead className="hidden sm:table-cell">Team</TableHead>
            <TableHead className="text-right w-14">Pts</TableHead>
            <TableHead className="hidden md:table-cell w-28">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.map((r) => (
            <TableRow key={r.id} style={{ borderLeft: `2px solid ${getTeamColor(r.driver.team.teamKey)}`, background: r.fastestLap ? `color-mix(in srgb, ${flColor} 4%, transparent)` : undefined }}>
              <TableCell>
                <span className={`font-mono text-sm font-bold ${r.finishPosition === 1 ? '' : r.finishPosition == null ? 'text-muted-foreground' : ''}`} style={r.finishPosition === 1 ? { color: flColor } : undefined}>
                  {r.finishPosition ?? 'DNF'}
                </span>
              </TableCell>
              <TableCell>
                <a href={`/drivers/${r.driver.id}?year=${year}`} className="font-mono text-[10px] font-bold tracking-widest hover:text-foreground transition-colors">
                  {r.driver.code}
                </a>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2 flex-wrap">
                  <a href={`/drivers/${r.driver.id}?year=${year}`} className="font-medium text-sm hover:text-foreground transition-colors">
                    {r.driver.fullName}
                  </a>
                  {r.fastestLap && (
                    <>
                      <span className="font-mono text-[8px] tracking-widest uppercase px-1.5 py-0.5 border" style={{ borderColor: `color-mix(in srgb, ${flColor} 40%, transparent)`, color: `color-mix(in srgb, ${flColor} 80%, transparent)` }}>FL</span>
                      {lapMsMap.get(r.driver.id) && (
                        <span className="font-mono text-[9px] font-bold" style={{ color: flColor }}>
                          {formatMs(lapMsMap.get(r.driver.id) ?? null)}
                        </span>
                      )}
                    </>
                  )}
                </div>
                <div className="sm:hidden font-mono text-[9px] text-muted-foreground mt-0.5 truncate">{r.driver.team.name}</div>
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <a href={`/teams/${r.driver.team.id}?year=${year}`} className="inline-flex items-center gap-1.5 font-mono text-[9px] text-muted-foreground hover:text-foreground transition-colors max-w-[140px]">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: getTeamColor(r.driver.team.teamKey) }} />
                  <span className="truncate">{r.driver.team.name}</span>
                </a>
              </TableCell>
              <TableCell className="text-right font-mono text-sm">{r.points}</TableCell>
              <TableCell className="hidden md:table-cell w-28 font-mono text-[9px] text-muted-foreground">{r.status}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
