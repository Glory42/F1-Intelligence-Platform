import type { Context } from 'hono';
import type { Bindings, RaceSession } from '../../common/types';
import { INVALID_SESSION_ERROR, parseRaceSession } from '../../common/session';
import { createDb, type Db } from '../../config/database';
import { RaceEventsService } from './race-events.service';
import { CACHE_COMPLETED, cacheIfData } from '../../common/cache';

const service = new RaceEventsService();

function raceSubResource<T>(getter: (db: Db, raceId: number, session: RaceSession) => Promise<T[]>) {
  return async (c: Context<{ Bindings: Bindings }>) => {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ data: null, error: { code: 'INVALID_ID', message: 'id must be a number' } }, 400);
    }
    const session = parseRaceSession(c.req.query('session'));
    if (!session) return c.json({ data: null, error: INVALID_SESSION_ERROR }, 400);
    const db = createDb(c.env.DATABASE_URL);
    if (!(await service.raceExists(db, id))) {
      return c.json({ data: null, error: { code: 'NOT_FOUND', message: `Race ${id} not found` } }, 404);
    }
    // Every race-event sub-resource only exists once ingested post-race, and never changes
    // afterward, so they all share one Cache-Control rule.
    const data = await getter(db, id, session);
    c.header('Cache-Control', cacheIfData(CACHE_COMPLETED, data.length > 0));
    return c.json({ data, error: null });
  };
}

export const RaceEventsController = {
  getRaceControl: raceSubResource((db, id, session) => service.getRaceControlMessages(db, id, session)),
  getOvertakes: raceSubResource((db, id, session) => service.getOvertakes(db, id, session)),
  getTeamRadio: raceSubResource((db, id, session) => service.getTeamRadio(db, id, session)),
};
