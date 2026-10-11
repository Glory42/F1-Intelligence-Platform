// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCompareController, type CompareLocationAdapter } from '@/features/compare/useCompareController';

type Item = { id: number; name: string };
type Detail = { id: number; label: string };
type YearStats = { year: number; wins: number };

const items: Item[] = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }];
const allItems: Item[] = [...items, { id: 3, name: 'C' }];
const yearItems: Item[] = [{ id: 5, name: 'X' }, { id: 6, name: 'Y' }];

function makeAdapter(initialSearch: string) {
  let currentUrl = `/compare/drivers${initialSearch}`;
  const replaceUrl = vi.fn((url: string) => {
    currentUrl = url;
  });
  const adapter: CompareLocationAdapter = {
    getSearchParams: () => new URLSearchParams(initialSearch),
    getPathname: () => '/compare/drivers',
    replaceUrl,
  };
  return { adapter, replaceUrl, getUrl: () => currentUrl };
}

function makeConfig() {
  const fetchItemsForYear = vi.fn(async (year: number) => (year === 2024 ? yearItems : items));
  const fetchDetail = vi.fn(async (id: number, year: number): Promise<Detail> => ({ id, label: `detail-${id}-${year}` }));
  const fetchCareer = vi.fn(async (id: number): Promise<YearStats[]> => [{ year: 2023, wins: id }]);

  return {
    config: {
      years: [2023, 2024, 2025],
      defaultYear: 2025,
      initialItems: items,
      allItems,
      entityLabel: 'driver',
      fetchItemsForYear,
      fetchDetail,
      fetchCareer,
    },
    fetchItemsForYear,
    fetchDetail,
    fetchCareer,
  };
}

describe('useCompareController', () => {
  it('defaults a/b to the first two initial items and fetches season detail', async () => {
    const { adapter } = makeAdapter('');
    const { config, fetchDetail } = makeConfig();

    const { result } = renderHook(() => useCompareController(config, adapter));

    expect(result.current.aId).toBe(1);
    expect(result.current.bId).toBe(2);

    await waitFor(() => expect(result.current.comparison?.mode).toBe('season'));
    expect(fetchDetail).toHaveBeenCalledWith(1, 2025);
    expect(fetchDetail).toHaveBeenCalledWith(2, 2025);
  });

  it('hydrates year/a/b from URL search params on mount', async () => {
    const { adapter } = makeAdapter('?year=2024&a=6&b=5');
    const { config } = makeConfig();

    const { result } = renderHook(() => useCompareController(config, adapter));

    await waitFor(() => expect(result.current.year).toBe(2024));
    await waitFor(() => expect(result.current.items).toEqual(yearItems));
    await waitFor(() => expect(result.current.aId).toBe(6));
    expect(result.current.bId).toBe(5);
  });

  it('switches to allItems and career fetching when career=true is in the URL', async () => {
    const { adapter } = makeAdapter('?career=true&a=3&b=1');
    const { config, fetchCareer } = makeConfig();

    const { result } = renderHook(() => useCompareController(config, adapter));

    await waitFor(() => expect(result.current.isCareer).toBe(true));
    expect(result.current.items).toEqual(allItems);
    expect(result.current.aId).toBe(3);
    expect(result.current.bId).toBe(1);

    await waitFor(() => expect(result.current.comparison?.mode).toBe('career'));
    expect(fetchCareer).toHaveBeenCalledWith(3);
    expect(fetchCareer).toHaveBeenCalledWith(1);
  });

  it('writes year/a/b back to the URL via the location adapter', async () => {
    const { adapter, replaceUrl } = makeAdapter('');
    const { config } = makeConfig();

    renderHook(() => useCompareController(config, adapter));

    await waitFor(() =>
      expect(replaceUrl).toHaveBeenCalledWith('/compare/drivers?year=2025&a=1&b=2')
    );
  });
});
