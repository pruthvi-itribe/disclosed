import {
  buildDoclingForm,
  DEFAULT_DOCLING_COOLDOWN_MS,
  DOCLING_CONVERT_PATH,
  HttpDoclingConverter,
  MAX_DOCLING_MESSAGE_CHARS,
  textFromDoclingReply,
  type DoclingHttp,
  type DoclingOptions,
  type DoclingRequest,
} from './docling-client';

/**
 * The markdown this engine was chosen for: table pipes, and the statement
 * heading BEFORE its own table rather than 2,977 characters after it.
 */
const MARKDOWN = [
  '## UNAUDITED STANDALONE FINANCIAL RESULTS',
  '',
  '| # | Particulars | 30.06.2026 | 30.06.2025 |',
  '| 1 | Revenue from operations | 54,618.69 | 52,369.69 |',
].join('\n');

const successReply = (markdown: string): unknown => ({
  status: 'success',
  document: { md_content: markdown },
});

const requestFor = (over: Partial<DoclingRequest> = {}): DoclingRequest => ({
  data: Buffer.from('%PDF-1.4 not really a pdf'),
  fileName: 'JKIL-outcome.pdf',
  ocr: false,
  maxPages: 150,
  ...over,
});

interface RecordedPost {
  readonly path: string;
  readonly form: FormData;
}

interface StubHttp extends DoclingHttp {
  /** Every request that was ACTUALLY made. Its length is the assertion. */
  readonly posts: RecordedPost[];
  healthCalls: number;
}

/**
 * A hand-written stand-in for the transport.
 *
 * There is no axios here and no socket anywhere in this file: the point of
 * `DoclingHttp` being an interface is that the client's failure behaviour —
 * which is most of its behaviour — is decidable without a service to break.
 */
const stubHttp = (
  behaviour: {
    readonly post?: (path: string, form: FormData) => Promise<unknown>;
    readonly health?: () => Promise<void>;
  } = {},
): StubHttp => {
  const stub: StubHttp = {
    posts: [],
    healthCalls: 0,
    post: async (path, form) => {
      stub.posts.push({ path, form });
      return behaviour.post === undefined
        ? successReply(MARKDOWN)
        : behaviour.post(path, form);
    },
    health: async () => {
      stub.healthCalls += 1;
      if (behaviour.health !== undefined) await behaviour.health();
    },
  };
  return stub;
};

/** A clock the test moves by hand, so the cooldown never costs a second. */
const clock = (
  cooldownMs = 1_000,
): { readonly options: DoclingOptions; advance: (ms: number) => void } => {
  let time = 1_700_000_000_000;
  return {
    options: { cooldownMs, now: () => time },
    advance: (ms) => {
      time += ms;
    },
  };
};

const rejecting = (error: unknown) => async (): Promise<never> => {
  throw error;
};

