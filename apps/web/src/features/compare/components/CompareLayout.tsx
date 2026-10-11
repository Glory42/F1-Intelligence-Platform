import type { ReactNode } from 'react';
import { Zap } from 'lucide-react';
import { CompareModeToggle } from './CompareModeToggle';
import { CompareYearSelect } from './CompareYearSelect';
import { CompareSlotBadge } from './CompareSlotBadge';

interface Side {
  select: ReactNode;
  card: ReactNode;
  name: string | null;
  color: string;
}

interface Props {
  a: Side;
  b: Side;
  years: number[];
  year: number;
  setYear: (year: number) => void;
  isCareer: boolean;
  setIsCareer: (isCareer: boolean) => void;
  status: ReactNode;
  stats: ReactNode;
}

export function CompareLayout({ a, b, years, year, setYear, isCareer, setIsCareer, status, stats }: Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] gap-6 items-start">
      <aside className="lg:order-2 lg:sticky lg:top-6 border border-white/[0.06] bg-black p-4 space-y-4">
        <div className="space-y-2">
          {a.select}
          <div className="text-center font-mono text-[9px] tracking-widest text-muted-foreground uppercase">vs</div>
          {b.select}
        </div>

        <div className="flex items-center gap-3">
          {!isCareer && (
            <div className="flex-1 min-w-0">
              <CompareYearSelect years={years} year={year} setYear={setYear} />
            </div>
          )}
          <div className={isCareer ? 'ml-auto' : undefined}>
            <CompareModeToggle isCareer={isCareer} setIsCareer={setIsCareer} />
          </div>
        </div>

        <div className="border-t border-white/[0.06] pt-4 space-y-3">
          {a.card}
          {b.card}
        </div>
      </aside>

      <section className="lg:order-1 min-w-0">
        {status ?? (
          <div key="content" className="fade-swap border border-white/[0.06] bg-black p-6 space-y-6">
            <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
              <Zap size={11} /> head-to-head comparison
            </div>

            <div className="flex items-center justify-between gap-4 font-mono text-[9px] tracking-wider uppercase text-white/80">
              <span className="flex items-center gap-2 min-w-0">
                <CompareSlotBadge slot="A" color={a.color} />
                <span className="truncate">{a.name ?? '-'}</span>
              </span>
              <span className="flex items-center gap-2 min-w-0 justify-end">
                <span className="truncate">{b.name ?? '-'}</span>
                <CompareSlotBadge slot="B" color={b.color} />
              </span>
            </div>

            <div className="space-y-4">{stats}</div>
          </div>
        )}
      </section>
    </div>
  );
}
