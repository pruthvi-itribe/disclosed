import { renderHook, act } from '@testing-library/react';
import { usePoll, FAST_MS } from './use-poll';
import { ApiSendError } from './api-send';
import { INITIAL_FILTERS } from '../../app/filter-state';
import {
  envelope,
  okApiGet,
  flush,
  SUMMARY,
  FILINGS,
  META,
  type AnyResult,
} from './use-poll.fixtures';

describe('the watching branch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls the watchlist feed through the ETag-free path while open', async () => {
    const apiGet = okApiGet();
    const apiSend = vi.fn().mockResolvedValue({
      success: true,
      data: FILINGS,
      error: null,
      meta: { ...META, unread: 0, watching: [{ symbol: 'TCS' }] },
    });
    // Hoisted: an inline vi.fn() would be a NEW function on every render,
    // churning refresh's identity and looping the mount effect forever.
    const onSessionEnded = vi.fn();
    const { result } = renderHook(() =>
      usePoll({
        apiGet: apiGet as never,
        apiSend: apiSend as never,
        view: 'watching',
        company: null,
        filters: INITIAL_FILTERS,
        onSessionEnded,
      }),
    );
    await flush();

    // One authenticated read per poll, both halves from one response — and
    // the summary still rides the same cycle.
    expect(apiSend).toHaveBeenCalledWith(
      '/api/watchlist/feed?limit=25&offset=0',
      'GET',
    );
    expect(apiGet.mock.calls.map((c) => c[0])).toContain('/api/summary');
    expect(
      apiGet.mock.calls.some((c) => String(c[0]).startsWith('/api/filings')),
    ).toBe(false);
    expect(result.current.filings).toEqual(FILINGS);
    expect((result.current.meta as { watching?: unknown }).watching).toEqual([
      { symbol: 'TCS' },
    ]);
  });

  // The feed's Load more grows the shared limit through 500, but the
  // watchlist feed's bounds reader THROWS at 201 rather than clamping —
  // sending the grown limit unclamped 400s every poll and kills the
  // Watching view for the whole session.
  it('clamps the grown feed limit to the server cap of 200', async () => {
    const apiGet = okApiGet();
    const apiSend = vi.fn().mockResolvedValue({
      success: true,
      data: FILINGS,
      error: null,
      meta: { ...META, unread: 0, watching: [] },
    });
    const onSessionEnded = vi.fn();
    renderHook(() =>
      usePoll({
        apiGet: apiGet as never,
        apiSend: apiSend as never,
        view: 'watching',
        company: null,
        filters: { ...INITIAL_FILTERS, limit: 500 },
        onSessionEnded,
      }),
    );
    await flush();

    expect(apiSend).toHaveBeenCalledWith(
      '/api/watchlist/feed?limit=200&offset=0',
      'GET',
    );
  });

  it('a 401 from the watching feed ends the session once', async () => {
    const onSessionEnded = vi.fn();
    const apiGet = okApiGet();
    const apiSend = vi
      .fn()
      .mockRejectedValue(
        new ApiSendError('Sign in to use this.', 401, 'UNAUTHENTICATED', null),
      );
    renderHook(() =>
      usePoll({
        apiGet: apiGet as never,
        apiSend: apiSend as never,
        view: 'watching',
        company: null,
        filters: INITIAL_FILTERS,
        onSessionEnded,
      }),
    );
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FAST_MS);
    });

    expect(onSessionEnded).toHaveBeenCalledOnce();
  });
});

describe('per-container data slots', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // The old client kept each container's last draw and a 304 meant "THIS
  // container unchanged". One shared slot re-created the bug the hard way:
  // Watching's page overwrote the feed's, the feed's refetch 304'd (which
  // sets no state), and the feed rendered Watching's data — an empty feed
  // on an account watching nothing. Found live at phone width, 2026-08-18.
  it('a 304 after a view switch keeps THAT view s data, not the last view s', async () => {
    const onSessionEnded = vi.fn();
    const WATCH_ITEMS: unknown[] = [];
    const apiGet = vi.fn((path: string): AnyResult => {
      if (path === '/api/summary') {
        return Promise.resolve({ status: 'ok', body: envelope(SUMMARY) });
      }
      // First feed fetch answers data; the refetch after the round trip
      // through Watching answers 304.
      const feedCalls = apiGet.mock.calls.filter((c) =>
        String(c[0]).startsWith('/api/filings'),
      ).length;
      if (feedCalls > 1) return Promise.resolve({ status: 'unchanged' });
      return Promise.resolve({ status: 'ok', body: envelope(FILINGS, META) });
    });
    const apiSend = vi.fn().mockResolvedValue({
      success: true,
      data: WATCH_ITEMS,
      error: null,
      meta: { ...META, total: 0, returned: 0, unread: 0, watching: [] },
    });
    const onEnded = onSessionEnded;
    const { result, rerender } = renderHook(
      (props: { view: 'feed' | 'watching' }) =>
        usePoll({
          apiGet: apiGet as never,
          apiSend: apiSend as never,
          view: props.view,
          company: null,
          filters: INITIAL_FILTERS,
          onSessionEnded: onEnded,
        }),
      { initialProps: { view: 'feed' as 'feed' | 'watching' } },
    );
    await flush();
    expect(result.current.filings).toEqual(FILINGS);

    rerender({ view: 'watching' });
    await flush();
    expect(result.current.filings).toEqual(WATCH_ITEMS);

    rerender({ view: 'feed' });
    await flush();
    await flush();
    // The refetch 304'd — the FEED's slot must still hold the feed's items.
    expect(result.current.filings).toEqual(FILINGS);
    expect(result.current.meta).toEqual(META);
  });
});