describe('textFromDoclingReply', () => {
  it('takes the markdown out of a successful conversion', () => {
    expect(textFromDoclingReply(successReply(MARKDOWN))).toEqual({
      outcome: 'ok',
      text: MARKDOWN,
    });
  });

  it('keeps the pipes and the heading order verbatim', () => {
    // `md_content` rather than `text_content`, deliberately: the plain-text
    // rendering discards exactly the pipes and headings that carry the two
    // guarantees this engine was paid for.
    const result = textFromDoclingReply(successReply(MARKDOWN));
    if (result.outcome !== 'ok') throw new Error('expected a reading');
    expect(result.text).toContain('| Revenue from operations | 54,618.69 |');
    expect(result.text.indexOf('UNAUDITED STANDALONE')).toBeLessThan(
      result.text.indexOf('| 1 |'),
    );
  });

  it.each<[string, unknown]>([
    ['a string body', 'not json at all'],
    ['null', null],
    ['a number', 42],
    ['nothing at all', undefined],
    ['a boolean', false],
  ])('reports %s as unavailable rather than empty', (_label, payload) => {
    // A reply that is not an object is a transport telling the truth about a
    // proxy or a gateway, not a document refusing to convert.
    expect(textFromDoclingReply(payload)).toEqual({
      outcome: 'unavailable',
      message: 'the Docling service returned no object',
    });
  });

  it.each([
    ['a missing document', { status: 'success' }],
    ['a null document', { status: 'failure', document: null }],
    [
      'a document with no markdown',
      { status: 'partial_success', document: {} },
    ],
    [
      'an empty markdown body',
      { status: 'success', document: { md_content: '' } },
    ],
    [
      'a non-string markdown body',
      { status: 'success', document: { md_content: 12 } },
    ],
    ['a document that is a string', { status: 'success', document: 'md' }],
  ])('REFUSES %s', (_label, payload) => {
    // Refused rather than `ok` with an empty string: the caller would otherwise
    // store a successfully-read document with nothing in it, over a perfectly
    // good pdf-parse reading.
    const result = textFromDoclingReply(payload);
    expect(result.outcome).toBe('refused');
    if (result.outcome !== 'refused') return;
    expect(result.message).toContain('no markdown content');
  });

  it('quotes the status the service actually sent', () => {
    // `partial_success` with no content and `failure` are the same fact for the
    // caller, but only the message says which one the operator is looking at.
    const result = textFromDoclingReply({ status: 'partial_success' });
    if (result.outcome !== 'refused') throw new Error('expected a refusal');
    expect(result.message).toContain('"partial_success"');
  });

  it('names an unrecognised status shape rather than guessing at it', () => {
    const result = textFromDoclingReply({ status: 7, document: {} });
    if (result.outcome !== 'refused') throw new Error('expected a refusal');
    expect(result.message).toContain('"unknown"');
  });

  it('keeps only a bounded slice of a string the service chose', () => {
    // Literal as well as constant: an unbounded message is a log line a remote
    // service gets to choose the length of.
    expect(MAX_DOCLING_MESSAGE_CHARS).toBe(300);
    const result = textFromDoclingReply({ status: 'x'.repeat(5_000) });
    if (result.outcome !== 'refused') throw new Error('expected a refusal');
    expect(result.message).toHaveLength(MAX_DOCLING_MESSAGE_CHARS);
  });

  it('never throws on a reply of any shape', () => {
    const odd: readonly unknown[] = [[], {}, { document: {} }, () => MARKDOWN];
    for (const payload of odd) {
      expect(() => textFromDoclingReply(payload)).not.toThrow();
    }
  });
});

describe('buildDoclingForm', () => {
  it.each<[string, boolean, string]>([
    ['a raster scan', true, 'true'],
    ['a text-layer results filing', false, 'false'],
  ])('sends do_ocr for %s as the string %s', (_label, ocr, expected) => {
    // `do_ocr` is the whole cost model — on for character recovery, off for
    // reading order — and multipart carries strings, so the flag has to go out
    // as one. A boolean here would serialise to something the service reads
    // differently.
    const form = buildDoclingForm(requestFor({ ocr }));
    expect(form.getAll('do_ocr')).toEqual([expected]);
  });

  it('sends the page bound as a 1-indexed inclusive page_range PAIR', () => {
    // `max_num_pages` aborts the whole conversion — `ConversionError: Document
    // has 640 pages, exceeding the max_num_pages limit of 40` — so the wrong
    // parameter turns every long filing into a hard failure instead of a
    // partial read.
    const form = buildDoclingForm(requestFor({ maxPages: 40 }));
    expect(form.getAll('page_range')).toEqual(['1', '40']);
    expect(form.getAll('max_num_pages')).toEqual([]);
  });

  it.each<[string, number, readonly string[]]>([
    ['the OCR ceiling', 40, ['1', '40']],
    ['the layout ceiling', 150, ['1', '150']],
    ['a single page', 1, ['1', '1']],
    ['a page count of zero', 0, ['1', '1']],
    ['a negative page count', -5, ['1', '1']],
  ])('turns %s into %j', (_label, maxPages, expected) => {
    // A range ending below its start is not a range, so a page count pdf-parse
    // under-reported as zero still asks for the first page.
    const form = buildDoclingForm(requestFor({ maxPages }));
    expect(form.getAll('page_range')).toEqual(expected);
  });

  it('fixes the rendering at markdown rather than making it a setting', () => {
    // It is the only rendering that carries the table pipes and the heading
    // order this engine was chosen for, so making it configurable would make
    // the guarantee optional.
    const form = buildDoclingForm(requestFor());
    expect(form.getAll('to_formats')).toEqual(['md']);
  });

  it('asks the service not to abort on a document it cannot convert', () => {
    // A document that cannot be converted must come back as a status this
    // client can read, not as a 500 that looks like the service being down —
    // the two have opposite remedies.
    const form = buildDoclingForm(requestFor());
    expect(form.getAll('abort_on_error')).toEqual(['false']);
  });

  it('sends the bytes under the filename Docling keys its result off', () => {
    const form = buildDoclingForm(
      requestFor({ fileName: 'APOLLOTYRE-results.pdf' }),
    );
    const part = form.get('files');
    if (part === null || typeof part === 'string') {
      throw new Error('expected the PDF to be sent as a file part');
    }
    expect(part.name).toBe('APOLLOTYRE-results.pdf');
    expect(part.type).toBe('application/pdf');
    expect(part.size).toBe(requestFor().data.length);
  });
});

