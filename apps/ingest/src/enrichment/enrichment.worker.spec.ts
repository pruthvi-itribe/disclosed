import { categoryGroupFor, composeOutcome } from '@app/filings';
import type {
  AttachmentFetcher,
  AttachmentResult,
  ClaimedFiling,
  ClaimExtractionRequest,
  ClaimExtractionResult,
  ClaimExtractor,
  ResultsExtractionResult,
  ResultsExtractor,
  EnrichmentRepository,
  Filing,
  FilingEnrichment,
  PdfParser,
  ZipReader,
  ZipTextOk,
} from '@app/filings';
import type { TelegramService } from '@app/notify';
import type { FilingContextService } from './filing-context.service';
import {
  describeTick,
  describeZipSource,
  EnrichmentWorker,
  HEARTBEAT_MS,
  MAX_DOCUMENT_SOURCE_CHARS,
  type EnrichmentOptions,
} from './enrichment.worker';

const NOW = new Date('2026-08-06T06:00:00.000Z');

/**
 * A filing published two hours ago: outside the parse-retry window, so a
 * document that will not parse is a permanent property of the document rather
 * than a race with NSE's upload.
 */
const OLD = new Date(NOW.getTime() - 7_200_000);
const PDF_URL = 'https://nsearchives.nseindia.com/corporate/RAILTEL.pdf';

const ORDER_DOCUMENT =
  'Intimation under Regulation 30\n' +
  '1. Name of the entity awarding the \norder(s)/contract(s); \nSouth Western Railway \n' +
  '2. Significant terms and conditions of order(s)/contract(s) awarded in brief; Supply of nylon mesh.\n' +
  '3. Broad consideration or size of the order(s)/contract(s); Rs. 18,53,66,820/-\n' +
  '4. Whether promoter interest exists; No\n';

const filing = (overrides: Partial<Filing> = {}): Filing => ({
  seqId: 500,
  symbol: 'RAILTEL',
  isin: 'INE000000001',
  companyName: 'RailTel Corporation of India Limited',
  industry: null,
  category: 'Bagging/Receiving of orders/contracts',
  summary: 'RailTel has informed the Exchange about an order',
  attachmentUrl: PDF_URL,
  announcedAt: NOW,
  disseminatedAt: NOW,
  ingestedAt: NOW,
  ...overrides,
});

class StubRepository {
  public readonly recorded: Array<{
    seqId: number;
    enrichment: FilingEnrichment;
  }> = [];
  public claimCalls = 0;
  public claimThrows = false;
  public pendingCalls = 0;
  public pendingThrows = false;

  constructor(private queue: ClaimedFiling[] = []) {}

  async pendingCount(): Promise<number> {
    this.pendingCalls += 1;
    if (this.pendingThrows) throw new Error('mongo is down');
    return this.queue.length;
  }

  async claimNext(): Promise<ClaimedFiling | null> {
    this.claimCalls += 1;
    if (this.claimThrows) throw new Error('mongo is down');
    return this.queue.shift() ?? null;
  }

  async recordEnrichment(
    seqId: number,
    enrichment: FilingEnrichment,
  ): Promise<void> {
    this.recorded.push({ seqId, enrichment });
  }
}

class StubFetcher {
  public readonly urls: string[] = [];

  constructor(private result: AttachmentResult) {}

  async fetch(url: string): Promise<AttachmentResult> {
    this.urls.push(url);
    return this.result;
  }
}

class StubTelegram {
  public readonly sent: string[] = [];
  public throws = false;

  async send(message: string): Promise<void> {
    if (this.throws) throw new Error('telegram is down');
    this.sent.push(message);
  }
}

class StubContext {
  public throws = false;

  constructor(private line: string | null = null) {}

  async contextFor(): Promise<string | null> {
    return this.line;
  }

  async contextForAmount(): Promise<string | null> {
    if (this.throws) throw new Error('context query failed');
    return this.line;
  }
}

const okBody = (): AttachmentResult => ({
  outcome: 'ok',
  body: Buffer.from('%PDF-1.4 pretend'),
  bytes: 16,
  contentType: 'application/pdf',
});

const parserOf =
  (text: string): PdfParser =>
  async () => ({ text, numpages: 2 });

const OPTIONS: EnrichmentOptions = {
  idleIntervalMs: 1000,
  requestDelayMs: 0,
  batchSize: 10,
  maxAttempts: 3,
  retryBaseMs: 1000,
  retryMaxMs: 10_000,
  parseWindowMs: 3_600_000,
  maxParseAttempts: 3,
  parseRetryBaseMs: 300_000,
  leaseMs: 60_000,
  alertWindowMs: 600_000,
  watchlist: [],
  maxClaims: 3,
};

interface Harness {
  readonly worker: EnrichmentWorker;
  readonly repository: StubRepository;
  readonly fetcher: StubFetcher;
  readonly telegram: StubTelegram;
  readonly context: StubContext;
}

function harness(overrides: {
  queue?: ClaimedFiling[];
  fetch?: AttachmentResult;
  text?: string;
  options?: Partial<EnrichmentOptions>;
  contextLine?: string | null;
  zipReader?: ZipReader | null;
}): Harness {
  const repository = new StubRepository(
    overrides.queue ?? [{ filing: filing(), attempts: 1, parseAttempts: 0 }],
  );
  const fetcher = new StubFetcher(overrides.fetch ?? okBody());
  const telegram = new StubTelegram();
  const context = new StubContext(overrides.contextLine ?? null);

  const worker = new EnrichmentWorker(
    repository as unknown as EnrichmentRepository,
    fetcher as unknown as AttachmentFetcher,
    context as unknown as FilingContextService,
    telegram as unknown as TelegramService,
    { ...OPTIONS, ...overrides.options },
    parserOf(overrides.text ?? ORDER_DOCUMENT),
    null,
    overrides.zipReader ?? null,
  );

  return { worker, repository, fetcher, telegram, context };
}

const onlyRecorded = (repository: StubRepository): FilingEnrichment => {
  expect(repository.recorded).toHaveLength(1);
  return repository.recorded[0].enrichment;
};

describe('EnrichmentWorker — the happy path', () => {
  it('reads the document and records the verdict', async () => {
    const { worker, repository } = harness({});
    const result = await worker.tick(NOW);

    expect(result).toMatchObject({ claimed: 1, enriched: 1, refused: 0 });
    expect(onlyRecorded(repository)).toMatchObject({
      state: 'enriched',
      amountRupees: 185_366_820,
      counterparty: 'South Western Railway',
      headline: 'RAILTEL BAGS ORDER ₹18.54 cr from South Western Railway',
      unparseableReason: null,
      nextAttemptAt: null,
    });
  });

  it('fetches the URL the attachment decision approved', async () => {
    const { worker, fetcher } = harness({});
    await worker.tick(NOW);
    expect(fetcher.urls).toEqual([PDF_URL]);
  });

  it('stores the derived-context line alongside the verdict', async () => {
    const { worker, repository } = harness({
      contextLine: '3rd order for RAILTEL in 30 days',
    });
    await worker.tick(NOW);
    expect(onlyRecorded(repository).contextLine).toBe(
      '3rd order for RAILTEL in 30 days',
    );
  });

  it('drains the whole batch, newest first, until the queue is empty', async () => {
    const { worker, repository } = harness({
      queue: [
        { filing: filing({ seqId: 3 }), attempts: 1, parseAttempts: 0 },
        { filing: filing({ seqId: 2 }), attempts: 1, parseAttempts: 0 },
        { filing: filing({ seqId: 1 }), attempts: 1, parseAttempts: 0 },
      ],
    });

    const result = await worker.tick(NOW);
    expect(result.claimed).toBe(3);
    expect(repository.recorded.map((row) => row.seqId)).toEqual([3, 2, 1]);
  });

  it('stops at the batch size rather than draining without bound', async () => {
    const queue = Array.from({ length: 10 }, (_unused, index) => ({
      filing: filing({ seqId: index }),
      attempts: 1,
      parseAttempts: 0,
    }));
    const { worker } = harness({ queue, options: { batchSize: 4 } });

    expect((await worker.tick(NOW)).claimed).toBe(4);
  });
});

/**
 * The half of coverage that does not depend on a model, a network or a parser.
 *
 * `composeOutcome` runs off `symbol`, `category` and `summary`, which the poller
 * writes for every filing on the two-second hot path — so the assertion that
 * matters is not that an enriched filing carries an outcome, it is that a filing
 * NOTHING could be read from carries one too. That population is 3.2% of the
 * live collection and rendered as a completely blank row before this existed.
 */
