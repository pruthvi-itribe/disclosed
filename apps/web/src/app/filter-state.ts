/**
 * The feed's filter state and every writer's reset rule, ported from the old
 * client's `state` and its handlers. Admin-only filters (category, group,
 * tier, enrichment state, amount, refusal) do not exist here — the admin
 * surface stays server-rendered permanently — so the fields below are the
 * whole vocabulary. `q`, `symbol` gain their writers with search in Plan 3.
 */
/** One applied suggestion, so editing the input can undo exactly it. */
export interface PickedSuggestion {
  readonly kind: 'company' | 'category' | 'group';
  /** The filter value the pick applies. */
  readonly value: string;
  /** What the input shows, and what the search note names. */
  readonly head: string;
  readonly name: string;
  readonly filings: number;
}

export interface FilterState {
  readonly limit: number;
  readonly offset: number;
  readonly q: string;
  readonly symbol: string;
  readonly category: string;
  readonly picked: PickedSuggestion | null;
  readonly topic: string;
  /**
   * The card's group tag still filters even though the feed's group CHIPS
   * were deleted (the topic axis beat them: financial 368 vs results 152).
   * The tag toggles — clicking the active group clears it.
   */
  readonly group: string;
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
  category: '',
  picked: null,
  topic: '',
  group: '',
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
  | { readonly type: 'pickGroup'; readonly group: string }
  | { readonly type: 'applySuggestion'; readonly item: PickedSuggestion }
  | { readonly type: 'submitSearch'; readonly q: string }
  | { readonly type: 'clearSearch' }
  | { readonly type: 'undoPick' }
  | { readonly type: 'grow' };

/**
 * Reverses ONLY what a pick did — company clears the symbol, category the
 * category, group the group. A blanket reset would clear a group applied
 * from a card's tag, which was never the pick's to take.
 */
const undoPicked = (state: FilterState): FilterState => {
  if (state.picked === null) return state;
  const cleared =
    state.picked.kind === 'company'
      ? { symbol: '' }
      : state.picked.kind === 'category'
        ? { category: '' }
        : { group: '' };
  return { ...state, ...cleared, picked: null };
};

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
    case 'pickGroup':
      return {
        ...state,
        group: state.group === action.group ? '' : action.group,
        offset: 0,
      };
    case 'applySuggestion': {
      const undone = undoPicked(state);
      const applied =
        action.item.kind === 'company'
          ? { symbol: action.item.value }
          : action.item.kind === 'category'
            ? { category: action.item.value }
            : { group: action.item.value };
      return {
        ...undone,
        ...applied,
        picked: action.item,
        q: '',
        offset: 0,
      };
    }
    case 'submitSearch':
      return { ...undoPicked(state), q: action.q, offset: 0 };
    case 'clearSearch':
      return { ...undoPicked(state), q: '', offset: 0 };
    // Typing invalidates a pick: reverse exactly what it did, nothing more.
    case 'undoPick':
      return undoPicked(state);
    // Grows the window, keeping the offset — a feed a reader is part-way
    // down must not jump to the top. No step above the cap: no request.
    case 'grow': {
      const next = LIMIT_STEPS.find((step) => step > state.limit);
      return next === undefined ? state : { ...state, limit: next };
    }
  }
};
