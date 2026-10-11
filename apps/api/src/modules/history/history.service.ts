import { and, asc, desc, eq, gte, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Db } from '../../config/database';
import {
  drivers, historyConstructorLineage, historyConstructorSeasons, historyConstructors, historyDrivers, raceResults,
  races, seasons, teams,
} from '../../db/schema';
import type {
  ConstructorLineage, DriverHistory, HistoryMilestones, HistoryRecords, MilestoneEntry, OnThisDay, RecordEntry,
  TeamHistory,
} from '../../common/types';
import { f1dbConstructorId, normalizePersonName } from '../../common/f1dbMatch';
import { toDriver } from '../../common/mappers';
import { buildChases, buildCoreLinks, groupLineages, nearestMonthDay, type CoreLink, type CoreLinks } from './history.helpers';

const LEADERS = 10;
const MILESTONE_ROWS = 5;
const ON_THIS_DAY = 10;
// Below ~50 starts a handful of 1950s cameos (and Indy 500 one-offs) top every rate table.
const RATE_MIN_STARTS = 50;

export class HistoryService {
  private async coreLinks(db: Db): Promise<CoreLinks> {
    const [driverRows, teamRows] = await Promise.all([
      db.select({ id: drivers.id, firstName: drivers.firstName, lastName: drivers.lastName, year: seasons.year })
        .from(drivers).innerJoin(seasons, eq(drivers.seasonId, seasons.id)),
      db.select({ id: teams.id, teamKey: teams.teamKey, year: seasons.year })
        .from(teams).innerJoin(seasons, eq(teams.seasonId, seasons.id)),
    ]);
    return buildCoreLinks(driverRows, teamRows);
  }

  async findRecords(db: Db): Promise<HistoryRecords> {
    const links = await this.coreLinks(db);
    const driverEntry = (r: { f1dbId: string; name: string; nationality: string | null; matchKey: string; value: unknown }): RecordEntry => ({
      f1dbId: r.f1dbId, name: r.name, value: Number(r.value), nationality: r.nationality, ...linkFields(links.drivers.get(r.matchKey)),
    });
    const driverLeaders = async (value: SQL<number> | PgColumn, where?: SQL) => (
      await db.select({
        f1dbId: historyDrivers.f1dbId, name: historyDrivers.name, nationality: historyDrivers.nationality,
        matchKey: historyDrivers.matchKey, value,
      })
        .from(historyDrivers).where(where)
        // Ties (seven titles each) fall back to wins, then name, so the order is stable.
        .orderBy(desc(value), desc(historyDrivers.raceWins), asc(historyDrivers.name)).limit(LEADERS)
    ).map(driverEntry);
    const constructorLeaders = async (column: PgColumn) => (
      await db.select({
        f1dbId: historyConstructors.f1dbId, name: historyConstructors.name, nationality: historyConstructors.country, value: column,
      })
        .from(historyConstructors).orderBy(desc(column), desc(historyConstructors.raceWins), asc(historyConstructors.name)).limit(LEADERS)
    ).map((r): RecordEntry => ({
      f1dbId: r.f1dbId, name: r.name, value: Number(r.value), nationality: r.nationality, ...linkFields(links.teams.get(r.f1dbId)),
    }));
    const rate = (column: PgColumn) => sql<number>`(${column}::float / ${historyDrivers.raceStarts})`;
    const rateFloor = gte(historyDrivers.raceStarts, RATE_MIN_STARTS);
    const activeKeys = [...links.drivers].filter(([, link]) => link.active).map(([key]) => key);

    const [wins, championships, poles, podiums, starts, cWins, cChampionships, cPoles, winRate, poleRate, podiumRate, active] = await Promise.all([
      driverLeaders(historyDrivers.raceWins),
      driverLeaders(historyDrivers.championships),
      driverLeaders(historyDrivers.polePositions),
      driverLeaders(historyDrivers.podiums),
      driverLeaders(historyDrivers.raceStarts),
      constructorLeaders(historyConstructors.raceWins),
      constructorLeaders(historyConstructors.championships),
      constructorLeaders(historyConstructors.polePositions),
      driverLeaders(rate(historyDrivers.raceWins), rateFloor),
      driverLeaders(rate(historyDrivers.polePositions), rateFloor),
      driverLeaders(rate(historyDrivers.podiums), rateFloor),
      activeKeys.length === 0 ? [] : db.select().from(historyDrivers).where(inArray(historyDrivers.matchKey, activeKeys)),
    ]);

    const drivers = { wins, championships, poles, podiums, starts };
    return {
      drivers,
      constructors: { wins: cWins, championships: cChampionships, poles: cPoles },
      rates: { winRate, poleRate, podiumRate },
      rateMinStarts: RATE_MIN_STARTS,
      chases: buildChases(drivers, active.map((d) => ({
        f1dbId: d.f1dbId, name: d.name, nationality: d.nationality, ...linkFields(links.drivers.get(d.matchKey)),
        totals: { wins: d.raceWins, championships: d.championships, poles: d.polePositions, podiums: d.podiums, starts: d.raceStarts },
      }))),
    };
  }

