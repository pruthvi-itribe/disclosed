import { createApiGet, SessionEndedError } from './api-get';
import { createEtagStore } from './etag-store';

const jsonResponse = (body: unknown, etag?: string): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: etag === undefined ? {} : { ETag: etag },
  });

const envelope = { success: true, data: [1], error: null, meta: null };

describe('apiGet', () => {
  it('sends credentials, because the session is a cookie the page cannot read', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(envelope));
    const apiGet = createApiGet(createEtagStore(), fetcher);

    await apiGet('/api/filings');

    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'include',
    });
  });

  it('returns the body and remembers a strong validator', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(envelope, '"abc"'));
    const store = createEtagStore();
    const apiGet = createApiGet(store, fetcher);

    const result = await apiGet('/api/filings');

    expect(result).toEqual({ status: 'ok', body: envelope });
    expect(store.validatorFor('/api/filings')).toBe('"abc"');
  });

  it('sends If-None-Match on the next call and reports unchanged on 304', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(envelope, '"abc"'))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const apiGet = createApiGet(createEtagStore(), fetcher);

    await apiGet('/api/filings');
    const second = await apiGet('/api/filings');

    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      headers: { 'If-None-Match': '"abc"' },
    });
    expect(second).toEqual({ status: 'unchanged' });
  });

  // A 304 answers "what you hold is current", which is only true while the
  // caller still holds this path's body. After a filter round-trip the feed's
  // one slot holds a DIFFERENT query's answer, so the caller says so and the
  // ask goes out unconditional — found live on 2026-08-18: uncheck 'Only
  // filings with verified claims', re-check it, and the feed stayed unfiltered.
  it('asks unconditionally when the caller no longer holds this body', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(envelope, '"abc"'))
      .mockResolvedValueOnce(jsonResponse(envelope, '"def"'));
    const store = createEtagStore();
    const apiGet = createApiGet(store, fetcher);

    await apiGet('/api/filings');
    const second = await apiGet('/api/filings', () => true, false);

    const headers = fetcher.mock.calls[1]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(headers['If-None-Match']).toBeUndefined();
    // The fresh answer's validator is still remembered, so the NEXT ask —
    // once the body is held again — revalidates as usual.
    expect(second).toEqual({ status: 'ok', body: envelope });
    expect(store.validatorFor('/api/filings')).toBe('"def"');
  });

  // `res.ok` is FALSE for 304. Handling it after an `!ok` guard would throw on
  // every successful revalidation, which is the single easiest way to get this
  // wrong.
  it('does not treat 304 as a failure', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 304 }));
    const apiGet = createApiGet(createEtagStore(), fetcher);

    await expect(apiGet('/api/filings')).resolves.toEqual({
      status: 'unchanged',
    });
  });

  // A session that ended under an open tab is not a pipeline fault. The caller
  // reloads into the landing page rather than painting a red banner every four
  // seconds.
  it('rejects a 401 with SessionEndedError', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 401 }));
    const apiGet = createApiGet(createEtagStore(), fetcher);

    await expect(apiGet('/api/filings')).rejects.toBeInstanceOf(
      SessionEndedError,
    );
  });

  it('throws with the status for any other failure', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('nope', { status: 500 }));
    const apiGet = createApiGet(createEtagStore(), fetcher);

    await expect(apiGet('/api/filings')).rejects.toThrow(/500/);
  });

  // Responses do not arrive in the order requests were sent. A poll dispatched
  // before a ticker click can land after it and paint the feed as that
  // company's filings; the caller claims a sequence before dispatch and this
  // drops anything no longer current.
  it('reports stale when the caller says its request was superseded', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(envelope, '"abc"'));
    const apiGet = createApiGet(createEtagStore(), fetcher);

    const result = await apiGet('/api/filings', () => false);

    expect(result).toEqual({ status: 'stale' });
  });

  it('does not remember a validator from a superseded response', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(envelope, '"abc"'));
    const store = createEtagStore();
    const apiGet = createApiGet(store, fetcher);

    await apiGet('/api/filings', () => false);

    expect(store.validatorFor('/api/filings')).toBeNull();
  });
});
