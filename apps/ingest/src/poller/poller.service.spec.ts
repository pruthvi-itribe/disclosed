import { Logger } from '@nestjs/common';
import type {
  FetchResult,
  Filing,
  FilingRepository,
  SourceAdapter,
} from '@app/filings';
import type { TelegramService } from '@app/notify';
import type { AlertService } from '../alert/alert.service';
import { CircuitBreaker } from './circuit-breaker';
import { PollerService, type PollerOptions } from './poller.service';

// 2026-08-05T04:58:20Z === 10:28 IST — inside the 07:00–23:00 filing window.
const IN_WINDOW = new Date('2026-08-05T04:58:20.000Z');
// 2026-08-05T20:00:00Z === 01:30 IST — outside it.
const OUT_OF_WINDOW = new Date('2026-08-05T20:00:00.000Z');

const HOT = 2000;
const IDLE = 30000;
const BURST = 8;
const FAILURES = 3;

// Nest's logger writes to stdout on every run; silenced for the whole file.
beforeAll(() => Logger.overrideLogger(false));

const makeFiling = (
  seqId: number,
  iso = '2026-08-05T04:58:18.000Z',
): Filing => ({
  seqId,
  symbol: 'TEST',
  isin: 'INE000000001',
  companyName: 'Test Ltd',
  industry: null,
  category: 'Bagging/Receiving of orders/contracts',
  summary: `Order ${seqId}`,
  attachmentUrl: null,
  announcedAt: new Date(iso),
  disseminatedAt: new Date(iso),
  ingestedAt: IN_WINDOW,
});

/** A page as the adapter reports it: mapped filings plus the raw accounting. */
const page = (filings: readonly Filing[], received?: number): FetchResult => ({
  filings,
  received: received ?? filings.length,
  skipped: (received ?? filings.length) - filings.length,
});

/** Resolves only when the test says so — used to hold a poll mid-flight. */
class Gate {
  private release: (() => void) | null = null;
  readonly opened: Promise<void>;

  constructor() {
    this.opened = new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }

  open(): void {
    this.release?.();
  }
}

const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

/** Spins the microtask queue until `predicate` holds, or fails the test. */
const waitFor = async (
  predicate: () => boolean,
  label: string,
): Promise<void> => {
  for (let i = 0; i < 2000; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`timed out waiting for: ${label}`);
};

class StubAdapter implements SourceAdapter {
  latest: FetchResult = page([]);
  day: FetchResult = page([]);
  latestCalls = 0;
  dayCalls = 0;
  lastDayArg: Date | null = null;
  failLatest: Error | null = null;
  failLatestAlways: Error | null = null;
  failDay: Error | null = null;
  /** Boxed so a rejection value of `null` is still a rejection. */
  rejectWith: { value: unknown } | null = null;
  gate: Gate | null = null;
  onFetch: (() => void) | null = null;

  async fetchLatest(): Promise<FetchResult> {
    this.latestCalls += 1;
    this.onFetch?.();
    if (this.gate) await this.gate.opened;
    if (this.rejectWith) throw this.rejectWith.value;
    if (this.failLatestAlways) throw this.failLatestAlways;
    if (this.failLatest) {
      const error = this.failLatest;
      this.failLatest = null;
      throw error;
    }
    return this.latest;
  }

  async fetchDay(date: Date): Promise<FetchResult> {
    this.dayCalls += 1;
    this.lastDayArg = date;
    if (this.failDay) throw this.failDay;
    return this.day;
  }
}

class StubRepo {
  readonly stored = new Map<number, Filing>();
  insertCalls: Array<readonly Filing[]> = [];
  indexError: Error | null = null;
  insertError: Error | null = null;
  assertCalls = 0;
  maxSeqIdCalls = 0;
  /** Records the order the startup checks ran in. */
  readonly startupOrder: string[] = [];

  async assertIndexes(): Promise<void> {
    this.assertCalls += 1;
    this.startupOrder.push('assertIndexes');
    if (this.indexError) throw this.indexError;
  }

  async insertNew(filings: readonly Filing[]): Promise<Filing[]> {
    this.insertCalls.push(filings);
    if (this.insertError) throw this.insertError;
    const fresh = filings.filter((f) => !this.stored.has(f.seqId));
    fresh.forEach((f) => this.stored.set(f.seqId, f));
    return fresh;
  }

