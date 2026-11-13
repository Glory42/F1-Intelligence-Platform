import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../config/database';
import {
  drivers, lapTimes, raceControlMessages, raceLapTraces, racePitStops, raceResults, sprintLapTimes, sprintResults, teams,
} from '../../db/schema';
import type { RaceSession, StrategyInsightsResponse, Team } from '../../common/types';
import { teamDegradation } from './degradation.helpers';
import { findPitBattles, neutralisedLaps } from './pit-battles.helpers';

// Computed at read time from ~1,000 laps and ~20 lap traces: cheap, and a completed race's answer is cached immutable.
export class StrategyInsightsService {
  async findInsights(db: Db, raceId: number, session: RaceSession): Promise<StrategyInsightsResponse> {
    const laps = session === 'sprint' ? sprintLapTimes : lapTimes;
    const results = session === 'sprint' ? sprintResults : raceResults;
    const [lapRows, teamRows, traceRows, stopRows, messageRows] = await Promise.all([
      db
        .select({
          teamId: drivers.teamId, driverId: laps.driverId, lapNumber: laps.lapNumber,
          lapTimeMs: laps.lapTimeMs, compound: laps.compound, tyreLife: laps.tyreLife,
        })
        .from(laps)
        .innerJoin(drivers, eq(laps.driverId, drivers.id))
        .where(eq(laps.raceId, raceId)),
      db
        .selectDistinct({ team: teams })
        .from(results)
        .innerJoin(drivers, eq(results.driverId, drivers.id))
        .innerJoin(teams, eq(drivers.teamId, teams.id))
        .where(eq(results.raceId, raceId)),
      db
        .select({
          driverId: raceLapTraces.driverId, positions: raceLapTraces.positions,
          gapsMs: raceLapTraces.gapsMs, intervalsMs: raceLapTraces.intervalsMs,
        })
        .from(raceLapTraces)
        .where(and(eq(raceLapTraces.raceId, raceId), eq(raceLapTraces.sessionType, session))),
      db
        .select({ driverId: racePitStops.driverId, lapNumber: racePitStops.lapNumber })
        .from(racePitStops)
        .where(and(eq(racePitStops.raceId, raceId), eq(racePitStops.sessionType, session))),
      db
        .select({
          lapNumber: raceControlMessages.lapNumber, category: raceControlMessages.category,
          flag: raceControlMessages.flag, message: raceControlMessages.message,
        })
        .from(raceControlMessages)
        .where(and(eq(raceControlMessages.raceId, raceId), eq(raceControlMessages.sessionType, session)))
        .orderBy(asc(raceControlMessages.date)),
    ]);

    // Only the last lap's fuel load matters to the intercept, not the slope, so the last accurate lap is close enough.
    const totalLaps = Math.max(0, ...lapRows.map((l) => l.lapNumber));
    const raceLaps = Math.max(0, ...traceRows.map((t) => t.positions.length));
    const byId = new Map<number, Team>(teamRows.map((r) => [r.team.id, r.team]));
    return {
      degradation: teamDegradation(lapRows, totalLaps).flatMap(({ teamId, ...row }) => {
        const team = byId.get(teamId);
        return team ? [{ team, ...row }] : [];
      }),
      pitBattles: findPitBattles(traceRows, stopRows, neutralisedLaps(messageRows, raceLaps)),
    };
  }
}
