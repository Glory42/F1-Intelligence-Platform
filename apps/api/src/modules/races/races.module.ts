import { Hono } from 'hono';
import type { Bindings } from '../../common/types';
import { RacesController } from './races.controller';

const racesModule = new Hono<{ Bindings: Bindings }>();

racesModule.get('/', RacesController.getAll);
racesModule.get('/:id', RacesController.getById);
racesModule.get('/:id/long-runs', RacesController.getLongRuns);

export default racesModule;
