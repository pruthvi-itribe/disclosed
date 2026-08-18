import { createApiSend } from './api-send';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

const ok = { success: true, data: { added: true }, error: null, meta: null };

describe('apiSend', () => {
  it('POSTs a JSON body to an auth route', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(ok));
    const apiSend = createApiSend(fetcher);

    await apiSend('/api/auth/login', 'POST', { email: 'a@b.c', password: 'x' });

    const [path, init] = fetcher.mock.calls[0] ?? [];
    expect(path).toBe('/api/auth/login');
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.c', password: 'x' }),
    });
  });

  // The 415 guard is a CSRF control — an HTML form cannot emit
  // application/json — and it applies to bodyless mutations too. Making the
  // header conditional on a body is what would 415 the live product.
  it('sends the JSON Content-Type on a bodyless mutation', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(ok));
    const apiSend = createApiSend(fetcher);

    await apiSend('/api/watchlist?symbol=TCS', 'POST', undefined);

    const init = fetcher.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({
      'Content-Type': 'application/json',
    });
    expect(init?.body).toBeUndefined();
  });

  it('DELETEs with the parameter in the path and no body', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(ok));
    const apiSend = createApiSend(fetcher);

    await apiSend('/api/watchlist/TCS', 'DELETE', undefined);

    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'DELETE' });
  });

  // The Watching read: no Content-Type, and deliberately NO ETag store and
  // no 304 branch — the renderer must always receive a real body. Routing
  // it through apiGet would hand it a NOT_MODIFIED sentinel it has no
  // branch for.
  it('a GET sends no Content-Type and returns the whole envelope', async () => {
    const meta = { total: 3, watching: [] };
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ ...ok, meta }));
    const apiSend = createApiSend(fetcher);

    const body = await apiSend('/api/watchlist/feed?limit=25&offset=0', 'GET');

    const init = fetcher.mock.calls[0]?.[1];
    expect(
      (init?.headers as Record<string, string>)['Content-Type'],
    ).toBeUndefined();
    expect(body.meta).toEqual(meta);
  });

  // The server's sentence is the reader's sentence; callers branch on the
  // code, never the prose.
  it('rejects with the status, code, meta and the server message', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          success: false,
          data: null,
          error: {
            code: 'WATCHLIST_FULL',
            message:
              'You are watching 50 companies, which is the limit. Remove one to add another.',
          },
          meta: { used: 50, cap: 50 },
        },
        409,
      ),
    );
    const apiSend = createApiSend(fetcher);

    await expect(
      apiSend('/api/watchlist?symbol=TCS', 'POST'),
    ).rejects.toMatchObject({
      status: 409,
      code: 'WATCHLIST_FULL',
      meta: { used: 50, cap: 50 },
      message:
        'You are watching 50 companies, which is the limit. Remove one to add another.',
    });
  });

  it('falls back to the status when the body is unparseable', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response('<html>bad gateway</html>', { status: 502 }),
      );
    const apiSend = createApiSend(fetcher);

    await expect(apiSend('/api/auth/logout', 'POST')).rejects.toMatchObject({
      message: 'That did not work (502).',
      status: 502,
    });
  });

  // A 200 whose body is not a success envelope is a failure, not a shrug.
  it('rejects a body that is not a success envelope', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ success: false, data: null, error: null }),
      );
    const apiSend = createApiSend(fetcher);

    await expect(apiSend('/api/auth/logout', 'POST')).rejects.toBeInstanceOf(
      Error,
    );
  });
});
