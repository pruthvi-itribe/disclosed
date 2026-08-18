/**
 * The feed's filter state and every writer's reset rule, ported from the old
 * client's `state` and its handlers. Admin-only filters (category, group,
 * tier, enrichment state, amount, refusal) do not exist here — the admin
 * surface stays server-rendered permanently — so the fields below are the
 * whole vocabulary. `q`, `symbol` gain their writers with search in Plan 3.
 */
export interface FilterState {
  readonly limit: number;
  readonly offset: number;
  readonly q: string;
  readonly symbol: string;
  readonly topic: string;
  readonly plans: boolean;
  readonly onlyInsights: boolean;
}

/**
 * onlyInsights defaults ON — the single most consequential default on the
 * page: roughly three filings in five said nothing verifiable.
 */
export const INITIAL_FILTERS: FilterState = {
  limit: 25,
  offset: 0,
  q: '',
  symbol: '',
  topic: '',
  plans: false,
  onlyInsights: true,
};

/**
 * Load more GROWS through these steps rather than paging freely: the old
 * client's admin select owns the same list, and assigning a select a value
 * it has no option for blanks it — `Number('') || DEFAULT_LIMIT` once
 * snapped a 75-row feed back to 25.
 */
export const LIMIT_STEPS: readonly number[] = [25, 50, 100, 200, 500];

export type FilterAction =
  | { readonly type: 'chip'; readonly topic: string; readonly plans: boolean }
  | { readonly type: 'onlyInsights'; readonly value: boolean }
  | { readonly type: 'grow' };

export const filterReducer = (
  state: FilterState,
  action: FilterAction,
): FilterState => {
  switch (action.type) {
    // The chip row holds two axes and exactly one chip is ever lit; every
    // click writes BOTH, which is what clears the other axis.
    case 'chip':
      return { ...state, topic: action.topic, plans: action.plans, offset: 0 };
    case 'onlyInsights':
      return { ...state, onlyInsights: action.value, offset: 0 };
    // Grows the window, keeping the offset — a feed a reader is part-way
    // down must not jump to the top. No step above the cap: no request.
    case 'grow': {
      const next = LIMIT_STEPS.find((step) => step > state.limit);
      return next === undefined ? state : { ...state, limit: next };
    }
  }
};
