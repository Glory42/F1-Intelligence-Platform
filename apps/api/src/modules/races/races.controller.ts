import { RacesService } from './races.service';
import { LongRunsService } from './long-runs.service';
import { raceRoute, seasonRoute } from '../../common/route';

const service = new RacesService();
const longRuns = new LongRunsService();

export const RacesController = {
  // Even a status=completed list grows during the season, so only a past season is final.
  getAll: seasonRoute({
    query: ['status'],
    load: ({ db, year, query }) => service.findAll(db, year, query('status')),
  }),

  getById: raceRoute({
    load: ({ db, race, circuit }) => service.findDetail(db, race, circuit),
  }),

  getLongRuns: raceRoute({
    load: ({ db, race }) => longRuns.findLongRuns(db, race.id),
  }),
};
