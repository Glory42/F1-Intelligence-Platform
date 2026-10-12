import type { QualifyingSession, RaceSession } from './types';

export interface SessionParam<S> {
  parse: (value: string | undefined) => S | null;
  error: { code: string; message: string };
}

export const RACE_SESSION: SessionParam<RaceSession> = {
  parse: (value) => {
    const session = value ?? 'race';
    return session === 'race' || session === 'sprint' ? session : null;
  },
  error: { code: 'INVALID_SESSION', message: "session must be 'race' or 'sprint'" },
};

export const QUALIFYING_SESSION: SessionParam<QualifyingSession> = {
  parse: (value) => {
    const session = value ?? 'Q';
    return session === 'Q' || session === 'SQ' ? session : null;
  },
  error: { code: 'INVALID_SESSION', message: "session must be 'Q' or 'SQ'" },
};