  async getMaxSeqId(): Promise<number | null> {
    this.maxSeqIdCalls += 1;
    this.startupOrder.push('getMaxSeqId');
    const ids = [...this.stored.keys()];
    return ids.length ? Math.max(...ids) : null;
  }
}

class StubAlerts {
  readonly batches: Array<readonly Filing[]> = [];
  readonly alerted: Filing[] = [];
  throwOnCall: Error | null = null;

  async processInserted(filings: readonly Filing[]): Promise<Filing[]> {
    this.batches.push(filings);
    if (this.throwOnCall) throw this.throwOnCall;
    this.alerted.push(...filings);
    return [...filings];
  }
}

class StubTelegram {
  readonly sent: string[] = [];
  throwOnSend: Error | null = null;

  async send(text: string): Promise<void> {
    if (this.throwOnSend) throw this.throwOnSend;
    this.sent.push(text);
  }
}

interface Harness {
  adapter: StubAdapter;
  repo: StubRepo;
  alerts: StubAlerts;
  telegram: StubTelegram;
  breaker: CircuitBreaker;
  service: PollerService;
}

const build = (
  options: Partial<PollerOptions> = {},
  failureThreshold = FAILURES,
): Harness => {
  const adapter = new StubAdapter();
  const repo = new StubRepo();
  const alerts = new StubAlerts();
  const telegram = new StubTelegram();
  const breaker = new CircuitBreaker(failureThreshold);

  const service = new PollerService(
    adapter,
    repo as unknown as FilingRepository,
    alerts as unknown as AlertService,
    telegram as unknown as TelegramService,
    breaker,
    {
      hotIntervalMs: HOT,
      idleIntervalMs: IDLE,
      burstThreshold: BURST,
      ...options,
    },
  );

  return { adapter, repo, alerts, telegram, breaker, service };
};

describe('PollerService: ingest and drain', () => {
  it('ingests new filings and drains on the first run', async () => {
    const { adapter, service } = build();
    adapter.latest = page([makeFiling(30), makeFiling(20)]);
    adapter.day = page([makeFiling(30), makeFiling(20), makeFiling(10)]);

    const result = await service.tick(IN_WINDOW);

    // Cold start has no cursor to overlap against, so it must drain.
    expect(result.drained).toBe(true);
    expect(adapter.dayCalls).toBe(1);
    expect(result.ingested).toBe(3);
  });

  it('does not drain when the page overlaps the cursor', async () => {
    const { adapter, service } = build();
    adapter.latest = page([makeFiling(30), makeFiling(20)]);
    await service.tick(IN_WINDOW);
    adapter.dayCalls = 0;

    adapter.latest = page([makeFiling(40), makeFiling(30), makeFiling(20)]);
    const result = await service.tick(IN_WINDOW);

    expect(result.drained).toBe(false);
    expect(adapter.dayCalls).toBe(0);
    expect(result.ingested).toBe(1);
  });

  it('drains when the page has rolled over past the cursor', async () => {
    const { adapter, repo, service } = build();
    adapter.latest = page([makeFiling(20), makeFiling(10)]);
    await service.tick(IN_WINDOW);
    adapter.dayCalls = 0;

    // Every id on the new page is above the cursor — no overlap, possible hole.
    adapter.latest = page([makeFiling(90), makeFiling(80)]);
    adapter.day = page([
      makeFiling(90),
      makeFiling(80),
      makeFiling(50),
      makeFiling(30),
    ]);
    const result = await service.tick(IN_WINDOW);

    expect(result.drained).toBe(true);
    expect(adapter.dayCalls).toBe(1);
    // The drain recovered the two filings the hot page never showed us.
    expect(repo.stored.has(50)).toBe(true);
    expect(repo.stored.has(30)).toBe(true);
  });

  it('drains on a hole even when the page carries no new ids', async () => {
    // `holeDetected` is independent of `newSeqIds.length`: a cold start reports
    // a hole with an empty list. Inferring the drain from the id count instead
    // would skip the one drain that establishes the baseline.
    const { adapter, service } = build();
    adapter.latest = page([]);
    adapter.day = page([makeFiling(11), makeFiling(12)]);

    const result = await service.tick(IN_WINDOW);

    expect(result.drained).toBe(true);
    expect(adapter.dayCalls).toBe(1);
    expect(result.ingested).toBe(2);
  });

  it('drains the IST day of the instant it was handed, not the wall clock', async () => {
    const { adapter, service } = build();
    adapter.latest = page([makeFiling(30)]);

    await service.tick(IN_WINDOW);

    expect(adapter.lastDayArg).toBe(IN_WINDOW);
  });

  it('merges the drained day with the hot page without duplicating ids', async () => {
    const { adapter, repo, service } = build();
    adapter.latest = page([makeFiling(30), makeFiling(20)]);
    adapter.day = page([makeFiling(30), makeFiling(20), makeFiling(10)]);

    await service.tick(IN_WINDOW);

    const offered = repo.insertCalls[0]
      .map((f) => f.seqId)
      .sort((a, b) => a - b);
    expect(offered).toEqual([10, 20, 30]);
  });
});

