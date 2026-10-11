import { Hono } from 'hono';
import type { Bindings } from '../../common/types';
import { HistoryController } from '../history/history.controller';
import { DriversController } from './drivers.controller';

const driversModule = new Hono<{ Bindings: Bindings }>();

driversModule.get('/standings', DriversController.getStandings);
driversModule.get('/racecraft', DriversController.getRacecraft);
driversModule.get('/', DriversController.getAll);
driversModule.get('/:id/career', DriversController.getCareerStats);
driversModule.get('/:id/history', HistoryController.getDriverHistory);
driversModule.get('/:id/teammate-battle', DriversController.getTeammateBattle);
driversModule.get('/:id', DriversController.getById);

export default driversModule;
