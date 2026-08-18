import { useCallback, useEffect, useState } from 'react';
import type { ApiEnvelope } from '../../shared/api/api-get';
import type { SendMethod } from '../../shared/api/api-send';
import type { WatchedCompany } from '../../shared/types/account';

export interface WatchCounts {
  readonly used: number;
  readonly cap: number;
}

export interface WatchState {
  /** A Set keyed by SYMBOL — one company files repeatedly and the star
   * belongs to the company. A Set, not a Record: the keys are
   * exchange-supplied tickers and a plain object's prototype makes
   * 'constructor' a key too. */
  readonly watched: ReadonlySet<string>;
  readonly pending: ReadonlySet<string>;
  readonly counts: WatchCounts | null;
  readonly failure: string | null;
  readonly toggle: (symbol: string) => Promise<void>;
  readonly setFromRoster: (
    rows: readonly Pick<WatchedCompany, 'symbol'>[],
    cap: number,
  ) => void;
}

/**
 * The watched set, CONFIRMED NOT OPTIMISTIC: the only immediate feedback is
 * the pending state, the set changes when the server has answered, and it
 * always equals what the server last said — every Watching poll overwrites
 * it wholesale through setFromRoster, which is what fixes a watchlist
 * changed in a second tab. The failure sentence is the server's own
 * (WATCHLIST_FULL, UNKNOWN_SYMBOL), never a client rewording.
 */
export const useWatch = ({
  apiSend,
  enabled,
}: {
  readonly apiSend: <T>(
    path: string,
    method: SendMethod,
    body?: unknown,
  ) => Promise<ApiEnvelope<T>>;
  /** Signed in. The star is absent, not disabled, without it. */
  readonly enabled: boolean;
}): WatchState => {
  const [watched, setWatched] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [counts, setCounts] = useState<WatchCounts | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    apiSend<readonly WatchedCompany[]>('/api/watchlist', 'GET').then(
      (body) => {
        setWatched(new Set(body.data.map((row) => row.symbol)));
        setCounts(body.meta as WatchCounts);
      },
      (error: unknown) => {
        const text = error instanceof Error ? error.message : String(error);
        setFailure(`Could not read your watchlist: ${text}`);
      },
    );
  }, [apiSend, enabled]);

  const toggle = useCallback(
    async (symbol: string): Promise<void> => {
      setPending((prev) => new Set(prev).add(symbol));
      const on = watched.has(symbol);
      try {
        const body = await apiSend(
          on
            ? `/api/watchlist/${encodeURIComponent(symbol)}`
            : `/api/watchlist?symbol=${encodeURIComponent(symbol)}`,
          on ? 'DELETE' : 'POST',
        );
        setWatched((prev) => {
          const next = new Set(prev);
          if (on) next.delete(symbol);
          else next.add(symbol);
          return next;
        });
        setCounts(body.meta as WatchCounts);
        setFailure(null);
      } catch (error: unknown) {
        const text = error instanceof Error ? error.message : String(error);
        setFailure(text || 'Could not change the watchlist.');
      } finally {
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(symbol);
          return next;
        });
      }
    },
    [apiSend, watched],
  );

  const setFromRoster = useCallback(
    (rows: readonly Pick<WatchedCompany, 'symbol'>[], cap: number) => {
      setWatched(new Set(rows.map((row) => row.symbol)));
      setCounts({ used: rows.length, cap });
    },
    [],
  );

  return { watched, pending, counts, failure, toggle, setFromRoster };
};
