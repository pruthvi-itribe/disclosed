import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiResult } from '../../shared/api/api-get';
import type { SuggestionsView } from '../../shared/types/api';
import type { PickedSuggestion } from '../../app/filter-state';

/**
 * Coalesces only bursts FASTER than 140ms — key repeat, a paste, an IME
 * commit. A fluent typist's ~200ms-per-character cadence outruns it, so
 * most keystrokes still fire their own request; the sequence counter, not
 * this timer, is what keeps the answers ordered. 140ms reads as instant,
 * 400ms reads as slow.
 */
export const SUGGEST_DEBOUNCE_MS = 140;

/**
 * Over 954 companies one letter matches 87 on average and 253 at worst; two
 * letters match 8 on average. One character is a list, not a suggestion.
 */
export const SUGGEST_MIN = 2;

export type SuggestItem = PickedSuggestion;

export interface SuggestState {
  readonly items: readonly SuggestItem[];
  readonly open: boolean;
  /** -1 means "nothing highlighted, Enter searches the typed text". */
  readonly active: number;
  readonly onInput: (typed: string) => void;
  /** ArrowDown's reopen: immediate, bypassing the debounce. */
  readonly openNow: (typed: string) => void;
  readonly close: () => void;
  readonly moveActive: (delta: number) => void;
  readonly setActive: (index: number) => void;
}

/**
 * The type-ahead: a debounce collapsing keystrokes AND a sequence counter
 * dropping out-of-order responses — two separate guards, because the reopen
 * path bypasses the timer while a debounced request may still be in flight.
 * The catch is deliberately silent (close, never a banner): this is the one
 * fetch on the page whose failure a reader routes around by just typing.
 * An empty answer closes the list rather than drawing a "no matches" row —
 * the box also searches free text, so a query with no company behind it is
 * ordinary.
 */
export const useSuggest = ({
  apiGet,
}: {
  readonly apiGet: <T>(path: string) => Promise<ApiResult<T>>;
}): SuggestState => {
  const [items, setItems] = useState<readonly SuggestItem[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActiveState] = useState(-1);
  const seqRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const close = useCallback(() => {
    // Closed must STICK: cancel the queued debounce and invalidate any
    // in-flight answer, or a keystroke's request fires after Enter,
    // Escape or blur and pops the list back open over the freshly
    // filtered feed.
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    seqRef.current += 1;
    setOpen(false);
    setActiveState(-1);
  }, []);

  const request = useCallback(
    (typed: string) => {
      const trimmed = typed.trim();
      if (trimmed.length < SUGGEST_MIN) {
        close();
        return;
      }
      const mine = ++seqRef.current;
      apiGet<SuggestionsView>(
        `/api/suggest?q=${encodeURIComponent(trimmed)}`,
      ).then(
        (result) => {
          if (mine !== seqRef.current) return;
          if (result.status !== 'ok') return;
          const data = result.body.data;
          const next: SuggestItem[] = [
            ...data.companies.map((row) => ({
              kind: 'company' as const,
              value: row.symbol,
              head: row.symbol,
              name: row.companyName,
              filings: row.filings,
            })),
            ...data.categories.map((row) => ({
              kind: 'category' as const,
              value: row.category,
              head: row.category,
              name: '',
              filings: row.filings,
            })),
            ...data.groups.map((row) => ({
              kind: 'group' as const,
              value: row.group,
              head: row.label,
              name: '',
              filings: row.filings,
            })),
          ];
          if (next.length === 0) {
            close();
            return;
          }
          setItems(next);
          setOpen(true);
          // Nothing pre-selected: pre-selecting row 0 makes Enter silently
          // apply a filter nobody chose.
          setActiveState(-1);
        },
        () => {
          if (mine !== seqRef.current) return;
          close();
        },
      );
    },
    [apiGet, close],
  );

  const onInput = useCallback(
    (typed: string) => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(
        () => request(typed),
        SUGGEST_DEBOUNCE_MS,
      );
    },
    [request],
  );

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const moveActive = useCallback(
    (delta: number) => {
      if (!open || items.length === 0) return;
      setActiveState((at) => {
        const next = at + delta;
        // Wraps at both ends — the list is at most 11 rows.
        if (next < 0) return items.length - 1;
        if (next >= items.length) return 0;
        return next;
      });
    },
    [open, items.length],
  );

  return {
    items,
    open,
    active,
    onInput,
    openNow: request,
    close,
    moveActive,
    setActive: setActiveState,
  };
};
