import { act, renderHook } from '@testing-library/react';
import { usePoll, FAST_MS } from './use-poll';
import { SessionEndedError } from './api-get';
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
