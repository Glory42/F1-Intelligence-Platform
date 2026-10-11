import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { formatMs } from '@/lib/utils';
import type { QualifyingResult } from '@/types';
import { getTeamColor } from '@/lib/f1/teamColors';

function fmtSector(ms: number | null): string {
  if (!ms) return '-';
  return (ms / 1000).toFixed(3);
}

interface Props {
  qualifying: QualifyingResult[];
  year: number;
  labelPrefix?: string;
}

export function QualifyingGrid({ qualifying, year, labelPrefix = 'Q' }: Props) {
  const hasQ2 = qualifying.some((q) => q.q2TimeMs);
  const hasQ3 = qualifying.some((q) => q.q3TimeMs);
  const hasSectors = qualifying.some((q) => q.sector1Ms || q.sector2Ms || q.sector3Ms);

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">Grid</TableHead>
            <TableHead className="w-14">Code</TableHead>
            <TableHead>Driver</TableHead>
            <TableHead className="text-right">{labelPrefix}1</TableHead>
            {hasQ2 && <TableHead className="text-right">{labelPrefix}2</TableHead>}
            {hasQ3 && <TableHead className="text-right">{labelPrefix}3</TableHead>}
            {hasSectors && (
              <>
                <TableHead className="text-right hidden lg:table-cell">S1</TableHead>
                <TableHead className="text-right hidden lg:table-cell">S2</TableHead>
                <TableHead className="text-right hidden lg:table-cell">S3</TableHead>
                <TableHead className="text-right hidden xl:table-cell">Top km/h</TableHead>
              </>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {qualifying.map((q) => (
            <TableRow key={q.id} style={{ borderLeft: `2px solid ${getTeamColor(q.driver.team.teamKey)}` }}>
              <TableCell>
                <span className={`font-mono text-sm font-bold ${q.gridPosition === 1 ? 'text-[#a855f7]' : 'text-muted-foreground'}`}>
                  P{q.gridPosition}
                </span>
              </TableCell>
              <TableCell>
                <a href={`/drivers/${q.driver.id}?year=${year}`} className="font-mono text-xs font-semibold tracking-widest hover:text-[#a855f7] transition-colors">
                  {q.driver.code}
                </a>
              </TableCell>
              <TableCell>
                <a href={`/drivers/${q.driver.id}?year=${year}`} className="font-medium hover:text-[#a855f7] transition-colors">
                  {q.driver.fullName}
                </a>
                <p className="font-mono text-[8px] text-muted-foreground mt-0.5">{q.driver.team.name}</p>
              </TableCell>
              <TableCell className="text-right font-mono text-sm text-muted-foreground">
                {formatMs(q.q1TimeMs)}
              </TableCell>
              {hasQ2 && (
                <TableCell className="text-right font-mono text-sm text-muted-foreground">
                  {formatMs(q.q2TimeMs)}
                </TableCell>
              )}
              {hasQ3 && (
                <TableCell className={`text-right font-mono text-sm ${q.q3TimeMs ? 'font-bold' : 'text-muted-foreground'}`}>
                  {formatMs(q.q3TimeMs)}
                </TableCell>
              )}
              {hasSectors && (
                <>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground hidden lg:table-cell">
                    {fmtSector(q.sector1Ms)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground hidden lg:table-cell">
                    {fmtSector(q.sector2Ms)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground hidden lg:table-cell">
                    {fmtSector(q.sector3Ms)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground hidden xl:table-cell">
                    {q.speedSt ? Math.round(Number(q.speedSt)) : '-'}
                  </TableCell>
                </>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
