import { describe, expect, test } from 'vitest';
import {
  compareReducer,
  createInitialCompareState,
  type CompareReducerConfig,
  type CompareState,
} from '@/features/compare/compareReducer';

type Item = { id: number; name: string };
type Detail = { id: number; label: string };
type YearStats = { year: number; wins: number };

const initialItems: Item[] = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }];
const allItems: Item[] = [...initialItems, { id: 3, name: 'C' }];
const yearItems: Item[] = [{ id: 5, name: 'X' }, { id: 6, name: 'Y' }];

const config: CompareReducerConfig<Item> = { defaultYear: 2025, initialItems, allItems };

function initial(): CompareState<Item, Detail, YearStats> {
  return createInitialCompareState(config);
}

describe('createInitialCompareState', () => {
  test('defaults a/b to the first two items and arms a detail fetch', () => {
    const state = initial();
    expect(state.year).toBe(2025);
    expect(state.aId).toBe(1);
    expect(state.bId).toBe(2);
    expect(state.detailFetch).toEqual({ aId: 1, bId: 2, year: 2025, isCareer: false, requestId: 1 });
    expect(state.loading).toBe(true);
  });
});

describe('HYDRATE', () => {
  test('regression (6bf3415): a non-default year + explicit a/b apply once items load, not clobbered by the year-fetch default', () => {
    let state = initial();
    // URL was ?year=2024&a=6&b=5
    state = compareReducer(state, { type: 'HYDRATE', year: 2024, aId: 6, bId: 5 }, config);

    expect(state.year).toBe(2024);
    expect(state.pendingAId).toBe(6);
    expect(state.pendingBId).toBe(5);
    expect(state.itemsFetch).toEqual({ year: 2024, requestId: 2 });
    // the stale mount-time detail fetch for the old defaults must not still be armed
    expect(state.detailFetch).toBeNull();

    // fetchItemsForYear(2024) resolves with [5, 6]: without the fix this would default
    // aId/bId to items[0]/items[1] instead of applying the URL's a=6&b=5
    state = compareReducer(state, { type: 'ITEMS_LOADED', requestId: 2, items: yearItems }, config);

    expect(state.aId).toBe(6);
    expect(state.bId).toBe(5);
    expect(state.pendingAId).toBeUndefined();
    expect(state.pendingBId).toBeUndefined();
    expect(state.detailFetch).toEqual({ aId: 6, bId: 5, year: 2024, isCareer: false, requestId: 3 });
  });

  test('career mode applies a/b immediately and uses allItems, no items fetch', () => {
    const state = compareReducer(initial(), { type: 'HYDRATE', isCareer: true, aId: 3, bId: 1 }, config);

    expect(state.isCareer).toBe(true);
    expect(state.items).toBe(allItems);
    expect(state.aId).toBe(3);
    expect(state.bId).toBe(1);
    expect(state.itemsFetch).toBeNull();
    expect(state.detailFetch).toEqual({ aId: 3, bId: 1, year: 2025, isCareer: true, requestId: 2 });
  });

  test('default year with a/b params applies them without fetching items', () => {
    const state = compareReducer(initial(), { type: 'HYDRATE', aId: 2, bId: 1 }, config);

    expect(state.items).toBe(initialItems);
    expect(state.itemsFetch).toBeNull();
    expect(state.aId).toBe(2);
    expect(state.bId).toBe(1);
  });

  test('no params at all leaves the initial defaults untouched', () => {
    const before = initial();
    const state = compareReducer(before, { type: 'HYDRATE' }, config);
    expect(state.aId).toBe(before.aId);
    expect(state.bId).toBe(before.bId);
    expect(state.year).toBe(before.year);
  });
});

