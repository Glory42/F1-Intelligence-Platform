import { DriversService } from './drivers.service';
import { TeammateBattleService } from './teammate-battle.service';
import { RacecraftService } from './racecraft.service';
import { driverRoute, newestSeason, seasonRoute } from '../../common/route';

const service = new DriversService();
const teammateBattles = new TeammateBattleService();
const racecraft = new RacecraftService();

export const DriversController = {
  getRacecraft: seasonRoute({
    load: ({ db, year }) => racecraft.findRacecraft(db, year),
  }),

  getTeammateBattle: driverRoute({
    load: ({ db, driver }) => teammateBattles.findBattle(db, driver),
  }),

  getAll: seasonRoute({
    load: ({ db, year, query }) => {
      const teamId = query('team_id');
      return service.findAll(db, year, teamId ? Number(teamId) : undefined);
    },
  }),

  getStandings: seasonRoute({
    load: ({ db, year }) => service.findStandings(db, year),
  }),

  getCareerStats: driverRoute({
    load: ({ db, driver }) => service.findCareerStats(db, driver),
    seasonOf: newestSeason,
  }),

  getById: driverRoute({
    load: ({ db, driver, team }) => service.findDetail(db, driver, team),
  }),
};