describe('EnrichmentWorker — what the filing SAYS, on every write path', () => {
  it('stores the outcome and the group beside a successful verdict', async () => {
    const { worker, repository } = harness({});
    await worker.tick(NOW);

    expect(onlyRecorded(repository)).toMatchObject({
      state: 'enriched',
      outcome: composeOutcome(filing()).text,
      outcomeSource: composeOutcome(filing()).source,
      categoryGroup: categoryGroupFor(filing().category),
    });
  });

  it.each([
    ['a URL that is not there', null],
    ['a URL off the archive host', 'https://example.com/a.pdf'],
  ])('stores them for an unparseable filing with %s', async (_l, url) => {
    const { worker, repository } = harness({
      queue: [
        {
          filing: filing({ attachmentUrl: url }),
          attempts: 1,
          parseAttempts: 0,
        },
      ],
    });
    await worker.tick(NOW);

    const recorded = onlyRecorded(repository);
    expect(recorded.state).toBe('unparseable');
    expect(recorded.outcome).toBe(composeOutcome(filing()).text);
    expect(recorded.categoryGroup).toBe(categoryGroupFor(filing().category));
  });

  it('stores them when a transient failure puts the filing back', async () => {
    const { worker, repository } = harness({
      fetch: { outcome: 'failed', status: 503, message: 'service unavailable' },
    });
    await worker.tick(NOW);

    const recorded = onlyRecorded(repository);
    expect(recorded.state).toBe('pending');
    expect(recorded.outcome).toBe(composeOutcome(filing()).text);
  });

  it('agrees with what the dashboard derives on read', async () => {
    // The stored copy is a cache of a pure function over immutable input. If the
    // two can disagree, one of them is wrong and nobody can tell which.
    const one = filing({
      symbol: 'ACME',
      category: 'Credit Rating',
      summary: 'Acme Ltd has informed the Exchange about Credit Rating',
    });
    const { worker, repository } = harness({
      queue: [{ filing: one, attempts: 1, parseAttempts: 0 }],
    });
    await worker.tick(NOW);

    const derived = composeOutcome(one);
    expect(onlyRecorded(repository).outcome).toBe(derived.text);
    expect(onlyRecorded(repository).outcomeSource).toBe('category');
  });
});

describe('EnrichmentWorker — the follow-up alert', () => {
  it('sends one when the document yielded a verified amount', async () => {
    const { worker, telegram } = harness({
      contextLine: '3rd order for RAILTEL in 30 days',
    });
    const result = await worker.tick(NOW);

    expect(result.alerted).toBe(1);
    expect(telegram.sent).toHaveLength(1);
    expect(telegram.sent[0]).toContain(
      'RAILTEL BAGS ORDER ₹18.54 cr from South Western Railway',
    );
    expect(telegram.sent[0]).toContain('3rd order for RAILTEL in 30 days');
    expect(telegram.sent[0]).toContain('Stated as "Rs. 18,53,66,820"');
    expect(telegram.sent[0]).toContain(`Source: ${PDF_URL}`);
  });

  it('sends nothing when the amount was refused', async () => {
    // The first alert already carried the exchange's own words; there is
    // nothing to add.
    const { worker, telegram, repository } = harness({
      text:
        'RailTel Corporation of India Limited has received a Letter of Intent ' +
        'for works valued at Rs. 18,53,66,820/-, subject to the execution of a ' +
        'definitive agreement and to the conditions set out therein.',
    });
    const result = await worker.tick(NOW);

    expect(result).toMatchObject({ enriched: 1, refused: 1, alerted: 0 });
    expect(telegram.sent).toHaveLength(0);
    expect(onlyRecorded(repository).headline).toBe(
      'RAILTEL — BAGGING/RECEIVING OF ORDERS/CONTRACTS',
    );
  });

  it('respects the routine-category gate', async () => {
    const { worker, telegram } = harness({
      queue: [
        {
          filing: filing({ category: 'Trading Window' }),
          attempts: 1,
          parseAttempts: 0,
        },
      ],
    });
    await worker.tick(NOW);
    expect(telegram.sent).toHaveLength(0);
  });

  it('respects the watchlist', async () => {
    // An operator who filters one lane must not keep receiving the other.
    const { worker, telegram } = harness({
      options: { watchlist: ['RELIANCE'] },
    });
    expect((await worker.tick(NOW)).alerted).toBe(0);
    expect(telegram.sent).toHaveLength(0);
  });

  it('alerts for a symbol that IS on the watchlist', async () => {
    const { worker, telegram } = harness({
      options: { watchlist: [' railtel '] },
    });
    await worker.tick(NOW);
    expect(telegram.sent).toHaveLength(1);
  });

  it('respects the cold-start alert window', async () => {
    // Without this, a backfill of a thousand stored filings sends a hundred and
    // fifty follow-ups about news from last week.
    const stale = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    const { worker, telegram, repository } = harness({});

    expect((await worker.tick(stale)).alerted).toBe(0);
    expect(telegram.sent).toHaveLength(0);
    // The verdict is still stored. Only the message is suppressed.
    expect(onlyRecorded(repository).state).toBe('enriched');
  });

  it('stores the verdict even when Telegram is down', async () => {
    const { worker, repository, telegram } = harness({});
    telegram.throws = true;

    const result = await worker.tick(NOW);
    expect(result.enriched).toBe(1);
    expect(result.alerted).toBe(0);
    expect(onlyRecorded(repository).state).toBe('enriched');
  });

  it('persists before it alerts', async () => {
    const order: string[] = [];
    const repository = new StubRepository([
      { filing: filing(), attempts: 1, parseAttempts: 0 },
    ]);
    const telegram = new StubTelegram();
    const original = repository.recordEnrichment.bind(repository);
    repository.recordEnrichment = async (seqId, enrichment) => {
      order.push('record');
      await original(seqId, enrichment);
    };
    const originalSend = telegram.send.bind(telegram);
    telegram.send = async (message) => {
      order.push('send');
      await originalSend(message);
    };

    const worker = new EnrichmentWorker(
      repository as unknown as EnrichmentRepository,
      new StubFetcher(okBody()) as unknown as AttachmentFetcher,
      new StubContext() as unknown as FilingContextService,
      telegram as unknown as TelegramService,
      OPTIONS,
      parserOf(ORDER_DOCUMENT),
    );

    await worker.tick(NOW);
    expect(order).toEqual(['record', 'send']);
  });
});

