import { TeamsService } from './teams.service';
import { newestSeason, seasonRoute, teamRoute } from '../../common/route';

const service = new TeamsService();

export const TeamsController = {
  getAll: seasonRoute({
    load: ({ db, year }) => service.findAll(db, year),
  }),

  getPitCrewRankings: seasonRoute({
    load: ({ db, year }) => service.findPitCrewRankings(db, year),
  }),

  getTeamPitStops: teamRoute({
    load: ({ db, team }) => service.findTeamPitStops(db, team.id),
  }),

  getStandings: seasonRoute({
    load: ({ db, year }) => service.findStandings(db, year),
  }),

  getCareerStats: teamRoute({
    load: ({ db, team }) => service.findCareerStats(db, team),
    seasonOf: newestSeason,
  }),

  getById: teamRoute({
    load: ({ db, team }) => service.findDetail(db, team),
  }),
};
