import { act, renderHook } from '@testing-library/react';
import { usePoll, FAST_MS } from './use-poll';
import { SessionEndedError, type ApiResult } from './api-get';
import { ApiSendError } from './api-send';
import { INITIAL_FILTERS } from '../../app/filter-state';

const envelope = <T,>(data: T, meta: unknown = null) => ({
  success: true,
  data,
  error: null,
  meta,
});

const SUMMARY = { totalFilings: 11918, todayIstDay: '2026-08-18' };
const FILINGS = [{ seqId: 1 }, { seqId: 2 }];
const META = { total: 2, offset: 0, returned: 2, hasMore: false };

type AnyResult = Promise<ApiResult<unknown>>;

// The unused `current` parameter widens the mock's call tuple so the
// currency-check test can read calls[n][1].
const okApiGet = () =>
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  vi.fn((path: string, _current?: () => boolean): AnyResult => {
    if (path === '/api/summary') {
      return Promise.resolve({ status: 'ok', body: envelope(SUMMARY) });
    }
    return Promise.resolve({ status: 'ok', body: envelope(FILINGS, META) });
  });

const renderPoll = (
  apiGet: ReturnType<typeof okApiGet>,
  onSessionEnded = vi.fn(),
) =>
  renderHook(
    (props: { filters: typeof INITIAL_FILTERS }) =>
      usePoll({
        apiGet: apiGet as never,
        view: 'feed',
        company: null,
        filters: props.filters,
        onSessionEnded,
      }),
    { initialProps: { filters: INITIAL_FILTERS } },
  );

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('usePoll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches the summary and the filings in one cycle on mount', async () => {
    const apiGet = okApiGet();
    const { result } = renderPoll(apiGet);
    await flush();

    const paths = apiGet.mock.calls.map((c) => c[0]);
    expect(paths).toContain('/api/summary');
    expect(paths).toContain('/api/filings?limit=25&offset=0&tier=verified');
    expect(result.current.filings).toEqual(FILINGS);
    expect(result.current.meta).toEqual(META);
    expect(result.current.summary).toEqual(SUMMARY);
    expect(result.current.live).toBe('live');
  });

  it('starts connecting, before anything has answered', () => {
    const apiGet = okApiGet();
    const { result } = renderPoll(apiGet);
    expect(result.current.live).toBe('connecting');
  });

  it('polls again after four seconds', async () => {
    const apiGet = okApiGet();
    renderPoll(apiGet);
    await flush();
    const before = apiGet.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FAST_MS);
    });
    expect(apiGet.mock.calls.length).toBe(before + 2);
  });

  // An unattended tab polling every four seconds for a week is load on the
  // same database the poller is writing to.
  it('does not poll while the tab is hidden, and refreshes on return', async () => {
    const apiGet = okApiGet();
    renderPoll(apiGet);
    await flush();
    const before = apiGet.mock.calls.length;

    Object.defineProperty(document, 'hidden', {
      value: true,
      configurable: true,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * FAST_MS);
    });
    expect(apiGet.mock.calls.length).toBe(before);

    Object.defineProperty(document, 'hidden', {
      value: false,
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();
    expect(apiGet.mock.calls.length).toBe(before + 2);
  });

  it('refetches immediately when the filters change', async () => {
    const apiGet = okApiGet();
    const { rerender } = renderPoll(apiGet);
    await flush();

    rerender({ filters: { ...INITIAL_FILTERS, topic: 'dividend' } });
    await flush();

    const paths = apiGet.mock.calls.map((c) => c[0]);
    expect(paths).toContain(
      '/api/filings?limit=25&offset=0&tier=verified&topic=dividend',
    );
  });

  // A 304 keeps what the page has: no new state, no re-render of the cards.
  it('keeps the same data objects across an unchanged poll', async () => {
    const apiGet = vi.fn((path: string): AnyResult => {
      if (path === '/api/summary') {
        return Promise.resolve({ status: 'ok', body: envelope(SUMMARY) });
      }
      if (apiGet.mock.calls.filter((c) => c[0] !== '/api/summary').length > 1) {
        return Promise.resolve({ status: 'unchanged' });
      }
      return Promise.resolve({ status: 'ok', body: envelope(FILINGS, META) });
    });
    const { result } = renderPoll(apiGet as ReturnType<typeof okApiGet>);
    await flush();
    const first = result.current.filings;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FAST_MS);
    });
    expect(result.current.filings).toBe(first);
    expect(result.current.live).toBe('live');
  });

  // Responses do not arrive in the order requests were sent; the sequence is
  // claimed before dispatch and a superseded request's current() reads false.
  it('hands apiGet a currency check that expires on the next refresh', async () => {
    const apiGet = okApiGet();
    const { result } = renderPoll(apiGet);
    await flush();

    const firstCurrent = apiGet.mock.calls[0]?.[1];
    expect(firstCurrent?.()).toBe(true);

    act(() => {
      result.current.refresh();
    });
    expect(firstCurrent?.()).toBe(false);
    await flush();
  });

  it('climbs stale to down as failures accumulate, and recovers', async () => {
    let failing = true;
    const apiGet = vi.fn((path: string): AnyResult => {
      if (failing) return Promise.reject(new Error('boom'));
      if (path === '/api/summary') {
        return Promise.resolve({ status: 'ok', body: envelope(SUMMARY) });
      }
      return Promise.resolve({ status: 'ok', body: envelope(FILINGS, META) });
    });
    const { result } = renderPoll(apiGet as ReturnType<typeof okApiGet>);
    await flush();

    expect(result.current.live).toBe('stale');
    expect(result.current.failure).toBe('Refresh failed (1 in a row): boom');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FAST_MS);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FAST_MS);
    });
    expect(result.current.live).toBe('down');
    expect(result.current.failure).toBe('Refresh failed (3 in a row): boom');

    failing = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FAST_MS);
    });
    expect(result.current.live).toBe('live');
    expect(result.current.failure).toBeNull();
  });

  // A session that ended under an open tab is handed to the caller ONCE —
  // the latch is what stops a reload loop.
  it('reports a session that ended exactly once', async () => {
    const onSessionEnded = vi.fn();
    const apiGet = vi.fn((): AnyResult =>
      Promise.reject(new SessionEndedError()),
    );
    renderPoll(apiGet as ReturnType<typeof okApiGet>, onSessionEnded);
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FAST_MS);
    });

    expect(onSessionEnded).toHaveBeenCalledOnce();
  });
});

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