describe('PollerService: cursor discipline', () => {
  it('treats a stored cursor of 0 as a real cursor, not as a cold start', async () => {
    // A truthiness check on the cursor reads 0 as "no cursor" and re-drains the
    // whole day on every poll, forever.
    const { adapter, repo, service } = build();
    repo.stored.set(0, makeFiling(0));
    await service.initialise();
    adapter.latest = page([makeFiling(0)]);

    const result = await service.tick(IN_WINDOW);

    expect(result.drained).toBe(false);
    expect(adapter.dayCalls).toBe(0);
  });

  it('never advances the cursor from an empty page', async () => {
    const { adapter, service } = build();
    adapter.latest = page([makeFiling(30)]);
    await service.tick(IN_WINDOW);

    // An empty page proves nothing, so a later page must still be measured
    // against 30 rather than against a cursor an empty poll moved.
    adapter.latest = page([]);
    await service.tick(IN_WINDOW);

    adapter.latest = page([makeFiling(31), makeFiling(30)]);
    const result = await service.tick(IN_WINDOW);

    expect(result.ingested).toBe(1);
    expect(result.drained).toBe(false);
  });

  it('advances past ids the drain recovered, so it does not re-drain', async () => {
    const { adapter, service } = build();
    // Hot page empty, day carries everything: the cursor must still move.
    adapter.latest = page([]);
    adapter.day = page([makeFiling(50), makeFiling(40)]);
    await service.tick(IN_WINDOW);
    adapter.dayCalls = 0;

    adapter.latest = page([makeFiling(50), makeFiling(40)]);
    const result = await service.tick(IN_WINDOW);

    expect(result.drained).toBe(false);
    expect(adapter.dayCalls).toBe(0);
  });

  it('does not advance the cursor when the drain fails', async () => {
    const { adapter, service } = build();
    adapter.latest = page([makeFiling(20)]);
    await service.tick(IN_WINDOW);

    adapter.failDay = new Error('drain 403');
    adapter.latest = page([makeFiling(90)]);
    const first = await service.tick(IN_WINDOW);
    expect(first.drained).toBe(true);

    // The hole is unresolved, so the next poll must detect it again and retry
    // rather than stepping over the records the drain never delivered.
    adapter.failDay = null;
    adapter.day = page([makeFiling(90), makeFiling(50)]);
    const second = await service.tick(IN_WINDOW);

    expect(second.drained).toBe(true);
    expect(second.ingested).toBe(1);
  });

  it('does not advance the cursor when the write throws', async () => {
    const { adapter, repo, service } = build();
    adapter.latest = page([makeFiling(20)]);
    await service.tick(IN_WINDOW);

    repo.insertError = new Error('mongo down');
    adapter.latest = page([makeFiling(30), makeFiling(20)]);
    await service.tick(IN_WINDOW);

    // Rows may have been persisted without alerting; stepping over them would
    // make that permanent. The cursor stays at 20 so 30 is offered again.
    repo.insertError = null;
    const recovered = await service.tick(IN_WINDOW);

    expect(recovered.ingested).toBe(1);
    expect(repo.stored.has(30)).toBe(true);
  });

  it('does not treat an empty first poll as a baseline', async () => {
    // Nothing on the page and nothing in the day means no cursor was ever
    // established. Recording one anyway — even the -Infinity that an unguarded
    // `Math.max()` over an empty list yields — would tell the next poll it has
    // continuity it has never had, and the cold-start drain would never run.
    const { adapter, service } = build();
    adapter.latest = page([]);
    adapter.day = page([]);
    await service.tick(IN_WINDOW);
    adapter.dayCalls = 0;

    const second = await service.tick(IN_WINDOW);

    expect(second.drained).toBe(true);
    expect(adapter.dayCalls).toBe(1);
  });

  it('never lets the cursor go backwards', async () => {
    const { adapter, service } = build();
    adapter.latest = page([makeFiling(30)]);
    await service.tick(IN_WINDOW);

    // A page that happens to carry only older ids must not drag the cursor
    // back, or everything between would be offered — and alerted — twice.
    adapter.latest = page([makeFiling(20)]);
    await service.tick(IN_WINDOW);

    adapter.latest = page([makeFiling(25), makeFiling(20)]);
    const result = await service.tick(IN_WINDOW);

    expect(result.ingested).toBe(0);
  });

  it('restores the cursor from storage so a restart does not re-alert', async () => {
    const { adapter, repo, alerts, service } = build();
    repo.stored.set(30, makeFiling(30));
    await service.initialise();

    adapter.latest = page([makeFiling(30)]);
    const result = await service.tick(IN_WINDOW);

    expect(result.ingested).toBe(0);
    expect(alerts.alerted).toHaveLength(0);
  });
});