describe('EnrichmentWorker — terminal states that are never retried', () => {
  it.each([
    ['no attachment at all', null, 'no-attachment'],
    ["NSE's dash sentinel", '-', 'no-attachment'],
    [
      'a URL off the archive host',
      'https://example.com/a.pdf',
      'untrusted-host',
    ],
  ])('reaches unparseable for %s', async (_label, attachmentUrl, reason) => {
    const { worker, repository, fetcher } = harness({
      queue: [
        { filing: filing({ attachmentUrl }), attempts: 1, parseAttempts: 0 },
      ],
    });

    const result = await worker.tick(NOW);
    expect(result).toMatchObject({ unparseable: 1, retried: 0, failed: 0 });
    expect(onlyRecorded(repository)).toMatchObject({
      state: 'unparseable',
      unparseableReason: reason,
      nextAttemptAt: null,
    });
    // Not fetched at all: the verdict is about the URL, not the network.
    expect(fetcher.urls).toHaveLength(0);
  });

  it('reaches unparseable for a PDF truncated at origin', async () => {
    // OLD, and that is now load-bearing rather than incidental: the same bytes
    // on a filing published a minute ago are looked at again, because NSE's own
    // upload could still be running. See `parse-retry.ts` and the LICHSGFIN
    // filing this pipeline lost to exactly that race.
    const worker = new EnrichmentWorker(
      new StubRepository([
        {
          filing: filing({ disseminatedAt: OLD }),
          attempts: 1,
          parseAttempts: 0,
        },
      ]) as unknown as EnrichmentRepository,
      new StubFetcher(okBody()) as unknown as AttachmentFetcher,
      new StubContext() as unknown as FilingContextService,
      new StubTelegram() as unknown as TelegramService,
      OPTIONS,
      async () => {
        throw new Error('Invalid PDF structure');
      },
    );

    expect((await worker.tick(NOW)).unparseable).toBe(1);
  });

  it.each([
    [
      'a body that ends mid-stream',
      Buffer.from('%PDF-1.7 body bytes with no terminator'),
      'truncated-at-origin',
    ],
    [
      'a body that ends where a PDF should',
      Buffer.from('%PDF-1.7 body bytes\nstartxref\n9\n%%EOF\n'),
      'unreadable-pdf',
    ],
  ])(
    'reads the reason off %s rather than assuming it',
    async (_label, body, reason) => {
      const repository = new StubRepository([
        {
          filing: filing({ disseminatedAt: OLD }),
          attempts: 1,
          parseAttempts: 0,
        },
      ]);
      const worker = new EnrichmentWorker(
        repository as unknown as EnrichmentRepository,
        new StubFetcher({
          outcome: 'ok',
          body,
          bytes: body.length,
          contentType: 'application/pdf',
        }) as unknown as AttachmentFetcher,
        new StubContext() as unknown as FilingContextService,
        new StubTelegram() as unknown as TelegramService,
        OPTIONS,
        async () => {
          throw new Error("Couldn't find trailer dictionary");
        },
      );

      await worker.tick(NOW);
      expect(onlyRecorded(repository)).toMatchObject({
        state: 'unparseable',
        unparseableReason: reason,
        lastError: "Couldn't find trailer dictionary",
      });
    },
  );

  it('reaches unparseable for a raster scan with no text layer', async () => {
    const { worker, repository } = harness({ text: '   \n \f ' });
    expect((await worker.tick(NOW)).unparseable).toBe(1);
    expect(onlyRecorded(repository).unparseableReason).toBe('no-text-layer');
  });

  it.each([
    [
      'an advertised size',
      { outcome: 'oversized', bytes: 70_000_000, advertised: true } as const,
      '70000000 bytes)',
    ],
    [
      'a counted size',
      { outcome: 'oversized', bytes: 67_108_865, advertised: false } as const,
      'read before the transfer was cut',
    ],
    [
      'no size at all',
      { outcome: 'oversized', bytes: null, advertised: false } as const,
      'size not reported',
    ],
  ])(
    'reaches unparseable for an oversized attachment with %s',
    async (_label, fetch, expected) => {
      // The stored detail is the whole point of the streaming rewrite: all 8
      // filings the previous cap refused recorded "unknown bytes", so nobody
      // could tell whether the cap had missed by a kilobyte or a gigabyte.
      const { worker, repository } = harness({ fetch });

      expect((await worker.tick(NOW)).unparseable).toBe(1);
      const recorded = onlyRecorded(repository);
      expect(recorded).toMatchObject({
        state: 'unparseable',
        unparseableReason: 'oversized',
      });
      expect(recorded.lastError).toContain(expected);
    },
  );

  it.each([
    [404, 'not-found'],
    [410, 'not-found'],
    [400, 'rejected'],
    [451, 'rejected'],
  ])('reaches unparseable for HTTP %d', async (status, reason) => {
    const { worker, repository } = harness({
      fetch: { outcome: 'failed', status, message: `Request failed ${status}` },
    });

    expect((await worker.tick(NOW)).unparseable).toBe(1);
    expect(onlyRecorded(repository).unparseableReason).toBe(reason);
  });

  it('never leaves a terminal filing carrying a next attempt time', async () => {
    for (const fetch of [
      { outcome: 'oversized', bytes: null, advertised: false } as const,
      { outcome: 'failed', status: 404, message: 'gone' } as const,
    ]) {
      const { worker, repository } = harness({ fetch });
      await worker.tick(NOW);
      expect(onlyRecorded(repository).nextAttemptAt).toBeNull();
    }
  });
});

describe('EnrichmentWorker — transient failures', () => {
  it.each([[403], [429], [500], [503]])(
    'schedules a retry with a backoff after HTTP %d',
    async (status) => {
      const { worker, repository } = harness({
        fetch: { outcome: 'failed', status, message: 'nope' },
      });

      const result = await worker.tick(NOW);
      expect(result).toMatchObject({ retried: 1, failed: 0, unparseable: 0 });
      expect(onlyRecorded(repository)).toMatchObject({
        state: 'pending',
        lastError: 'nope',
        nextAttemptAt: new Date(NOW.getTime() + OPTIONS.retryBaseMs),
      });
    },
  );

  it('retries a network failure with no status', async () => {
    const { worker, repository } = harness({
      fetch: { outcome: 'failed', status: null, message: 'socket hang up' },
    });
    expect((await worker.tick(NOW)).retried).toBe(1);
    expect(onlyRecorded(repository).state).toBe('pending');
  });

  it('doubles the backoff per attempt', async () => {
    const { worker, repository } = harness({
      queue: [{ filing: filing(), attempts: 2, parseAttempts: 0 }],
      fetch: { outcome: 'failed', status: 503, message: 'nope' },
    });

    await worker.tick(NOW);
    expect(onlyRecorded(repository).nextAttemptAt).toEqual(
      new Date(NOW.getTime() + OPTIONS.retryBaseMs * 2),
    );
  });

  it('gives up once the attempt budget is spent', async () => {
    const { worker, repository } = harness({
      queue: [
        { filing: filing(), attempts: OPTIONS.maxAttempts, parseAttempts: 0 },
      ],
      fetch: { outcome: 'failed', status: 503, message: 'still down' },
    });

    const result = await worker.tick(NOW);
    expect(result).toMatchObject({ failed: 1, retried: 0 });
    expect(onlyRecorded(repository)).toMatchObject({
      state: 'failed',
      attempts: OPTIONS.maxAttempts,
      nextAttemptAt: null,
      lastError: 'still down',
    });
  });
});

