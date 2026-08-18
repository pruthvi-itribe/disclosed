import { act, render } from '@testing-library/react';
import { App } from './App';
import type { ApiResult } from '../shared/api/api-get';
import type { FilingView } from '../shared/types/api';

/** Shared doubles for the App specs — split when the suite hit the cap. */
export const summary = {
  todayIstDay: '2026-08-18',
  previousIstDay: '2026-08-17',
  todayCount: 4,
  todayVerified: 2,
  todayByGroup: { narrative: 4 },
  feedLagMs: 60_000,
  generatedAtIst: '2026-08-18 14:00:11',
};

export const filing = (over: Record<string, unknown> = {}): FilingView =>
  ({
    seqId: 1,
    symbol: 'INFY',
    companyName: 'Infosys',
    category: 'Updates',
    categoryGroup: 'other',
    categoryGroupLabel: 'Other',
    confidenceTier: 'verified',
    confidenceTierLabel: 'Verified',
    disseminatedAt: '2026-08-18T04:00:00.000Z',
    disseminatedAtIst: '2026-08-18 09:30:00',
    istDay: '2026-08-18',
    outcome: 'An update was filed.',
    attachmentUrl: null,
    industry: null,
    industrySource: null,
    enrichment: {
      resultsLine: null,
      results: null,
      claims: [
        {
          text: 'a fresh claim',
          echo: false,
          topic: null,
          span: 's',
          direction: null,
          directionEvidence: null,
        },
      ],
    },
    ...over,
  }) as unknown as FilingView;

export const envelope = (data: unknown, meta: unknown = null) => ({
  success: true,
  data,
  error: null,
  meta,
});

export const meta = {
  total: 1,
  limit: 25,
  offset: 0,
  returned: 1,
  hasMore: false,
};

export const okApiGet = () =>
  vi.fn((path: string): Promise<ApiResult<unknown>> =>
    Promise.resolve({
      status: 'ok',
      body:
        path === '/api/summary'
          ? envelope(summary)
          : envelope([filing()], meta),
    }),
  );

export const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

export const okApiSend = () =>
  vi.fn((path: string): Promise<unknown> => {
    if (path === '/api/me') {
      return Promise.resolve(
        envelope({
          signedIn: true,
          email: 'r@example.invalid',
          watchCount: 0,
          watchCap: 50,
          unread: 0,
          channels: [],
        }),
      );
    }
    if (path === '/api/watchlist') {
      return Promise.resolve(envelope([], { used: 0, cap: 50 }));
    }
    return Promise.resolve(envelope(null));
  });

export const renderApp = async (apiGet = okApiGet(), apiSend = okApiSend()) => {
  const view = render(
    <App
      apiGet={apiGet as never}
      apiSend={apiSend as never}
      onSessionEnded={vi.fn()}
    />,
  );
  await flush();
  return { apiGet, apiSend, ...view };
};
