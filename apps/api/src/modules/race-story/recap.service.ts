import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db } from '../../config/database';
import { drivers, raceBattles, racePitStops, racePredictions, raceResults, teams } from '../../db/schema';
import type { RaceRecap } from '../../common/types';
import { toDriver } from '../../common/mappers';

const leaderDrivers = alias(drivers, 'leader_drivers');
const leaderTeams = alias(teams, 'leader_teams');

// One cheap call for the home hub's "last race" card: no traces, no laps.
export class RecapService {
  async findRecap(db: Db, raceId: number): Promise<RaceRecap> {
    const [winnerRows, predictionRows, stopRows, battleRows] = await Promise.all([
      db.select({ driver: drivers, team: teams }).from(raceResults)
        .innerJoin(drivers, eq(raceResults.driverId, drivers.id)).innerJoin(teams, eq(drivers.teamId, teams.id))
        .where(and(eq(raceResults.raceId, raceId), eq(raceResults.finishPosition, 1))).limit(1),
      db.select({ driver: drivers, team: teams }).from(racePredictions)
        .innerJoin(drivers, eq(racePredictions.predictedWinnerId, drivers.id)).innerJoin(teams, eq(drivers.teamId, teams.id))
        .where(eq(racePredictions.raceId, raceId)).limit(1),
      db.select({ driver: drivers, team: teams, stationaryMs: racePitStops.stationaryMs }).from(racePitStops)
        .innerJoin(drivers, eq(racePitStops.driverId, drivers.id)).innerJoin(teams, eq(drivers.teamId, teams.id))
        .where(and(eq(racePitStops.raceId, raceId), eq(racePitStops.sessionType, 'race'), isNotNull(racePitStops.stationaryMs)))
        .orderBy(asc(racePitStops.stationaryMs)).limit(1),
      db.select({ battle: raceBattles, chaser: drivers, chaserTeam: teams, leader: leaderDrivers, leaderTeam: leaderTeams })
        .from(raceBattles)
        .innerJoin(drivers, eq(raceBattles.chaserDriverId, drivers.id)).innerJoin(teams, eq(drivers.teamId, teams.id))
        .innerJoin(leaderDrivers, eq(raceBattles.leaderDriverId, leaderDrivers.id))
        .innerJoin(leaderTeams, eq(leaderDrivers.teamId, leaderTeams.id))
        .where(and(eq(raceBattles.raceId, raceId), eq(raceBattles.sessionType, 'race')))
        .orderBy(desc(sql`${raceBattles.lapEnd} - ${raceBattles.lapStart}`), asc(raceBattles.minGapMs)).limit(1),
    ]);

    const winner = winnerRows[0] ? toDriver(winnerRows[0].driver, winnerRows[0].team) : null;
    const predictedWinner = predictionRows[0] ? toDriver(predictionRows[0].driver, predictionRows[0].team) : null;
    const battle = battleRows[0];
    return {
      winner,
      predictedWinner,
      predictionHit: winner && predictedWinner ? winner.id === predictedWinner.id : null,
      fastestStop: stopRows[0] ? { driver: toDriver(stopRows[0].driver, stopRows[0].team), stationaryMs: stopRows[0].stationaryMs! } : null,
      topBattle: battle
        ? {
          chaser: toDriver(battle.chaser, battle.chaserTeam), leader: toDriver(battle.leader, battle.leaderTeam),
          lapStart: battle.battle.lapStart, lapEnd: battle.battle.lapEnd, minGapMs: battle.battle.minGapMs,
        }
        : null,
    };
  }
}
