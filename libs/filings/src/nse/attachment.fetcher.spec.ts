import nock from 'nock';
import {
  ATTACHMENT_REFERER,
  AttachmentFetcher,
  MAX_ATTACHMENT_BYTES,
} from './attachment.fetcher';

const HOST = 'https://nsearchives.nseindia.com';
const PATH = '/corporate/RAILTEL_intimation.pdf';
const URL = `${HOST}${PATH}`;

const pdf = Buffer.from('%PDF-1.4 body bytes');

beforeAll(() => {
  nock.disableNetConnect();
});

afterAll(() => {
  nock.enableNetConnect();
  nock.restore();
});

afterEach(() => {
  nock.cleanAll();
});

describe('AttachmentFetcher — the happy path', () => {
  it('returns the body, its size and its content type', async () => {
    nock(HOST).get(PATH).reply(200, pdf, { 'content-type': 'application/pdf' });

    const result = await new AttachmentFetcher().fetch(URL);
    expect(result).toEqual({
      outcome: 'ok',
      body: pdf,
      bytes: pdf.length,
      contentType: 'application/pdf',
    });
  });

  it('identifies itself as a browser arriving from the NSE filings page', async () => {
    // Not decoration. The archive host served 60 sampled requests cold with
    // these headers and none without them was ever tried; the politeness is
    // treated as load-bearing until something measures otherwise.
    const scope = nock(HOST, {
      reqheaders: {
        'user-agent': /Chrome\/\d+/,
        referer: ATTACHMENT_REFERER,
      },
    })
      .get(PATH)
      .reply(200, pdf);

    const result = await new AttachmentFetcher().fetch(URL);
    expect(result.outcome).toBe('ok');
    expect(scope.isDone()).toBe(true);
  });

  it('reports a missing content-type as null rather than guessing', async () => {
    nock(HOST).get(PATH).reply(200, pdf, {});
    const result = await new AttachmentFetcher().fetch(URL);
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.contentType).toBeNull();
  });
});

describe('AttachmentFetcher — the size cap', () => {
  it('refuses a body that outgrows the cap mid-transfer', async () => {
    const cap = 64;
    nock(HOST)
      .get(PATH)
      .reply(200, Buffer.alloc(cap * 4, 0x41), {
        'content-length': String(cap * 4),
      });

    const result = await new AttachmentFetcher(cap).fetch(URL);
    expect(result.outcome).toBe('oversized');
    if (result.outcome !== 'oversized') return;
    // Null is the honest answer: axios aborts the stream, so there is no
    // response left to read a length from. What matters is that the verdict is
    // `oversized` and therefore terminal, not `failed` and therefore retried.
    expect(result.bytes === null || result.bytes === cap * 4).toBe(true);
  });

  it('refuses a body that outgrows the cap without advertising a length', async () => {
    const cap = 64;
    nock(HOST)
      .get(PATH)
      .reply(200, Buffer.alloc(cap * 4, 0x41));

    const result = await new AttachmentFetcher(cap).fetch(URL);
    expect(result.outcome).toBe('oversized');
  });

  it('accepts a body exactly at the cap', async () => {
    const cap = 64;
    nock(HOST).get(PATH).reply(200, Buffer.alloc(cap, 0x41));

    const result = await new AttachmentFetcher(cap).fetch(URL);
    expect(result.outcome).toBe('ok');
  });

  it('caps above the largest attachment NSE has been observed to publish', () => {
    // 22.2 MB was the largest in the sampled month. The cap must clear it, or
    // the worker refuses real documents.
    expect(MAX_ATTACHMENT_BYTES).toBeGreaterThan(22.2 * 1024 * 1024);
  });
});

describe('AttachmentFetcher — failures are values', () => {
  it.each([[403], [404], [429], [500], [502], [503]])(
    'reports HTTP %d with its status intact',
    async (status) => {
      // The status is what decides retry-versus-terminal. An exception would lose
      // it inside a message string.
      nock(HOST).get(PATH).reply(status, 'nope');

      const result = await new AttachmentFetcher().fetch(URL);
      expect(result.outcome).toBe('failed');
      if (result.outcome !== 'failed') return;
      expect(result.status).toBe(status);
      expect(result.message.length).toBeGreaterThan(0);
    },
  );

  it('reports a network error with a null status', async () => {
    nock(HOST)
      .get(PATH)
      .replyWithError({ code: 'ECONNRESET', message: 'reset' });

    const result = await new AttachmentFetcher().fetch(URL);
    expect(result.outcome).toBe('failed');
    if (result.outcome !== 'failed') return;
    expect(result.status).toBeNull();
  });

  it('does not follow a redirect off the archive host', async () => {
    // decideAttachment checked the host of the URL we were GIVEN. Following a
    // 302 would move the fetch to a host nothing checked.
    nock(HOST)
      .get(PATH)
      .reply(302, '', { location: 'https://example.com/a.pdf' });

    const result = await new AttachmentFetcher().fetch(URL);
    expect(result.outcome).toBe('failed');
    if (result.outcome !== 'failed') return;
    expect(result.status).toBe(302);
  });

  it('never throws, whatever the transport does', async () => {
    nock(HOST).get(PATH).replyWithError('socket hang up');
    await expect(new AttachmentFetcher().fetch(URL)).resolves.toMatchObject({
      outcome: 'failed',
    });
  });
});

