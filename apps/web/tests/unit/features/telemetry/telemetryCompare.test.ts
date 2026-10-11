import { describe, expect, it } from 'vitest';
import { lapDelta, miniSectorWinners } from '@/features/telemetry/telemetryCompare';

// Two hand-built laps on the same 4-point distance grid (cumulative time in ms).
const A = { timeMs: [0, 1_000, 2_500, 3_400] };
const B = { timeMs: [0, 1_200, 2_400, 3_500] };

describe('lapDelta', () => {
  it('is A minus B at each distance point: negative while A is ahead', () => {
    expect(lapDelta(A, B)).toEqual([0, -200, 100, -100]);
  });
});

describe('miniSectorWinners', () => {
  it('awards each mini-sector to whoever covered it faster', () => {
    // Segments: 0→1 A 1000 vs B 1200 (A), 1→2 A 1500 vs B 1200 (B), 2→3 A 900 vs B 1100 (A).
    expect(miniSectorWinners(A, B, 3)).toEqual(['a', 'b', 'a']);
  });
});
