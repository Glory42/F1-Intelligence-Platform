import { describe, expect, test } from 'bun:test';
import { toRaceControlMessage, toRaceOvertake, toTeamRadioClip } from '../../../../src/modules/race-events/openf1.mappers';
import type { raceControlMessages, raceOvertakes, teamRadioClips } from '../../../../src/db/schema';

describe('toRaceControlMessage', () => {
  const row: typeof raceControlMessages.$inferSelect = {
    id: 1,
    raceId: 100,
    date: new Date('2025-09-07T13:32:10Z'),
    category: 'Flag',
    flag: 'YELLOW',
    lapNumber: 12,
    driverNumber: 44,
    scope: 'Sector',
    sector: 4,
    message: 'YELLOW IN TRACK SECTOR 4',
    sessionType: 'race',
    createdAt: new Date('2025-09-07T14:00:00Z'),
  };

  test('converts the date column to an ISO string', () => {
    expect(toRaceControlMessage(row).date).toBe('2025-09-07T13:32:10.000Z');
  });

  test('maps nullable columns through as-is', () => {
    expect(toRaceControlMessage(row)).toEqual({
      id: 1,
      raceId: 100,
      date: '2025-09-07T13:32:10.000Z',
      category: 'Flag',
      flag: 'YELLOW',
      lapNumber: 12,
      driverNumber: 44,
      scope: 'Sector',
      sector: 4,
      message: 'YELLOW IN TRACK SECTOR 4',
    });
  });

  test('null optional columns stay null', () => {
    const result = toRaceControlMessage({ ...row, flag: null, lapNumber: null, driverNumber: null, scope: null, sector: null });
    expect(result.flag).toBeNull();
    expect(result.lapNumber).toBeNull();
    expect(result.driverNumber).toBeNull();
    expect(result.scope).toBeNull();
    expect(result.sector).toBeNull();
  });
});

describe('toRaceOvertake', () => {
  const overtakeRow: typeof raceOvertakes.$inferSelect = {
    id: 1,
    raceId: 100,
    date: new Date('2025-09-07T13:50:07Z'),
    overtakingDriverId: 10,
    overtakenDriverId: 11,
    position: 3,
    sessionType: 'race',
    createdAt: new Date('2025-09-07T14:00:00Z'),
  };

  test('converts the date column to an ISO string', () => {
    expect(toRaceOvertake(overtakeRow).date).toBe('2025-09-07T13:50:07.000Z');
  });

  test('maps all columns through', () => {
    expect(toRaceOvertake(overtakeRow)).toEqual({
      id: 1,
      raceId: 100,
      date: '2025-09-07T13:50:07.000Z',
      overtakingDriverId: 10,
      overtakenDriverId: 11,
      position: 3,
    });
  });
});

describe('toTeamRadioClip', () => {
  const clipRow: typeof teamRadioClips.$inferSelect = {
    id: 1,
    raceId: 100,
    driverId: 10,
    date: new Date('2025-09-07T13:45:52Z'),
    recordingUrl: 'https://livetiming.formula1.com/static/clip.mp3',
    sessionType: 'race',
    createdAt: new Date('2025-09-07T14:00:00Z'),
  };

  test('converts the date column to an ISO string', () => {
    expect(toTeamRadioClip(clipRow).date).toBe('2025-09-07T13:45:52.000Z');
  });

  test('maps all columns through', () => {
    expect(toTeamRadioClip(clipRow)).toEqual({
      id: 1,
      raceId: 100,
      driverId: 10,
      date: '2025-09-07T13:45:52.000Z',
      recordingUrl: 'https://livetiming.formula1.com/static/clip.mp3',
    });
  });
});
