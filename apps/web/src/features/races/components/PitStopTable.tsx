import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { getTeamColor } from '@/lib/teamColors';
import { formatStopSeconds } from '@/lib/utils';
import type { DriverStrategy } from '@/types';

interface Props {
  drivers: DriverStrategy[];
  year: number;
}

// Same conventions as RaceResultsTable: team-colour edge, code + name links, team dot.
export function PitStopTable({ drivers, year }: Props) {
  const stops = drivers
    .flatMap((d) => d.pitStops.map((p) => ({ driver: d.driver, ...p })))
    .sort((a, b) => a.lapNumber - b.lapNumber);
  if (stops.length === 0) return null;
  const fastest = Math.min(...stops.flatMap((s) => (s.stationaryMs == null ? [] : [s.stationaryMs])));

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">Code</TableHead>
            <TableHead>Driver</TableHead>
            <TableHead className="hidden sm:table-cell">Team</TableHead>
            <TableHead className="text-right w-14">Lap</TableHead>
            <TableHead className="text-right w-28">Stationary</TableHead>
            <TableHead className="text-right hidden md:table-cell w-28">Pit lane</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stops.map((s) => (
            <TableRow key={`${s.driver.id}-${s.lapNumber}`} style={{ borderLeft: `2px solid ${getTeamColor(s.driver.team.teamKey)}` }}>
              <TableCell>
                <a href={`/drivers/${s.driver.id}?year=${year}`} className="font-mono text-[10px] font-bold tracking-widest hover:text-foreground transition-colors">
                  {s.driver.code}
                </a>
              </TableCell>
              <TableCell>
                <a href={`/drivers/${s.driver.id}?year=${year}`} className="font-medium text-sm hover:text-foreground transition-colors">{s.driver.fullName}</a>
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <span className="inline-flex items-center gap-1.5 font-mono text-[9px] text-muted-foreground">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: getTeamColor(s.driver.team.teamKey) }} />
                  {s.driver.team.name}
                </span>
              </TableCell>
              <TableCell className="text-right font-mono text-sm">{s.lapNumber}</TableCell>
              <TableCell className="text-right font-mono text-sm font-bold" style={s.stationaryMs === fastest ? { color: '#a855f7' } : undefined}>
                {formatStopSeconds(s.stationaryMs)}
              </TableCell>
              <TableCell className="text-right hidden md:table-cell font-mono text-[10px] text-muted-foreground">{formatStopSeconds(s.pitLaneMs)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