describe('PollerService: startup checks', () => {
  it('verifies the unique index before reading the cursor', async () => {
    const { repo, service } = build();

    await service.initialise();

    expect(repo.startupOrder).toEqual(['assertIndexes', 'getMaxSeqId']);
  });

  it('propagates a missing index rather than polling without it', async () => {
    // Without the unique index insertNew returns every re-seen filing as new
    // and a restart re-alerts the whole day. Starting anyway is not an option.
    const { repo, service } = build();
    repo.indexError = new Error('no unique index on seqId');

    await expect(service.initialise()).rejects.toThrow('no unique index');
    expect(repo.maxSeqIdCalls).toBe(0);
  });

  it('refuses a second concurrent loop', async () => {
    const { adapter, service } = build({ hotIntervalMs: 1, idleIntervalMs: 1 });
    adapter.onFetch = () => {
      if (adapter.latestCalls >= 1) service.stop();
    };
    const running = service.start();

    await expect(service.start()).rejects.toThrow(/already running/i);

    await running;
  });
});

describe('PollerService: alerting is gated on confirmed inserts', () => {
  it('hands the alert service only the rows the repository confirmed', async () => {
    const { adapter, repo, alerts, service } = build();
    repo.stored.set(20, makeFiling(20));
    await service.initialise();

    adapter.latest = page([makeFiling(30), makeFiling(20)]);
    await service.tick(IN_WINDOW);

    expect(alerts.batches).toHaveLength(1);
    expect(alerts.batches[0].map((f) => f.seqId)).toEqual([30]);
  });

  it('does not alert on candidates the repository rejected as duplicates', async () => {
    // The case where the batch offered and the batch stored genuinely differ.
    // A drain re-offers the whole IST day, most of which we already hold — so
    // handing the poll's own candidate list to the alert service instead of the
    // repository's answer re-notifies a day of filings on every rollover.
    const { adapter, repo, alerts, service } = build();
    repo.stored.set(10, makeFiling(10));
    repo.stored.set(20, makeFiling(20));
    await service.initialise();

    adapter.latest = page([makeFiling(90)]);
    adapter.day = page([makeFiling(90), makeFiling(20), makeFiling(10)]);
    const result = await service.tick(IN_WINDOW);

    expect(result.drained).toBe(true);
    expect(repo.insertCalls[0]).toHaveLength(3);
    expect(alerts.batches[0].map((f) => f.seqId)).toEqual([90]);
  });

  it('does not re-alert filings already stored', async () => {
    const { adapter, alerts, service } = build();
    adapter.latest = page([makeFiling(30)]);
    adapter.day = page([makeFiling(30)]);
    await service.tick(IN_WINDOW);
    const firstCount = alerts.alerted.length;

    await service.tick(IN_WINDOW);

    expect(alerts.alerted.length).toBe(firstCount);
  });

  it('skips the alert service entirely when nothing was inserted', async () => {
    const { adapter, alerts, service } = build();
    adapter.latest = page([makeFiling(30)]);
    await service.tick(IN_WINDOW);
    alerts.batches.length = 0;

    // The same page again: the repository confirms nothing new.
    await service.tick(IN_WINDOW);

    expect(alerts.batches).toHaveLength(0);
  });

  it('reports the alert count the service actually attempted', async () => {
    const { adapter, service } = build();
    adapter.latest = page([makeFiling(30), makeFiling(20)]);

    const result = await service.tick(IN_WINDOW);

    expect(result.alerted).toBe(2);
  });

  it('still advances the cursor when the alert service throws', async () => {
    // The write is the source of truth; notification is best effort. A poison
    // record must not wedge the cursor and re-drain the day forever.
    const { adapter, alerts, service } = build();
    alerts.throwOnCall = new Error('formatter blew up');
    adapter.latest = page([makeFiling(30)]);

    const result = await service.tick(IN_WINDOW);

    expect(result.alerted).toBe(0);
    alerts.throwOnCall = null;
    adapter.latest = page([makeFiling(30)]);
    expect((await service.tick(IN_WINDOW)).drained).toBe(false);
  });
});

