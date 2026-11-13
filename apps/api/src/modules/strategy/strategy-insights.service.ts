import { eq } from 'drizzle-orm';
import type { Db } from '../../config/database';
import { drivers, lapTimes, raceResults, sprintLapTimes, sprintResults, teams } from '../../db/schema';
import type { RaceSession, StrategyInsightsResponse, Team } from '../../common/types';
import { teamDegradation } from './degradation.helpers';

// Computed at read time from ~1,000 laps: cheap, and a completed race's answer is cached immutable.
export class StrategyInsightsService {
  async findInsights(db: Db, raceId: number, session: RaceSession): Promise<StrategyInsightsResponse> {
    const laps = session === 'sprint' ? sprintLapTimes : lapTimes;
    const results = session === 'sprint' ? sprintResults : raceResults;
    const [lapRows, teamRows] = await Promise.all([
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
    ]);

    // Only the last lap's fuel load matters to the intercept, not the slope, so the last accurate lap is close enough.
    const totalLaps = Math.max(0, ...lapRows.map((l) => l.lapNumber));
    const byId = new Map<number, Team>(teamRows.map((r) => [r.team.id, r.team]));
    return {
      degradation: teamDegradation(lapRows, totalLaps).flatMap(({ teamId, ...row }) => {
        const team = byId.get(teamId);
        return team ? [{ team, ...row }] : [];
      }),
    };
  }
}