describe('AttachmentFetcher — the shipped defaults', () => {
  it('caps at the shipped ceiling when none is given', async () => {
    nock(HOST).get(PATH).reply(200, Buffer.alloc(1024, 0x41));
    const result = await new AttachmentFetcher().fetch(URL);
    expect(result.outcome).toBe('ok');
  });

  it('reports a non-Error throw without losing it', async () => {
    // Not reachable through axios, but this is the last thing between a strange
    // throw and a worker that reports a fetch as having simply not happened.
    const throwing = {
      get: async () => {
        throw 'something threw a string';
      },
    } as unknown as import('axios').AxiosInstance;

    const result = await new AttachmentFetcher(1024, throwing).fetch(URL);
    expect(result).toEqual({
      outcome: 'failed',
      status: null,
      message: 'something threw a string',
    });
  });

  it('measures the buffer as well as the header', async () => {
    // Belt and braces: a transport that hands back more bytes than it
    // advertised must still be refused rather than parsed.
    const oversizedTransport = {
      get: async () => ({
        data: Buffer.alloc(4096, 0x41),
        headers: { 'content-type': 'application/pdf' },
      }),
    } as unknown as import('axios').AxiosInstance;

    const result = await new AttachmentFetcher(64, oversizedTransport).fetch(
      URL,
    );
    expect(result).toEqual({ outcome: 'oversized', bytes: 4096 });
  });
});

describe('AttachmentFetcher — how axios reports an oversized body', () => {
  /** A minimal AxiosError-shaped throw, since the version marker is what matters. */
  const axiosThrow = (
    error: Record<string, unknown>,
  ): import('axios').AxiosInstance =>
    ({
      get: async () => {
        throw { isAxiosError: true, ...error };
      },
    }) as unknown as import('axios').AxiosInstance;

  it('recognises the older ERR_FR_MAX_CONTENT_LENGTH_EXCEEDED code', async () => {
    // Matching only the CURRENT axios spelling would reclassify every oversized
    // document as a retryable transport failure: five wasted fetches of a 22 MB
    // file, then `failed` instead of `unparseable`.
    const result = await new AttachmentFetcher(
      64,
      axiosThrow({
        code: 'ERR_FR_MAX_CONTENT_LENGTH_EXCEEDED',
        message: 'too big',
        response: { headers: { 'content-length': '30000000' } },
      }),
    ).fetch(URL);

    expect(result).toEqual({ outcome: 'oversized', bytes: 30_000_000 });
  });

  it('recognises the current generic code by its message', async () => {
    const result = await new AttachmentFetcher(
      64,
      axiosThrow({
        code: 'ERR_BAD_RESPONSE',
        message: 'maxContentLength size of 64 exceeded',
      }),
    ).fetch(URL);

    expect(result).toEqual({ outcome: 'oversized', bytes: null });
  });

  it('reports a null size when the advertised length is not a number', async () => {
    const result = await new AttachmentFetcher(
      64,
      axiosThrow({
        code: 'ERR_FR_MAX_CONTENT_LENGTH_EXCEEDED',
        message: 'too big',
        response: { headers: { 'content-length': 'lots' } },
      }),
    ).fetch(URL);

    expect(result).toEqual({ outcome: 'oversized', bytes: null });
  });

  it('does not mistake an ordinary failure for an oversized one', async () => {
    const result = await new AttachmentFetcher(
      64,
      axiosThrow({
        code: 'ERR_BAD_RESPONSE',
        message: 'Request failed with status code 502',
        response: { status: 502, headers: {} },
      }),
    ).fetch(URL);

    expect(result).toMatchObject({ outcome: 'failed', status: 502 });
  });

  it('handles an axios error with no message at all', async () => {
    const result = await new AttachmentFetcher(
      64,
      axiosThrow({ code: 'ECONNABORTED' }),
    ).fetch(URL);

    expect(result).toMatchObject({ outcome: 'failed', status: null });
  });
});

describe('AttachmentFetcher — a throw that is not an axios error', () => {
  const throwing = (error: unknown): import('axios').AxiosInstance =>
    ({
      get: async () => {
        throw error;
      },
    }) as unknown as import('axios').AxiosInstance;

  it.each([
    ['an Error', new Error('the parser blew up'), 'the parser blew up'],
    ['a string', 'raw string throw', 'raw string throw'],
    ['a number', 42, '42'],
  ])('keeps the message from %s', async (_label, error, expected) => {
    const result = await new AttachmentFetcher(1024, throwing(error)).fetch(
      URL,
    );
    expect(result).toEqual({
      outcome: 'failed',
      status: null,
      message: expected,
    });
  });
});
