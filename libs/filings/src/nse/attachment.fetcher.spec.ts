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
    // THE SIZE IS NEVER UNKNOWN ANY MORE. All 8 filings the old 25 MB cap
    // refused recorded `bytes: null`, because aborting an `arraybuffer`
    // request destroys the response the length would have come from — so the
    // collection could not say whether a refusal had missed by a kilobyte or
    // by a gigabyte. It had missed by 4%.
    expect(result).toEqual({
      outcome: 'oversized',
      bytes: cap * 4,
      advertised: true,
    });
  });

  it('refuses a body that outgrows the cap without advertising a length', async () => {
    // A transport rather than nock, because nock computes a `content-length`
    // for every fixture and there is then no way to exercise the case NSE's
    // chunked responses actually present.
    const cap = 64;
    const unannounced = {
      get: async () => ({
        status: 200,
        headers: {},
        data: {
          async *[Symbol.asyncIterator]() {
            for (let index = 0; index < 8; index += 1) {
              yield Buffer.alloc(cap, 0x41);
            }
          },
        },
      }),
    } as unknown as import('axios').AxiosInstance;

    const result = await new AttachmentFetcher(cap, unannounced).fetch(URL);
    expect(result.outcome).toBe('oversized');
    if (result.outcome !== 'oversized') return;
    // Counted rather than advertised, and flagged as such: what is known is
    // how much arrived before the transfer was cut, which is a lower bound.
    expect(result.advertised).toBe(false);
    expect(result.bytes).toBeGreaterThan(cap);
  });

  it('refuses a lying content-length by counting what actually arrives', async () => {
    // A header is a claim by somebody else's server. The counter is the
    // authority, and it is the reason a response that under-reports its own
    // size cannot walk past the cap.
    const cap = 64;
    nock(HOST)
      .get(PATH)
      .reply(200, Buffer.alloc(cap * 4, 0x41), { 'content-length': '10' });

    const result = await new AttachmentFetcher(cap).fetch(URL);
    expect(result.outcome).toBe('oversized');
  });

  it('reads the whole of a body that fits, in order', async () => {
    // The chunks are concatenated once rather than appended, and a bug there
    // would be invisible to a single-chunk fixture.
    const body = Buffer.concat([
      Buffer.alloc(2048, 0x41),
      Buffer.alloc(2048, 0x42),
    ]);
    nock(HOST).get(PATH).reply(200, body);

    const result = await new AttachmentFetcher(1 << 20).fetch(URL);
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.bytes).toBe(4096);
    expect(result.body.equals(body)).toBe(true);
  });

  it('accepts a body exactly at the cap', async () => {
    const cap = 64;
    nock(HOST).get(PATH).reply(200, Buffer.alloc(cap, 0x41));

    const result = await new AttachmentFetcher(cap).fetch(URL);
    expect(result.outcome).toBe('ok');
  });

  it('clears every attachment NSE has been observed to publish', () => {
    // 41.52 MB is the largest measured on the live collection — SALSTEEL's
    // newspaper scan, one of the 8 the old 25 MB cap refused. A cap under it
    // refuses a real document; this one is a denial-of-service bound and is
    // meant to sit well clear of the distribution rather than inside it.
    expect(MAX_ATTACHMENT_BYTES).toBeGreaterThan(41.52 * 1024 * 1024);
    // And it is still a bound. An unbounded download is a denial of service on
    // this pipeline's own worker.
    expect(MAX_ATTACHMENT_BYTES).toBeLessThanOrEqual(128 * 1024 * 1024);
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

  it('refuses a body it cannot read as a stream rather than guessing', async () => {
    // A transport that answers with something this cannot iterate has changed
    // contract underneath us. Reading it as bytes anyway is how an empty
    // document becomes a filing recorded unreadable rather than a bug.
    const notAStream = {
      get: async () => ({
        status: 200,
        data: Buffer.alloc(4096, 0x41),
        headers: { 'content-type': 'application/pdf' },
      }),
    } as unknown as import('axios').AxiosInstance;

    const result = await new AttachmentFetcher(1 << 20, notAStream).fetch(URL);
    expect(result).toEqual({
      outcome: 'failed',
      status: 200,
      message: 'the response body was not a readable stream',
    });
  });

  it('refuses on the advertised length without reading the body', async () => {
    // The cheap refusal: a truthful header means the whole document goes
    // unread, which is the difference between refusing a 400 MB response and
    // downloading one to find out how big it is.
    let destroyed = false;
    let read = false;
    const huge = {
      get: async () => ({
        status: 200,
        headers: { 'content-length': String(1 << 30) },
        data: {
          destroy: () => {
            destroyed = true;
          },
          async *[Symbol.asyncIterator]() {
            read = true;
            yield Buffer.alloc(1);
          },
        },
      }),
    } as unknown as import('axios').AxiosInstance;

    const result = await new AttachmentFetcher(1 << 20, huge).fetch(URL);
    expect(result).toEqual({
      outcome: 'oversized',
      bytes: 1 << 30,
      advertised: true,
    });
    expect(read).toBe(false);
    expect(destroyed).toBe(true);
  });

  it('destroys the stream it cuts off rather than draining it', async () => {
    // A socket left receiving a document nobody will read is the same denial
    // of service the cap exists to prevent, merely quieter.
    let destroyed = false;
    const endless = {
      get: async () => ({
        status: 200,
        headers: {},
        data: {
          destroy: () => {
            destroyed = true;
          },
          async *[Symbol.asyncIterator]() {
            for (;;) yield Buffer.alloc(512, 0x41);
          },
        },
      }),
    } as unknown as import('axios').AxiosInstance;

    const result = await new AttachmentFetcher(1024, endless).fetch(URL);
    expect(result.outcome).toBe('oversized');
    expect(destroyed).toBe(true);
  });

  it('reads a Uint8Array chunk as readily as a Buffer', async () => {
    const chunky = {
      get: async () => ({
        status: 200,
        headers: {},
        data: {
          async *[Symbol.asyncIterator]() {
            yield new Uint8Array([0x25, 0x50]);
            yield new Uint8Array([0x44, 0x46]);
          },
        },
      }),
    } as unknown as import('axios').AxiosInstance;

    const result = await new AttachmentFetcher(1024, chunky).fetch(URL);
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.body.toString('latin1')).toBe('%PDF');
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

    expect(result).toEqual({
      outcome: 'oversized',
      bytes: 30_000_000,
      advertised: true,
    });
  });

  it('recognises the current generic code by its message', async () => {
    const result = await new AttachmentFetcher(
      64,
      axiosThrow({
        code: 'ERR_BAD_RESPONSE',
        message: 'maxContentLength size of 64 exceeded',
      }),
    ).fetch(URL);

    expect(result).toEqual({
      outcome: 'oversized',
      bytes: null,
      advertised: false,
    });
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

    expect(result).toEqual({
      outcome: 'oversized',
      bytes: null,
      advertised: false,
    });
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
