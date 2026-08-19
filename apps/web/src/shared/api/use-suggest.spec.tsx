import { act, renderHook } from '@testing-library/react';
import { useSuggest, SUGGEST_DEBOUNCE_MS } from './use-suggest';
import type { ApiResult } from './api-get';

const answer = (
  companies: unknown[] = [],
  categories: unknown[] = [],
  groups: unknown[] = [],
) => ({
  status: 'ok' as const,
  body: {
    success: true,
    data: {
      companies,
      categories,
      groups,
      builtAtIst: '',
      companiesKnown: 954,
    },
    error: null,
    meta: null,
  },
});

const COMPANY = {
  symbol: 'BRITANNIA',
  companyName: 'Britannia Industries',
  filings: 120,
};

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('useSuggest', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const renderSuggest = (apiGet: ReturnType<typeof vi.fn>) =>
    renderHook(() => useSuggest({ apiGet: apiGet as never }));

  // A burst faster than the debounce — key repeat, a paste — coalesces
  // into one request. Real typing at ~200ms per character outruns the
  // 140ms timer; the sequence guard below handles that case.
  it('debounces a fast burst into one request', async () => {
    const apiGet = vi.fn().mockResolvedValue(answer([COMPANY]));
    const { result } = renderSuggest(apiGet);

    for (const typed of ['br', 'bri', 'brit', 'brita']) {
      act(() => result.current.onInput(typed));
    }
    expect(apiGet).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS);
    });

    expect(apiGet).toHaveBeenCalledOnce();
    expect(apiGet).toHaveBeenCalledWith('/api/suggest?q=brita');
    expect(result.current.open).toBe(true);
    expect(result.current.items[0]).toEqual({
      kind: 'company',
      value: 'BRITANNIA',
      head: 'BRITANNIA',
      name: 'Britannia Industries',
      filings: 120,
    });
    // Nothing pre-selected: pre-selecting row 0 makes Enter silently apply
    // a filter nobody chose.
    expect(result.current.active).toBe(-1);
  });

  // One character matches 87 of 954 companies on average — a list, not a
  // suggestion.
  it('asks nothing below two characters and closes', async () => {
    const apiGet = vi.fn();
    const { result } = renderSuggest(apiGet);
    act(() => result.current.onInput('b'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS);
    });
    expect(apiGet).not.toHaveBeenCalled();
    expect(result.current.open).toBe(false);
  });

  it('normalises groups with the label as the head', async () => {
    const apiGet = vi
      .fn()
      .mockResolvedValue(
        answer(
          [],
          [{ category: 'Stock Split', filings: 8 }],
          [{ group: 'capital', label: 'Capital', filings: 30 }],
        ),
      );
    const { result } = renderSuggest(apiGet);
    act(() => result.current.onInput('ca'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS);
    });
    expect(result.current.items.map((i) => `${i.kind}:${i.head}`)).toEqual([
      'category:Stock Split',
      'group:Capital',
    ]);
  });

  // Responses do not arrive in the order requests were sent; the sequence
  // guard is separate from the debounce, because ArrowDown-to-reopen
  // bypasses the timer while a debounced request may still be in flight.
  it('drops an out-of-order response', async () => {
    let resolveFirst!: (v: ApiResult<unknown>) => void;
    const apiGet = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<ApiResult<unknown>>((r) => {
            resolveFirst = r;
          }),
      )
      .mockResolvedValueOnce(answer([COMPANY]));
    const { result } = renderSuggest(apiGet);

    act(() => result.current.openNow('first'));
    act(() => result.current.openNow('second'));
    await flush();
    expect(result.current.items).toHaveLength(1);

    await act(async () => {
      resolveFirst(answer([]) as never);
      await Promise.resolve();
    });
    // The stale answer must not close or replace the newer list.
    expect(result.current.open).toBe(true);
    expect(result.current.items).toHaveLength(1);
  });

  // Never a "no matches" row — the box also searches free text, so a query
  // with no company behind it is ordinary.
  it('an empty answer closes the list', async () => {
    const apiGet = vi.fn().mockResolvedValue(answer([]));
    const { result } = renderSuggest(apiGet);
    act(() => result.current.openNow('zz'));
    await flush();
    expect(result.current.open).toBe(false);
  });

  // The one fetch on the page that never raises the banner.
  it('a failed fetch closes silently', async () => {
    const apiGet = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderSuggest(apiGet);
    act(() => result.current.openNow('br'));
    await flush();
    expect(result.current.open).toBe(false);
  });

  // Enter, Escape and blur all mean CLOSED — and closed must stick: a
  // queued debounce or an in-flight answer reopening the list over the
  // freshly filtered feed is the box overruling the reader.
  it('close() cancels a queued request', async () => {
    const apiGet = vi.fn().mockResolvedValue(answer([COMPANY]));
    const { result } = renderSuggest(apiGet);

    act(() => result.current.onInput('brita'));
    act(() => result.current.close());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS);
    });

    expect(apiGet).not.toHaveBeenCalled();
    expect(result.current.open).toBe(false);
  });

  it('an answer landing after close() stays closed', async () => {
    let resolveLate!: (v: ApiResult<unknown>) => void;
    const apiGet = vi.fn().mockImplementationOnce(
      () =>
        new Promise<ApiResult<unknown>>((r) => {
          resolveLate = r;
        }),
    );
    const { result } = renderSuggest(apiGet);

    act(() => result.current.openNow('brita'));
    act(() => result.current.close());
    await act(async () => {
      resolveLate(answer([COMPANY]) as never);
      await Promise.resolve();
    });

    expect(result.current.open).toBe(false);
  });

  it('moves the highlight with wrapping at both ends', async () => {
    const apiGet = vi
      .fn()
      .mockResolvedValue(answer([COMPANY, { ...COMPANY, symbol: 'TCS' }]));
    const { result } = renderSuggest(apiGet);
    act(() => result.current.openNow('br'));
    await flush();

    act(() => result.current.moveActive(1));
    expect(result.current.active).toBe(0);
    act(() => result.current.moveActive(-1));
    expect(result.current.active).toBe(1);
    act(() => result.current.moveActive(1));
    expect(result.current.active).toBe(0);
  });
});
