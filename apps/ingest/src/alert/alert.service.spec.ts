import { Logger } from '@nestjs/common';
import { AlertService, type AlertOptions } from './alert.service';
import { formatFilingAlert, type TelegramService } from '@app/notify';
import type { Filing } from '@app/filings';

const now = new Date('2026-08-05T05:00:00.000Z');

// Nest's logger writes to stdout on every run; the assertions below spy on
// Logger.prototype instead, so the real transport is off for the whole file.
beforeAll(() => Logger.overrideLogger(false));

const makeFiling = (overrides: Partial<Filing> = {}): Filing => ({
  seqId: 1,
  symbol: 'PANACEABIO',
  isin: 'INE922B01023',
  companyName: 'Panacea Biotec Limited',
  industry: 'Pharmaceuticals',
  category: 'Bagging/Receiving of orders/contracts',
  summary: 'Order received',
  attachmentUrl: null,
  announcedAt: new Date('2026-08-05T04:59:50.000Z'),
  disseminatedAt: new Date('2026-08-05T04:59:50.000Z'),
  ingestedAt: now,
  ...overrides,
});

describe('AlertService', () => {
  let sent: string[];
  let service: AlertService;

  const telegram = { send: async (t: string) => void sent.push(t) };

  beforeEach(() => {
    sent = [];
    service = new AlertService(telegram as never, {
      alertWindowMs: 10 * 60 * 1000,
      watchlist: [],
    });
  });

  it('alerts a fresh non-routine filing', async () => {
    const alerted = await service.processInserted([makeFiling()], now);

    expect(alerted).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('PANACEABIO');
  });

  it('suppresses routine categories', async () => {
    const alerted = await service.processInserted(
      [makeFiling({ category: 'Copy of Newspaper Publication' })],
      now,
    );

    expect(alerted).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('suppresses a stale backfill entirely', async () => {
    const backfill = Array.from({ length: 500 }, (_, i) =>
      makeFiling({
        seqId: i,
        disseminatedAt: new Date('2026-08-04T10:00:00.000Z'),
      }),
    );

    const alerted = await service.processInserted(backfill, now);

    expect(alerted).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('restricts to the watchlist when one is configured', async () => {
    service = new AlertService(telegram as never, {
      alertWindowMs: 10 * 60 * 1000,
      watchlist: ['RELIANCE'],
    });

    const alerted = await service.processInserted(
      [
        makeFiling({ symbol: 'PANACEABIO' }),
        makeFiling({ seqId: 2, symbol: 'RELIANCE' }),
      ],
      now,
    );

    expect(alerted.map((f) => f.symbol)).toEqual(['RELIANCE']);
  });

  it('matches the watchlist case-insensitively', async () => {
    service = new AlertService(telegram as never, {
      alertWindowMs: 10 * 60 * 1000,
      watchlist: ['reliance'],
    });

    const alerted = await service.processInserted(
      [makeFiling({ symbol: 'RELIANCE' })],
      now,
    );

    expect(alerted).toHaveLength(1);
  });

  it('sends oldest-first so the feed reads chronologically', async () => {
    const older = makeFiling({ seqId: 1, symbol: 'AAA' });
    const newer = makeFiling({ seqId: 2, symbol: 'BBB' });

    await service.processInserted([newer, older], now);

    expect(sent[0]).toContain('AAA');
    expect(sent[1]).toContain('BBB');
  });

  it('handles an empty batch', async () => {
    expect(await service.processInserted([], now)).toEqual([]);
    expect(sent).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Everything below extends the brief's seven tests with the five decisions
// carried forward from earlier reviews, each of which guards a failure that is
// SILENT: a scrambled or aborted batch still resolves, and a resolved send is
// not a delivered message.
// ---------------------------------------------------------------------------

const WINDOW = 10 * 60 * 1000;
const STALE = new Date('2026-08-04T10:00:00.000Z');

interface Channel {
  readonly telegram: TelegramService;
  readonly sent: string[];
  /** Highest number of sends observed in flight at once. */
  peak: () => number;
}

/**
 * A stub rather than a real TelegramService: the real one needs a ConfigService
 * and a mocked bot, and none of that is what these tests are about.
 *
 * The in-flight counter is the point. A `Promise.all` implementation starts
 * every send before any of them resolves, so it peaks at N; awaiting each send
 * in turn peaks at 1. Without the `await` inside the stub the two are
 * indistinguishable, because a synchronous push records call order either way.
 */
const makeChannel = (delayFor: (text: string) => number = () => 0): Channel => {
  const sent: string[] = [];
  let inFlight = 0;
  let peak = 0;

  const telegram = {
    send: async (text: string): Promise<void> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, delayFor(text)));
      sent.push(text);
      inFlight -= 1;
    },
  } as unknown as TelegramService;

  return { telegram, sent, peak: () => peak };
};

/** A channel whose send rejects, to prove the loop survives one that does. */
const failingChannel = (reason: unknown): TelegramService =>
  ({
    send: async (): Promise<void> => {
      throw reason;
    },
  }) as unknown as TelegramService;

const build = (
  telegram: TelegramService,
  options: Partial<AlertOptions> = {},
): AlertService =>
  new AlertService(telegram, {
    alertWindowMs: WINDOW,
    watchlist: [],
    ...options,
  });

/**
 * Builds a record with a field in a shape the Filing type forbids but a real
 * read can produce — a projection that omits a column, a document written
 * before a field existed. `as unknown as Filing` rather than `any`.
 */
const malformed = (overrides: Readonly<Record<string, unknown>>): Filing =>
  ({ ...makeFiling(), ...overrides }) as unknown as Filing;

describe('AlertService: send order is chronological, oldest message first', () => {
  /**
   * The reasoning this pins, because it is not self-evident and inverting it
   * costs nothing at test time but reads backwards to a human:
   *
   *   NSE pages newest-first, and `partitionForAlerting` preserves input order.
   *   Sending that order sequentially posts the NEWEST filing FIRST, which makes
   *   it the OLDEST message in the chat — the freshest news buried above older
   *   news. Sorting ascending by seqId sends the oldest first, so the newest
   *   filing is the last send and therefore the most recent message, which is
   *   where a reader's eye already is.
   */
  const shuffled = (): Filing[] => [
    makeFiling({ seqId: 5, symbol: 'EEE' }),
    makeFiling({ seqId: 3, symbol: 'CCC' }),
    makeFiling({ seqId: 1, symbol: 'AAA' }),
    makeFiling({ seqId: 4, symbol: 'DDD' }),
    makeFiling({ seqId: 2, symbol: 'BBB' }),
  ];

  it('sends in ascending seqId order regardless of input order', async () => {
    const channel = makeChannel();

    await build(channel.telegram).processInserted(shuffled(), now);

    expect(channel.sent.map((text) => text.slice(0, 3))).toEqual([
      'AAA',
      'BBB',
      'CCC',
      'DDD',
      'EEE',
    ]);
  });

  it('does not preserve NSE newest-first order, which would read backwards', async () => {
    // NSE's own order for the batch above is 5,4,3,2,1. Relaying it verbatim is
    // the bug: the newest filing would be the oldest message on screen.
    const channel = makeChannel();
    const newestFirst = [
      makeFiling({ seqId: 3, symbol: 'CCC' }),
      makeFiling({ seqId: 2, symbol: 'BBB' }),
      makeFiling({ seqId: 1, symbol: 'AAA' }),
    ];

    await build(channel.telegram).processInserted(newestFirst, now);

    expect(channel.sent[0]).toContain('AAA');
  });

  it('lands the newest filing last, as the most recent chat message', async () => {
    const channel = makeChannel();

    const alerted = await build(channel.telegram).processInserted(
      shuffled(),
      now,
    );

    const newest = Math.max(...alerted.map((filing) => filing.seqId));
    expect(newest).toBe(5);
    expect(channel.sent[channel.sent.length - 1]).toContain('EEE');
  });

  it('returns the filings in the same order it sent them', async () => {
    const channel = makeChannel();

    const alerted = await build(channel.telegram).processInserted(
      shuffled(),
      now,
    );

    expect(alerted.map((filing) => filing.seqId)).toEqual([1, 2, 3, 4, 5]);
  });

  it('orders by seqId, not by symbol', async () => {
    // Every other fixture here numbers its symbols alphabetically, which would
    // let a sort on the wrong key pass. These two disagree.
    const channel = makeChannel();
    const batch = [
      makeFiling({ seqId: 1, symbol: 'ZZZ' }),
      makeFiling({ seqId: 2, symbol: 'AAA' }),
    ];

    await build(channel.telegram).processInserted(batch, now);

    expect(channel.sent[0]).toContain('ZZZ');
    expect(channel.sent[1]).toContain('AAA');
  });

  it('keeps input order for equal seqIds rather than reshuffling them', async () => {
    // Duplicate seqIds cannot occur — Task 7 puts a unique index on the field —
    // but a comparator returning 0 must not be an excuse to reorder.
    const channel = makeChannel();
    const tied = [
      makeFiling({ seqId: 7, symbol: 'FIRST' }),
      makeFiling({ seqId: 7, symbol: 'SECOND' }),
    ];

    await build(channel.telegram).processInserted(tied, now);

    expect(channel.sent[0]).toContain('FIRST');
    expect(channel.sent[1]).toContain('SECOND');
  });
});

/**
 * SEQUENTIAL, NEVER `Promise.all`. Two things break under concurrency and
 * neither raises anything: Telegram's per-chat rate limit answers 429, which
 * `TelegramService.send` swallows by design, so the filing is simply lost; and
 * the messages arrive in whatever order the API returns, destroying the
 * chronological ordering the sort above exists to produce.
 */
describe('AlertService: sends sequentially', () => {
  it('never has two sends in flight at once', async () => {
    const channel = makeChannel(() => 5);
    const batch = Array.from({ length: 6 }, (_unused, index) =>
      makeFiling({ seqId: index + 1, symbol: `SYM${index}` }),
    );

    await build(channel.telegram).processInserted(batch, now);

    expect(channel.peak()).toBe(1);
    expect(channel.sent).toHaveLength(6);
  });

  it('awaits each send before starting the next, so order survives latency', async () => {
    // The first send is the slowest. Under `Promise.all` the fast ones resolve
    // first and the chat reads 3, 2, 1 despite the sort.
    const channel = makeChannel((text) =>
      text.startsWith('AAA') ? 30 : text.startsWith('BBB') ? 10 : 0,
    );
    const batch = [
      makeFiling({ seqId: 1, symbol: 'AAA' }),
      makeFiling({ seqId: 2, symbol: 'BBB' }),
      makeFiling({ seqId: 3, symbol: 'CCC' }),
    ];

    await build(channel.telegram).processInserted(batch, now);

    expect(channel.sent.map((text) => text.slice(0, 3))).toEqual([
      'AAA',
      'BBB',
      'CCC',
    ]);
  });

  it('has finished every send by the time it resolves', async () => {
    const channel = makeChannel(() => 10);
    const batch = Array.from({ length: 4 }, (_unused, index) =>
      makeFiling({ seqId: index + 1, symbol: `SYM${index}` }),
    );

    await build(channel.telegram).processInserted(batch, now);

    // A fire-and-forget loop resolves with an empty or partial `sent`.
    expect(channel.sent).toHaveLength(4);
  });
});

/**
 * ONE BAD RECORD MUST NOT ABORT THE BATCH. `formatFilingAlert` calls
 * `.toUpperCase()` on `symbol` and `category` and `.replace()` on `summary`;
 * `isRoutine` calls `.trim()` on `category`. Every one of those throws a
 * TypeError on a record whose field is absent or not a string, which a
 * projected read or a pre-migration document can produce. Unhandled, the throw
 * escapes `processInserted` into the poll loop and the whole rest of the batch
 * — including the filing the user is waiting for — is never sent.
 */
describe('AlertService: a malformed record is skipped, not fatal', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  /**
   * Every shape here throws from a DIFFERENT call site, which is the point:
   * classification (`isRoutine`), watchlist matching and formatting each read a
   * different field, so a try/catch around the send alone leaves two of the
   * three uncovered.
   */
  const BAD_SHAPES: ReadonlyArray<readonly [string, Record<string, unknown>]> =
    [
      ['category absent (throws in isRoutine)', { category: undefined }],
      ['category null', { category: null }],
      ['category non-string', { category: 42 }],
      ['symbol absent (throws in the formatter)', { symbol: undefined }],
      ['symbol null', { symbol: null }],
      ['symbol non-string', { symbol: 42 }],
      ['summary absent (throws escaping)', { summary: undefined }],
      ['summary non-string', { summary: { text: 'nested' } }],
    ];

  it.each(BAD_SHAPES)(
    'delivers the rest of the batch when the middle filing has %s',
    async (_label, overrides) => {
      const channel = makeChannel();
      const batch = [
        makeFiling({ seqId: 1, symbol: 'AAA' }),
        malformed({ seqId: 2, ...overrides }),
        makeFiling({ seqId: 3, symbol: 'CCC' }),
      ];

      const alerted = await build(channel.telegram).processInserted(batch, now);

      expect(channel.sent).toHaveLength(2);
      expect(channel.sent[0]).toContain('AAA');
      expect(channel.sent[1]).toContain('CCC');
      expect(alerted.map((filing) => filing.seqId)).toEqual([1, 3]);
    },
  );

  it.each(BAD_SHAPES)(
    'resolves rather than rejecting on %s',
    async (_label, overrides) => {
      const channel = makeChannel();

      await expect(
        build(channel.telegram).processInserted(
          [malformed({ seqId: 2, ...overrides })],
          now,
        ),
      ).resolves.toEqual([]);
    },
  );

  it.each(BAD_SHAPES)(
    'logs %s at error level, naming the seqId that failed',
    async (_label, overrides) => {
      const channel = makeChannel();

      await build(channel.telegram).processInserted(
        [malformed({ seqId: 106726042, ...overrides })],
        now,
      );

      // Silently dropping a filing is the one outcome worse than failing to
      // send it: the seqId is what makes the loss diagnosable and replayable.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const logged = errorSpy.mock.calls[0].map(String).join(' ');
      expect(logged).toContain('106726042');
    },
  );

  it('keeps going when the malformed record is first', async () => {
    const channel = makeChannel();
    const batch = [
      malformed({ seqId: 1, category: undefined }),
      makeFiling({ seqId: 2, symbol: 'BBB' }),
    ];

    const alerted = await build(channel.telegram).processInserted(batch, now);

    expect(channel.sent).toHaveLength(1);
    expect(alerted.map((filing) => filing.seqId)).toEqual([2]);
  });

  it('keeps going when every record is malformed', async () => {
    const channel = makeChannel();
    const batch = BAD_SHAPES.map(([, overrides], index) =>
      malformed({ seqId: index + 1, ...overrides }),
    );

    const alerted = await build(channel.telegram).processInserted(batch, now);

    expect(alerted).toEqual([]);
    expect(channel.sent).toEqual([]);
    expect(errorSpy).toHaveBeenCalledTimes(BAD_SHAPES.length);
  });

  /**
   * A programming error inside the pipeline — not a bad record — must not read
   * as a flaky data feed. It is still contained, because one filing may never
   * cost the batch, but the stack goes to the log so the bug is findable.
   */
  it('logs the stack when the failure carries one', async () => {
    const bug = new TypeError('Cannot read properties of undefined');

    await build(failingChannel(bug)).processInserted([makeFiling()], now);

    // Nest renders Logger.error's second parameter as the trace. Asserting on
    // `bug.stack` by identity is what proves it is not being dropped.
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('TypeError'),
      bug.stack,
    );
  });

  it('describes a record whose seqId is itself missing, without throwing', async () => {
    // The log line must be total too: a formatter for an error path that throws
    // re-raises from inside the catch that exists to contain the failure.
    const channel = makeChannel();

    await expect(
      build(channel.telegram).processInserted(
        [malformed({ seqId: undefined, category: undefined })],
        now,
      ),
    ).resolves.toEqual([]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('logs a record whose seqId cannot be stringified at all', async () => {
    // The log line is built inside the catch, so anything it touches must be
    // total too: a template literal on a null-prototype object throws "Cannot
    // convert object to primitive value", and that throw would escape the catch
    // whose entire job is to contain the failure.
    const unprintableSeqId = Object.create(null) as number;
    const channel = makeChannel();

    await expect(
      build(channel.telegram).processInserted(
        [malformed({ seqId: unprintableSeqId, category: undefined })],
        now,
      ),
    ).resolves.toEqual([]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('matches the watchlist without throwing on an absent symbol', async () => {
    // With a watchlist configured, `isWatched` reads `symbol` — a third call
    // site, reached only in this configuration.
    const channel = makeChannel();
    const service = build(channel.telegram, { watchlist: ['RELIANCE'] });

    const alerted = await service.processInserted(
      [
        malformed({ seqId: 1, symbol: undefined }),
        makeFiling({ seqId: 2, symbol: 'RELIANCE' }),
      ],
      now,
    );

    expect(alerted.map((filing) => filing.seqId)).toEqual([2]);
    expect(channel.sent).toHaveLength(1);
  });

  /**
   * `TelegramService.send` is documented never to reject — it catches
   * everything internally. This suite does not trust that: Task 12 wires the
   * dependency, a future notifier may not keep the promise, and the cost of
   * being wrong is a whole batch lost to one send.
   */
  const REJECTIONS: ReadonlyArray<readonly [string, unknown]> = [
    ['an Error', new Error('ETELEGRAM: 429 Too Many Requests')],
    ['a thrown string', 'socket hang up'],
    ['null', null],
    ['undefined', undefined],
  ];

  it.each(REJECTIONS)(
    'survives a send that rejects with %s',
    async (_label, reason) => {
      const service = build(failingChannel(reason));

      await expect(
        service.processInserted([makeFiling({ seqId: 1 })], now),
      ).resolves.toEqual([]);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    },
  );

  it('describes a rejection that cannot be stringified at all', async () => {
    // Neither Symbol.toPrimitive nor toString: `String(value)` throws. The
    // describer must still terminate in a string, because its caller is a catch.
    const unprintable: Record<string, unknown> = Object.create(null);
    unprintable.self = unprintable;

    await expect(
      build(failingChannel(unprintable)).processInserted([makeFiling()], now),
    ).resolves.toEqual([]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});

/**
 * THE TWO GATES ARE INDEPENDENT. The window gate suppresses a cold-start drain;
 * the routine gate suppresses no-signal categories. Collapsing them into one
 * condition — or letting either subsume the other — would restore exactly the
 * failure the other exists to prevent, and both failures are silent.
 */
describe('AlertService: the window gate and the routine gate apply independently', () => {
  const CASES: ReadonlyArray<readonly [string, Partial<Filing>, boolean]> = [
    ['fresh and non-routine', {}, true],
    ['fresh but routine', { category: 'Trading Window' }, false],
    ['stale but non-routine', { disseminatedAt: STALE }, false],
    [
      'stale and routine',
      { category: 'Updates', disseminatedAt: STALE },
      false,
    ],
  ];

  it.each(CASES)('%s -> alerts: %s', async (_label, overrides, expected) => {
    const channel = makeChannel();

    const alerted = await build(channel.telegram).processInserted(
      [makeFiling(overrides)],
      now,
    );

    expect(alerted).toHaveLength(expected ? 1 : 0);
    expect(channel.sent).toHaveLength(expected ? 1 : 0);
  });

  it('suppresses a routine filing that is inside the window', async () => {
    // Isolates the routine gate: freshness alone must not be enough.
    const channel = makeChannel();

    const alerted = await build(channel.telegram).processInserted(
      [makeFiling({ category: 'Copy of Newspaper Publication' })],
      now,
    );

    expect(alerted).toEqual([]);
  });

  it('suppresses a non-routine filing that is outside the window', async () => {
    // Isolates the window gate: a market-moving category must not bypass it.
    const channel = makeChannel();

    const alerted = await build(channel.telegram).processInserted(
      [makeFiling({ disseminatedAt: STALE })],
      now,
    );

    expect(alerted).toEqual([]);
  });

  it('picks the one live filing out of a cold-start drain of routine noise', async () => {
    const channel = makeChannel();
    const drain = [
      ...Array.from({ length: 300 }, (_unused, index) =>
        makeFiling({
          seqId: index + 1,
          symbol: 'OLD',
          disseminatedAt: STALE,
        }),
      ),
      makeFiling({ seqId: 400, symbol: 'NOISE', category: 'Trading Window' }),
      makeFiling({ seqId: 401, symbol: 'LIVE' }),
    ];

    const alerted = await build(channel.telegram).processInserted(drain, now);

    expect(alerted.map((filing) => filing.symbol)).toEqual(['LIVE']);
    expect(channel.sent).toHaveLength(1);
  });

  it('applies the routine gate case- and whitespace-insensitively', async () => {
    const channel = makeChannel();

    const alerted = await build(channel.telegram).processInserted(
      [makeFiling({ category: '  TRADING WINDOW  ' })],
      now,
    );

    expect(alerted).toEqual([]);
  });
});

/**
 * WHAT THE RETURN VALUE MEANS. `TelegramService.send()` resolves on a Telegram
 * outage, on a 400, and when credentials are absent entirely — it catches and
 * logs rather than rejecting, so that a notification failure can never stop
 * ingestion. Nothing downstream may read a resolved send as delivery.
 */
describe('AlertService: the return value is attempted, not delivered', () => {
  it('returns filings whose send resolved without reaching Telegram', async () => {
    // Exactly the shape of TelegramService with no credentials configured: it
    // logs and returns. TASK 12 MUST NOT persist an "alerted" flag on this.
    const blackHole = {
      send: async (): Promise<void> => undefined,
    } as unknown as TelegramService;

    const alerted = await build(blackHole).processInserted(
      [makeFiling({ seqId: 1 })],
      now,
    );

    expect(alerted).toHaveLength(1);
  });

  /**
   * The one thing the value does promise: a record that threw before the send
   * was issued is not in it.
   *
   * Both throw sites are covered, and the second is the load-bearing one. A
   * record that fails CLASSIFICATION never reaches the send either way, so it
   * cannot tell an implementation that counts a filing before sending it from
   * one that counts it after. Only a record that survives classification and
   * then fails FORMATTING can.
   */
  const THROW_SITES: ReadonlyArray<readonly [string, Record<string, unknown>]> =
    [
      ['classification, in isRoutine', { category: undefined }],
      ['formatting, after the gates passed', { symbol: undefined }],
    ];

  it.each(THROW_SITES)(
    'omits a filing that threw during %s',
    async (_label, overrides) => {
      const channel = makeChannel();

      const alerted = await build(channel.telegram).processInserted(
        [makeFiling({ seqId: 1 }), malformed({ seqId: 2, ...overrides })],
        now,
      );

      expect(alerted.map((filing) => filing.seqId)).toEqual([1]);
      expect(channel.sent).toHaveLength(1);
    },
  );

  it('returns the caller filings by reference, not copies', async () => {
    // Task 12 correlates these against what it inserted, and re-wrapping would
    // strip the Date instances the schema wrote.
    const channel = makeChannel();
    const batch = [makeFiling({ seqId: 1 })];

    const alerted = await build(channel.telegram).processInserted(batch, now);

    expect(alerted[0]).toBe(batch[0]);
  });

  it('returns a fresh array that does not alias the caller batch', async () => {
    const channel = makeChannel();
    const batch = [makeFiling({ seqId: 1 })];

    const alerted = await build(channel.telegram).processInserted(batch, now);
    alerted.push(makeFiling({ seqId: 99 }));

    expect(batch).toHaveLength(1);
  });

  it('sends exactly what the formatter produces, unmodified', async () => {
    // Formatting belongs to the formatter; anything added here would bypass its
    // HTML escaping, which is a security control.
    const channel = makeChannel();
    const filing = makeFiling({ seqId: 1, symbol: 'M&M' });

    await build(channel.telegram).processInserted([filing], now);

    expect(channel.sent).toEqual([formatFilingAlert(filing)]);
  });

  it('sends one message per filing, never a digest', async () => {
    const channel = makeChannel();
    const batch = Array.from({ length: 3 }, (_unused, index) =>
      makeFiling({ seqId: index + 1, symbol: `SYM${index}` }),
    );

    await build(channel.telegram).processInserted(batch, now);

    expect(channel.sent).toHaveLength(3);
  });
});

/**
 * THE INSERT-ONLY CONTRACT. This service holds no state between calls and does
 * no deduplication of its own — deliberately, because the repository's
 * insert-only detection already is that check and duplicating it would give two
 * places to get it wrong. The consequence is a hard precondition on the caller.
 */
describe('AlertService: alerts on whatever it is given, every time', () => {
  it('re-alerts on a filing submitted twice', async () => {
    // Executable form of the doc comment: there is NO memory here, so passing a
    // full poll result rather than confirmed-new inserts would re-notify on
    // every restart. Task 12 must only ever pass `insertNew`'s return value.
    const channel = makeChannel();
    const service = build(channel.telegram);
    const filing = makeFiling({ seqId: 1 });

    await service.processInserted([filing], now);
    await service.processInserted([filing], now);

    expect(channel.sent).toHaveLength(2);
  });

  it('alerts twice on a duplicate within a single batch', async () => {
    const channel = makeChannel();
    const filing = makeFiling({ seqId: 1 });

    const alerted = await build(channel.telegram).processInserted(
      [filing, filing],
      now,
    );

    expect(alerted).toHaveLength(2);
    expect(channel.sent).toHaveLength(2);
  });
});

describe('AlertService: the watchlist', () => {
  const alertedSymbols = async (
    watchlist: readonly string[],
    symbols: readonly string[],
  ): Promise<string[]> => {
    const channel = makeChannel();
    const service = build(channel.telegram, { watchlist });

    const alerted = await service.processInserted(
      symbols.map((symbol, index) => makeFiling({ seqId: index + 1, symbol })),
      now,
    );

    return alerted.map((filing) => filing.symbol);
  };

  it('alerts on every non-routine filing when the watchlist is empty', async () => {
    expect(await alertedSymbols([], ['AAA', 'BBB'])).toEqual(['AAA', 'BBB']);
  });

  const MATCH_CASES: ReadonlyArray<
    readonly [string, readonly string[], readonly string[], readonly string[]]
  > = [
    ['an exact match', ['RELIANCE'], ['RELIANCE', 'PANACEABIO'], ['RELIANCE']],
    ['a lowercase entry', ['reliance'], ['RELIANCE'], ['RELIANCE']],
    ['a mixed-case entry', ['ReLiAnCe'], ['RELIANCE'], ['RELIANCE']],
    ['a lowercase symbol', ['RELIANCE'], ['reliance'], ['reliance']],
    [
      'several entries',
      ['TCS', 'RELIANCE'],
      ['RELIANCE', 'TCS'],
      ['RELIANCE', 'TCS'],
    ],
    ['no match at all', ['TCS'], ['RELIANCE', 'PANACEABIO'], []],
    ['a symbol with an ampersand', ['M&M'], ['M&M', 'TCS'], ['M&M']],
  ];

  it.each(MATCH_CASES)(
    'handles %s',
    async (_label, watchlist, symbols, expected) => {
      expect(await alertedSymbols(watchlist, symbols)).toEqual([...expected]);
    },
  );

  /**
   * A watchlist arrives from `WATCHLIST=RELIANCE, TCS`.split(','), so entry two
   * carries a leading space. Unnormalised it matches nothing, and because the
   * failure is "no alerts" rather than an error, a bot that has gone completely
   * silent looks exactly like a quiet market. Normalising both sides here is
   * defence in depth, not a substitute for Task 12 validating its own config.
   */
  const UNTIDY_CASES: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['a leading space', [' RELIANCE']],
    ['a trailing space', ['RELIANCE ']],
    ['surrounding spaces', ['  RELIANCE  ']],
    ['a tab', ['\tRELIANCE']],
    ['untidy and lowercase', [' reliance ']],
  ];

  it.each(UNTIDY_CASES)(
    'matches a watchlist entry with %s',
    async (_label, watchlist) => {
      expect(await alertedSymbols(watchlist, ['RELIANCE'])).toEqual([
        'RELIANCE',
      ]);
    },
  );

  it('matches a symbol that arrives padded', async () => {
    expect(await alertedSymbols(['RELIANCE'], [' RELIANCE '])).toEqual([
      ' RELIANCE ',
    ]);
  });

  /**
   * `WATCHLIST=` parses to `['']`, not `[]`. Treated as a real entry it matches
   * no symbol and mutes the bot entirely; treated as absent it means what the
   * operator wrote, which is "no watchlist". The documented semantics of an
   * empty watchlist are alert-on-everything, so this must take that branch.
   */
  it('treats an all-empty watchlist as no watchlist', async () => {
    expect(await alertedSymbols([''], ['RELIANCE', 'TCS'])).toEqual([
      'RELIANCE',
      'TCS',
    ]);
    expect(await alertedSymbols(['', '  '], ['RELIANCE'])).toEqual([
      'RELIANCE',
    ]);
  });

  it('ignores a stray empty entry without turning it into a wildcard', async () => {
    expect(await alertedSymbols(['', 'RELIANCE'], ['RELIANCE', 'TCS'])).toEqual(
      ['RELIANCE'],
    );
  });

  it('does not match on a prefix or a substring', async () => {
    expect(await alertedSymbols(['REL'], ['RELIANCE'])).toEqual([]);
    expect(await alertedSymbols(['RELIANCE'], ['RELIANCEPP'])).toEqual([]);
  });

  it('does not mutate the caller watchlist', async () => {
    const watchlist = [' reliance ', 'TCS'];
    const channel = makeChannel();

    await build(channel.telegram, { watchlist }).processInserted(
      [makeFiling({ symbol: 'RELIANCE' })],
      now,
    );

    expect(watchlist).toEqual([' reliance ', 'TCS']);
  });

  it('still applies the routine gate to a watched symbol', async () => {
    // The watchlist narrows; it never overrides. A watched company's newspaper
    // publication is still noise.
    const channel = makeChannel();
    const alerted = await build(channel.telegram, {
      watchlist: ['RELIANCE'],
    }).processInserted(
      [makeFiling({ symbol: 'RELIANCE', category: 'Trading Window' })],
      now,
    );

    expect(alerted).toEqual([]);
  });
});

describe('AlertService: the window and the clock are the caller/config, not constants', () => {
  const fiveMinutesOld = (): Filing =>
    makeFiling({ disseminatedAt: new Date('2026-08-05T04:55:00.000Z') });

  it('honours a window narrower than the filing age', async () => {
    const channel = makeChannel();

    const alerted = await build(channel.telegram, {
      alertWindowMs: 60 * 1000,
    }).processInserted([fiveMinutesOld()], now);

    expect(alerted).toEqual([]);
  });

  it('honours a window wider than the filing age', async () => {
    const channel = makeChannel();

    const alerted = await build(channel.telegram, {
      alertWindowMs: 60 * 60 * 1000,
    }).processInserted([fiveMinutesOld()], now);

    expect(alerted).toHaveLength(1);
  });

  it('defaults now to the real clock when the caller omits it', async () => {
    const channel = makeChannel();
    const service = build(channel.telegram);

    const live = makeFiling({ seqId: 1, disseminatedAt: new Date() });
    const ancient = makeFiling({ seqId: 2, disseminatedAt: STALE });

    const alerted = await service.processInserted([live, ancient]);

    expect(alerted.map((filing) => filing.seqId)).toEqual([1]);
  });

  it('depends only on the instant supplied, never on the real clock', async () => {
    const channel = makeChannel();
    const past = new Date('1999-01-15T05:00:00.000Z');

    const alerted = await build(channel.telegram).processInserted(
      [makeFiling({ disseminatedAt: new Date('1999-01-15T04:59:50.000Z') })],
      past,
    );

    expect(alerted).toHaveLength(1);
  });
});

describe('AlertService: immutability and no-op paths', () => {
  const ordered = (): Filing[] => [
    makeFiling({ seqId: 3, symbol: 'CCC' }),
    makeFiling({ seqId: 1, symbol: 'AAA' }),
    makeFiling({ seqId: 2, symbol: 'BBB' }),
  ];

  it('does not reorder the caller batch', async () => {
    const channel = makeChannel();
    const batch = ordered();

    await build(channel.telegram).processInserted(batch, now);

    expect(batch.map((filing) => filing.seqId)).toEqual([3, 1, 2]);
  });

  it('does not add to or remove from the caller batch', async () => {
    const channel = makeChannel();
    const batch = ordered();

    await build(channel.telegram).processInserted(batch, now);

    expect(batch).toHaveLength(3);
  });

  it('does not mutate the filings it is handed', async () => {
    const channel = makeChannel();
    const batch = ordered();
    const before = JSON.stringify(batch);

    await build(channel.telegram).processInserted(batch, now);

    expect(JSON.stringify(batch)).toBe(before);
  });

  it('does not mutate the now Date', async () => {
    const channel = makeChannel();
    const clock = new Date('2026-08-05T05:00:00.000Z');

    await build(channel.telegram).processInserted(ordered(), clock);

    expect(clock.toISOString()).toBe('2026-08-05T05:00:00.000Z');
  });

  it('tolerates a frozen input array', async () => {
    const channel = makeChannel();
    const batch = Object.freeze(ordered());

    await expect(
      build(channel.telegram).processInserted(batch, now),
    ).resolves.toHaveLength(3);
  });

  it('accepts a readonly array without widening', async () => {
    // Compile-time guard: the repository hands back a readonly batch.
    const channel = makeChannel();
    const batch: readonly Filing[] = Object.freeze(ordered());

    const alerted: Filing[] = await build(channel.telegram).processInserted(
      batch,
      now,
    );

    expect(alerted).toHaveLength(3);
  });

  it('sends nothing when every filing is suppressed', async () => {
    const channel = makeChannel();

    const alerted = await build(channel.telegram).processInserted(
      [
        makeFiling({ seqId: 1, category: 'Updates' }),
        makeFiling({ seqId: 2, disseminatedAt: STALE }),
      ],
      now,
    );

    expect(alerted).toEqual([]);
    expect(channel.sent).toEqual([]);
  });

  it('logs the count of filings stored outside the window', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const channel = makeChannel();
    const drain = Array.from({ length: 42 }, (_unused, index) =>
      makeFiling({ seqId: index + 1, disseminatedAt: STALE }),
    );

    await build(channel.telegram).processInserted(drain, now);

    // The cold-start drain is silent on Telegram but must not be silent in the
    // log: this line is what says the gate worked rather than the poller dying.
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(String(logSpy.mock.calls[0][0])).toContain('42');
    jest.restoreAllMocks();
  });

  it('does not log a window line when nothing was outside the window', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const channel = makeChannel();

    await build(channel.telegram).processInserted([makeFiling()], now);

    expect(logSpy).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it('sends nothing and logs nothing for an empty batch', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const channel = makeChannel();

    await expect(
      build(channel.telegram).processInserted([], now),
    ).resolves.toEqual([]);

    expect(channel.sent).toEqual([]);
    expect(logSpy).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });
});
