export type CompareResult<TDetail, TYearStats> =
  | { mode: 'season'; a: TDetail; b: TDetail }
  | { mode: 'career'; a: TYearStats[]; b: TYearStats[] };

export interface CompareReducerConfig<T> {
  defaultYear: number;
  initialItems: T[];
  allItems: T[];
}

interface FetchDescriptor {
  requestId: number;
}

export interface ItemsFetch extends FetchDescriptor {
  year: number;
}

export interface DetailFetch extends FetchDescriptor {
  aId: number;
  bId: number;
  year: number;
  isCareer: boolean;
}

export interface CompareState<T extends { id: number }, TDetail, TYearStats> {
  year: number;
  items: T[];
  aId: number;
  bId: number;
  isCareer: boolean;
  comparison: CompareResult<TDetail, TYearStats> | null;
  loading: boolean;
  error: string | null;
  pendingAId?: number;
  pendingBId?: number;
  nextRequestId: number;
  itemsFetch: ItemsFetch | null;
  detailFetch: DetailFetch | null;
}

export type CompareAction<T, TDetail, TYearStats> =
  | { type: 'HYDRATE'; year?: number; aId?: number; bId?: number; isCareer?: boolean }
  | { type: 'YEAR_CHANGED'; year: number }
  | { type: 'A_SELECTED'; id: number }
  | { type: 'B_SELECTED'; id: number }
  | { type: 'MODE_CHANGED'; isCareer: boolean }
  | { type: 'ITEMS_LOADED'; requestId: number; items: T[] }
  | { type: 'DETAIL_LOADED'; requestId: number; result: CompareResult<TDetail, TYearStats> }
  | { type: 'DETAIL_FAILED'; requestId: number; message: string };

// Arms the (only) detail fetch, or clears it while a/b are still mid-hydration:
// pendingAId/pendingBId being set means ITEMS_LOADED hasn't resolved them onto a/b yet.
function armDetailFetch<T extends { id: number }, TDetail, TYearStats>(
  state: CompareState<T, TDetail, TYearStats>,
): CompareState<T, TDetail, TYearStats> {
  if (!state.aId || !state.bId || state.pendingAId !== undefined || state.pendingBId !== undefined) {
    return { ...state, detailFetch: null };
  }
  const requestId = state.nextRequestId + 1;
  return {
    ...state,
    loading: true,
    error: null,
    nextRequestId: requestId,
    detailFetch: { aId: state.aId, bId: state.bId, year: state.year, isCareer: state.isCareer, requestId },
  };
}

function armItemsFetch<T extends { id: number }, TDetail, TYearStats>(
  state: CompareState<T, TDetail, TYearStats>,
  year: number,
): CompareState<T, TDetail, TYearStats> {
  const requestId = state.nextRequestId + 1;
  return { ...state, year, nextRequestId: requestId, itemsFetch: { year, requestId }, detailFetch: null };
}

export function createInitialCompareState<T extends { id: number }, TDetail, TYearStats>(
  config: CompareReducerConfig<T>,
): CompareState<T, TDetail, TYearStats> {
  const aId = config.initialItems[0]?.id ?? 0;
  const bId = config.initialItems[1]?.id ?? config.initialItems[0]?.id ?? 0;
  return armDetailFetch({
    year: config.defaultYear,
    items: config.initialItems,
    aId,
    bId,
    isCareer: false,
    comparison: null,
    loading: false,
    error: null,
    nextRequestId: 0,
    itemsFetch: null,
    detailFetch: null,
  });
}

export function compareReducer<T extends { id: number }, TDetail, TYearStats>(
  state: CompareState<T, TDetail, TYearStats>,
  action: CompareAction<T, TDetail, TYearStats>,
  config: CompareReducerConfig<T>,
): CompareState<T, TDetail, TYearStats> {
  switch (action.type) {
    case 'HYDRATE': {
      const year = action.year ?? state.year;
      if (action.isCareer) {
        return armDetailFetch({
          ...state,
          year,
          isCareer: true,
          items: config.allItems,
          aId: action.aId ?? state.aId,
          bId: action.bId ?? state.bId,
        });
      }
      if (action.year !== undefined && action.year !== config.defaultYear) {
        return { ...armItemsFetch(state, year), pendingAId: action.aId, pendingBId: action.bId };
      }
      return armDetailFetch({ ...state, year, aId: action.aId ?? state.aId, bId: action.bId ?? state.bId });
    }

    case 'YEAR_CHANGED': {
      if (state.isCareer) return armDetailFetch({ ...state, year: action.year });
      if (action.year === config.defaultYear) {
        const { initialItems } = config;
        const aId = initialItems.some((i) => i.id === state.aId) ? state.aId : (initialItems[0]?.id ?? 0);
        const bId = initialItems.some((i) => i.id === state.bId)
          ? state.bId
          : (initialItems[1]?.id ?? initialItems[0]?.id ?? 0);
        return armDetailFetch({
          ...state, year: action.year, items: initialItems, aId, bId,
          pendingAId: undefined, pendingBId: undefined,
        });
      }
      return { ...armItemsFetch(state, action.year), pendingAId: undefined, pendingBId: undefined };
    }

    case 'A_SELECTED':
      return armDetailFetch({ ...state, aId: action.id });

    case 'B_SELECTED':
      return armDetailFetch({ ...state, bId: action.id });

    case 'MODE_CHANGED': {
      if (action.isCareer) {
        return armDetailFetch({ ...state, isCareer: true, items: config.allItems });
      }
      if (state.year === config.defaultYear) {
        return armDetailFetch({ ...state, isCareer: false, items: config.initialItems });
      }
      return { ...armItemsFetch({ ...state, isCareer: false }, state.year), pendingAId: undefined, pendingBId: undefined };
    }

    case 'ITEMS_LOADED': {
      if (state.itemsFetch?.requestId !== action.requestId) return state;
      if (action.items.length === 0) {
        return { ...state, items: action.items, itemsFetch: null, pendingAId: undefined, pendingBId: undefined };
      }
      const aId = state.pendingAId ?? (action.items.some((i) => i.id === state.aId) ? state.aId : action.items[0].id);
      const bId =
        state.pendingBId ?? (action.items.some((i) => i.id === state.bId) ? state.bId : (action.items[1]?.id ?? action.items[0].id));
      return armDetailFetch({
        ...state, items: action.items, aId, bId,
        pendingAId: undefined, pendingBId: undefined, itemsFetch: null,
      });
    }

    case 'DETAIL_LOADED': {
      if (state.detailFetch?.requestId !== action.requestId) return state;
      return { ...state, comparison: action.result, loading: false, error: null, detailFetch: null };
    }

    case 'DETAIL_FAILED': {
      if (state.detailFetch?.requestId !== action.requestId) return state;
      return { ...state, error: action.message, loading: false, detailFetch: null };
    }
  }
}
