import type { ConstructorLineage, DriverRecordStat, LineageMember, RecordChase, RecordEntry } from '../../common/types';
import { f1dbConstructorId, normalizePersonName } from '../../common/f1dbMatch';

export type CoreTeamRef = { id: number; teamKey: string };
export type CoreLink = { id: number; active: boolean };
export type CoreTeamLink = CoreTeamRef & { active: boolean };
export type CoreLinks = { drivers: Map<string, CoreLink>; teams: Map<string, CoreTeamLink> };
export type CoreDriverRow = { id: number; firstName: string; lastName: string; year: number };
export type CoreTeamRow = { id: number; teamKey: string; year: number };

export type ActiveDriverTotals = Omit<RecordEntry, 'value'> & { totals: Record<DriverRecordStat, number> };

export type LineageRow = {
  parentF1dbId: string; position: number; constructorF1dbId: string; yearFrom: number; yearTo: number | null;
  name: string | null; raceWins: number | null; championships: number | null;
};

// 2024 is a leap year, so 02-29 maps to a real day and the year wraps at 366.
const DAYS_IN_YEAR = 366;

function dayOfYear(monthDay: string): number {
  const [month, day] = monthDay.split('-').map(Number);
  return (Date.UTC(2024, month - 1, day) - Date.UTC(2024, 0, 1)) / 86_400_000;
}

// Nearest by calendar distance, wrapping round New Year; ties go to the later date.
export function nearestMonthDay(requested: string, available: string[]): string | null {
  const target = dayOfYear(requested);
  let best: { monthDay: string; distance: number; forward: boolean } | null = null;
  for (const monthDay of available) {
    const delta = (dayOfYear(monthDay) - target + DAYS_IN_YEAR) % DAYS_IN_YEAR;
    const distance = Math.min(delta, DAYS_IN_YEAR - delta);
    const forward = delta <= DAYS_IN_YEAR - delta;
    if (!best || distance < best.distance || (distance === best.distance && forward && !best.forward)) {
      best = { monthDay, distance, forward };
    }
  }
  return best?.monthDay ?? null;
}

// Rows are season-scoped, so each person links to their latest season. A constructor can sit under
// several core keys (red_bull, red_bull_racing): the current one wins, else the longest-running.
export function buildCoreLinks(driverRows: CoreDriverRow[], teamRows: CoreTeamRow[]): CoreLinks {
  const activeYear = Math.max(...driverRows.map((r) => r.year));
  const byYear = <T extends { year: number }>(rows: T[]) => [...rows].sort((a, b) => a.year - b.year);

  const drivers = new Map<string, CoreLink>();
  for (const r of byYear(driverRows)) {
    drivers.set(normalizePersonName(`${r.firstName} ${r.lastName}`), { id: r.id, active: r.year === activeYear });
  }

  const keysByConstructor = new Map<string, Map<string, { latest: CoreTeamRow; seasons: number }>>();
  for (const r of byYear(teamRows)) {
    const keys = keysByConstructor.get(f1dbConstructorId(r.teamKey)) ?? new Map();
    keys.set(r.teamKey, { latest: r, seasons: (keys.get(r.teamKey)?.seasons ?? 0) + 1 });
    keysByConstructor.set(f1dbConstructorId(r.teamKey), keys);
  }

  const teams = new Map<string, CoreTeamLink>();
  for (const [f1dbId, keys] of keysByConstructor) {
    const [best] = [...keys.values()].sort((a, b) =>
      Number(b.latest.year === activeYear) - Number(a.latest.year === activeYear)
      || b.seasons - a.seasons
      || b.latest.year - a.latest.year);
    teams.set(f1dbId, { id: best.latest.id, teamKey: best.latest.teamKey, active: best.latest.year === activeYear });
  }
  return { drivers, teams };
}

export function buildChases(
  leaders: Record<DriverRecordStat, RecordEntry[]>,
  active: ActiveDriverTotals[],
): RecordChase[] {
  return (Object.keys(leaders) as DriverRecordStat[]).flatMap((stat) => {
    const record = leaders[stat][0];
    if (!record) return [];
    const best = active
      .filter((d) => d.f1dbId !== record.f1dbId && d.totals[stat] > 0)
      .sort((a, b) => b.totals[stat] - a.totals[stat])[0];
    const chaser = best
      ? { f1dbId: best.f1dbId, name: best.name, nationality: best.nationality, coreId: best.coreId, active: best.active, value: best.totals[stat] }
      : null;
    return [{ stat, record, chaser }];
  });
}

// F1DB repeats a family's chronology under each member, so families are keyed by their most
// recent member and the fullest copy wins.
export function groupLineages(rows: LineageRow[], coreTeams: Map<string, CoreTeamLink>): ConstructorLineage[] {
  const byParent = new Map<string, LineageRow[]>();
  for (const row of rows) byParent.set(row.parentF1dbId, [...(byParent.get(row.parentF1dbId) ?? []), row]);

  const byLatest = new Map<string, LineageMember[]>();
  for (const familyRows of byParent.values()) {
    const members: LineageMember[] = [...familyRows]
      .sort((a, b) => a.position - b.position)
      .map((r) => ({
        f1dbId: r.constructorF1dbId, name: r.name ?? r.constructorF1dbId, yearFrom: r.yearFrom, yearTo: r.yearTo,
        raceWins: r.raceWins ?? 0, championships: r.championships ?? 0, coreId: coreTeams.get(r.constructorF1dbId)?.id ?? null,
      }));
    if (members.length < 2) continue;
    const latest = latestMember(members);
    const existing = byLatest.get(latest.f1dbId);
    if (!existing || members.length > existing.length) byLatest.set(latest.f1dbId, members);
  }

  return [...byLatest.entries()]
    .map(([f1dbId, members]): ConstructorLineage => {
      const link = coreTeams.get(f1dbId);
      return {
        f1dbId,
        name: latestMember(members).name,
        coreTeam: link ? { id: link.id, teamKey: link.teamKey } : null,
        active: link?.active ?? false,
        members,
      };
    })
    .sort((a, b) =>
      Number(b.active) - Number(a.active)
      || latestMember(b.members).yearFrom - latestMember(a.members).yearFrom
      || a.name.localeCompare(b.name));
}

function latestMember(members: LineageMember[]): LineageMember {
  return members.reduce((latest, m) => (m.yearFrom >= latest.yearFrom ? m : latest));
}
