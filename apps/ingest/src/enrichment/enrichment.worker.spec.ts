import type {
  AttachmentFetcher,
  AttachmentResult,
  ClaimedFiling,
  EnrichmentRepository,
  Filing,
  FilingEnrichment,
  PdfParser,
} from '@app/filings';
import type { TelegramService } from '@app/notify';
import type { FilingContextService } from './filing-context.service';
import { EnrichmentWorker, type EnrichmentOptions } from './enrichment.worker';

const NOW = new Date('2026-08-06T06:00:00.000Z');
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

  constructor(private queue: ClaimedFiling[] = []) {}

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
  leaseMs: 60_000,
  alertWindowMs: 600_000,
  watchlist: [],
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
}): Harness {
  const repository = new StubRepository(
    overrides.queue ?? [{ filing: filing(), attempts: 1 }],
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
        { filing: filing({ seqId: 3 }), attempts: 1 },
        { filing: filing({ seqId: 2 }), attempts: 1 },
        { filing: filing({ seqId: 1 }), attempts: 1 },
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
    }));
    const { worker } = harness({ queue, options: { batchSize: 4 } });

    expect((await worker.tick(NOW)).claimed).toBe(4);
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
      queue: [{ filing: filing({ category: 'Trading Window' }), attempts: 1 }],
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
    const repository = new StubRepository([{ filing: filing(), attempts: 1 }]);
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
      'a ZIP attachment',
      'https://nsearchives.nseindia.com/corporate/resignation.zip',
      'not-a-pdf',
    ],
    [
      'a URL off the archive host',
      'https://example.com/a.pdf',
      'untrusted-host',
    ],
  ])('reaches unparseable for %s', async (_label, attachmentUrl, reason) => {
    const { worker, repository, fetcher } = harness({
      queue: [{ filing: filing({ attachmentUrl }), attempts: 1 }],
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
    const worker = new EnrichmentWorker(
      new StubRepository([
        { filing: filing(), attempts: 1 },
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

  it('records the parser message on a truncated document', async () => {
    const repository = new StubRepository([{ filing: filing(), attempts: 1 }]);
    const worker = new EnrichmentWorker(
      repository as unknown as EnrichmentRepository,
      new StubFetcher(okBody()) as unknown as AttachmentFetcher,
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
      unparseableReason: 'truncated-at-origin',
      lastError: "Couldn't find trailer dictionary",
    });
  });

  it('reaches unparseable for a raster scan with no text layer', async () => {
    const { worker, repository } = harness({ text: '   \n \f ' });
    expect((await worker.tick(NOW)).unparseable).toBe(1);
    expect(onlyRecorded(repository).unparseableReason).toBe('no-text-layer');
  });

  it('reaches unparseable for an oversized attachment', async () => {
    const { worker, repository } = harness({
      fetch: { outcome: 'oversized', bytes: 30_000_000 },
    });

    expect((await worker.tick(NOW)).unparseable).toBe(1);
    expect(onlyRecorded(repository)).toMatchObject({
      state: 'unparseable',
      unparseableReason: 'oversized',
    });
  });

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
      { outcome: 'oversized', bytes: null } as const,
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
      queue: [{ filing: filing(), attempts: 2 }],
      fetch: { outcome: 'failed', status: 503, message: 'nope' },
    });

    await worker.tick(NOW);
    expect(onlyRecorded(repository).nextAttemptAt).toEqual(
      new Date(NOW.getTime() + OPTIONS.retryBaseMs * 2),
    );
  });

  it('gives up once the attempt budget is spent', async () => {
    const { worker, repository } = harness({
      queue: [{ filing: filing(), attempts: OPTIONS.maxAttempts }],
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
    const repository = new StubRepository([{ filing: filing(), attempts: 1 }]);
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
      { filing: filing({ seqId: 1 }), attempts: 1 },
      { filing: filing({ seqId: 2 }), attempts: 1 },
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
    const repository = new StubRepository([{ filing: filing(), attempts: 1 }]);
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
      retried: 0,
      failed: 0,
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
      queue: [{ filing: filing(), attempts: 1 }],
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
      queue: [{ filing: filing(), attempts: 1 }],
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
        { filing: filing({ seqId: 1 }), attempts: 1 },
        { filing: filing({ seqId: 2 }), attempts: 1 },
        { filing: filing({ seqId: 3 }), attempts: 1 },
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
      { filing: filing({ seqId: 1 }), attempts: 1 },
      { filing: filing({ seqId: 2 }), attempts: 1 },
      { filing: filing({ seqId: 3 }), attempts: 1 },
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
