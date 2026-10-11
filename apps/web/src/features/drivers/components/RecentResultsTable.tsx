import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import type { RaceResult } from '@/types';

type RecentResult = RaceResult & { race: { name: string; raceDate: string } };

interface Props {
  results: RecentResult[];
}

export function RecentResultsTable({ results }: Props) {
  if (results.length === 0) {
    return <p className="font-mono text-[9px] text-muted-foreground px-5 py-6">No recent results.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Race</TableHead>
            <TableHead className="text-center w-14">Grid</TableHead>
            <TableHead className="text-center w-14">Finish</TableHead>
            <TableHead className="text-right w-14">Pts</TableHead>
            <TableHead className="w-10 hidden sm:table-cell whitespace-nowrap">Δ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.map((r) => {
            const gained = r.gridPosition - (r.finishPosition ?? r.gridPosition);
            return (
              <TableRow key={r.id}>
                <TableCell>
                  <a href={`/races/${r.raceId}`} className="font-medium text-sm hover:text-[#a855f7] transition-colors">
                    {r.race.name}
                  </a>
                  <p className="font-mono text-[9px] text-muted-foreground mt-0.5">
                    {new Date(r.race.raceDate).getFullYear()}
                  </p>
                </TableCell>
                <TableCell className="text-center font-mono text-sm">{r.gridPosition}</TableCell>
                <TableCell className="text-center">
                  <span className={`font-mono text-sm font-bold ${r.finishPosition === 1 ? 'text-[#a855f7]' : r.finishPosition == null ? 'text-muted-foreground' : ''}`}>
                    {r.finishPosition ?? 'DNF'}
                  </span>
                </TableCell>
                <TableCell className="text-right font-mono text-sm">{r.points}</TableCell>
                <TableCell className="hidden sm:table-cell">
                  {r.finishPosition == null ? (
                    <span className="font-mono text-[9px] text-red-400">DNF</span>
                  ) : gained > 0 ? (
                    <span className="font-mono text-sm text-green-400">+{gained}</span>
                  ) : gained < 0 ? (
                    <span className="font-mono text-sm text-red-400">{gained}</span>
                  ) : (
                    <span className="font-mono text-sm text-muted-foreground">-</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