describe('PollerService: cadence', () => {
  const CADENCE_CASES: ReadonlyArray<readonly [string, Date, number, number]> =
    [
      ['hot interval inside the window', IN_WINDOW, 1, HOT],
      ['idle interval outside the window', OUT_OF_WINDOW, 1, IDLE],
      ['zero delay on a burst inside the window', IN_WINDOW, 10, 0],
      ['zero delay on a burst outside the window', OUT_OF_WINDOW, 10, 0],
    ];

  it.each(CADENCE_CASES)('%s', async (_label, now, count, expected) => {
    const { adapter, service } = build();
    adapter.latest = page(
      Array.from({ length: count }, (_, i) => makeFiling(100 + i)),
    );
    adapter.day = adapter.latest;

    expect((await service.tick(now)).delayMs).toBe(expected);
  });

  it('keeps the hot interval when a poll found nothing new', async () => {
    const { adapter, service } = build();
    adapter.latest = page([makeFiling(30)]);
    await service.tick(IN_WINDOW);

    expect((await service.tick(IN_WINDOW)).delayMs).toBe(HOT);
  });

  it('returns an interval after a failed poll so the loop keeps its cadence', async () => {
    const { adapter, service } = build();
    adapter.failLatest = new Error('network down');

    expect((await service.tick(IN_WINDOW)).delayMs).toBe(HOT);
  });
});

describe('PollerService: circuit breaker', () => {
  it('sends a degraded alert after the failure threshold', async () => {
    const { adapter, telegram, service } = build();
    adapter.failLatestAlways = new Error('403 Access Denied');

    await service.tick(IN_WINDOW);
    await service.tick(IN_WINDOW);
    expect(telegram.sent).toHaveLength(0);

    await service.tick(IN_WINDOW);

    expect(telegram.sent).toHaveLength(1);
    expect(telegram.sent[0]).toContain('INGEST DEGRADED');
  });

  it('signals once per outage, not once per failed poll', async () => {
    // Re-signalling every 2s would be ~1800 messages an hour, the operator
    // would mute the channel, and a muted channel is no alerting at all.
    const { adapter, telegram, service } = build();
    adapter.failLatestAlways = new Error('403 Access Denied');

    for (let i = 0; i < 12; i += 1) await service.tick(IN_WINDOW);

    expect(telegram.sent).toHaveLength(1);
  });

  it('keeps polling while degraded — the breaker never gates a request', async () => {
    const { adapter, service } = build();
    adapter.failLatestAlways = new Error('403 Access Denied');
    for (let i = 0; i < 5; i += 1) await service.tick(IN_WINDOW);
    const duringOutage = adapter.latestCalls;

    await service.tick(IN_WINDOW);

    expect(adapter.latestCalls).toBe(duringOutage + 1);
  });

  it('recovers and can signal a second, later outage', async () => {
    const { adapter, telegram, service } = build();
    adapter.failLatestAlways = new Error('403');
    for (let i = 0; i < 3; i += 1) await service.tick(IN_WINDOW);

    adapter.failLatestAlways = null;
    adapter.latest = page([makeFiling(30)]);
    await service.tick(IN_WINDOW);

    adapter.failLatestAlways = new Error('403 again');
    for (let i = 0; i < 3; i += 1) await service.tick(IN_WINDOW);

    expect(telegram.sent).toHaveLength(2);
  });

  it('does not trip on a quiet market: an empty page is a healthy fetch', async () => {
    const { adapter, telegram, breaker, service } = build();
    adapter.latest = page([]);
    adapter.day = page([]);

    for (let i = 0; i < 20; i += 1) await service.tick(IN_WINDOW);

    expect(breaker.consecutiveFailures()).toBe(0);
    expect(telegram.sent).toHaveLength(0);
  });

  it('clears the streak on a successful poll that ingested nothing new', async () => {
    const { adapter, breaker, service } = build();
    adapter.latest = page([makeFiling(30)]);
    await service.tick(IN_WINDOW);

    adapter.failLatest = new Error('blip');
    await service.tick(IN_WINDOW);
    expect(breaker.consecutiveFailures()).toBe(1);

    // Same page again: nothing new to ingest, but the fetch itself worked.
    await service.tick(IN_WINDOW);

    expect(breaker.consecutiveFailures()).toBe(0);
  });

  it('clears the streak on a successful poll that returned an empty page', async () => {
    // The recovery signal is the FETCH, not the filings. Gating it on records
    // arriving means a quiet market never clears a streak, and the breaker
    // eventually reports an outage that is not happening.
    const { adapter, breaker, service } = build();
    adapter.failLatest = new Error('blip');
    await service.tick(IN_WINDOW);
    expect(breaker.consecutiveFailures()).toBe(1);

    adapter.latest = page([]);
    await service.tick(IN_WINDOW);

    expect(breaker.consecutiveFailures()).toBe(0);
  });

  it('names the failure count and the last error in the degraded alert', async () => {
    const { adapter, telegram, service } = build();
    adapter.failLatestAlways = new Error('403 Access Denied');

    for (let i = 0; i < 3; i += 1) await service.tick(IN_WINDOW);

    expect(telegram.sent[0]).toContain('3 consecutive poll failures');
    expect(telegram.sent[0]).toContain('403 Access Denied');
  });

  it('does not throw when a poll fails, so the loop survives', async () => {
    const { adapter, service } = build();
    adapter.failLatest = new Error('network down');

    await expect(service.tick(IN_WINDOW)).resolves.toMatchObject({
      ingested: 0,
      alerted: 0,
      drained: false,
    });
  });

  it('does not retry the fetch itself — the adapter already spends one', async () => {
    const { adapter, service } = build();
    adapter.failLatestAlways = new Error('403 Access Denied');

    await service.tick(IN_WINDOW);

    expect(adapter.latestCalls).toBe(1);
  });

  it('leaves the cursor alone when the fetch fails', async () => {
    const { adapter, service } = build();
    adapter.latest = page([makeFiling(30)]);
    await service.tick(IN_WINDOW);

    adapter.failLatest = new Error('blip');
    await service.tick(IN_WINDOW);

    adapter.latest = page([makeFiling(31), makeFiling(30)]);
    expect((await service.tick(IN_WINDOW)).ingested).toBe(1);
  });
});

