import { RACE_SESSION } from '../../common/session';
import { raceRoute } from '../../common/route';
import { RaceEventsService } from './race-events.service';

const service = new RaceEventsService();

export const RaceEventsController = {
  getRaceControl: raceRoute({
    session: RACE_SESSION,
    load: ({ db, race, session }) => service.getRaceControlMessages(db, race.id, session),
  }),
  getOvertakes: raceRoute({
    session: RACE_SESSION,
    load: ({ db, race, session }) => service.getOvertakes(db, race.id, session),
  }),
  getTeamRadio: raceRoute({
    session: RACE_SESSION,
    load: ({ db, race, session }) => service.getTeamRadio(db, race.id, session),
  }),
};
