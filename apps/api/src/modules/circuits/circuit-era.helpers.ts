import type { drivers, teams, races } from '../../db/schema';
import type { CircuitDetailResponse } from '../../common/types';
import { toDriver, toTeam } from '../../common/mappers';
import type { WinnerRow } from './circuit-stats.helpers';

type RaceRow = typeof races.$inferSelect;
type TeamRow = typeof teams.$inferSelect;
type DriverRow = typeof drivers.$inferSelect;

export type Era = 'all' | 'modern' | 'legacy' | 'nineties';
export type EraMap<T> = Record<Era, T>;

export const ERAS: Era[] = ['all', 'modern', 'legacy', 'nineties'];

interface TeamWinEntry {
  team: TeamRow;
  wins: number;
  bestIdx: number;
}

export interface DriverWinEntry {
  driver: DriverRow;
  team: TeamRow;
  wins: number;
  bestIdx: number;
}

export interface EraWinAggregates {
  teamWinsByEra: EraMap<Map<string, TeamWinEntry>>;
  driverWinsByEra: EraMap<Map<string, DriverWinEntry>>;
}

// Team identities rebrand across seasons (Alpha Tauri -> RB -> Racing Bulls, etc.) —
// without this, one constructor's wins would split across team_key variants.
const TEAM_KEY_ALIASES: Record<string, string> = {
  red_bull: 'red_bull_racing',
  rb: 'racing_bulls',
  alphatauri: 'alpha_tauri',
  alfa_romeo: 'alfa_romeo_racing',
  lotus_f1: 'lotus',
};

export function normalizeTeamKey(rawKey: string): string {
  return TEAM_KEY_ALIASES[rawKey] ?? rawKey;
}

function erasForYear(year: number): Era[] {
  const applicableEras: Era[] = ['all'];
  if (year >= 2018) applicableEras.push('modern');
  else if (year >= 2000) applicableEras.push('legacy');
  else if (year >= 1990) applicableEras.push('nineties');
  return applicableEras;
}

export function driverKeyFor(driver: DriverRow): string {
  return `${driver.firstName} ${driver.lastName}`;
}

function emptyEraMap<T>(factory: () => T): EraMap<T> {
  return { all: factory(), modern: factory(), legacy: factory(), nineties: factory() };
}

export function aggregateEraWins(
  winnerRows: WinnerRow[],
  raceMap: Map<number, RaceRow>,
  raceOrder: Map<number, number>
): EraWinAggregates {
  const teamWinsByEra = emptyEraMap<Map<string, TeamWinEntry>>(() => new Map());
  const driverWinsByEra = emptyEraMap<Map<string, DriverWinEntry>>(() => new Map());

  for (const winner of winnerRows) {
    const currentIdx = raceOrder.get(winner.race_results.raceId) ?? 999;
    const race = raceMap.get(winner.race_results.raceId);
    const year = race ? new Date(race.raceDate).getFullYear() : 2000;
    const teamKey = normalizeTeamKey(winner.teams.teamKey);
    const driverKey = driverKeyFor(winner.drivers);

    for (const era of erasForYear(year)) {
      const teamWins = teamWinsByEra[era];
      const existingTeam = teamWins.get(teamKey);
      if (!existingTeam) {
        teamWins.set(teamKey, { team: winner.teams, wins: 1, bestIdx: currentIdx });
      } else {
        if (currentIdx < existingTeam.bestIdx) {
          existingTeam.bestIdx = currentIdx;
          existingTeam.team = winner.teams;
        }
        existingTeam.wins += 1;
      }

      const driverWins = driverWinsByEra[era];
      const existingDriver = driverWins.get(driverKey);
      if (!existingDriver) {
        driverWins.set(driverKey, { driver: winner.drivers, team: winner.teams, wins: 1, bestIdx: currentIdx });
      } else {
        if (currentIdx < existingDriver.bestIdx) {
          existingDriver.bestIdx = currentIdx;
          existingDriver.driver = winner.drivers;
          existingDriver.team = winner.teams;
        }
        existingDriver.wins += 1;
      }
    }
  }

  return { teamWinsByEra, driverWinsByEra };
}

export function buildDominanceByEra(
  teamWinsByEra: EraMap<Map<string, TeamWinEntry>>,
  driverWinsByEra: EraMap<Map<string, DriverWinEntry>>
): CircuitDetailResponse['dominance'] {
  const dominanceByEra = {} as CircuitDetailResponse['dominance'];

  for (const era of ERAS) {
    dominanceByEra[era] = {
      constructors: Array.from(teamWinsByEra[era].values())
        .sort((a, b) => b.wins - a.wins)
        .map((entry) => ({ team: toTeam(entry.team), wins: entry.wins })),
      drivers: Array.from(driverWinsByEra[era].values())
        .sort((a, b) => b.wins - a.wins)
        .map((entry) => ({ driver: toDriver(entry.driver, entry.team), wins: entry.wins })),
    };
  }

  return dominanceByEra;
}