/**
 * A rejected promise can carry anything: a string, a bare API object, or
 * nothing at all. `(error as Error).message` reads `undefined` off most of them
 * and THROWS on `null` — from inside the catch block whose whole job is to
 * contain the failure, which would then escape `tick()` and end the loop.
 */
describe('PollerService: a rejection of any shape is described', () => {
  const REJECTIONS: ReadonlyArray<readonly [string, () => unknown, string]> = [
    ['an Error', () => new Error('403 Denied'), 'Error: 403 Denied'],
    ['a bare string', () => 'access denied', 'access denied'],
    ['null', () => null, 'null'],
    ['undefined', () => undefined, 'undefined'],
    ['a number', () => 42, '42'],
    [
      'an object with a null prototype, which String() cannot convert',
      () => Object.create(null) as unknown,
      '[unprintable]',
    ],
  ];

  it.each(REJECTIONS)(
    'describes %s without throwing from inside the catch',
    async (_label, make, expected) => {
      const { adapter, telegram, service } = build({}, 1);
      adapter.rejectWith = { value: make() };

      await expect(service.tick(IN_WINDOW)).resolves.toMatchObject({
        ingested: 0,
      });
      expect(telegram.sent[0]).toContain(expected);
    },
  );
});

describe('PollerService: a wholly rejected page is a blind feed', () => {
  it('alarms when every record on the page was rejected', async () => {
    const { adapter, telegram, service } = build();
    adapter.latest = page([], 20);

    await service.tick(IN_WINDOW);

    expect(telegram.sent).toHaveLength(1);
    expect(telegram.sent[0]).toContain('INGEST BLIND');
    expect(telegram.sent[0]).toContain('20');
  });

  it('stays quiet on an empty day, which is the normal signal', async () => {
    const { adapter, telegram, service } = build();
    adapter.latest = page([], 0);

    for (let i = 0; i < 10; i += 1) await service.tick(IN_WINDOW);

    expect(telegram.sent).toHaveLength(0);
  });

  it('stays quiet when only some records were rejected', async () => {
    const { adapter, telegram, service } = build();
    adapter.latest = page([makeFiling(30)], 5);

    await service.tick(IN_WINDOW);

    expect(telegram.sent).toHaveLength(0);
  });

  it('signals once per episode, not once per poll', async () => {
    const { adapter, telegram, service } = build();
    adapter.latest = page([], 20);

    for (let i = 0; i < 10; i += 1) await service.tick(IN_WINDOW);

    expect(telegram.sent).toHaveLength(1);
  });

  it('re-arms once the feed maps again', async () => {
    const { adapter, telegram, service } = build();
    adapter.latest = page([], 20);
    await service.tick(IN_WINDOW);

    adapter.latest = page([makeFiling(30)]);
    await service.tick(IN_WINDOW);

    adapter.latest = page([], 20);
    await service.tick(IN_WINDOW);

    expect(telegram.sent).toHaveLength(2);
  });

  it('does not count a rejected page as a failed poll', async () => {
    const { adapter, breaker, service } = build();
    adapter.latest = page([], 20);

    for (let i = 0; i < 5; i += 1) await service.tick(IN_WINDOW);

    expect(breaker.consecutiveFailures()).toBe(0);
  });
});

