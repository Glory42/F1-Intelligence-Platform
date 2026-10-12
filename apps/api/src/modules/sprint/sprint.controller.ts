import type { Context } from 'hono';
import type { Bindings } from '../../common/types';
import { createDb } from '../../config/database';
import { SprintService } from './sprint.service';
import { cacheControlForStatus } from '../../common/cache';
import { raceRoute } from '../../common/route';
import { SPRINT } from '../../common/session-kind';
import { findPrediction, findUpcomingPrediction } from '../../common/session-reads';

const service = new SprintService();

export const SprintController = {
  getUpcoming: async (c: Context<{ Bindings: Bindings }>) => {
    const data = await findUpcomingPrediction(createDb(c.env.DATABASE_URL), SPRINT);
    if (!data) {
      return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'No upcoming sprint prediction available' } }, 404);
    }
    c.header('Cache-Control', cacheControlForStatus(data.race.status));
    return c.json({ data, error: null });
  },

  getByRaceId: raceRoute({
    param: 'raceId',
    load: ({ db, race, circuit }) => findPrediction(db, SPRINT, race, circuit),
    missing: (raceId) => `No sprint prediction for race ${raceId}`,
  }),

  getDetailByRaceId: raceRoute({
    param: 'raceId',
    load: ({ db, race, circuit }) => service.findDetail(db, race, circuit),
    missing: (raceId) => `No sprint data for race ${raceId}`,
  }),
};