  async findMilestones(db: Db): Promise<HistoryMilestones> {
    const links = await this.coreLinks(db);
    const d = historyDrivers;
    const milestone = async (from: PgColumn, to: PgColumn, raceName: PgColumn, order: 'asc' | 'desc'): Promise<MilestoneEntry[]> => {
      const days = sql<number>`(${to} - ${from})`;
      const rows = await db
        .select({ f1dbId: d.f1dbId, name: d.name, nationality: d.nationality, matchKey: d.matchKey, days, raceName })
        .from(d)
        .where(and(isNotNull(from), isNotNull(to)))
        .orderBy(order === 'asc' ? asc(days) : desc(days), asc(d.name))
        .limit(MILESTONE_ROWS);
      return rows.map((r) => ({
        f1dbId: r.f1dbId, name: r.name, nationality: r.nationality, ...linkFields(links.drivers.get(r.matchKey)),
        days: Number(r.days), raceName: String(r.raceName ?? ''),
      }));
    };

    const [youngestWinner, youngestPole, youngestPodium, youngestStarter, oldestFirstWin, longestWaitForWin] = await Promise.all([
      milestone(d.dateOfBirth, d.firstWinDate, d.firstWinName, 'asc'),
      milestone(d.dateOfBirth, d.firstPoleDate, d.firstPoleName, 'asc'),
      milestone(d.dateOfBirth, d.firstPodiumDate, d.firstPodiumName, 'asc'),
      milestone(d.dateOfBirth, d.firstRaceDate, d.firstRaceName, 'asc'),
      milestone(d.dateOfBirth, d.firstWinDate, d.firstWinName, 'desc'),
      milestone(d.firstRaceDate, d.firstWinDate, d.firstWinName, 'desc'),
    ]);
    return { youngestWinner, youngestPole, youngestPodium, youngestStarter, oldestFirstWin, longestWaitForWin };
  }

  async findLineages(db: Db): Promise<ConstructorLineage[]> {
    const [links, rows] = await Promise.all([
      this.coreLinks(db),
      db
        .select({
          parentF1dbId: historyConstructorLineage.parentF1dbId,
          position: historyConstructorLineage.position,
          constructorF1dbId: historyConstructorLineage.constructorF1dbId,
          yearFrom: historyConstructorLineage.yearFrom,
          yearTo: historyConstructorLineage.yearTo,
          name: historyConstructors.name,
          raceWins: historyConstructors.raceWins,
          championships: historyConstructors.championships,
        })
        .from(historyConstructorLineage)
        .leftJoin(historyConstructors, eq(historyConstructors.f1dbId, historyConstructorLineage.constructorF1dbId)),
    ]);
    return groupLineages(rows, links.teams);
  }

