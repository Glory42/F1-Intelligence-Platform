import { describe, expect, it } from 'vitest';
import { teammateTally } from '@/features/drivers/teammateTally';

const outing = (qualiPosition: number | null, finishPosition: number | null, status = 'Finished') =>
  ({ qualiPosition, finishPosition, status, points: 0 });
const race = (driver: ReturnType<typeof outing>, teammate: ReturnType<typeof outing>) => ({ driver, teammate });

describe('teammateTally', () => {
  it("totals each driver's podiums, retirements, averages and best finish over the shared races", () => {
    const races = [
      race(outing(2, 1), outing(4, 3)),
      race(outing(3, 5), outing(1, 2)),
      race(outing(4, null, 'Retired'), outing(6, 4)),
      race(outing(1, 2), outing(5, 17, '+1 Lap')),
    ];

    expect(teammateTally(races)).toEqual({
      driver: { podiums: 2, retirements: 1, avgQuali: 2.5, avgFinish: 8 / 3, bestFinish: 1 },
      teammate: { podiums: 2, retirements: 0, avgQuali: 4, avgFinish: 26 / 4, bestFinish: 2 },
    });
  });

  it('counts a disqualification as a retirement, matching the season stats', () => {
    const { driver } = teammateTally([race(outing(1, 20, 'Disqualified'), outing(2, 1))]);

    expect(driver.retirements).toBe(1);
    expect(driver.avgFinish).toBeNull();
    expect(driver.bestFinish).toBeNull();
  });
});
