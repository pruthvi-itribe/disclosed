import { act, renderHook } from '@testing-library/react';
import { useWatch } from './use-watch';
import { ApiSendError } from '../../shared/api/api-send';

const envelope = (data: unknown, meta: unknown = null) => ({
  success: true,
  data,
  error: null,
  meta,
});

const ROWS = [{ symbol: 'TCS' }, { symbol: 'ESAF' }];

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const renderWatch = (apiSend: ReturnType<typeof vi.fn>, enabled = true) =>
  renderHook(
    (props: { enabled: boolean }) =>
      useWatch({ apiSend: apiSend as never, enabled: props.enabled }),
    { initialProps: { enabled } },
  );

describe('useWatch', () => {
  it('loads the watchlist once signed in, keyed by symbol', async () => {
    const apiSend = vi
      .fn()
      .mockResolvedValue(envelope(ROWS, { used: 2, cap: 50 }));
    const { result } = renderWatch(apiSend);
    await flush();

    expect(apiSend).toHaveBeenCalledWith('/api/watchlist', 'GET');
    expect(result.current.watched.has('TCS')).toBe(true);
    expect(result.current.watched.has('INFY')).toBe(false);
    expect(result.current.counts).toEqual({ used: 2, cap: 50 });
  });

  it('loads nothing while signed out', async () => {
    const apiSend = vi.fn();
    renderWatch(apiSend, false);
    await flush();
    expect(apiSend).not.toHaveBeenCalled();
  });

  it('a failed load is reported in the old words', async () => {
    const apiSend = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderWatch(apiSend);
    await flush();
    expect(result.current.failure).toBe('Could not read your watchlist: boom');
  });

  // CONFIRMED, NOT OPTIMISTIC: the only immediate feedback is the pending
  // (disabled) state, and the set changes when the server has answered —
  // watched always equals what the server last said.
  it('watching a company is a bodyless POST with the symbol in the query', async () => {
    const apiSend = vi
      .fn()
      .mockResolvedValue(envelope([], { used: 0, cap: 50 }));
    const { result } = renderWatch(apiSend);
    await flush();

    apiSend.mockResolvedValueOnce(envelope(null, { used: 1, cap: 50 }));
    await act(async () => {
      await result.current.toggle('M&M');
    });

    expect(apiSend).toHaveBeenCalledWith('/api/watchlist?symbol=M%26M', 'POST');
    expect(result.current.watched.has('M&M')).toBe(true);
    expect(result.current.counts).toEqual({ used: 1, cap: 50 });
  });

  it('unwatching DELETEs with the symbol in the path', async () => {
    const apiSend = vi
      .fn()
      .mockResolvedValue(envelope(ROWS, { used: 2, cap: 50 }));
    const { result } = renderWatch(apiSend);
    await flush();

    apiSend.mockResolvedValueOnce(envelope(null, { used: 1, cap: 50 }));
    await act(async () => {
      await result.current.toggle('TCS');
    });

    expect(apiSend).toHaveBeenCalledWith('/api/watchlist/TCS', 'DELETE');
    expect(result.current.watched.has('TCS')).toBe(false);
  });

  it('marks the symbol pending while the server is deciding', async () => {
    const apiSend = vi
      .fn()
      .mockResolvedValue(envelope([], { used: 0, cap: 50 }));
    const { result } = renderWatch(apiSend);
    await flush();

    let resolve!: (v: unknown) => void;
    apiSend.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    let done: Promise<void>;
    act(() => {
      done = result.current.toggle('TCS');
    });
    expect(result.current.pending.has('TCS')).toBe(true);

    await act(async () => {
      resolve(envelope(null, { used: 1, cap: 50 }));
      await done;
    });
    expect(result.current.pending.has('TCS')).toBe(false);
  });

  // The server's sentence is the reader's sentence — WATCHLIST_FULL and
  // UNKNOWN_SYMBOL are the two a reader must see, unreworded.
  it('a refused toggle shows the server sentence and changes nothing', async () => {
    const apiSend = vi
      .fn()
      .mockResolvedValue(envelope([], { used: 50, cap: 50 }));
    const { result } = renderWatch(apiSend);
    await flush();

    apiSend.mockRejectedValueOnce(
      new ApiSendError(
        'You are watching 50 companies, which is the limit. Remove one to add another.',
        409,
        'WATCHLIST_FULL',
        { used: 50, cap: 50 },
      ),
    );
    await act(async () => {
      await result.current.toggle('TCS');
    });

    expect(result.current.watched.has('TCS')).toBe(false);
    expect(result.current.failure).toBe(
      'You are watching 50 companies, which is the limit. Remove one to add another.',
    );
    expect(result.current.pending.has('TCS')).toBe(false);
  });

  // The set always equals what the server LAST said — which makes response
  // order the thing that matters: a slow initial load resolving after a
  // confirmed toggle is older than the toggle, and applying it wholesale
  // unfills a star the server holds filled.
  it('a slow initial load never overwrites a confirmed toggle', async () => {
    let resolveLoad!: (v: unknown) => void;
    const apiSend = vi.fn().mockReturnValueOnce(
      new Promise((r) => {
        resolveLoad = r;
      }),
    );
    const { result } = renderWatch(apiSend);
    await flush();

    apiSend.mockResolvedValueOnce(envelope(null, { used: 1, cap: 50 }));
    await act(async () => {
      await result.current.toggle('TCS');
    });
    expect(result.current.watched.has('TCS')).toBe(true);

    await act(async () => {
      resolveLoad(envelope([], { used: 0, cap: 50 }));
    });
    expect(result.current.watched.has('TCS')).toBe(true);
    expect(result.current.counts).toEqual({ used: 1, cap: 50 });
  });

  // The poll clears the shared banner on every healthy cycle, the way the
  // old page's clearError() did — this is the hook-side half.
  it('clearFailure wipes the sentence', async () => {
    const apiSend = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderWatch(apiSend);
    await flush();
    expect(result.current.failure).not.toBeNull();

    act(() => {
      result.current.clearFailure();
    });
    expect(result.current.failure).toBeNull();
  });

  // Every Watching poll overwrites the set wholesale — the response is the
  // single source of truth, which is what fixes a second tab's changes.
  it('setFromRoster replaces the set and the counts', async () => {
    const apiSend = vi
      .fn()
      .mockResolvedValue(envelope(ROWS, { used: 2, cap: 50 }));
    const { result } = renderWatch(apiSend);
    await flush();

    act(() => {
      result.current.setFromRoster([{ symbol: 'INFY' }] as never, 50);
    });
    expect(result.current.watched.has('INFY')).toBe(true);
    expect(result.current.watched.has('TCS')).toBe(false);
    expect(result.current.counts).toEqual({ used: 1, cap: 50 });
  });
});
