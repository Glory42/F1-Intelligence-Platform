import { eq, asc } from 'drizzle-orm';
import type { Db } from '../../config/database';
import { races, circuits, sprintResults, drivers, teams } from '../../db/schema';
import type { SprintDetailResponse, SprintResult } from '../../common/types';
import { SPRINT_FORMATS } from '../../common/constants';
import { toRace, toSprintResult } from '../../common/mappers';
import { SPRINT } from '../../common/session-kind';
import { findLapSummaries, findPrediction } from '../../common/session-reads';

export class SprintService {
  async findDetail(
    db: Db,
    race: typeof races.$inferSelect,
    circuit: typeof circuits.$inferSelect,
  ): Promise<SprintDetailResponse | null> {
    if (!(SPRINT_FORMATS as readonly string[]).includes(race.eventFormat)) return null;

    const [prediction, resultRows, laps] = await Promise.all([
      findPrediction(db, SPRINT, race, circuit),
      db
        .select()
        .from(sprintResults)
        .innerJoin(drivers, eq(sprintResults.driverId, drivers.id))
        .innerJoin(teams, eq(drivers.teamId, teams.id))
        .where(eq(sprintResults.raceId, race.id))
        .orderBy(asc(sprintResults.finishPosition)),
      findLapSummaries(db, SPRINT, race.id),
    ]);

    // Return all rows (including grid_set placeholder rows) so frontend can render qualifying times
    const results: SprintResult[] = resultRows.map(toSprintResult);

    return { race: toRace(race, circuit), prediction, results, laps };
  }
}
