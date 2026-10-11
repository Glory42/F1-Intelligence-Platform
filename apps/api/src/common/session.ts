import type { RaceSession } from './types';

export const INVALID_SESSION_ERROR = { code: 'INVALID_SESSION', message: "session must be 'race' or 'sprint'" };

export function parseRaceSession(value: string | undefined): RaceSession | null {
  const session = value ?? 'race';
  return session === 'race' || session === 'sprint' ? session : null;
}
