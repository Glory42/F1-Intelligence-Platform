import { RACE_SESSION } from '../../common/session';
import { raceRoute } from '../../common/route';
import { RaceStoryService } from './race-story.service';
import { RecapService } from './recap.service';

const service = new RaceStoryService();
const recaps = new RecapService();

export const RaceStoryController = {
  getRecap: raceRoute({
    load: ({ db, race }) => recaps.findRecap(db, race.id),
    hasData: (data) => data.winner != null,
  }),

  getRaceStory: raceRoute({
    session: RACE_SESSION,
    load: ({ db, race, session }) => service.findRaceStory(db, race.id, session),
    hasData: (data) => data.drivers.length > 0,
  }),
};
