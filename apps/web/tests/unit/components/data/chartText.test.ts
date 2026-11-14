import { describe, expect, test } from 'vitest';
import { lineChartSummary, lineDashes } from '@/components/data/chartText';

describe('lineDashes', () => {
  test('keeps the first line of each colour solid and dashes the repeats', () => {
    expect(lineDashes(['#3671C6', '#E8002D', '#3671c6', '#E8002D', '#3671C6'])).toEqual(['', '', '6 3', '6 3', '2 3']);
  });
});

describe('lineChartSummary', () => {
  const series = [
    { label: 'VER', color: '#3671C6', points: [{ x: 1, y: 1 }, { x: 2, y: 1 }] },
    { label: 'SAR', color: '#64C4FF', points: [{ x: 1, y: 19 }, { x: 2, y: null }] },
    { label: 'DNS', color: '#fff', points: [{ x: 1, y: null }] },
  ];

  test("reads each line's last value, where a line stops early too", () => {
    expect(lineChartSummary(series, (v) => `P${v}`, 'lap')).toBe('Last values: VER P1 at lap 2; SAR P19 at lap 1.');
  });

  test('leaves the x position out when the axis has no label', () => {
    expect(lineChartSummary(series.slice(0, 1), (v) => `${v * 100}%`)).toBe('Last values: VER 100%.');
  });

  test('says so when there is nothing to read', () => {
    expect(lineChartSummary([], String)).toBe('No data.');
  });
});
