import { Hono } from 'hono';
import type { Bindings } from '../../common/types';
import { RaceStoryController } from './race-story.controller';

const raceStoryModule = new Hono<{ Bindings: Bindings }>();

raceStoryModule.get('/:id/race-story', RaceStoryController.getRaceStory);
raceStoryModule.get('/:id/recap', RaceStoryController.getRecap);

export default raceStoryModule;