describe('stale response guarding (the async-race class the old `active` flags guarded)', () => {
  test('an items response for a superseded request is ignored', () => {
    let state = initial();
    state = compareReducer(state, { type: 'YEAR_CHANGED', year: 2024 }, config); // requestId 2
    state = compareReducer(state, { type: 'YEAR_CHANGED', year: 2023 }, config); // supersedes it, requestId 3

    // the stale 2024 fetch resolves AFTER the 2023 one was armed
    const afterStale = compareReducer(state, { type: 'ITEMS_LOADED', requestId: 2, items: yearItems }, config);
    expect(afterStale).toBe(state);

    const afterCurrent = compareReducer(state, { type: 'ITEMS_LOADED', requestId: 3, items: yearItems }, config);
    expect(afterCurrent.items).toEqual(yearItems);
  });

  test('a detail response for a superseded request is ignored', () => {
    let state = initial(); // detailFetch requestId 1
    state = compareReducer(state, { type: 'A_SELECTED', id: 5 }, config); // requestId 2

    const stale = compareReducer(
      state,
      { type: 'DETAIL_LOADED', requestId: 1, result: { mode: 'season', a: { id: 1, label: 'old' }, b: { id: 2, label: 'old' } } },
      config,
    );
    expect(stale.comparison).toBeNull();

    const current = compareReducer(
      state,
      { type: 'DETAIL_LOADED', requestId: 2, result: { mode: 'season', a: { id: 5, label: 'new' }, b: { id: 2, label: 'new' } } },
      config,
    );
    expect(current.comparison).toEqual({ mode: 'season', a: { id: 5, label: 'new' }, b: { id: 2, label: 'new' } });
    expect(current.loading).toBe(false);
  });
});

describe('YEAR_CHANGED', () => {
  test('non-default year arms an items fetch and clears the detail fetch', () => {
    const state = compareReducer(initial(), { type: 'YEAR_CHANGED', year: 2024 }, config);
    expect(state.itemsFetch).toEqual({ year: 2024, requestId: 2 });
    expect(state.detailFetch).toBeNull();
  });

  test('back to the default year resets to initialItems and re-validates a/b', () => {
    let state = initial();
    state = compareReducer(state, { type: 'A_SELECTED', id: 99 }, config); // not in initialItems
    state = compareReducer(state, { type: 'YEAR_CHANGED', year: 2024 }, config);
    state = compareReducer(state, { type: 'ITEMS_LOADED', requestId: state.itemsFetch!.requestId, items: yearItems }, config);
    // aId/bId are now 5/6 (99 and 2 weren't in yearItems)
    state = compareReducer(state, { type: 'YEAR_CHANGED', year: 2025 }, config);

    expect(state.items).toBe(initialItems);
    expect(state.aId).toBe(1); // 5 isn't in initialItems, falls back
    expect(state.bId).toBe(2); // 6 isn't in initialItems, falls back
  });

  test('career mode ignores items fetching entirely', () => {
    let state = compareReducer(initial(), { type: 'MODE_CHANGED', isCareer: true }, config);
    state = compareReducer(state, { type: 'YEAR_CHANGED', year: 2024 }, config);
    expect(state.itemsFetch).toBeNull();
    expect(state.items).toBe(allItems);
  });
});

describe('MODE_CHANGED', () => {
  test('switching to career mode uses allItems immediately, no items fetch', () => {
    const state = compareReducer(initial(), { type: 'MODE_CHANGED', isCareer: true }, config);
    expect(state.items).toBe(allItems);
    expect(state.itemsFetch).toBeNull();
  });

  test('switching back to season mode at a non-default year re-fetches that year', () => {
    let state = initial();
    state = compareReducer(state, { type: 'YEAR_CHANGED', year: 2024 }, config);
    state = compareReducer(state, { type: 'ITEMS_LOADED', requestId: state.itemsFetch!.requestId, items: yearItems }, config);
    state = compareReducer(state, { type: 'MODE_CHANGED', isCareer: true }, config);
    state = compareReducer(state, { type: 'MODE_CHANGED', isCareer: false }, config);

    expect(state.itemsFetch?.year).toBe(2024);
  });
});

describe('ITEMS_LOADED with an empty result', () => {
  test('clears the pending fetch without arming a detail fetch', () => {
    let state = compareReducer(initial(), { type: 'YEAR_CHANGED', year: 2024 }, config);
    state = compareReducer(state, { type: 'ITEMS_LOADED', requestId: state.itemsFetch!.requestId, items: [] }, config);

    expect(state.items).toEqual([]);
    expect(state.itemsFetch).toBeNull();
    expect(state.detailFetch).toBeNull();
  });
});

describe('DETAIL_FAILED', () => {
  test('sets the error message and stops loading for the current request only', () => {
    const armed = initial();
    const stale = compareReducer(armed, { type: 'DETAIL_FAILED', requestId: 999, message: 'boom' }, config);
    expect(stale.error).toBeNull();

    const current = compareReducer(armed, { type: 'DETAIL_FAILED', requestId: 1, message: 'boom' }, config);
    expect(current.error).toBe('boom');
    expect(current.loading).toBe(false);
  });
});
