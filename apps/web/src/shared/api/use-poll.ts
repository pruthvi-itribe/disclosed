import { useCallback, useEffect, useRef, useState } from 'react';
import { SessionEndedError, type ApiResult } from './api-get';
import { filingsQuery, type ViewName } from './filings-query';
import type { FilterState } from '../../app/filter-state';
import type { FilingView, PageMeta, SummaryView } from '../types/api';

/**
 * The poll cadence. The loop skips ticks while the tab is hidden — an
 * unattended tab polling every four seconds for a week is load on the same
 * database the poller is writing to — and fires a forced refresh the moment
 * visibility returns.
 */
export const FAST_MS = 4000;

export type LiveKind = 'connecting' | 'live' | 'stale' | 'down';

export interface PollArgs {
  readonly apiGet: <T>(
    path: string,
    current?: () => boolean,
  ) => Promise<ApiResult<T>>;
  readonly view: ViewName;
  readonly company: string | null;
  readonly filters: FilterState;
  readonly onSessionEnded: () => void;
}

export interface PollState {
  readonly filings: readonly FilingView[] | null;
  readonly meta: PageMeta | null;
  readonly summary: SummaryView | null;
  readonly live: LiveKind;
  readonly failure: string | null;
  readonly refresh: () => void;
}

interface Health {
  readonly failures: number;
  readonly everLive: boolean;
  readonly message: string | null;
}

/**
 * The old client's refresh()/loop() as one hook: summary and filings ride
 * one cycle so the two surfaces they draw can never disagree; a sequence is
 * claimed before dispatch and a superseded response is discarded whole by
 * apiGet's currency seam; a 304 sets no state, which is what keeps React
 * from touching a feed that has not changed.
 */
export const usePoll = ({
  apiGet,
  view,
  company,
  filters,
  onSessionEnded,
}: PollArgs): PollState => {
  const [filings, setFilings] = useState<readonly FilingView[] | null>(null);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [summary, setSummary] = useState<SummaryView | null>(null);
  const [health, setHealth] = useState<Health>({
    failures: 0,
    everLive: false,
    message: null,
  });
  const seqRef = useRef(0);
  // LATCHED: a session that ended is reported once. The caller reloads into
  // the landing page; reporting it every four seconds would loop the reload.
  const endedRef = useRef(false);

  const query = filingsQuery(filters, view, company);

  const refresh = useCallback(() => {
    const seq = ++seqRef.current;
    const current = (): boolean => seq === seqRef.current;

    const jobs = [
      apiGet<SummaryView>('/api/summary', current).then((result) => {
        if (result.status === 'ok') setSummary(result.body.data);
      }),
      apiGet<readonly FilingView[]>(query, current).then((result) => {
        if (result.status === 'ok') {
          setFilings(result.body.data);
          setMeta(result.body.meta as PageMeta);
        }
      }),
    ];

    Promise.all(jobs).then(
      () => {
        if (!current()) return;
        setHealth({ failures: 0, everLive: true, message: null });
      },
      (error: unknown) => {
        if (!current()) return;
        if (error instanceof SessionEndedError) {
          if (!endedRef.current) {
            endedRef.current = true;
            onSessionEnded();
          }
          return;
        }
        const text = error instanceof Error ? error.message : String(error);
        setHealth((h) => ({
          failures: h.failures + 1,
          everLive: h.everLive,
          message: `Refresh failed (${h.failures + 1} in a row): ${text}`,
        }));
      },
    );
  }, [apiGet, query, onSessionEnded]);

  // The query is in refresh's identity, so a filter, view or company change
  // refetches immediately — the old client's refresh(true) on every writer.
  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const tick = setInterval(() => {
      if (!document.hidden) refresh();
    }, FAST_MS);
    const onVisibility = (): void => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  const live: LiveKind =
    health.failures === 0
      ? health.everLive
        ? 'live'
        : 'connecting'
      : health.failures > 2
        ? 'down'
        : 'stale';

  return { filings, meta, summary, live, failure: health.message, refresh };
};
