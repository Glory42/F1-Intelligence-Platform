import { useMemo, useState } from 'react';
import { scenarioOutcome, type Contender, type ScenarioPick, type Weekend } from '../titleScenario';

export interface WhatIfDriver {
  id: number;
  code: string;
  color: string;
}

interface Props {
  year: number;
  weekends: Weekend[];
  // Everyone still in contention; only `drivers` get places to pick, the rest score nothing.
  contenders: Contender[];
  drivers: WhatIfDriver[];
}

type Session = 'sprint' | 'gp';
const PLACES = Array.from({ length: 20 }, (_, i) => i + 1);
const SESSION_LABEL: Record<Session, string> = { sprint: 'Sprint', gp: 'Grand prix' };
const placeKey = (round: number, session: Session, id: number) => `${round}:${session}:${id}`;
const formatPoints = (points: number) => (Number.isInteger(points) ? String(points) : points.toFixed(1));

// Data comes in as props from the title-fight tab (CLAUDE.md §3): this island never fetches.
export function TitleWhatIf({ year, weekends, contenders, drivers }: Props) {
  const [places, setPlaces] = useState<Record<string, number>>({});

  const picks = useMemo<ScenarioPick[]>(
    () => weekends.flatMap((w) => drivers.map((d) => ({
      id: d.id, round: w.round,
      gp: places[placeKey(w.round, 'gp', d.id)] ?? null,
      sprint: places[placeKey(w.round, 'sprint', d.id)] ?? null,
    }))),
    [weekends, drivers, places],
  );
  const picked = Object.keys(places).length > 0;
  const outcome = useMemo(() => scenarioOutcome(contenders, picks, weekends, year), [contenders, picks, weekends, year]);

  const setPlace = (key: string, value: string) =>
    setPlaces((current) => {
      const next = { ...current };
      if (value === '') delete next[key];
      else next[key] = Number(value);
      return next;
    });

  const rows = weekends.flatMap((w) => [...(w.sprint ? ['sprint' as const] : []), 'gp' as const].map((session) => ({ w, session })));

  return (
    <section aria-label="What if" className="panel p-5 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="text-[11px] text-muted-foreground">
          What if: pick finishing places for the rest of the season. Places left blank score nothing.
        </div>
        {picked && (
          <button type="button" onClick={() => setPlaces({})} className="font-mono text-[9px] tracking-widest uppercase text-muted-foreground hover:text-foreground">
            Reset
          </button>
        )}
      </div>

      <p role="status" className="border-l-2 border-[#a855f7] pl-3 text-sm">
        {picked && outcome
          ? `${outcome.champion.name} takes the title at the ${outcome.decidedAt.name}${outcome.onCountback ? ', on countback' : ''}.`
          : 'Pick a few places to see who takes the title, and where.'}
      </p>

      <div className="grid gap-4 lg:grid-cols-[1fr_220px] items-start">
        <div className="overflow-auto max-h-[420px] border border-white/[0.06]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background">
              <tr className="text-left font-mono text-[9px] tracking-widest uppercase text-muted-foreground">
                <th className="px-3 py-2 font-normal">Round</th>
                {drivers.map((d) => (
                  <th key={d.id} className="px-2 py-2 font-normal" style={{ color: d.color }}>{d.code}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {rows.map(({ w, session }) => {
                const taken = new Map(drivers.map((d) => [d.id, places[placeKey(w.round, session, d.id)]]));
                return (
                  <tr key={`${w.round}-${session}`}>
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      <span className="block">{w.name}</span>
                      <span className="font-mono text-[9px] text-muted-foreground">{SESSION_LABEL[session]}</span>
                    </th>
                    {drivers.map((d) => {
                      const key = placeKey(w.round, session, d.id);
                      return (
                        <td key={d.id} className="px-2 py-2">
                          <select
                            aria-label={`${d.code}, ${w.name} ${SESSION_LABEL[session].toLowerCase()}`}
                            value={places[key] ?? ''}
                            onChange={(e) => setPlace(key, e.target.value)}
                            className="bg-transparent border border-white/[0.1] px-1 py-0.5 font-mono text-xs"
                          >
                            <option value="">–</option>
                            {PLACES.map((p) => (
                              <option key={p} value={p} disabled={[...taken].some(([id, place]) => id !== d.id && place === p)}>P{p}</option>
                            ))}
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {outcome && (
          <ol aria-label="Standings after these results" className="border border-white/[0.06] divide-y divide-white/[0.06]">
            {outcome.standings.slice(0, Math.max(drivers.length, 3)).map((c, i) => (
              <li key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span><span className="font-mono text-[10px] text-muted-foreground mr-2">{i + 1}</span>{c.name}</span>
                <span className="font-mono tabular-nums">{formatPoints(c.points)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
