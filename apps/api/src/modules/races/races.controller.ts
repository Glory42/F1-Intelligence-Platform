import { RacesService } from './races.service';
import { raceRoute, seasonRoute } from '../../common/route';

const service = new RacesService();

export const RacesController = {
  // Even a status=completed list grows during the season, so only a past season is final.
  getAll: seasonRoute({
    load: ({ db, year, query }) => service.findAll(db, year, query('status')),
  }),

  getById: raceRoute({
    load: ({ db, race, circuit }) => service.findDetail(db, race, circuit),
  }),
};
