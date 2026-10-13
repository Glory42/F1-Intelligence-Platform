import { and, eq, asc } from 'drizzle-orm';
import type { Db } from '../../config/database';
import { raceControlMessages, raceOvertakes, teamRadioClips } from '../../db/schema';
import type { RaceControlMessage, RaceOvertake, TeamRadioClip, RaceSession } from '../../common/types';
import { toRaceControlMessage, toRaceOvertake, toTeamRadioClip } from './openf1.mappers';

export class RaceEventsService {
  async getRaceControlMessages(db: Db, raceId: number, session: RaceSession): Promise<RaceControlMessage[]> {
    const rows = await db
      .select()
      .from(raceControlMessages)
      .where(and(eq(raceControlMessages.raceId, raceId), eq(raceControlMessages.sessionType, session)))
      .orderBy(asc(raceControlMessages.date));

    return rows.map(toRaceControlMessage);
  }

  async getOvertakes(db: Db, raceId: number, session: RaceSession): Promise<RaceOvertake[]> {
    const rows = await db
      .select()
      .from(raceOvertakes)
      .where(and(eq(raceOvertakes.raceId, raceId), eq(raceOvertakes.sessionType, session)))
      .orderBy(asc(raceOvertakes.date));

    return rows.map(toRaceOvertake);
  }

  async getTeamRadio(db: Db, raceId: number, session: RaceSession): Promise<TeamRadioClip[]> {
    const rows = await db
      .select()
      .from(teamRadioClips)
      .where(and(eq(teamRadioClips.raceId, raceId), eq(teamRadioClips.sessionType, session)))
      .orderBy(asc(teamRadioClips.date));

    return rows.map(toTeamRadioClip);
  }
}
