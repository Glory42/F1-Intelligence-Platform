import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Db } from '../../config/database';
import {
  drivers, historyConstructorSeasons, historyConstructors, historyDrivers, raceResults, races, teams,
} from '../../db/schema';
import type { DriverHistory, HistoryRecords, OnThisDayRace, RecordEntry, TeamHistory } from '../../common/types';
import { f1dbConstructorId, normalizePersonName } from '../../common/f1dbMatch';
import { toDriver } from '../../common/mappers';

const LEADERS = 10;
const YOUNGEST = 5;
const ON_THIS_DAY = 10;

export class HistoryService {
  async findRecords(db: Db): Promise<HistoryRecords> {
    const toEntries = (rows: Array<{ f1dbId: string; name: string; value: unknown }>): RecordEntry[] =>
      rows.map((r) => ({ f1dbId: r.f1dbId, name: r.name, value: Number(r.value) }));
    const driverLeaders = async (column: PgColumn) => toEntries(
      await db.select({ f1dbId: historyDrivers.f1dbId, name: historyDrivers.name, value: column })
        .from(historyDrivers).orderBy(desc(column)).limit(LEADERS),
    );
    const constructorLeaders = async (column: PgColumn) => toEntries(
      await db.select({ f1dbId: historyConstructors.f1dbId, name: historyConstructors.name, value: column })
        .from(historyConstructors).orderBy(desc(column)).limit(LEADERS),
    );
    const ageDays = sql<number>`(${historyDrivers.firstWinDate} - ${historyDrivers.dateOfBirth})`;

    const [wins, championships, poles, podiums, starts, cWins, cChampionships, cPoles, youngest] = await Promise.all([
      driverLeaders(historyDrivers.raceWins),
      driverLeaders(historyDrivers.championships),
      driverLeaders(historyDrivers.polePositions),
      driverLeaders(historyDrivers.podiums),
      driverLeaders(historyDrivers.raceStarts),
      constructorLeaders(historyConstructors.raceWins),
      constructorLeaders(historyConstructors.championships),
      constructorLeaders(historyConstructors.polePositions),
      db.select({ f1dbId: historyDrivers.f1dbId, name: historyDrivers.name, ageDays, raceName: historyDrivers.firstWinName })
        .from(historyDrivers)
        .where(sql`${isNotNull(historyDrivers.firstWinDate)} and ${isNotNull(historyDrivers.dateOfBirth)}`)
        .orderBy(asc(ageDays))
        .limit(YOUNGEST),
    ]);

    return {
      drivers: { wins, championships, poles, podiums, starts },
      constructors: { wins: cWins, championships: cChampionships, poles: cPoles },
      youngestWinners: youngest.map((y) => ({ ...y, ageDays: Number(y.ageDays), raceName: y.raceName ?? '' })),
    };
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

  // Uses the core races table (1980+ in this DB): completed races on the same month-day.
  async findOnThisDay(db: Db, monthDay: string): Promise<OnThisDayRace[]> {
    const rows = await db
      .select({ race: races, driver: drivers, team: teams })
      .from(races)
      .leftJoin(raceResults, and(eq(raceResults.raceId, races.id), eq(raceResults.finishPosition, 1)))
      .leftJoin(drivers, eq(raceResults.driverId, drivers.id))
      .leftJoin(teams, eq(drivers.teamId, teams.id))
      .where(and(eq(races.status, 'completed'), sql`to_char(${races.raceDate}, 'MM-DD') = ${monthDay}`))
      .orderBy(desc(races.raceDate))
      .limit(ON_THIS_DAY);
    return rows.map((r) => ({
      raceId: r.race.id,
      year: Number(r.race.raceDate.slice(0, 4)),
      name: r.race.name,
      winner: r.driver && r.team ? toDriver(r.driver, r.team) : null,
    }));
  }
}
