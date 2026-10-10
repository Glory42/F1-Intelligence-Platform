import { Hono } from 'hono';
import type { Bindings } from '../../common/types';
import { HistoryController } from '../history/history.controller';
import { TeamsController } from './teams.controller';

const teamsModule = new Hono<{ Bindings: Bindings }>();

teamsModule.get('/standings', TeamsController.getStandings);
teamsModule.get('/pit-stops', TeamsController.getPitCrewRankings);
teamsModule.get('/', TeamsController.getAll);
teamsModule.get('/:id/career', TeamsController.getCareerStats);
teamsModule.get('/:id/history', HistoryController.getTeamHistory);
teamsModule.get('/:id', TeamsController.getById);

export default teamsModule;
