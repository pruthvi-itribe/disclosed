import { act, fireEvent, render } from '@testing-library/react';
import { App } from './App';
import { FAST_MS } from '../shared/api/use-poll';
import type { ApiResult } from '../shared/api/api-get';
import type { FilingView } from '../shared/types/api';

/**
 * The shell: three views behind one poll, exactly one visible. Replaces
 * Plan 1's status-line App and its spec.
 */
const summary = {
  todayIstDay: '2026-08-18',
  previousIstDay: '2026-08-17',
  todayCount: 4,
  todayVerified: 2,
  todayByGroup: { narrative: 4 },
  feedLagMs: 60_000,
  generatedAtIst: '2026-08-18 14:00:11',
};

const filing = (over: Record<string, unknown> = {}): FilingView =>
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

const envelope = (data: unknown, meta: unknown = null) => ({
  success: true,
  data,
  error: null,
  meta,
});

const meta = { total: 1, limit: 25, offset: 0, returned: 1, hasMore: false };

const okApiGet = () =>
  vi.fn((path: string): Promise<ApiResult<unknown>> =>
    Promise.resolve({
      status: 'ok',
      body:
        path === '/api/summary'
          ? envelope(summary)
          : envelope([filing()], meta),
    }),
  );

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const okApiSend = () =>
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

const renderApp = async (apiGet = okApiGet(), apiSend = okApiSend()) => {
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

describe('App', () => {
  it('lands on the feed above 430px with exactly one view visible', async () => {
    const { container } = await renderApp();
    expect((container.querySelector('#view-feed') as HTMLElement).hidden).toBe(
      false,
    );
    expect((container.querySelector('#view-brief') as HTMLElement).hidden).toBe(
      true,
    );
    expect(container.querySelector('#view-company')).toBeNull();
    expect(container.querySelectorAll('[data-ui="card"]')).toHaveLength(1);
    expect(container.querySelector('#tab-feed')?.className).toBe('tab active');
  });

  it('switches to the Brief, asks its question, and locks the body', async () => {
    const { container, apiGet } = await renderApp();
    fireEvent.click(container.querySelector('#tab-brief') as Element);
    await flush();

    expect((container.querySelector('#view-brief') as HTMLElement).hidden).toBe(
      false,
    );
    expect(document.body.className).toBe('briefing');
    // Every tab switch costs a round trip: the deck asks the server a
    // different question than the feed does.
    expect(apiGet.mock.calls.map((c) => c[0])).toContain(
      '/api/filings?tier=verified&offset=0&limit=200',
    );

    fireEvent.click(container.querySelector('#tab-feed') as Element);
    await flush();
    expect(document.body.className).toBe('');
  });

  it('a ticker opens the company view and no tab is lit', async () => {
    const { container, apiGet } = await renderApp();
    fireEvent.click(container.querySelector('button.sym') as Element);
    await flush();

    expect(container.querySelector('#view-company')).not.toBeNull();
    expect(container.querySelector('#co-symbol')?.textContent).toBe('INFY');
    expect(container.querySelector('.tab.active')).toBeNull();
    expect(apiGet.mock.calls.map((c) => c[0])).toContain(
      '/api/filings?limit=200&offset=0&symbol=INFY',
    );

    fireEvent.click(container.querySelector('#company-back') as Element);
    await flush();
    expect(container.querySelector('#view-company')).toBeNull();
    expect((container.querySelector('#view-feed') as HTMLElement).hidden).toBe(
      false,
    );
  });

  it('a card opens the focus dialog and Escape closes it', async () => {
    const { container } = await renderApp();
    fireEvent.click(container.querySelector('[data-ui="card"]') as Element);
    expect(document.querySelector('[data-ui="focus-card"]')).not.toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('[data-ui="focus-card"]')).toBeNull();
  });

  // Never swallowed: a page that silently stops updating is worse than one
  // that says it stopped, because the stale numbers still read as current.
  it('shows the failure banner when the poll fails', async () => {
    const failing = vi.fn((): Promise<ApiResult<unknown>> =>
      Promise.reject(new Error('502')),
    );
    const { container } = await renderApp(failing as never);
    const alert = container.querySelector('#alert') as HTMLElement;
    expect(alert.hidden).toBe(false);
    expect(alert.textContent).toBe('Refresh failed (1 in a row): 502');
  });

  // use-me.ts promises the failed sign-out's sentence is "cleared by the
  // next successful poll" — this is the wiring that keeps that promise.
  // Without it one transient 502 stayed red all session.
  it('a healthy poll clears a stale account failure', async () => {
    vi.useFakeTimers();
    try {
      const apiSend = okApiSend();
      const { container } = await renderApp(okApiGet(), apiSend);

      apiSend.mockRejectedValueOnce(new Error('Something went wrong.'));
      fireEvent.click(container.querySelector('#signout') as Element);
      await flush();
      const alert = container.querySelector('#alert') as HTMLElement;
      expect(alert.textContent).toBe('Something went wrong.');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(FAST_MS);
      });
      expect(alert.hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the Watching tab', () => {
  it('survives the switch while the feed meta is still current', async () => {
    // The regression: opening Watching hands the view the FEED's meta —
    // which carries no roster — until the watchlist response lands. The
    // view must see null, not a meta of the wrong shape.
    const apiSend = vi.fn((path: string): Promise<unknown> => {
      if (path === '/api/me') {
        return Promise.resolve(
          envelope({
            signedIn: true,
            email: 'r@example.invalid',
            watchCount: 1,
            watchCap: 50,
            unread: 2,
            channels: [],
          }),
        );
      }
      if (path.startsWith('/api/watchlist/feed')) {
        return Promise.resolve(
          envelope([filing()], {
            ...meta,
            unread: 0,
            watching: [
              {
                symbol: 'INFY',
                companyName: 'Infosys',
                addedAt: 'x',
                addedAtIst: 'x',
                filingsHeld: 1,
                lastFiledAt: null,
                lastFiledAtIst: null,
              },
            ],
          }),
        );
      }
      return Promise.resolve(envelope([], { used: 0, cap: 50 }));
    });
    const okGet = okApiGet();
    const { container } = await renderApp(okGet, apiSend as never);

    fireEvent.click(container.querySelector('#tab-watching') as Element);
    await flush();
    await flush();

    expect(
      (container.querySelector('#view-watching') as HTMLElement).hidden,
    ).toBe(false);
    expect(apiSend.mock.calls.map((c) => c[0])).toContain(
      '/api/watchlist/feed?limit=25&offset=0',
    );
    expect(
      container
        .querySelector('[data-ui="watching-row"]')
        ?.getAttribute('data-symbol'),
    ).toBe('INFY');
  });
});
