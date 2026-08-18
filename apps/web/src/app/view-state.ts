import type { ViewName } from '../shared/api/filings-query';

export interface ViewState {
  readonly view: ViewName;
  readonly company: string | null;
}

export type ViewAction =
  | { readonly type: 'show'; readonly view: 'brief' | 'feed' }
  | { readonly type: 'openCompany'; readonly symbol: string };

/**
 * The landing view, read ONCE at load and never watched: swapping the view
 * under a reader who rotated their phone is worse than leaving them. 430px
 * is the widest phone viewport in common use — the feed is a three-column
 * grid whose card is 400px of text, the deck is one claim at 25px filling a
 * screen; each is default where it is right, and both tabs are on both.
 */
export const initialViewState = (): ViewState => ({
  view:
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 430px)').matches
      ? 'brief'
      : 'feed',
  company: null,
});

/**
 * showView's rule: leaving company clears the company. Every action fully
 * describes the next state, so the previous one is unread — the parameter
 * stays because useReducer's contract requires it.
 */
export const viewReducer = (
  _state: ViewState,
  action: ViewAction,
): ViewState => {
  switch (action.type) {
    case 'show':
      return { view: action.view, company: null };
    case 'openCompany':
      return { view: 'company', company: action.symbol };
  }
};
