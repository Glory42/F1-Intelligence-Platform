import { eq, and, desc, inArray, or, sql } from 'drizzle-orm';
import type { Db } from '../../config/database';
import { drivers, teams, seasons, driverSeasonStats, raceResults, races } from '../../db/schema';
import type { Driver, DriverDetailResponse, DriverStanding, DriverYearStats } from '../../common/types';
import { toDriver } from '../../common/mappers';
import { resolveSeason, buildStandings, buildCareerStats, type StatsAdapter } from '../../common/standings';
import { isSamePerson } from '../../common/driverIdentity';

function toDriverStats(s: typeof driverSeasonStats.$inferSelect) {
  return {
    racesEntered: s.racesEntered, racesFinished: s.racesFinished,
    wins: s.wins, podiums: s.podiums, poles: s.poles,
    totalPoints: s.totalPoints, championshipPosition: s.championshipPosition,
    avgFinishPosition: s.avgFinishPosition, winRate: s.winRate, avgPositionGain: s.avgPositionGain,
    dnfCount: s.dnfCount, dnfRate: s.dnfRate ?? null,
    avgSector1Ms: s.avgSector1Ms ?? null, avgSector2Ms: s.avgSector2Ms ?? null,
    avgSector3Ms: s.avgSector3Ms ?? null, topSpeedAvg: s.topSpeedAvg ?? null,
    teammateQualiDelta: s.teammateQualiDelta ?? null,
    sprintTotalPoints: s.sprintTotalPoints,
  };
}

const emptyDriverStats = {
  racesEntered: 0, racesFinished: 0, wins: 0, podiums: 0, poles: 0,
  totalPoints: '0', championshipPosition: null, avgFinishPosition: null,
  winRate: null, avgPositionGain: null, dnfCount: 0, dnfRate: null,
  avgSector1Ms: null, avgSector2Ms: null, avgSector3Ms: null,
  topSpeedAvg: null, teammateQualiDelta: null, sprintTotalPoints: '0',
};

const driverStatsAdapter: StatsAdapter<
  { drivers: { id: number } },
  typeof driverSeasonStats.$inferSelect,
  ReturnType<typeof toDriverStats>
> = {
  entityId: (r) => r.drivers.id,
  statsEntityId: (s) => s.driverId,
  toStats: toDriverStats,
  emptyStats: emptyDriverStats,
};

export class DriversService {
  async findAll(db: Db, year: number, teamId?: number): Promise<Driver[]> {
    const season = await resolveSeason(db, year);
    if (!season) return [];

    const rows = await db
      .select()
      .from(drivers)
      .innerJoin(teams, eq(drivers.teamId, teams.id))
      .where(
        teamId
          ? and(eq(drivers.seasonId, season.id), eq(drivers.teamId, teamId))
          : eq(drivers.seasonId, season.id)
      );

    return rows.map((r) => toDriver(r.drivers, r.teams));
  }

  async findStandings(db: Db, year: number): Promise<DriverStanding[]> {
    const season = await resolveSeason(db, year);
    if (!season) return [];

    const rows = await db
      .select()
      .from(drivers)
      .innerJoin(teams, eq(drivers.teamId, teams.id))
      .where(eq(drivers.seasonId, season.id));

    if (!rows.length) return [];
    const driverIds = rows.map((r) => r.drivers.id);

    const statsRows = await db
      .select()
      .from(driverSeasonStats)
      .where(and(
        eq(driverSeasonStats.seasonId, season.id),
        inArray(driverSeasonStats.driverId, driverIds),
      ));

    return buildStandings(
      rows,
      statsRows,
      driverStatsAdapter,
      (r, stats): DriverStanding => ({ driver: toDriver(r.drivers, r.teams), stats })
    );
  }

  async findCareerStats(db: Db, driverId: number): Promise<DriverYearStats[]> {
    const driverRow = await db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1);
    if (!driverRow[0]) return [];

    const self = driverRow[0];

    // Candidates share the code or surname; isSamePerson then decides, since FastF1's names vary by season.
    const candidates = await db
      .select()
      .from(drivers)
      .innerJoin(seasons, eq(drivers.seasonId, seasons.id))
      .innerJoin(teams, eq(drivers.teamId, teams.id))
      .where(or(eq(drivers.code, self.code), sql`lower(${drivers.lastName}) = lower(${self.lastName})`))
      .orderBy(desc(seasons.year));
    const allEntries = candidates.filter((e) => isSamePerson(self, e.drivers));

    if (!allEntries.length) return [];

    const allIds = allEntries.map((e) => e.drivers.id);
    const statsRows = await db
      .select()
      .from(driverSeasonStats)
      .where(inArray(driverSeasonStats.driverId, allIds));

    return buildCareerStats(
      allEntries,
      statsRows,
      driverStatsAdapter,
      (e, stats): DriverYearStats => ({
        year: e.seasons.year,
        driverId: e.drivers.id,
        driverNumberThatYear: e.drivers.driverNumber,
        teamName: e.teams.name,
        headshotUrl: e.drivers.headshotUrl ?? null,
        stats,
      })
    );
  }

  // `drivers` rows are season-scoped, so driverId alone already pins the season — no `year` param needed.
  async findById(db: Db, driverId: number): Promise<DriverDetailResponse | null> {
    const driverRows = await db
      .select()
      .from(drivers)
      .innerJoin(teams, eq(drivers.teamId, teams.id))
      .where(eq(drivers.id, driverId))
      .limit(1);

    if (!driverRows[0]) return null;
    const driver = toDriver(driverRows[0].drivers, driverRows[0].teams);

    const [statsRows, recentRows] = await Promise.all([
      db
        .select()
        .from(driverSeasonStats)
        .where(and(eq(driverSeasonStats.driverId, driverId), eq(driverSeasonStats.seasonId, driverRows[0].drivers.seasonId)))
        .limit(1),

      db
        .select({ result: raceResults, race: { name: races.name, raceDate: races.raceDate } })
        .from(raceResults)
        .innerJoin(races, eq(raceResults.raceId, races.id))
        .where(eq(raceResults.driverId, driverId))
        .orderBy(desc(races.raceDate))
        .limit(5),
    ]);

    const stats = statsRows[0];

    return {
      driver,
      seasonStats: stats ? toDriverStats(stats) : emptyDriverStats,
      recentResults: recentRows.map((r) => ({
        id: r.result.id, raceId: r.result.raceId, driverId: r.result.driverId,
        finishPosition: r.result.finishPosition, gridPosition: r.result.gridPosition,
        points: r.result.points, status: r.result.status, fastestLap: r.result.fastestLap,
        driver, race: { name: r.race.name, raceDate: r.race.raceDate },
      })),
    };
  }
}
