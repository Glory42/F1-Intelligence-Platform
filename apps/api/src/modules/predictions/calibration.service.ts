import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../config/database';
import { races, seasons } from '../../db/schema';
import type { SeasonCalibration } from '../../common/types';
import { GP } from '../../common/session-kind';
import { calibrationBySeason } from './calibration.helpers';

export class CalibrationService {
  // Every driver's win probability in every decided GP, its winner and its pole-sitter: three
  // flat reads (a few thousand rows), scored in calibration.helpers.
  async findGpCalibration(db: Db): Promise<Map<number, SeasonCalibration>> {
    const decided = inArray(races.status, [...GP.done]);
    const [probabilities, winners, poles] = await Promise.all([
      db.select({
        raceId: GP.features.raceId,
        year: seasons.year,
        driverId: GP.features.driverId,
        winProbability: GP.features.winProbability,
      })
        .from(GP.features)
        .innerJoin(races, eq(GP.features.raceId, races.id))
        .innerJoin(seasons, eq(races.seasonId, seasons.id))
        .where(decided),
      db.select({ raceId: GP.results.raceId, driverId: GP.results.driverId })
        .from(GP.results)
        .innerJoin(races, eq(GP.results.raceId, races.id))
        .where(and(decided, eq(GP.results.finishPosition, 1))),
      db.select({ raceId: GP.grid.raceId, driverId: GP.grid.driverId })
        .from(GP.grid)
        .innerJoin(races, eq(GP.grid.raceId, races.id))
        .where(and(decided, eq(GP.grid.gridPosition, 1))),
    ]);
    return calibrationBySeason(
      probabilities.map((row) => ({ ...row, winProbability: Number(row.winProbability) })),
      winners,
      poles,
    );
  }
}