describe('PollerService: a failed write is an incident', () => {
  it('does not throw, so the loop survives a database outage', async () => {
    const { adapter, repo, service } = build();
    adapter.latest = page([makeFiling(30)]);
    repo.insertError = new Error('mongo down');

    await expect(service.tick(IN_WINDOW)).resolves.toMatchObject({
      ingested: 0,
      alerted: 0,
    });
  });

  it('alarms the operator, because rows may be stored but never alerted', async () => {
    const { adapter, repo, telegram, service } = build();
    adapter.latest = page([makeFiling(30)]);
    repo.insertError = new Error('validation failed');

    await service.tick(IN_WINDOW);

    expect(telegram.sent).toHaveLength(1);
    expect(telegram.sent[0]).toContain('INGEST WRITE FAILED');
    expect(telegram.sent[0]).toContain('validation failed');
  });

  it('signals once per episode, not once per poll', async () => {
    const { adapter, repo, telegram, service } = build();
    adapter.latest = page([makeFiling(30)]);
    repo.insertError = new Error('mongo down');

    for (let i = 0; i < 10; i += 1) await service.tick(IN_WINDOW);

    expect(telegram.sent).toHaveLength(1);
  });

  it('re-arms once writes succeed again', async () => {
    const { adapter, repo, telegram, service } = build();
    adapter.latest = page([makeFiling(30)]);
    repo.insertError = new Error('mongo down');
    await service.tick(IN_WINDOW);

    repo.insertError = null;
    await service.tick(IN_WINDOW);

    repo.insertError = new Error('mongo down again');
    adapter.latest = page([makeFiling(40), makeFiling(30)]);
    await service.tick(IN_WINDOW);

    expect(telegram.sent).toHaveLength(2);
  });

  it('never alerts on a batch the write did not confirm', async () => {
    const { adapter, repo, alerts, service } = build();
    adapter.latest = page([makeFiling(30)]);
    repo.insertError = new Error('mongo down');

    await service.tick(IN_WINDOW);

    expect(alerts.batches).toHaveLength(0);
  });
});