describe('HttpDoclingConverter — the ordinary path', () => {
  it('converts a document and returns the markdown', async () => {
    const http = stubHttp();
    const converter = new HttpDoclingConverter(http, clock().options);

    const result = await converter.convert(requestFor());

    expect(result).toEqual({ outcome: 'ok', text: MARKDOWN });
    expect(http.posts).toHaveLength(1);
    expect(http.posts[0].path).toBe(DOCLING_CONVERT_PATH);
    expect(http.posts[0].form.getAll('do_ocr')).toEqual(['false']);
  });

  it('posts to the synchronous conversion endpoint', () => {
    expect(DOCLING_CONVERT_PATH).toBe('/v1/convert/file');
  });

  it('believes the service is up until something says otherwise', () => {
    expect(new HttpDoclingConverter(stubHttp()).isAvailable()).toBe(true);
  });

  it('carries the request configuration through to the form', async () => {
    const http = stubHttp();
    const converter = new HttpDoclingConverter(http, clock().options);

    await converter.convert(requestFor({ ocr: true, maxPages: 40 }));

    expect(http.posts[0].form.getAll('do_ocr')).toEqual(['true']);
    expect(http.posts[0].form.getAll('page_range')).toEqual(['1', '40']);
  });
});

describe('HttpDoclingConverter — the latch', () => {
  it('reports a transport failure as unavailable rather than throwing', async () => {
    const http = stubHttp({ post: rejecting(new Error('ECONNREFUSED')) });
    const converter = new HttpDoclingConverter(http, clock().options);

    const result = await converter.convert(requestFor());

    expect(result.outcome).toBe('unavailable');
    if (result.outcome !== 'unavailable') return;
    expect(result.message).toContain('could not be reached');
    expect(result.message).toContain('ECONNREFUSED');
  });

  it('makes NO second request inside the cooldown', async () => {
    // Without the latch a service that is down but reachable costs the full
    // timeout on every eligible filing: ~85 results filings a day against a
    // 300-second ceiling is seven hours of a worker waiting on a dependency it
    // was told to treat as optional.
    const http = stubHttp({ post: rejecting(new Error('socket hang up')) });
    const converter = new HttpDoclingConverter(http, clock().options);

    await converter.convert(requestFor());
    expect(converter.isAvailable()).toBe(false);

    const second = await converter.convert(requestFor());

    expect(http.posts).toHaveLength(1);
    expect(second.outcome).toBe('unavailable');
    if (second.outcome !== 'unavailable') return;
    expect(second.message).toContain('cooldown');
    expect(second.message).toContain('no request was made');
  });

  it('holds the latch open for the whole cooldown and no longer', async () => {
    const time = clock(1_000);
    const http = stubHttp({ post: rejecting(new Error('ETIMEDOUT')) });
    const converter = new HttpDoclingConverter(http, time.options);

    await converter.convert(requestFor());

    time.advance(999);
    expect(converter.isAvailable()).toBe(false);

    time.advance(1);
    expect(converter.isAvailable()).toBe(true);
  });

  it('lets a service that came back be used again without a restart', async () => {
    const time = clock(1_000);
    let down = true;
    const http = stubHttp({
      post: async () => {
        if (down) throw new Error('ECONNREFUSED');
        return successReply(MARKDOWN);
      },
    });
    const converter = new HttpDoclingConverter(http, time.options);

    await converter.convert(requestFor());
    await converter.convert(requestFor());
    expect(http.posts).toHaveLength(1);

    time.advance(1_000);
    down = false;
    const recovered = await converter.convert(requestFor());

    expect(http.posts).toHaveLength(2);
    expect(recovered).toEqual({ outcome: 'ok', text: MARKDOWN });
  });

  it('waits five minutes by default', () => {
    // Long enough that a down service is not re-probed once a filing, short
    // enough that a service coming back is picked up inside one human's
    // attention span.
    expect(DEFAULT_DOCLING_COOLDOWN_MS).toBe(300_000);
    expect(DEFAULT_DOCLING_COOLDOWN_MS).toBe(5 * 60 * 1_000);
  });

  it('uses the real clock when no options are supplied', async () => {
    // The default arm of the constructor, exercised without waiting for it: a
    // failure now is inside a five-minute cooldown by any real clock.
    const http = stubHttp({ post: rejecting(new Error('ENOTFOUND')) });
    const converter = new HttpDoclingConverter(http);

    expect(converter.isAvailable()).toBe(true);
    await converter.convert(requestFor());

    expect(converter.isAvailable()).toBe(false);
    expect(http.posts).toHaveLength(1);
  });

  it.each<[string, unknown, string]>([
    ['a non-Error throw', 'the process exited', 'the process exited'],
    ['a thrown number', 504, '504'],
    ['a thrown null', null, 'null'],
  ])('keeps a readable message from %s', async (_label, thrown, expected) => {
    const http = stubHttp({ post: rejecting(thrown) });
    const converter = new HttpDoclingConverter(http, clock().options);

    const result = await converter.convert(requestFor());

    expect(result.outcome).toBe('unavailable');
    if (result.outcome !== 'unavailable') return;
    expect(result.message).toContain(expected);
  });

  it('bounds and flattens a message the service chose the length of', async () => {
    const http = stubHttp({
      post: rejecting(new Error(`upstream\n  said\t${'x'.repeat(5_000)}`)),
    });
    const converter = new HttpDoclingConverter(http, clock().options);

    const result = await converter.convert(requestFor());

    if (result.outcome !== 'unavailable')
      throw new Error('expected a fallback');
    expect(result.message).toContain('upstream said x');
    expect(result.message).not.toContain('\n');
    expect(result.message).toContain('x'.repeat(280));
    expect(result.message).not.toContain('x'.repeat(300));
  });
});

