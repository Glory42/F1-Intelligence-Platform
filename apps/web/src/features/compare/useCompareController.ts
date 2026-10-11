import { useEffect, useMemo, useReducer, useRef } from 'react';
import {
  compareReducer,
  createInitialCompareState,
  type CompareAction,
  type CompareState,
  type CompareResult,
} from './compareReducer';

export interface CompareLocationAdapter {
  getSearchParams(): URLSearchParams;
  getPathname(): string;
  replaceUrl(url: string): void;
}

const browserLocationAdapter: CompareLocationAdapter = {
  getSearchParams: () => new URLSearchParams(window.location.search),
  getPathname: () => window.location.pathname,
  replaceUrl: (url) => window.history.replaceState({}, '', url),
};

interface CompareControllerConfig<T extends { id: number }, TDetail, TYearStats> {
  years: number[];
  defaultYear: number;
  initialItems: T[];
  allItems: T[];
  entityLabel: string;
  fetchItemsForYear: (year: number) => Promise<T[]>;
  fetchDetail: (id: number, year: number) => Promise<TDetail>;
  fetchCareer: (id: number) => Promise<TYearStats[]>;
}

export type { CompareResult };

export interface CompareControllerActions {
  setYear: (year: number) => void;
  setAId: (id: number) => void;
  setBId: (id: number) => void;
  setIsCareer: (isCareer: boolean) => void;
}

export interface CompareControllerResult<T, TDetail, TYearStats> {
  year: number;
  items: T[];
  aId: number;
  bId: number;
  itemA: T | undefined;
  itemB: T | undefined;
  isCareer: boolean;
  comparison: CompareResult<TDetail, TYearStats> | null;
  loading: boolean;
  error: string | null;
  actions: CompareControllerActions;
}

export function useCompareController<T extends { id: number }, TDetail, TYearStats>(
  config: CompareControllerConfig<T, TDetail, TYearStats>,
  locationAdapter: CompareLocationAdapter = browserLocationAdapter
): CompareControllerResult<T, TDetail, TYearStats> {
  const { defaultYear, initialItems, allItems } = config;
  const reducerConfig = useMemo(() => ({ defaultYear, initialItems, allItems }), [defaultYear, initialItems, allItems]);

  const [state, dispatch] = useReducer(
    (s: CompareState<T, TDetail, TYearStats>, a: CompareAction<T, TDetail, TYearStats>) => compareReducer(s, a, reducerConfig),
    createInitialCompareState<T, TDetail, TYearStats>(reducerConfig),
  );

  // Effects read config/adapter via these refs, not as deps: no re-fetch on a fresh
  // per-render identity, and no eslint-disable needed.
  const configRef = useRef(config);
  configRef.current = config;
  const adapterRef = useRef(locationAdapter);
  adapterRef.current = locationAdapter;

  useEffect(() => {
    const params = adapterRef.current.getSearchParams();
    const paramYear = params.get('year');
    const paramA = params.get('a');
    const paramB = params.get('b');
    dispatch({
      type: 'HYDRATE',
      year: paramYear ? parseInt(paramYear) : undefined,
      aId: paramA ? parseInt(paramA) : undefined,
      bId: paramB ? parseInt(paramB) : undefined,
      isCareer: params.get('career') === 'true' ? true : undefined,
    });
  }, []);

  useEffect(() => {
    const newUrl = `${adapterRef.current.getPathname()}?${new URLSearchParams({
      year: state.year.toString(),
      a: state.aId.toString(),
      b: state.bId.toString(),
      ...(state.isCareer ? { career: 'true' } : {}),
    }).toString()}`;
    adapterRef.current.replaceUrl(newUrl);
  }, [state.year, state.aId, state.bId, state.isCareer]);

  const { itemsFetch, detailFetch } = state;

  useEffect(() => {
    if (!itemsFetch) return;
    const { year, requestId } = itemsFetch;
    configRef.current
      .fetchItemsForYear(year)
      .then((items) => dispatch({ type: 'ITEMS_LOADED', requestId, items }))
      .catch((err) => console.error(`Failed to load ${configRef.current.entityLabel} for year`, year, err));
  }, [itemsFetch]);

  useEffect(() => {
    if (!detailFetch) return;
    const { aId, bId, year, isCareer, requestId } = detailFetch;
    const load = isCareer
      ? Promise.all([configRef.current.fetchCareer(aId), configRef.current.fetchCareer(bId)]).then(
          ([a, b]) => ({ mode: 'career' as const, a, b }),
        )
      : Promise.all([configRef.current.fetchDetail(aId, year), configRef.current.fetchDetail(bId, year)]).then(
          ([a, b]) => ({ mode: 'season' as const, a, b }),
        );
    load
      .then((result) => dispatch({ type: 'DETAIL_LOADED', requestId, result }))
      .catch((err) =>
        dispatch({ type: 'DETAIL_FAILED', requestId, message: err instanceof Error ? err.message : 'Failed to fetch details' }),
      );
  }, [detailFetch]);

  const itemA = useMemo(() => state.items.find((i) => i.id === state.aId), [state.items, state.aId]);
  const itemB = useMemo(() => state.items.find((i) => i.id === state.bId), [state.items, state.bId]);

  const actions = useMemo<CompareControllerActions>(
    () => ({
      setYear: (year) => dispatch({ type: 'YEAR_CHANGED', year }),
      setAId: (id) => dispatch({ type: 'A_SELECTED', id }),
      setBId: (id) => dispatch({ type: 'B_SELECTED', id }),
      setIsCareer: (isCareer) => dispatch({ type: 'MODE_CHANGED', isCareer }),
    }),
    [],
  );

  return {
    year: state.year,
    items: state.items,
    aId: state.aId,
    bId: state.bId,
    itemA,
    itemB,
    isCareer: state.isCareer,
    comparison: state.comparison,
    loading: state.loading,
    error: state.error,
    actions,
  };
}
