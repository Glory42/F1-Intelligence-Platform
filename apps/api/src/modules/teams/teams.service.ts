import { eq, and, inArray, desc, asc, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../config/database';
import { teams, seasons, drivers, teamSeasonStats, racePitStops, races } from '../../db/schema';
import type { Team, Driver, TeamDetailResponse, TeamStanding, TeamYearStats, PitCrewRanking, TeamPitStop } from '../../common/types';
import { toTeam, toDriver } from '../../common/mappers';
import { resolveSeason, buildStandings, buildCareerStats, type StatsAdapter } from '../../common/standings';

function toTeamStats(s: typeof teamSeasonStats.$inferSelect) {
  return {
    racesCompleted: s.racesCompleted, wins: s.wins, podiums: s.podiums,
    totalPoints: s.totalPoints, championshipPosition: s.championshipPosition,
    avgFinishPosition: s.avgFinishPosition, carPerformanceScore: s.carPerformanceScore,
    dnfCount: s.dnfCount, reliabilityScore: s.reliabilityScore ?? null,
    sprintTotalPoints: s.sprintTotalPoints,
  };
}

const emptyTeamStats = {
  racesCompleted: 0, wins: 0, podiums: 0, totalPoints: '0',
  championshipPosition: null, avgFinishPosition: null, carPerformanceScore: null,
  dnfCount: 0, reliabilityScore: null, sprintTotalPoints: '0',
};

// Standings pass raw `teams` rows; career passes `{ teams, seasons }` entries — so the
// two share the stats half and differ only in how they reach the team id.
const teamStatsPart = {
  statsEntityId: (s: typeof teamSeasonStats.$inferSelect) => s.teamId,
  toStats: toTeamStats,
  emptyStats: emptyTeamStats,
};

const teamStandingsAdapter: StatsAdapter<
  typeof teams.$inferSelect,
  typeof teamSeasonStats.$inferSelect,
  ReturnType<typeof toTeamStats>
> = { ...teamStatsPart, entityId: (t) => t.id };

const teamCareerAdapter: StatsAdapter<
  { teams: { id: number } },
  typeof teamSeasonStats.$inferSelect,
  ReturnType<typeof toTeamStats>
> = { ...teamStatsPart, entityId: (e) => e.teams.id };

export class TeamsService {
  async findAll(db: Db, year: number): Promise<Team[]> {
    const season = await resolveSeason(db, year);
    if (!season) return [];
    const rows = await db.select().from(teams).where(eq(teams.seasonId, season.id));
    return rows.map(toTeam);
  }

  async findStandings(db: Db, year: number): Promise<TeamStanding[]> {
    const season = await resolveSeason(db, year);
    if (!season) return [];

    const teamRows = await db.select().from(teams).where(eq(teams.seasonId, season.id));
    if (!teamRows.length) return [];

    const teamIds = teamRows.map((t) => t.id);
    const statsRows = await db
      .select()
      .from(teamSeasonStats)
      .where(and(
        eq(teamSeasonStats.seasonId, season.id),
        inArray(teamSeasonStats.teamId, teamIds),
      ));

    return buildStandings(
      teamRows,
      statsRows,
      teamStandingsAdapter,
      (t, stats): TeamStanding => ({ team: toTeam(t), stats })
    );
  }

  async findCareerStats(db: Db, teamId: number): Promise<TeamYearStats[]> {
    const teamRow = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!teamRow[0]) return [];

    const key = teamRow[0].teamKey;

    const allEntries = await db
      .select()
      .from(teams)
      .innerJoin(seasons, eq(teams.seasonId, seasons.id))
      .where(eq(teams.teamKey, key))
      .orderBy(desc(seasons.year));

    if (!allEntries.length) return [];

    const allIds = allEntries.map((e) => e.teams.id);
    const statsRows = await db
      .select()
      .from(teamSeasonStats)
      .where(inArray(teamSeasonStats.teamId, allIds));

    return buildCareerStats(
      allEntries,
      statsRows,
      teamCareerAdapter,
      (e, stats): TeamYearStats => ({
        year: e.seasons.year,
        teamId: e.teams.id,
        stats,
      })
    );
  }

  // `teams` rows are season-scoped, so teamId alone already pins the season — no `year` param needed.
  async findById(db: Db, teamId: number): Promise<TeamDetailResponse | null> {
    const teamRows = await db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);

    if (!teamRows[0]) return null;
    const team = toTeam(teamRows[0]);

    const [statsRows, driverRows] = await Promise.all([
      db
        .select()
        .from(teamSeasonStats)
        .where(and(eq(teamSeasonStats.teamId, teamId), eq(teamSeasonStats.seasonId, teamRows[0].seasonId)))
        .limit(1),

      db
        .select()
        .from(drivers)
        .where(and(eq(drivers.teamId, teamId), eq(drivers.seasonId, teamRows[0].seasonId))),
    ]);

    const stats = statsRows[0];
    const teamDrivers: Driver[] = driverRows.map((d) => toDriver(d, teamRows[0]));

    return {
      team,
      seasonStats: stats ? toTeamStats(stats) : emptyTeamStats,
      drivers: teamDrivers,
    };
  }

  // Median, not mean: one botched 10 s stop would otherwise drown a crew's whole season.
  async findPitCrewRankings(db: Db, year: number): Promise<PitCrewRanking[]> {
    const median = sql<number>`percentile_cont(0.5) within group (order by ${racePitStops.stationaryMs})`;
    const rows = await db
      .select({
        team: teams,
        stops: sql<number>`count(*)`,
        medianStationaryMs: median,
        fastestStationaryMs: sql<number>`min(${racePitStops.stationaryMs})`,
      })
      .from(racePitStops)
      .innerJoin(drivers, eq(racePitStops.driverId, drivers.id))
      .innerJoin(teams, eq(drivers.teamId, teams.id))
      .innerJoin(seasons, eq(teams.seasonId, seasons.id))
      .where(and(eq(seasons.year, year), isNotNull(racePitStops.stationaryMs)))
      .groupBy(teams.id)
      .orderBy(median);

    return rows.map((r) => ({
      team: toTeam(r.team),
      stops: Number(r.stops),
      medianStationaryMs: Math.round(Number(r.medianStationaryMs)),
      fastestStationaryMs: Number(r.fastestStationaryMs),
    }));
  }

  // Grand prix stops only, and only timed ones (OpenF1 has stationary time from the 2024 US GP).
  async findTeamPitStops(db: Db, teamId: number): Promise<TeamPitStop[]> {
    const rows = await db
      .select({ stop: racePitStops, race: races, driver: drivers, team: teams })
      .from(racePitStops)
      .innerJoin(drivers, eq(racePitStops.driverId, drivers.id))
      .innerJoin(teams, eq(drivers.teamId, teams.id))
      .innerJoin(races, eq(racePitStops.raceId, races.id))
      .where(and(eq(teams.id, teamId), eq(racePitStops.sessionType, 'race'), isNotNull(racePitStops.stationaryMs)))
      .orderBy(asc(races.roundNumber), asc(racePitStops.lapNumber));

    return rows.map((r) => ({
      raceId: r.race.id,
      roundNumber: r.race.roundNumber,
      raceName: r.race.name,
      driver: toDriver(r.driver, r.team),
      lapNumber: r.stop.lapNumber,
      stationaryMs: r.stop.stationaryMs!,
    }));
  }
}