describe('HttpDoclingConverter.probe', () => {
  it('reports a healthy service and closes the latch', async () => {
    const time = clock(1_000);
    const http = stubHttp({ post: rejecting(new Error('ECONNREFUSED')) });
    const converter = new HttpDoclingConverter(http, time.options);

    await converter.convert(requestFor());
    expect(converter.isAvailable()).toBe(false);

    // The service came back before its cooldown ran out. A probe that closes
    // the latch is how a deployment stops paying for the rest of the window.
    await expect(converter.probe()).resolves.toBe(true);
    expect(http.healthCalls).toBe(1);
    expect(converter.isAvailable()).toBe(true);
  });

  it('reports an unreachable service and opens the latch', async () => {
    // The startup path: a deployment can report the optional dependency as
    // absent without a filing having to discover it.
    const http = stubHttp({ health: rejecting(new Error('ECONNREFUSED')) });
    const converter = new HttpDoclingConverter(http, clock().options);

    await expect(converter.probe()).resolves.toBe(false);

    expect(converter.isAvailable()).toBe(false);
    const result = await converter.convert(requestFor());
    expect(http.posts).toHaveLength(0);
    expect(result.outcome).toBe('unavailable');
  });
});

describe('HttpDoclingConverter — the asymmetry that keeps one bad PDF cheap', () => {
  it('does NOT open the latch for a reply it could not read', async () => {
    // A transport failure is a statement about the SERVICE; a reply this client
    // cannot read is a statement about ONE DOCUMENT. Opening the latch for the
    // second would take the whole dependency down over one bad PDF, and the
    // next filing in the queue is usually fine.
    const http = stubHttp({ post: async () => ({ status: 'failure' }) });
    const converter = new HttpDoclingConverter(http, clock().options);

    const first = await converter.convert(requestFor());
    expect(first.outcome).toBe('refused');
    expect(converter.isAvailable()).toBe(true);

    const second = await converter.convert(requestFor());

    expect(http.posts).toHaveLength(2);
    expect(second.outcome).toBe('refused');
  });

  it('does NOT open the latch for an empty markdown body either', async () => {
    const http = stubHttp({ post: async () => successReply('') });
    const converter = new HttpDoclingConverter(http, clock().options);

    await converter.convert(requestFor());
    await converter.convert(requestFor());

    expect(http.posts).toHaveLength(2);
    expect(converter.isAvailable()).toBe(true);
  });
});
