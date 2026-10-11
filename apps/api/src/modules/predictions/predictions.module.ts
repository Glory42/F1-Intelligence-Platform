import { Hono } from 'hono';
import type { Bindings } from '../../common/types';
import { PredictionsController } from './predictions.controller';

const predictionsModule = new Hono<{ Bindings: Bindings }>();

predictionsModule.get('/model-info', PredictionsController.getModelInfo);
predictionsModule.get('/upcoming', PredictionsController.getUpcoming);
predictionsModule.get('/history', PredictionsController.getHistory);
predictionsModule.get('/accuracy', PredictionsController.getAccuracy);
predictionsModule.get('/standings', PredictionsController.getIntelStandings);
predictionsModule.get('/title-odds', PredictionsController.getTitleOdds);
predictionsModule.get('/race/:raceId/friday-pace', PredictionsController.getFridayPace);
predictionsModule.get('/race/:raceId', PredictionsController.getByRaceId);

export default predictionsModule;