  async findDriverHistory(db: Db, coreDriverId: number): Promise<DriverHistory | null> {
    const [core] = await db.select({ firstName: drivers.firstName, lastName: drivers.lastName })
      .from(drivers).where(eq(drivers.id, coreDriverId)).limit(1);
    if (!core) return null;
    const [row] = await db.select().from(historyDrivers)
      .where(eq(historyDrivers.matchKey, normalizePersonName(`${core.firstName} ${core.lastName}`))).limit(1);
    if (!row) return null;
    return {
      f1dbId: row.f1dbId, name: row.name, dateOfBirth: row.dateOfBirth, nationality: row.nationality,
      championships: row.championships, raceStarts: row.raceStarts, raceWins: row.raceWins, podiums: row.podiums,
      polePositions: row.polePositions, fastestLaps: row.fastestLaps, careerPoints: Number(row.careerPoints),
      sprintWins: row.sprintWins, grandSlams: row.grandSlams,
      firstRaceDate: row.firstRaceDate, firstRaceName: row.firstRaceName, firstWinDate: row.firstWinDate,
      firstWinName: row.firstWinName, firstPodiumDate: row.firstPodiumDate, firstPodiumName: row.firstPodiumName,
      firstPoleDate: row.firstPoleDate, firstPoleName: row.firstPoleName,
    };
  }

  async findTeamHistory(db: Db, coreTeamId: number): Promise<TeamHistory | null> {
    const [team] = await db.select({ teamKey: teams.teamKey }).from(teams).where(eq(teams.id, coreTeamId)).limit(1);
    if (!team) return null;
    const f1dbId = f1dbConstructorId(team.teamKey);
    const [[constructor], seasons] = await Promise.all([
      db.select().from(historyConstructors).where(eq(historyConstructors.f1dbId, f1dbId)).limit(1),
      db.select({ year: historyConstructorSeasons.year, chassis: historyConstructorSeasons.chassis, engine: historyConstructorSeasons.engine })
        .from(historyConstructorSeasons).where(eq(historyConstructorSeasons.constructorF1dbId, f1dbId))
        .orderBy(desc(historyConstructorSeasons.year)),
    ]);
    if (!constructor) return null;
    return {
      constructor: {
        f1dbId: constructor.f1dbId, name: constructor.name, championships: constructor.championships,
        raceStarts: constructor.raceStarts, raceWins: constructor.raceWins, podiums: constructor.podiums,
        polePositions: constructor.polePositions,
      },
      seasons,
    };
  }

  // Uses the core races table (1980+ in this DB): completed races on the same month-day, or on the
  // nearest month-day that has any when the requested one has none.
  async findOnThisDay(db: Db, requested: string): Promise<OnThisDay> {
    const monthDay = sql<string>`to_char(${races.raceDate}, 'MM-DD')`;
    const completed = eq(races.status, 'completed');
    let date = requested;
    let rows = await this.racesOn(db, and(completed, eq(monthDay, requested)));
    if (rows.length === 0) {
      const available = await db.selectDistinct({ monthDay }).from(races).where(completed);
      const nearest = nearestMonthDay(requested, available.map((r) => r.monthDay));
      if (nearest) {
        date = nearest;
        rows = await this.racesOn(db, and(completed, eq(monthDay, nearest)));
      }
    }
    return {
      requested,
      date,
      races: rows.map((r) => ({
        raceId: r.race.id,
        year: Number(r.race.raceDate.slice(0, 4)),
        name: r.race.name,
        winner: r.driver && r.team ? toDriver(r.driver, r.team) : null,
      })),
    };
  }

  private racesOn(db: Db, where: SQL | undefined) {
    return db
      .select({ race: races, driver: drivers, team: teams })
      .from(races)
      .leftJoin(raceResults, and(eq(raceResults.raceId, races.id), eq(raceResults.finishPosition, 1)))
      .leftJoin(drivers, eq(raceResults.driverId, drivers.id))
      .leftJoin(teams, eq(drivers.teamId, teams.id))
      .where(where)
      .orderBy(desc(races.raceDate))
      .limit(ON_THIS_DAY);
  }
}

function linkFields(link: CoreLink | undefined): { coreId: number | null; active: boolean } {
  return { coreId: link?.id ?? null, active: link?.active ?? false };
}
