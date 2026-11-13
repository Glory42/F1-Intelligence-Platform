import { describe, expect, it } from 'bun:test';
import { median } from '../../../src/common/stats';

describe('median', () => {
  it('takes the middle value, averaging the two middles of an even list', () => {
    expect(median([300, -100, 50])).toBe(50);
    expect(median([10, 40, 20, 30])).toBe(25);
  });

  it('is null for no values', () => {
    expect(median([])).toBeNull();
  });
});
