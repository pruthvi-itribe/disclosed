import { useCallback, useEffect, useRef, useState } from 'react';
import { SessionEndedError, type ApiEnvelope, type ApiResult } from './api-get';
import { ApiSendError, type SendMethod } from './api-send';
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
  /**
   * The ETag-free read, for the Watching view alone: one authenticated
   * request per poll answers both halves of that view, and its renderer
   * must always receive a real body — never a NOT_MODIFIED sentinel.
   * Optional so the reading surfaces need no write path.
   */
  readonly apiSend?: <T>(
    path: string,
    method: SendMethod,
    body?: unknown,
  ) => Promise<ApiEnvelope<T>>;
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
interface PageSlot {
  readonly data: readonly FilingView[];
  readonly meta: PageMeta;
}

/**
 * ONE SLOT PER CONTAINER, which is the old client's shape restated in
 * state: each of the four surfaces kept its own last draw, and a 304 meant
 * "THIS container unchanged". A single shared slot re-created the bug the
 * hard way — Watching's page overwrote the feed's, the feed's refetch
 * 304'd (which sets no state), and the feed rendered Watching's data.
 * Found live at phone width on 2026-08-18.
 */
type Container = 'feed' | 'brief' | 'company' | 'watching';

export const usePoll = ({
  apiGet,
  apiSend,
  view,
  company,
  filters,
  onSessionEnded,
}: PollArgs): PollState => {
  const [pages, setPages] = useState<Partial<Record<Container, PageSlot>>>({});
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

    const watching = view === 'watching' && company === null;
    const container: Container = company !== null ? 'company' : view;
    const keep = (data: readonly FilingView[], pageMeta: PageMeta): void =>
      setPages((prev) => ({ ...prev, [container]: { data, meta: pageMeta } }));
    const filingsJob =
      watching && apiSend !== undefined
        ? apiSend<readonly FilingView[]>(
            `/api/watchlist/feed?limit=${filters.limit}&offset=0`,
            'GET',
          ).then((body) => {
            if (!current()) return;
            keep(body.data, body.meta as PageMeta);
          })
        : apiGet<readonly FilingView[]>(query, current).then((result) => {
            if (result.status === 'ok') {
              keep(result.body.data, result.body.meta as PageMeta);
            }
          });

    const jobs = [
      apiGet<SummaryView>('/api/summary', current).then((result) => {
        if (result.status === 'ok') setSummary(result.body.data);
      }),
      filingsJob,
    ];

    Promise.all(jobs).then(
      () => {
        if (!current()) return;
        setHealth({ failures: 0, everLive: true, message: null });
      },
      (error: unknown) => {
        if (!current()) return;
        // The watching feed 401s through ApiSendError rather than the
        // ETag path's SessionEndedError; both mean the same ended session.
        if (
          error instanceof SessionEndedError ||
          (error instanceof ApiSendError && error.status === 401)
        ) {
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
  }, [apiGet, apiSend, query, view, company, filters.limit, onSessionEnded]);

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

  const shown = pages[company !== null ? 'company' : view];
  return {
    filings: shown?.data ?? null,
    meta: shown?.meta ?? null,
    summary,
    live,
    failure: health.message,
    refresh,
  };
};