describe('PollerService: the in-flight guard', () => {
  it('refuses a second poll while one is still running', async () => {
    const { adapter, service } = build();
    const gate = new Gate();
    adapter.gate = gate;
    adapter.latest = page([makeFiling(30)]);

    const first = service.tick(IN_WINDOW);
    await flush();
    const second = await service.tick(IN_WINDOW);

    expect(second.deferred).toBe(true);
    expect(second.ingested).toBe(0);
    expect(adapter.latestCalls).toBe(1);

    gate.open();
    await first;
  });

  it('releases the guard once the poll completes', async () => {
    const { adapter, service } = build();
    const gate = new Gate();
    adapter.gate = gate;
    adapter.latest = page([makeFiling(30)]);

    const first = service.tick(IN_WINDOW);
    await flush();
    gate.open();
    await first;

    adapter.gate = null;
    const third = await service.tick(IN_WINDOW);

    expect(third.deferred).toBe(false);
    expect(adapter.latestCalls).toBe(2);
  });

  it('releases the guard when the poll fails', async () => {
    const { adapter, service } = build();
    adapter.failLatest = new Error('boom');
    await service.tick(IN_WINDOW);

    adapter.latest = page([makeFiling(30)]);
    const next = await service.tick(IN_WINDOW);

    expect(next.deferred).toBe(false);
    expect(next.ingested).toBe(1);
  });

  it('releases the guard even when the poll throws outright', async () => {
    // Nothing below `tick` is supposed to throw, but the release lives in a
    // `finally` precisely because a throw that wedged the flag shut would
    // silence the poller permanently — with no error after the first one.
    const { adapter, telegram, service } = build({}, 1);
    telegram.throwOnSend = new Error('telegram client exploded');
    adapter.failLatest = new Error('403');

    await expect(service.tick(IN_WINDOW)).rejects.toThrow('exploded');

    telegram.throwOnSend = null;
    adapter.latest = page([makeFiling(30)]);
    expect((await service.tick(IN_WINDOW)).deferred).toBe(false);
  });

  it('returns a usable delay so a deferred caller does not spin', async () => {
    const { adapter, service } = build();
    const gate = new Gate();
    adapter.gate = gate;

    const first = service.tick(IN_WINDOW);
    await flush();
    const second = await service.tick(IN_WINDOW);

    expect(second.delayMs).toBe(HOT);

    gate.open();
    await first;
  });

  it('does not stack polls when a fetch outlives the interval', async () => {
    // A hard Akamai block takes ~30s to reject against a 2s interval, so an
    // unguarded caller would have ~15 polls in flight during the outage.
    const { adapter, service } = build();
    const gate = new Gate();
    adapter.gate = gate;

    const first = service.tick(IN_WINDOW);
    await flush();
    for (let i = 0; i < 15; i += 1) await service.tick(IN_WINDOW);

    expect(adapter.latestCalls).toBe(1);

    gate.open();
    await first;
  });
});

describe('PollerService: the loop', () => {
  it('polls repeatedly until stopped', async () => {
    const { adapter, service } = build({ hotIntervalMs: 1, idleIntervalMs: 1 });
    adapter.onFetch = () => {
      if (adapter.latestCalls >= 3) service.stop();
    };

    await service.start();

    expect(adapter.latestCalls).toBeGreaterThanOrEqual(3);
  });

  it('runs the startup checks before the first poll', async () => {
    const { adapter, repo, service } = build({
      hotIntervalMs: 1,
      idleIntervalMs: 1,
    });
    adapter.onFetch = () => service.stop();

    await service.start();

    expect(repo.assertCalls).toBe(1);
    expect(repo.startupOrder[0]).toBe('assertIndexes');
  });

  it('does not poll at all when the index check fails', async () => {
    const { adapter, repo, service } = build({
      hotIntervalMs: 1,
      idleIntervalMs: 1,
    });
    repo.indexError = new Error('no unique index on seqId');
    // A poller that skipped the assertion would loop here forever, and a test
    // that hangs reports nothing. Stopping from the first fetch turns that into
    // a clean assertion failure: `start()` resolves instead of rejecting.
    adapter.onFetch = () => service.stop();

    await expect(service.start()).rejects.toThrow('no unique index');
    expect(adapter.latestCalls).toBe(0);
  });

  it('stops promptly rather than waiting out the sleep', async () => {
    const { adapter, service } = build({
      hotIntervalMs: 60_000,
      idleIntervalMs: 60_000,
    });
    const running = service.start();
    await waitFor(() => adapter.latestCalls === 1, 'the first poll');

    service.stop();

    await expect(running).resolves.toBeUndefined();
  });

  it('does not begin a new sleep after being stopped mid-poll', async () => {
    // Checking `running` again before sleeping is what keeps a shutdown from
    // waiting out a full idle interval it has already been told to abandon.
    const { adapter, service } = build({
      hotIntervalMs: 60_000,
      idleIntervalMs: 60_000,
    });
    adapter.onFetch = () => service.stop();

    await expect(service.start()).resolves.toBeUndefined();
  });

  it('survives a tick that throws, which tick() is contracted never to do', async () => {
    const { adapter, service } = build({ hotIntervalMs: 1, idleIntervalMs: 1 });
    let calls = 0;
    jest.spyOn(service, 'tick').mockImplementation(async () => {
      calls += 1;
      if (calls >= 3) service.stop();
      throw new Error('contract violated');
    });

    await expect(service.start()).resolves.toBeUndefined();
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(adapter.latestCalls).toBe(0);
  });

  it('is safe to stop when it was never started', () => {
    const { service } = build();

    expect(() => service.stop()).not.toThrow();
  });
});