describe('EnrichmentWorker — containment', () => {
  it('never throws when a document blows up mid-processing', async () => {
    const repository = new StubRepository([
      { filing: filing(), attempts: 1, parseAttempts: 0 },
    ]);
    repository.recordEnrichment = async () => {
      throw new Error('write failed');
    };
    const worker = new EnrichmentWorker(
      repository as unknown as EnrichmentRepository,
      new StubFetcher(okBody()) as unknown as AttachmentFetcher,
      new StubContext() as unknown as FilingContextService,
      new StubTelegram() as unknown as TelegramService,
      OPTIONS,
      parserOf(ORDER_DOCUMENT),
    );

    await expect(worker.tick(NOW)).resolves.toMatchObject({
      claimed: 1,
      enriched: 0,
    });
  });

  it('one bad document does not cost the rest of the batch', async () => {
    const repository = new StubRepository([
      { filing: filing({ seqId: 1 }), attempts: 1, parseAttempts: 0 },
      { filing: filing({ seqId: 2 }), attempts: 1, parseAttempts: 0 },
    ]);
    const original = repository.recordEnrichment.bind(repository);
    repository.recordEnrichment = async (seqId, enrichment) => {
      if (seqId === 1) throw new Error('write failed');
      await original(seqId, enrichment);
    };

    const worker = new EnrichmentWorker(
      repository as unknown as EnrichmentRepository,
      new StubFetcher(okBody()) as unknown as AttachmentFetcher,
      new StubContext() as unknown as FilingContextService,
      new StubTelegram() as unknown as TelegramService,
      OPTIONS,
      parserOf(ORDER_DOCUMENT),
    );

    const result = await worker.tick(NOW);
    expect(result.claimed).toBe(2);
    expect(result.enriched).toBe(1);
    expect(repository.recorded.map((row) => row.seqId)).toEqual([2]);
  });

  it('stops the tick rather than spinning when claiming itself fails', async () => {
    const repository = new StubRepository([
      { filing: filing(), attempts: 1, parseAttempts: 0 },
    ]);
    repository.claimThrows = true;
    const worker = new EnrichmentWorker(
      repository as unknown as EnrichmentRepository,
      new StubFetcher(okBody()) as unknown as AttachmentFetcher,
      new StubContext() as unknown as FilingContextService,
      new StubTelegram() as unknown as TelegramService,
      OPTIONS,
      parserOf(ORDER_DOCUMENT),
    );

    await expect(worker.tick(NOW)).resolves.toEqual({
      claimed: 0,
      enriched: 0,
      refused: 0,
      unparseable: 0,
      parseRetried: 0,
      retried: 0,
      failed: 0,
      claimed_lines: 0,
      claimsDiscarded: 0,
      resultsLines: 0,
      alerted: 0,
    });
    expect(repository.claimCalls).toBe(1);
  });

  it('stores the verdict when the context query fails', async () => {
    const { worker, repository, context } = harness({});
    context.throws = true;

    const result = await worker.tick(NOW);
    expect(result.enriched).toBe(1);
    expect(onlyRecorded(repository).contextLine).toBeNull();
  });

  it('refuses to start twice', async () => {
    const { worker } = harness({ queue: [] });
    const running = worker.start();
    await expect(worker.start()).rejects.toThrow(/already running/);
    worker.stop();
    await running;
  });

  it('stops promptly rather than waiting out the idle interval', async () => {
    const { worker } = harness({
      queue: [],
      options: { idleIntervalMs: 60_000 },
    });

    const started = Date.now();
    const running = worker.start();
    // Let the first tick settle, then interrupt the idle sleep.
    await Promise.resolve();
    worker.stop();
    await running;

    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('is safe to stop when it was never started', () => {
    const { worker } = harness({ queue: [] });
    expect(() => worker.stop()).not.toThrow();
  });

  it('skips a tick that overlaps one already in flight', async () => {
    const { worker, repository } = harness({
      queue: [{ filing: filing(), attempts: 1, parseAttempts: 0 }],
    });

    const [first, second] = await Promise.all([
      worker.tick(NOW),
      worker.tick(NOW),
    ]);

    const claimed = first.claimed + second.claimed;
    expect(claimed).toBe(1);
    expect(repository.recorded).toHaveLength(1);
  });
});

describe('EnrichmentWorker — the loop', () => {
  it('drains the queue, then idles rather than spinning', async () => {
    const { worker, repository } = harness({
      queue: [{ filing: filing(), attempts: 1, parseAttempts: 0 }],
      options: { idleIntervalMs: 20_000, batchSize: 1 },
    });

    const running = worker.start();
    // Long enough for the first tick to finish and the loop to reach its sleep.
    await new Promise((resolve) => setTimeout(resolve, 30));
    worker.stop();
    await running;

    expect(repository.recorded).toHaveLength(1);
    // The idle interval is 20s and the test took milliseconds, so the loop must
    // have been woken by stop() rather than waited out.
    expect(repository.claimCalls).toBeGreaterThanOrEqual(2);
  });

  it('paces the fetches inside a tick', async () => {
    const { worker } = harness({
      queue: [
        { filing: filing({ seqId: 1 }), attempts: 1, parseAttempts: 0 },
        { filing: filing({ seqId: 2 }), attempts: 1, parseAttempts: 0 },
        { filing: filing({ seqId: 3 }), attempts: 1, parseAttempts: 0 },
      ],
      options: { requestDelayMs: 25 },
    });

    const started = Date.now();
    const result = await worker.tick(NOW);
    const elapsed = Date.now() - started;

    expect(result.claimed).toBe(3);
    // Two gaps for three documents: the delay is BETWEEN fetches, so a tick
    // that processes one filing must not sit out a delay for nothing.
    expect(elapsed).toBeGreaterThanOrEqual(45);
  });

  it('survives a tick that violates its own never-throw contract', async () => {
    // Unreachable through any input, which is exactly why it is here: the
    // alternative to an unreachable catch is an unhandled rejection that kills
    // the loop, and a dead worker looks identical to an empty queue.
    const { worker } = harness({ queue: [], options: { idleIntervalMs: 5 } });
    let thrown = 0;
    (worker as unknown as { tick: () => Promise<never> }).tick = async () => {
      thrown += 1;
      throw new Error('contract violated');
    };

    const running = worker.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    worker.stop();
    await running;

    expect(thrown).toBeGreaterThan(0);
  });
});

describe('EnrichmentWorker — shutdown mid-drain', () => {
  it('abandons the rest of the batch when stop() lands during a running drain', async () => {
    // Only meaningful while the loop is actually running: a tick invoked
    // directly has never been started, and must drain its whole batch.
    const repository = new StubRepository([
      { filing: filing({ seqId: 1 }), attempts: 1, parseAttempts: 0 },
      { filing: filing({ seqId: 2 }), attempts: 1, parseAttempts: 0 },
      { filing: filing({ seqId: 3 }), attempts: 1, parseAttempts: 0 },
    ]);
    const telegram = new StubTelegram();
    const worker = new EnrichmentWorker(
      repository as unknown as EnrichmentRepository,
      {
        fetch: async () => {
          worker.stop();
          return okBody();
        },
      } as unknown as AttachmentFetcher,
      new StubContext() as unknown as FilingContextService,
      telegram as unknown as TelegramService,
      { ...OPTIONS, batchSize: 3, idleIntervalMs: 5 },
      parserOf(ORDER_DOCUMENT),
    );

    await worker.start();

    // The first document completes; the loop notices the stop before claiming
    // a second one.
    expect(repository.recorded).toHaveLength(1);
  });
});

/**
 * The regression suite for the filing this pipeline lost.
 *
 * `LICHSGFIN` seqId 106727908 was fetched minutes after publication, arrived
 * with no `%%EOF`, was written off as `truncated-at-origin` — a state the state
 * machine called terminal — and parsed cleanly on a later re-fetch of the same
 * URL. Every test here is about that shape: the SAME bytes must be provisional
 * on a young filing and permanent on an old one.
 */
describe('EnrichmentWorker — a parse failure while the filing is still young', () => {
  /** A worker whose fetcher returns `body` and whose parser always throws. */
  const unparseableWorker = (
    repository: StubRepository,
    body = Buffer.from('%PDF-1.7 body bytes with no terminator'),
    options: Partial<EnrichmentOptions> = {},
  ): EnrichmentWorker =>
    new EnrichmentWorker(
      repository as unknown as EnrichmentRepository,
      new StubFetcher({
        outcome: 'ok',
        body,
        bytes: body.length,
        contentType: 'application/pdf',
      }) as unknown as AttachmentFetcher,
      new StubContext() as unknown as FilingContextService,
      new StubTelegram() as unknown as TelegramService,
      { ...OPTIONS, ...options },
      async () => {
        throw new Error('Invalid PDF structure');
      },
    );

  it('puts the filing back rather than losing it', async () => {
    const repository = new StubRepository([
      { filing: filing(), attempts: 1, parseAttempts: 0 },
    ]);

    const result = await unparseableWorker(repository).tick(NOW);

    expect(result).toMatchObject({ parseRetried: 1, unparseable: 0 });
    expect(onlyRecorded(repository)).toMatchObject({
      state: 'pending',
      parseAttempts: 1,
      // NOT recorded as an unreadable document: a filing still queued for
      // another look is not yet one, and the dashboard groups by this field.
      unparseableReason: null,
      nextAttemptAt: new Date(NOW.getTime() + OPTIONS.parseRetryBaseMs),
    });
  });

  it('says what it saw, so the operator is not left guessing', async () => {
    const repository = new StubRepository([
      { filing: filing(), attempts: 1, parseAttempts: 0 },
    ]);
    await unparseableWorker(repository).tick(NOW);

    expect(onlyRecorded(repository).lastError).toContain('truncated-at-origin');
    expect(onlyRecorded(repository).lastError).toContain('Invalid PDF');
  });

  it('bounds what it echoes from the parser into the record', async () => {
    const repository = new StubRepository([
      { filing: filing(), attempts: 1, parseAttempts: 0 },
    ]);
    const worker = new EnrichmentWorker(
      repository as unknown as EnrichmentRepository,
      new StubFetcher(okBody()) as unknown as AttachmentFetcher,
      new StubContext() as unknown as FilingContextService,
      new StubTelegram() as unknown as TelegramService,
      OPTIONS,
      async () => {
        // A parser message is third-party text reaching a stored record and a
        // log line; a newline in it forges a second log line.
        throw new Error(`x`.repeat(500) + '\nFAKE LOG LINE');
      },
    );
    await worker.tick(NOW);

    const { lastError } = onlyRecorded(repository);
    expect(lastError).not.toBeNull();
    expect(lastError?.length ?? 0).toBeLessThan(80);
    expect(lastError).not.toContain('\n');
  });

  it('spends the budget and then gives up for good', async () => {
    const repository = new StubRepository([
      {
        filing: filing(),
        attempts: 3,
        parseAttempts: OPTIONS.maxParseAttempts - 1,
      },
    ]);

    const result = await unparseableWorker(repository).tick(NOW);

    expect(result).toMatchObject({ unparseable: 1, parseRetried: 0 });
    expect(onlyRecorded(repository)).toMatchObject({
      state: 'unparseable',
      unparseableReason: 'truncated-at-origin',
      parseAttempts: OPTIONS.maxParseAttempts,
      nextAttemptAt: null,
    });
  });

  it('reads the second look successfully, which is the whole point', async () => {
    // The LICHSGFIN case end to end: the same URL, refetched, now complete.
    const repository = new StubRepository([
      { filing: filing(), attempts: 2, parseAttempts: 1 },
    ]);
    const worker = new EnrichmentWorker(
      repository as unknown as EnrichmentRepository,
      new StubFetcher(okBody()) as unknown as AttachmentFetcher,
      new StubContext() as unknown as FilingContextService,
      new StubTelegram() as unknown as TelegramService,
      OPTIONS,
      parserOf(ORDER_DOCUMENT),
    );

    expect((await worker.tick(NOW)).enriched).toBe(1);
    expect(onlyRecorded(repository)).toMatchObject({
      state: 'enriched',
      amountRupees: 185_366_820,
      // The spent attempt is kept on the record rather than reset, so the
      // history of a filing that needed a second look survives it.
      parseAttempts: 1,
    });
  });

  it.each([
    ['a ZIP', 'https://nsearchives.nseindia.com/corporate/x.zip', 'not-a-pdf'],
    ['a missing url', null, 'no-attachment'],
    [
      'a url off the archive host',
      'https://evil.example/x.pdf',
      'untrusted-host',
    ],
  ] as const)(
    'still gives up immediately on %s, however young the filing',
    async (_label, attachmentUrl, reason) => {
      const repository = new StubRepository([
        { filing: filing({ attachmentUrl }), attempts: 1, parseAttempts: 0 },
      ]);

      const result = await unparseableWorker(repository).tick(NOW);

      expect(result).toMatchObject({ unparseable: 1, parseRetried: 0 });
      expect(onlyRecorded(repository)).toMatchObject({
        state: 'unparseable',
        unparseableReason: reason,
      });
    },
  );

  it('still gives up immediately on a raster scan', async () => {
    // The document parsed. The characters-per-page distribution is bimodal
    // with a gap two orders of magnitude wide, so this is a scan and no
    // re-fetch produces a text layer.
    const { worker, repository } = harness({ text: '   \n \f ' });
    expect((await worker.tick(NOW)).unparseable).toBe(1);
    expect(onlyRecorded(repository)).toMatchObject({
      state: 'unparseable',
      unparseableReason: 'no-text-layer',
    });
  });

  it('never spends the parse budget on a timeout', async () => {
    // A network failure is not a failure to READ BYTES. Charging it to the
    // parse budget would put a filing back in the hole this all exists to fill.
    const repository = new StubRepository([
      { filing: filing(), attempts: 1, parseAttempts: 2 },
    ]);
    const worker = new EnrichmentWorker(
      repository as unknown as EnrichmentRepository,
      new StubFetcher({
        outcome: 'failed',
        status: null,
        message: 'socket hang up',
      }) as unknown as AttachmentFetcher,
      new StubContext() as unknown as FilingContextService,
      new StubTelegram() as unknown as TelegramService,
      OPTIONS,
      parserOf(ORDER_DOCUMENT),
    );

    expect((await worker.tick(NOW)).retried).toBe(1);
    expect(onlyRecorded(repository)).toMatchObject({
      state: 'pending',
      parseAttempts: 2,
    });
  });
});

/**
 * A worker that is not running looks exactly like a queue with nothing in it,
 * from outside — which is how this lane came to be silently absent from a
 * running deployment for a day while filings piled up behind it.
 */
describe('EnrichmentWorker — saying that it is alive', () => {
  it('reports the queue depth as soon as it starts', async () => {
    const { worker, repository } = harness({ queue: [] });

    const running = worker.start();
    worker.stop();
    await running;

    expect(repository.pendingCalls).toBeGreaterThanOrEqual(1);
  });

  it('keeps running when the depth cannot be read', async () => {
    // Instrumentation must never stop the loop that does the work.
    const { worker, repository } = harness({ queue: [] });
    repository.pendingThrows = true;

    const running = worker.start();
    worker.stop();

    await expect(running).resolves.toBeUndefined();
  });

  it('says so again after a spell of finding nothing', async () => {
    // A queue that has been empty for a while is the state a dead worker is
    // indistinguishable from, so the loop keeps saying it is there. Driven by
    // setting the idle interval to the heartbeat, so exactly one empty cycle
    // reaches the cadence.
    const { worker, repository } = harness({
      queue: [],
      options: { idleIntervalMs: HEARTBEAT_MS },
    });

    const running = worker.start();
    // The startup report is the first; the cadence produces the second.
    while (repository.pendingCalls < 2) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    worker.stop();
    await running;

    expect(repository.pendingCalls).toBeGreaterThanOrEqual(2);
  });

  it('beats every five minutes of idling, not on every empty tick', () => {
    // Pinned against a literal rather than against the constant, so a change to
    // the cadence is a decision this test reports rather than one it follows.
    expect(HEARTBEAT_MS).toBe(300_000);
    expect(HEARTBEAT_MS / OPTIONS.idleIntervalMs).toBeGreaterThan(1);
  });

  it('names every outcome a tick can have', () => {
    const line = describeTick({
      claimed: 7,
      enriched: 4,
      refused: 3,
      unparseable: 1,
      parseRetried: 1,
      retried: 1,
      failed: 0,
      claimed_lines: 2,
      claimsDiscarded: 5,
      resultsLines: 3,
      alerted: 2,
    });

    expect(line).toContain('claimed 7');
    expect(line).toContain('enriched 4');
    expect(line).toContain('refused on 3');
    expect(line).toContain('unparseable 1');
    expect(line).toContain('parse-retried 1');
    expect(line).toContain('retried 1');
    expect(line).toContain('failed 0');
    expect(line).toContain('claim-lines 2');
    expect(line).toContain('5 claim(s) discarded');
    expect(line).toContain('results-lines 3');
    expect(line).toContain('alerted 2');
  });
});

/**
 * The claim stage: what reaches a model, what comes back, and what is stored.
 *
 * NO NETWORK. A recorder stands in for the extractor, so every path — including
 * the ones that only happen when something has gone wrong — is exercised
 * without a key and without a request leaving the process.
 */
class StubExtractor {
  public readonly requests: ClaimExtractionRequest[] = [];

  constructor(
    private readonly result: ClaimExtractionResult = {
      outcome: 'ok',
      claims: [],
    },
    private readonly throws: Error | null = null,
  ) {}

  async extract(
    request: ClaimExtractionRequest,
  ): Promise<ClaimExtractionResult> {
    this.requests.push(request);
    if (this.throws !== null) throw this.throws;
    return this.result;
  }
}

/** A press release long enough and narrative enough to be worth a model call. */
const PRESS_RELEASE = [
  'Mumbai, India - August 6, 2026: The Company today outlined its FY31 vision,',
  'setting out its goal to build a Rs. 10,000 Cr Adjusted EBITDA business.',
  'The Company has joined the Microsoft Intelligent Security Association.',
  'x'.repeat(1_600),
].join('\n');

const TRUE_CLAIM = {
  span: 'The Company has joined the Microsoft Intelligent Security Association.',
  text: 'joins the Microsoft Intelligent Security Association',
  kind: 'partnership' as const,
};

const claimHarness = (
  extractor: StubExtractor | null,
  overrides: { category?: string; text?: string } = {},
) => {
  const repository = new StubRepository([
    {
      filing: filing({ category: overrides.category ?? 'Press Release' }),
      attempts: 1,
      parseAttempts: 0,
    },
  ]);
  const telegram = new StubTelegram();
  const worker = new EnrichmentWorker(
    repository as unknown as EnrichmentRepository,
    new StubFetcher(okBody()) as unknown as AttachmentFetcher,
    new StubContext() as unknown as FilingContextService,
    telegram as unknown as TelegramService,
    OPTIONS,
    parserOf(overrides.text ?? PRESS_RELEASE),
    extractor as unknown as ClaimExtractor | null,
  );
  return { worker, repository, telegram };
};

describe('EnrichmentWorker — notable claims', () => {
  it('stores a verified claim, its wire line and the document’s own sentence', async () => {
    const extractor = new StubExtractor({
      outcome: 'ok',
      claims: [TRUE_CLAIM],
    });
    const { worker, repository } = claimHarness(extractor);

    const result = await worker.tick(NOW);

    expect(result.claimed_lines).toBe(1);
    const stored = onlyRecorded(repository);
    expect(stored.claimLine).toBe(
      'RAILTEL: JOINS THE MICROSOFT INTELLIGENT SECURITY ASSOCIATION',
    );
    expect(stored.claims).toHaveLength(1);
    expect(PRESS_RELEASE).toContain(stored.claims[0].span);
    expect(stored.claimsProposed).toBe(1);
    expect(stored.claimRefusalReason).toBeNull();
  });

  it('sends the document, the symbol and the exchange’s own words', async () => {
    const extractor = new StubExtractor();
    const { worker } = claimHarness(extractor);
    await worker.tick(NOW);

    expect(extractor.requests).toHaveLength(1);
    expect(extractor.requests[0].symbol).toBe('RAILTEL');
    expect(extractor.requests[0].documentText).toBe(PRESS_RELEASE);
  });

  it('DISCARDS an invented claim and records why', async () => {
    const extractor = new StubExtractor({
      outcome: 'ok',
      claims: [
        {
          span: 'The Company will double its capacity within eighteen months.',
          text: 'plans to double capacity within eighteen months',
          kind: 'expansion',
        },
      ],
    });
    const { worker, repository } = claimHarness(extractor);

    const result = await worker.tick(NOW);

    expect(result.claimed_lines).toBe(0);
    expect(result.claimsDiscarded).toBe(1);
    const stored = onlyRecorded(repository);
    expect(stored.claimLine).toBeNull();
    expect(stored.claims).toEqual([]);
    expect(stored.claimDiscards[0].reason).toBe('span-not-found');
    expect(stored.claimRefusalReason).toBe('all-discarded');
  });

  it('keeps the good claim and drops the invented one from the same reply', async () => {
    const extractor = new StubExtractor({
      outcome: 'ok',
      claims: [
        TRUE_CLAIM,
        {
          span: 'an invented sentence about the company',
          text: 'an invented claim about it',
          kind: 'operational',
        },
      ],
    });
    const { worker, repository } = claimHarness(extractor);
    await worker.tick(NOW);

    const stored = onlyRecorded(repository);
    expect(stored.claims).toHaveLength(1);
    expect(stored.claimDiscards).toHaveLength(1);
    expect(stored.claimsProposed).toBe(2);
  });

  // THE REGRESSION TEST FOR THE RESULTS GAP, inverted from what it used to
  // assert. These categories were refused before a model was called, by a
  // 22-name allowlist that `Outcome of Board Meeting` was missing from — and
  // because a filing that was never read renders exactly like a filing with
  // nothing in it, that absence stayed invisible for weeks. No category decides
  // this any more.
  it.each([
    ['a category the allowlist called routine', 'Trading Window'],
    ['a category the allowlist excluded', 'Record Date'],
    ['the category the gap was in', 'Outcome of Board Meeting'],
    ['a category NSE has not invented yet', 'Some Future Category'],
  ])('now calls the model for %s', async (_label, category) => {
    const extractor = new StubExtractor();
    const { worker, repository } = claimHarness(extractor, { category });

    await worker.tick(NOW);

    expect(extractor.requests).toHaveLength(1);
    expect(onlyRecorded(repository).claimRefusalReason).not.toBe(
      'not-eligible',
    );
    expect(onlyRecorded(repository).coverageSkip).toBeNull();
  });

  it('never calls the model for a covering letter', async () => {
    const extractor = new StubExtractor();
    const { worker, repository } = claimHarness(extractor, {
      text: 'Please find enclosed the audio recording link. '.repeat(4),
    });

    await worker.tick(NOW);

    expect(extractor.requests).toEqual([]);
    const stored = onlyRecorded(repository);
    expect(stored.claimRefusalReason).toBe('not-eligible');
    expect(stored.claimRefusalDetail).toContain('covering letter');
  });

  it('invents no extractor when it is constructed without one', async () => {
    // The constructor's default is `null`, and it has to stay null: a worker
    // built without an extractor that quietly acquired one would record "the
    // model found nothing" on every eligible filing, which is the one wrong
    // answer here — indistinguishable from a working pipeline in a quiet market.
    const repository = new StubRepository([
      {
        filing: filing({ category: 'Press Release' }),
        attempts: 1,
        parseAttempts: 0,
      },
    ]);
    const worker = new EnrichmentWorker(
      repository as unknown as EnrichmentRepository,
      new StubFetcher(okBody()) as unknown as AttachmentFetcher,
      new StubContext() as unknown as FilingContextService,
      new StubTelegram() as unknown as TelegramService,
      OPTIONS,
      parserOf(PRESS_RELEASE),
    );

    await worker.tick(NOW);

    expect(onlyRecorded(repository).claimRefusalReason).toBe(
      'extractor-unavailable',
    );
  });

  it('records that nothing is configured rather than silently finding nothing', async () => {
    // "No extractor" and "the extractor found nothing" are different facts, and
    // a dashboard that rendered them the same would make an unconfigured
    // pipeline indistinguishable from a quiet market.
    const { worker, repository } = claimHarness(null);

    await worker.tick(NOW);

    expect(onlyRecorded(repository).claimRefusalReason).toBe(
      'extractor-unavailable',
    );
  });

  it('records the ordinary answer: the model found nothing', async () => {
    const { worker, repository } = claimHarness(new StubExtractor());
    await worker.tick(NOW);

    const stored = onlyRecorded(repository);
    expect(stored.claimRefusalReason).toBe('no-claims');
    expect(stored.claimsProposed).toBe(0);
  });

  it.each([
    [
      'the extractor reports a failure',
      new StubExtractor({ outcome: 'failed', message: '429 rate limited' }),
    ],
    [
      'the extractor throws despite its contract',
      new StubExtractor(undefined, new Error('socket hang up')),
    ],
  ])('stores the verdict anyway when %s', async (_label, extractor) => {
    // The amount, the counterparty and the headline are already worth storing,
    // and re-running the filing would spend another NSE request to reach them.
    const { worker, repository } = claimHarness(extractor);

    const result = await worker.tick(NOW);

    expect(result.enriched).toBe(1);
    const stored = onlyRecorded(repository);
    expect(stored.state).toBe('enriched');
    expect(stored.claimRefusalReason).toBe('extractor-error');
    expect(stored.claimRefusalDetail).not.toBeNull();
  });

  it('puts the claim line on the wire, for a filing with no figure at all', async () => {
    // The point of the whole feature. This document yields no amount, so the
    // headline degrades to the exchange's own category and the old gate would
    // have sent nothing — which is how six competitor lines were missed.
    const extractor = new StubExtractor({
      outcome: 'ok',
      claims: [TRUE_CLAIM],
    });
    const { worker, telegram, repository } = claimHarness(extractor);

    const result = await worker.tick(NOW);

    expect(onlyRecorded(repository).amountRupees).toBeNull();
    expect(result.alerted).toBe(1);
    expect(telegram.sent).toHaveLength(1);
    expect(telegram.sent[0]).toContain(
      'RAILTEL: JOINS THE MICROSOFT INTELLIGENT SECURITY ASSOCIATION',
    );
  });

  it('sends nothing when the document yields neither a figure nor a claim', async () => {
    const { worker, telegram } = claimHarness(new StubExtractor());
    await worker.tick(NOW);
    expect(telegram.sent).toEqual([]);
  });

  it('honours the per-filing claim cap', async () => {
    const four = ['alpha', 'beta', 'gamma', 'delta'].map((word) => ({
      ...TRUE_CLAIM,
      text: `joins the Microsoft Intelligent Security ${word}`,
    }));
    const repository = new StubRepository([
      {
        filing: filing({ category: 'Press Release' }),
        attempts: 1,
        parseAttempts: 0,
      },
    ]);
    const worker = new EnrichmentWorker(
      repository as unknown as EnrichmentRepository,
      new StubFetcher(okBody()) as unknown as AttachmentFetcher,
      new StubContext() as unknown as FilingContextService,
      new StubTelegram() as unknown as TelegramService,
      { ...OPTIONS, maxClaims: 2 },
      parserOf(PRESS_RELEASE),
      new StubExtractor({
        outcome: 'ok',
        claims: four,
      }) as unknown as ClaimExtractor,
    );

    await worker.tick(NOW);

    expect(onlyRecorded(repository).claims).toHaveLength(2);
  });

  it('never lets the claim stage cost the enrichment', async () => {
    const { worker, repository } = claimHarness(
      new StubExtractor(undefined, new Error('everything is on fire')),
    );

    const result = await worker.tick(NOW);

    expect(result).toMatchObject({ enriched: 1, claimed_lines: 0 });
    expect(onlyRecorded(repository).headline).not.toBeNull();
  });
});

describe('describeZipSource', () => {
  const opened = (members: ZipTextOk['members'], ignored: string[] = []) =>
    ({
      outcome: 'ok',
      text: 'x',
      pages: 1,
      truncated: false,
      members,
      ignored,
    }) as ZipTextOk;

  it('names each entry with its character count', () => {
    expect(
      describeZipSource(
        opened([{ fileName: 'a.pdf', bytes: 10, chars: 4576, message: null }]),
      ),
    ).toBe('zip: a.pdf (4576 chars)');
  });

  it('names an unreadable entry with the parser’s reason', () => {
    expect(
      describeZipSource(
        opened([
          {
            fileName: 'scan.pdf',
            bytes: 10,
            chars: null,
            message: 'no trailer',
          },
        ]),
      ),
    ).toBe('zip: scan.pdf (unreadable: no trailer)');
  });

  it('says so when an unreadable entry carried no reason', () => {
    expect(
      describeZipSource(
        opened([{ fileName: 'a.pdf', bytes: 10, chars: null, message: null }]),
      ),
    ).toContain('no reason given');
  });

  it('lists what it ignored, because an MP3 skipped is a fact about the filing', () => {
    expect(
      describeZipSource(
        opened(
          [{ fileName: 'a.pdf', bytes: 10, chars: 5, message: null }],
          ['WebXMLFile.xml', 'call.mp3'],
        ),
      ),
    ).toBe('zip: a.pdf (5 chars); ignored WebXMLFile.xml, call.mp3');
  });

  it('bounds what it stores', () => {
    const many = Array.from({ length: 60 }, (_v, index) => ({
      fileName: `entry-with-a-long-name-${index}.pdf`,
      bytes: 10,
      chars: 5,
      message: null,
    }));
    expect(describeZipSource(opened(many))).toHaveLength(
      MAX_DOCUMENT_SOURCE_CHARS,
    );
  });
});

describe('EnrichmentWorker — ZIP attachments', () => {
  const ZIP_URL =
    'https://nsearchives.nseindia.com/corporate/RESIGNATION_05082026.zip';

  const zipFiling = (): ClaimedFiling => ({
    filing: filing({
      attachmentUrl: ZIP_URL,
      category: 'Bagging/Receiving of orders/contracts',
    }),
    attempts: 1,
    parseAttempts: 0,
  });

  /** A reader over a described archive, standing in for yauzl. */
  const reader = (
    entries: readonly { name: string; body: Buffer | null }[],
  ): ZipReader => ({
    list: async () =>
      entries.map((entry) => ({
        fileName: entry.name,
        compressedSize: 1000,
        uncompressedSize: 1100,
      })),
    read: async (_archive, fileName) =>
      entries.find((entry) => entry.name === fileName)?.body ?? null,
  });

  it('reads the PDFs out of an archive and enriches the filing', async () => {
    // The whole point: `Resignation of Director/KMP/SMP` is 213 filings a month
    // and 100% ZIP, so this pipeline was blind to the category rather than
    // refusing it on the merits.
    const { worker, repository, fetcher } = harness({
      queue: [zipFiling()],
      zipReader: reader([
        { name: 'ORDER.pdf', body: Buffer.from('%PDF-a') },
        { name: 'WebXMLFile.xml', body: Buffer.from('<x/>') },
      ]),
    });

    const result = await worker.tick(NOW);
    expect(fetcher.urls).toEqual([ZIP_URL]);
    expect(result).toMatchObject({ enriched: 1, unparseable: 0 });
    expect(onlyRecorded(repository)).toMatchObject({ state: 'enriched' });
  });

  it('records which entries the text came from', async () => {
    const { worker, repository } = harness({
      queue: [zipFiling()],
      zipReader: reader([
        { name: 'ORDER.pdf', body: Buffer.from('%PDF-a') },
        { name: 'call.mp3', body: Buffer.from('sound') },
      ]),
    });

    await worker.tick(NOW);
    const source = onlyRecorded(repository).documentSource;
    expect(source).toContain('ORDER.pdf');
    expect(source).toContain('ignored call.mp3');
  });

  it('finds the amount inside an archived PDF', async () => {
    // End to end: the concatenated text goes through the same reader every
    // other document does, so an archived order intimation yields its figure.
    const { worker, repository } = harness({
      queue: [zipFiling()],
      zipReader: reader([{ name: 'ORDER.pdf', body: Buffer.from('%PDF-a') }]),
    });

    await worker.tick(NOW);
    expect(onlyRecorded(repository).amountRupees).toBe(185_366_820);
  });

  it('reaches unparseable for a zip bomb, and says so', async () => {
    const bomb: ZipReader = {
      list: async () => [
        { fileName: 'bomb.pdf', compressedSize: 1, uncompressedSize: 1e9 },
      ],
      read: async () => Buffer.from('x'),
    };
    const { worker, repository } = harness({
      queue: [zipFiling()],
      zipReader: bomb,
    });

    expect((await worker.tick(NOW)).unparseable).toBe(1);
    const recorded = onlyRecorded(repository);
    expect(recorded).toMatchObject({
      state: 'unparseable',
      unparseableReason: 'not-a-pdf',
      nextAttemptAt: null,
    });
    // The state is the one a ZIP already had; the REASON is new and is what
    // tells a bomb from an archive of spreadsheets on the dashboard.
    expect(recorded.lastError).toContain('compression-ratio');
  });

  it('reaches unparseable for an archive with no PDF in it', async () => {
    const { worker, repository } = harness({
      queue: [zipFiling()],
      zipReader: reader([
        { name: 'WebXMLFile.xml', body: Buffer.from('<x/>') },
      ]),
    });

    expect((await worker.tick(NOW)).unparseable).toBe(1);
    expect(onlyRecorded(repository).lastError).toContain('no-pdf-entries');
  });

  it('reaches unparseable when no archive reader is wired', async () => {
    // A supported state: ZIP attachments land exactly where they did before
    // this feature existed, and say so.
    const { worker, repository } = harness({
      queue: [zipFiling()],
      zipReader: null,
    });

    expect((await worker.tick(NOW)).unparseable).toBe(1);
    expect(onlyRecorded(repository)).toMatchObject({
      unparseableReason: 'not-a-pdf',
      lastError: 'no archive reader is configured',
    });
  });

  it('reaches no-text-layer for an archive of raster scans', async () => {
    const { worker, repository } = harness({
      queue: [zipFiling()],
      text: '   ',
      zipReader: reader([{ name: 'SCAN.pdf', body: Buffer.from('%PDF-a') }]),
    });

    expect((await worker.tick(NOW)).unparseable).toBe(1);
    expect(onlyRecorded(repository).unparseableReason).toBe('no-text-layer');
  });

  it('records a member the archive could not read, with its reason', async () => {
    const { worker, repository } = harness({
      queue: [zipFiling()],
      zipReader: {
        list: async () => [
          { fileName: 'a.pdf', compressedSize: 10, uncompressedSize: 12 },
          { fileName: 'b.pdf', compressedSize: 10, uncompressedSize: 12 },
        ],
        read: async (_archive, fileName) =>
          fileName === 'a.pdf' ? null : Buffer.from('%PDF-b'),
      },
    });

    await worker.tick(NOW);
    const source = onlyRecorded(repository).documentSource;
    expect(source).toContain('a.pdf (unreadable:');
    expect(source).toContain('b.pdf (');
  });

  it('leaves documentSource null for an ordinary PDF', async () => {
    const { worker, repository } = harness({});
    await worker.tick(NOW);
    expect(onlyRecorded(repository).documentSource).toBeNull();
  });
});

/**
 * The summary, and the wall between it and everything this pipeline publishes.
 *
 * Every test here exists because a summary is MODEL PROSE that no span
 * verifies. The claim list is the thing this project publishes from, and the
 * one property that must never quietly regress is that unverified text cannot
 * get into it or onto the wire.
 */
describe('EnrichmentWorker — the document summary', () => {
  const SUMMARY =
    'A press release in which the company sets out its FY31 vision and a ' +
    'target to build a Rs 10,000 Cr adjusted EBITDA business.';

  it('stores the summary in its own field, not among the claims', async () => {
    const { worker, repository } = claimHarness(
      new StubExtractor({
        outcome: 'ok',
        claims: [TRUE_CLAIM],
        summary: SUMMARY,
      }),
    );

    await worker.tick(NOW);
    const recorded = onlyRecorded(repository);
    expect(recorded.documentSummary).toBe(SUMMARY);
    // THE WALL. One verified claim, and the summary is not among them.
    expect(recorded.claims).toHaveLength(1);
    expect(recorded.claims.map((claim) => claim.text)).not.toContain(SUMMARY);
    expect(recorded.claimsProposed).toBe(1);
  });

  it('NEVER puts the summary on the wire', async () => {
    // The single most important assertion in this file. Telegram is the
    // outward-facing surface and it must carry only what the document says.
    const { worker, telegram } = claimHarness(
      new StubExtractor({
        outcome: 'ok',
        claims: [TRUE_CLAIM],
        summary: SUMMARY,
      }),
    );

    await worker.tick(NOW);
    expect(telegram.sent).toHaveLength(1);
    expect(telegram.sent[0]).not.toContain(SUMMARY);
    expect(telegram.sent[0]).not.toContain('FY31 vision');
    // And what it DOES carry is the verified claim.
    expect(telegram.sent[0]).toContain('MICROSOFT INTELLIGENT SECURITY');
  });

  it('keeps the summary out of the claim line', async () => {
    const { worker, repository } = claimHarness(
      new StubExtractor({
        outcome: 'ok',
        claims: [TRUE_CLAIM],
        summary: SUMMARY,
      }),
    );

    await worker.tick(NOW);
    expect(onlyRecorded(repository).claimLine).not.toContain('FY31');
  });

  it('stores a summary for a document that yielded no claim at all', async () => {
    // The case a summary is most useful for: a reviewer asking what a filing
    // with no wire line was about.
    const { worker, repository, telegram } = claimHarness(
      new StubExtractor({ outcome: 'ok', claims: [], summary: SUMMARY }),
    );

    await worker.tick(NOW);
    const recorded = onlyRecorded(repository);
    expect(recorded.documentSummary).toBe(SUMMARY);
    expect(recorded.claimRefusalReason).toBe('no-claims');
    // And still nothing on the wire, because there is nothing verified to say.
    expect(telegram.sent).toEqual([]);
  });

  it('stores a summary even when every claim was discarded', async () => {
    const { worker, repository } = claimHarness(
      new StubExtractor({
        outcome: 'ok',
        claims: [{ ...TRUE_CLAIM, span: 'a sentence the document never had' }],
        summary: SUMMARY,
      }),
    );

    await worker.tick(NOW);
    const recorded = onlyRecorded(repository);
    expect(recorded.claimRefusalReason).toBe('all-discarded');
    expect(recorded.documentSummary).toBe(SUMMARY);
  });

  it.each([
    [
      'an advisory summary',
      'This filing is clearly positive for the stock and supports a re-rating.',
      'advisory-language',
    ],
    [
      'a summary about litigation',
      'The company disclosed a civil suit filed before the Bombay High Court.',
      'legally-blocked',
    ],
    ['a fragment', 'an update', 'empty'],
  ])('refuses %s and says why', async (_label, summary, reason) => {
    const { worker, repository } = claimHarness(
      new StubExtractor({ outcome: 'ok', claims: [TRUE_CLAIM], summary }),
    );

    await worker.tick(NOW);
    const recorded = onlyRecorded(repository);
    expect(recorded.documentSummary).toBeNull();
    expect(recorded.documentSummaryRefusalReason).toBe(reason);
    // The claim survives. The two lanes are independent, so a refused summary
    // must not cost a verified claim.
    expect(recorded.claims).toHaveLength(1);
  });

  it('records no summary when the reply carried none', async () => {
    const { worker, repository } = claimHarness(
      new StubExtractor({ outcome: 'ok', claims: [TRUE_CLAIM] }),
    );

    await worker.tick(NOW);
    expect(onlyRecorded(repository)).toMatchObject({
      documentSummary: null,
      documentSummaryRefusalReason: 'empty',
    });
  });

  it('records no summary when the filing never reached a model', async () => {
    // A COVERING LETTER rather than a category, because the category no longer
    // decides. What remains is a structural property of the bytes in hand, and
    // it is the reason the skip can be counted rather than inferred.
    const { worker, repository } = claimHarness(null, {
      text: 'Please find enclosed the intimation. '.repeat(4),
    });

    await worker.tick(NOW);
    expect(onlyRecorded(repository)).toMatchObject({
      documentSummary: null,
      documentSummaryRefusalReason: null,
      claimRefusalReason: 'not-eligible',
      coverageSkip: 'covering-letter',
    });
  });
});

/**
 * The results lane.
 *
 * NO NETWORK, exactly as the claim lane's tests: a recorder stands in for the
 * results extractor so every refusal — including the ones that only happen when
 * a model has read the wrong table — is exercised without a key.
 */
class StubResultsExtractor {
  public readonly requests: ClaimExtractionRequest[] = [];

  constructor(
    private readonly result: ResultsExtractionResult = {
      outcome: 'ok',
      results: null,
    },
    private readonly throws: Error | null = null,
  ) {}

  async extractResults(
    request: ClaimExtractionRequest,
  ): Promise<ResultsExtractionResult> {
    this.requests.push(request);
    if (this.throws !== null) throw this.throws;
    return this.result;
  }
}

/** A statement built the way `pdf-parse` produces one. */
const STATEMENT_COLUMNS = '30.06.202631.03.202630.06.202531.03.2025';
const STATEMENT_ROW =
  'Revenue from operations 73,977.90 73,356.74 65,607.59 2,84,706.00';
const STATEMENT_DOCUMENT = [
  'UNAUDITED CONSOLIDATED FINANCIAL RESULTS',
  'FOR THE QUARTER ENDED JUNE 30, 2026',
  '₹ Million',
  STATEMENT_COLUMNS,
  STATEMENT_ROW,
  'Profit for the period (9 - 10) 3,488.72 6,309.73 128.78 13,724.16',
  'padding '.repeat(300),
].join('\n');

const PROPOSED_RESULTS = {
  basis: 'consolidated' as const,
  columnsSpan: STATEMENT_COLUMNS,
  figures: [
    {
      metric: 'revenue' as const,
      current: '73,977.90',
      prior: '65,607.59',
      span: STATEMENT_ROW,
    },
  ],
};

const resultsHarness = (
  extractor: StubResultsExtractor | null,
  overrides: { category?: string; text?: string } = {},
) => {
  const repository = new StubRepository([
    {
      filing: filing({
        category: overrides.category ?? 'Outcome of Board Meeting',
      }),
      attempts: 1,
      parseAttempts: 0,
    },
  ]);
  const telegram = new StubTelegram();
  const worker = new EnrichmentWorker(
    repository as unknown as EnrichmentRepository,
    new StubFetcher(okBody()) as unknown as AttachmentFetcher,
    new StubContext() as unknown as FilingContextService,
    telegram as unknown as TelegramService,
    OPTIONS,
    parserOf(overrides.text ?? STATEMENT_DOCUMENT),
    null,
    null,
    extractor as unknown as ResultsExtractor | null,
  );
  return { worker, repository, telegram };
};

describe('EnrichmentWorker — financial results', () => {
  it('stores a verified table, its wire line and the rows behind it', async () => {
    const { worker, repository } = resultsHarness(
      new StubResultsExtractor({ outcome: 'ok', results: PROPOSED_RESULTS }),
    );

    const result = await worker.tick(NOW);

    expect(result.resultsLines).toBe(1);
    const stored = onlyRecorded(repository);
    expect(stored.resultsLine).toBe(
      'RAILTEL Q1 FY27 (CONSOLIDATED): REVENUE ₹73,977.90 MN VS ₹65,607.59 MN (YOY)',
    );
    expect(stored.results?.basis).toBe('consolidated');
    expect(stored.results?.period).toBe('Q1 FY27');
    expect(STATEMENT_DOCUMENT).toContain(stored.results?.figures[0].span);
    expect(stored.resultsProposed).toBe(1);
    expect(stored.resultsRefusalReason).toBeNull();
  });

  it('sends the document, the symbol and the exchange own words', async () => {
    const extractor = new StubResultsExtractor();
    const { worker } = resultsHarness(extractor);
    await worker.tick(NOW);
    expect(extractor.requests[0]).toEqual({
      symbol: 'RAILTEL',
      category: 'Outcome of Board Meeting',
      summary: expect.any(String),
      documentText: STATEMENT_DOCUMENT,
    });
  });

  it('never calls a model for a category with no statement in it', async () => {
    const extractor = new StubResultsExtractor();
    const { worker, repository } = resultsHarness(extractor, {
      category: 'Record Date',
    });
    await worker.tick(NOW);
    expect(extractor.requests).toHaveLength(0);
    const stored = onlyRecorded(repository);
    expect(stored.resultsRefusalReason).toBe('not-eligible');
    expect(stored.resultsProposed).toBeNull();
  });

  it('records that nothing is configured rather than a silent nothing', async () => {
    const { worker, repository } = resultsHarness(null);
    await worker.tick(NOW);
    expect(onlyRecorded(repository).resultsRefusalReason).toBe(
      'extractor-unavailable',
    );
  });

  it.each([
    [
      'the model found no statement',
      new StubResultsExtractor({ outcome: 'ok', results: null }),
      'no-results',
    ],
    [
      'the extractor failed',
      new StubResultsExtractor({ outcome: 'failed', message: 'a 429' }),
      'extractor-error',
    ],
    [
      'the extractor threw, which it is contracted never to do',
      new StubResultsExtractor(undefined, new Error('boom')),
      'extractor-error',
    ],
  ])('records %s', async (_label, extractor, expected) => {
    const { worker, repository } = resultsHarness(extractor);
    const result = await worker.tick(NOW);
    // The enrichment still lands: a failing results lane costs the results and
    // never the amount, the claims or the headline.
    expect(result.enriched).toBe(1);
    const stored = onlyRecorded(repository);
    expect(stored.resultsRefusalReason).toBe(expected);
    expect(stored.resultsLine).toBeNull();
  });

  it('records the gate own refusal, with the reason', async () => {
    // The dangerous case, end to end: a standalone figure labelled consolidated.
    const { worker, repository } = resultsHarness(
      new StubResultsExtractor({
        outcome: 'ok',
        results: { ...PROPOSED_RESULTS, basis: 'standalone' },
      }),
    );
    await worker.tick(NOW);
    const stored = onlyRecorded(repository);
    expect(stored.resultsRefusalReason).toBe('basis-not-determinable');
    expect(stored.resultsLine).toBeNull();
    expect(stored.results).toBeNull();
  });

  it('puts the results line on the wire, ahead of everything else', async () => {
    const { worker, telegram } = resultsHarness(
      new StubResultsExtractor({ outcome: 'ok', results: PROPOSED_RESULTS }),
    );
    await worker.tick(NOW);
    expect(telegram.sent).toHaveLength(1);
    expect(telegram.sent[0].split('\n')[0]).toContain(
      'RAILTEL Q1 FY27 (CONSOLIDATED)',
    );
  });

  it('sends nothing when the table was refused and nothing else was found', async () => {
    const { worker, telegram } = resultsHarness(
      new StubResultsExtractor({ outcome: 'ok', results: null }),
    );
    await worker.tick(NOW);
    expect(telegram.sent).toHaveLength(0);
  });
});
