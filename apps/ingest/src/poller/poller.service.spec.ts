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
const DRAIN = 300000;
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
      drainIntervalMs: DRAIN,
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
    // would skip the one drain that establishes the baseline — and since the
    // scheduled sweep would re-pull the day anyway, the REASON is what makes
    // that regression visible.
    const { adapter, service } = build();
    adapter.latest = page([]);
    adapter.day = page([makeFiling(11), makeFiling(12)]);

    const result = await service.tick(IN_WINDOW);

    expect(result.drained).toBe(true);
    expect(result.drainReason).toBe('rollover');
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
    // A truthiness check on the cursor reads 0 as "no cursor" and reports a
    // rollover on every poll, forever. The first tick after a restart DOES
    // drain — every restart reconciles, because that is when the gap is widest
    // — so the distinguishing fact is the REASON, not whether a drain ran.
    const { adapter, repo, service } = build();
    repo.stored.set(0, makeFiling(0));
    await service.initialise();
    adapter.latest = page([makeFiling(0)]);

    const first = await service.tick(IN_WINDOW);
    expect(first.drainReason).toBe('periodic');

    // A cold start would report a rollover on this poll too, and every poll
    // after it. A real cursor of 0 overlaps the page and reports none.
    const second = await service.tick(IN_WINDOW);

    expect(second.drainReason).toBeNull();
    expect(adapter.dayCalls).toBe(1);
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

  it('never lets the cursor go backwards, but still ingests what a lower page carries', async () => {
    // Two separate properties, and conflating them is what lost 2.37% of the
    // corpus. A page carrying only older ids must not drag the CURSOR back —
    // the next poll would then find its oldest id above the cursor, report a
    // hole that does not exist, and re-drain the day forever. But the FILINGS
    // on that page are still filings we do not hold, and the database is what
    // decides that, so they are ingested.
    const { adapter, repo, service } = build();
    adapter.latest = page([makeFiling(30)]);
    adapter.day = page([makeFiling(30)]);
    await service.tick(IN_WINDOW);
    adapter.dayCalls = 0;

    adapter.latest = page([makeFiling(20)]);
    const lower = await service.tick(IN_WINDOW);

    expect(lower.ingested).toBe(1);
    expect(repo.stored.has(20)).toBe(true);
    expect(lower.drained).toBe(false);

    // The oldest id here is 25: still at or below the real cursor of 30, so
    // the page overlaps and no drain is owed. Had the cursor followed the
    // lower page down to 20, this would read as a rollover and re-pull the
    // whole day — on this poll and on every poll after it.
    adapter.latest = page([makeFiling(40), makeFiling(25)]);
    const result = await service.tick(IN_WINDOW);

    expect(result.drained).toBe(false);
    expect(adapter.dayCalls).toBe(0);
    expect(result.ingested).toBe(2);
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

  /**
   * The burst signal is derived from the cursor, and a failed drain HOLDS the
   * cursor — so the same ids stay "new" on every subsequent poll. Feeding that
   * count to the burst rule returns a zero delay forever: `start()` skips the
   * sleep and the loop issues fetchLatest + fetchDay back to back at network
   * speed, indefinitely, while the breaker sits at zero failures because the
   * HOT fetch keeps succeeding. It is the request storm the in-flight guard
   * exists to prevent, arriving through the no-loss path instead — and the
   * guard cannot help, because the calls are sequential rather than stacked.
   *
   * It fires exactly when the heavier uncapped day endpoint is unhappy during a
   * genuine burst: under load, against Akamai.
   */
  it('does not busy-loop when the drain keeps failing', async () => {
    const { adapter, service } = build();
    adapter.latest = page([makeFiling(20)]);
    await service.tick(IN_WINDOW);

    adapter.failDay = new Error('drain 403');
    adapter.latest = page(
      Array.from({ length: 20 }, (_, i) => makeFiling(100 + i)),
    );

    const first = await service.tick(IN_WINDOW);
    const second = await service.tick(IN_WINDOW);
    const third = await service.tick(IN_WINDOW);

    expect(first.drained).toBe(true);
    expect(first.delayMs).toBe(HOT);
    expect(second.delayMs).toBe(HOT);
    expect(third.delayMs).toBe(HOT);
  });

  it('still honours the burst signal when the drain succeeded', async () => {
    // The fallback above must not cost the burst escape hatch on the path that
    // actually earned it: a drain that worked means the cursor moved.
    const { adapter, service } = build();
    adapter.latest = page(
      Array.from({ length: 20 }, (_, i) => makeFiling(100 + i)),
    );
    adapter.day = adapter.latest;

    expect((await service.tick(IN_WINDOW)).delayMs).toBe(0);
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

  it('does not re-arm on an empty page, which proves nothing either way', async () => {
    // A feed alternating empty and all-rejected would otherwise re-arm on every
    // empty poll and re-alert on every blind one — the flood the latch exists
    // to prevent. Only filings arriving are evidence the mapper works again.
    const { adapter, telegram, service } = build();

    for (let i = 0; i < 4; i += 1) {
      adapter.latest = page([], 20);
      await service.tick(IN_WINDOW);
      adapter.latest = page([], 0);
      await service.tick(IN_WINDOW);
    }

    expect(telegram.sent).toHaveLength(1);
  });

  it('does not count a rejected page as a failed poll', async () => {
    const { adapter, breaker, service } = build();
    adapter.latest = page([], 20);

    for (let i = 0; i < 5; i += 1) await service.tick(IN_WINDOW);

    expect(breaker.consecutiveFailures()).toBe(0);
  });
});

/**
 * A drain that keeps failing is the most consequential silence of the three:
 * the hole the entire no-loss guarantee exists to close is never closed, and
 * nothing else in the system notices. The HOT fetch keeps succeeding, so the
 * breaker stays healthy; the cursor is held, so no filing is skipped — the
 * records inside the gap are simply never fetched, and nobody is told.
 */
describe('PollerService: a failed drain is an incident', () => {
  const rolledOver = (harness: Harness): void => {
    harness.adapter.latest = page([makeFiling(90)]);
  };

  it('alarms the operator when the day re-pull fails', async () => {
    const harness = build();
    const { adapter, telegram, service } = harness;
    adapter.latest = page([makeFiling(20)]);
    await service.tick(IN_WINDOW);

    adapter.failDay = new Error('drain 403 Access Denied');
    rolledOver(harness);
    await service.tick(IN_WINDOW);

    expect(telegram.sent).toHaveLength(1);
    expect(telegram.sent[0]).toContain('INGEST DRAIN FAILED');
    expect(telegram.sent[0]).toContain('403 Access Denied');
  });

  it('signals once per episode, not once per poll', async () => {
    const harness = build();
    const { adapter, telegram, service } = harness;
    adapter.latest = page([makeFiling(20)]);
    await service.tick(IN_WINDOW);

    adapter.failDay = new Error('drain 403');
    rolledOver(harness);
    for (let i = 0; i < 10; i += 1) await service.tick(IN_WINDOW);

    expect(telegram.sent).toHaveLength(1);
  });

  it('re-arms once a drain succeeds again', async () => {
    const harness = build();
    const { adapter, telegram, service } = harness;
    adapter.latest = page([makeFiling(20)]);
    await service.tick(IN_WINDOW);

    adapter.failDay = new Error('drain 403');
    rolledOver(harness);
    await service.tick(IN_WINDOW);

    adapter.failDay = null;
    adapter.day = page([makeFiling(90), makeFiling(50)]);
    await service.tick(IN_WINDOW);

    adapter.failDay = new Error('drain 403 again');
    adapter.latest = page([makeFiling(200)]);
    await service.tick(IN_WINDOW);

    expect(telegram.sent).toHaveLength(2);
  });

  it('does not count a failed drain as a failed poll', async () => {
    // The hot fetch worked. Counting this on the breaker would report an
    // outage that is not happening and mask the one that is.
    const harness = build();
    const { adapter, breaker, service } = harness;
    adapter.latest = page([makeFiling(20)]);
    await service.tick(IN_WINDOW);

    adapter.failDay = new Error('drain 403');
    rolledOver(harness);
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

/**
 * NSE DISSEMINATES OUT OF seq_id ORDER. The design spec called seq_id
 * "monotonic, unique, totally ordered", and the recorded corpus refutes it:
 * 414 of 17,442 filings (2.37%, 12.9/day) across 23 of 32 IST days arrive with
 * a seq_id BELOW the stream position at the moment they are disseminated, most
 * of them carrying a real `exchdisstime` rather than the `an_dt` fallback.
 *
 * A cursor-as-newness-filter drops every one of them without a log, a counter
 * or an alert: `detectRollover` keeps only `id > cursor`, and `holeDetected`
 * stays FALSE because the page's oldest id is below the cursor, so no drain is
 * triggered either. The database — the unique index on seqId plus `insertNew`'s
 * return value — is the only correct newness authority, so the whole page is
 * offered to it every poll and the cursor keeps its real job: deciding whether
 * the page rolled past us.
 *
 * Every id and timestamp below is transcribed from
 * `data/corpus/05-07-2026_05-08-2026.jsonl`, including the page compositions.
 */
describe('PollerService: out-of-order dissemination', () => {
  /** 15:33 IST on 07-Jul-2026 — inside the filing window. */
  const JUL_07 = new Date('2026-07-07T10:03:45.000Z');
  /** 11:07 IST on 06-Jul-2026 — inside the filing window. */
  const JUL_06 = new Date('2026-07-06T05:37:45.000Z');

  /** The real 20-record page as it stood at 10:03:43Z on 07-Jul-2026. */
  const PAGE_BEFORE_REVERSAL = [
    106689007, 106689005, 106689004, 106689003, 106685570, 106685567, 106689002,
    106689000, 106688999, 106688998, 106688997, 106688996, 106688995, 106688994,
    106688992, 106688989, 106688988, 106688987, 106688986, 106688985,
  ];

  /**
   * The same page two seconds later. `106689006` (APTECHT) has arrived AFTER
   * `106689007` (RCOM) despite carrying the lower id, and the oldest record has
   * aged off the bottom.
   */
  const PAGE_AFTER_REVERSAL = [
    106689006, 106689007, 106689005, 106689004, 106689003, 106685570, 106685567,
    106689002, 106689000, 106688999, 106688998, 106688997, 106688996, 106688995,
    106688994, 106688992, 106688989, 106688988, 106688987, 106688986,
  ];

  /** The real page at 05:35:48Z on 06-Jul-2026; the stream sits at 106687146. */
  const PAGE_BEFORE_BLOCK = [
    106687146, 106687145, 106687144, 106687143, 106687131, 106687130, 106687129,
    106687127, 106687104, 106687103, 106687101, 106687100, 106687099, 106687098,
    106687097, 106687090, 106687083, 106687082, 106687081, 106687079,
  ];

  /**
   * 117 seconds later. `106603022` (CONSOFINVT, a SEBI Takeover disclosure)
   * arrives 84,124 ids BELOW the stream position, and is the head of a
   * descending run.
   */
  const PAGE_AFTER_BLOCK = [106603022, ...PAGE_BEFORE_BLOCK.slice(0, 19)];

  /** The rest of the descending run, in the order NSE disseminated it. */
  const DESCENDING_RUN = [
    106603016, 106603008, 106602971, 106602914, 106602900, 106602863, 106602793,
  ];

  const pageOf = (seqIds: readonly number[]): FetchResult =>
    page(seqIds.map((id) => makeFiling(id)));

  it('ingests a filing disseminated with an id one below the stream position', async () => {
    // seq 106689007 at 10:03:43, then seq 106689006 at 10:03:45. Adjacent ids,
    // two seconds apart, reversed. Filtering on `id > cursor` loses APTECHT's
    // reply to a financial-results clarification silently and forever.
    const { adapter, repo, alerts, service } = build();
    adapter.latest = pageOf(PAGE_BEFORE_REVERSAL);
    adapter.day = adapter.latest;
    await service.tick(JUL_07);

    adapter.latest = pageOf(PAGE_AFTER_REVERSAL);
    const result = await service.tick(JUL_07);

    expect(repo.stored.has(106689006)).toBe(true);
    expect(result.ingested).toBe(1);
    expect(alerts.alerted.map((f) => f.seqId)).toContain(106689006);
  });

  it('ingests a descending run that lands 84,124 ids below the stream', async () => {
    const { adapter, repo, service } = build();
    adapter.latest = pageOf(PAGE_BEFORE_BLOCK);
    adapter.day = adapter.latest;
    await service.tick(JUL_06);

    // The block jump itself, then the run behind it, one poll per record.
    adapter.latest = pageOf(PAGE_AFTER_BLOCK);
    await service.tick(JUL_06);

    let carried = PAGE_AFTER_BLOCK;
    for (const seqId of DESCENDING_RUN) {
      carried = [seqId, ...carried.slice(0, 19)];
      adapter.latest = pageOf(carried);
      await service.tick(JUL_06);
    }

    for (const seqId of [106603022, ...DESCENDING_RUN]) {
      expect(repo.stored.has(seqId)).toBe(true);
    }
  });

  it('does not report a hole for an out-of-order filing, and must not need to', async () => {
    // `detectRollover` is unchanged and correct: the page still overlaps what
    // we hold, so nothing rolled past us and no drain is owed. Recovery comes
    // from offering the page to the database, not from re-pulling the day.
    const { adapter, service } = build();
    adapter.latest = pageOf(PAGE_BEFORE_REVERSAL);
    adapter.day = adapter.latest;
    await service.tick(JUL_07);
    adapter.dayCalls = 0;

    adapter.latest = pageOf(PAGE_AFTER_REVERSAL);
    const result = await service.tick(JUL_07);

    expect(result.drained).toBe(false);
    expect(adapter.dayCalls).toBe(0);
    expect(result.ingested).toBe(1);
  });

  it('offers the whole page to the repository, not only the ids above the cursor', async () => {
    // A restart resuming at 106689007 with nothing else known: every id on the
    // page must reach `insertNew` and let the unique index decide, including
    // the nineteen that sit below the cursor.
    const { adapter, repo, service } = build();
    repo.stored.set(106689007, makeFiling(106689007));
    await service.initialise();

    adapter.latest = pageOf(PAGE_AFTER_REVERSAL);
    await service.tick(JUL_07);

    expect(
      repo.insertCalls[0].map((f) => f.seqId).sort((a, b) => a - b),
    ).toEqual([...PAGE_AFTER_REVERSAL].sort((a, b) => a - b));
  });

  it('does not re-offer rows the database has already accounted for', async () => {
    // The pre-filter. It is a cost control, never the newness authority: the
    // whole page is a candidate every poll, and this only removes the rows a
    // resolved `insertNew` already proved are in the collection.
    const { adapter, repo, service } = build();
    repo.stored.set(106689007, makeFiling(106689007));
    await service.initialise();

    adapter.latest = pageOf(PAGE_AFTER_REVERSAL);
    await service.tick(JUL_07);
    const second = await service.tick(JUL_07);
    const third = await service.tick(JUL_07);

    expect(repo.insertCalls[0]).toHaveLength(20);
    // Nothing left to offer, so the write is skipped entirely.
    expect(repo.insertCalls).toHaveLength(1);
    expect(second.ingested).toBe(0);
    expect(third.ingested).toBe(0);
  });

  it('offers a row again when the write that would have proven it stored threw', async () => {
    const { adapter, repo, service } = build();
    repo.stored.set(106689007, makeFiling(106689007));
    await service.initialise();
    repo.insertError = new Error('mongo down');

    adapter.latest = pageOf(PAGE_AFTER_REVERSAL);
    await service.tick(JUL_07);

    repo.insertError = null;
    await service.tick(JUL_07);

    // A throw leaves the batch's fate unknown, so nothing may be remembered.
    expect(repo.insertCalls[1]).toHaveLength(20);
    expect(repo.stored.has(106689006)).toBe(true);
  });

  it('leaves the cursor at the stream high-water mark, never dragging it back', async () => {
    // Ingesting a low id must not move the cursor down: the cursor's job is the
    // rollover test, and a cursor that follows an 84,000-id excursion downward
    // would report a hole on every subsequent poll and re-drain the day.
    const { adapter, service } = build();
    adapter.latest = pageOf(PAGE_BEFORE_BLOCK);
    adapter.day = adapter.latest;
    await service.tick(JUL_06);
    adapter.dayCalls = 0;

    adapter.latest = pageOf(PAGE_AFTER_BLOCK);
    await service.tick(JUL_06);

    expect(adapter.dayCalls).toBe(0);
  });
});

/**
 * THE SCHEDULED DRAINS. The design spec asked for two — "Scheduled drain every
 * 5 minutes regardless. Final drain at 23:30 closes the day" — and both were
 * dropped when the plan was written.
 *
 * Nothing noticed, because the rollover drain looks like it covers the same
 * ground. Measured over the recorded corpus it does not: no 2-second window
 * holds more than 6 filings and no 30-second window more than 9, against a
 * 20-record page, so ZERO windows can roll the page at the poll cadence.
 * Replaying all 32 days through this service fires `holeDetected` four times —
 * cold start and nothing else. The reconciliation the no-loss guarantee rests
 * on was running roughly once per process lifetime.
 */
describe('PollerService: scheduled drains', () => {
  const DRAIN_MS = 300_000;
  const later = (from: Date, ms: number): Date => new Date(from.getTime() + ms);
  /** 23:30 IST on 2026-08-05 === 18:00:00Z. */
  const CLOSING = new Date('2026-08-05T18:00:00.000Z');

  /** A harness already past its cold-start drain, with the day endpoint clean. */
  const settled = async (): Promise<Harness> => {
    const harness = build({ drainIntervalMs: DRAIN_MS });
    harness.adapter.latest = page([makeFiling(30)]);
    harness.adapter.day = page([makeFiling(30)]);
    await harness.service.tick(IN_WINDOW);
    harness.adapter.dayCalls = 0;
    return harness;
  };

  it('re-pulls the day once the drain interval has elapsed, with no rollover', async () => {
    const { adapter, service } = await settled();

    const before = await service.tick(later(IN_WINDOW, DRAIN_MS - 1));
    expect(before.drainReason).toBeNull();
    expect(adapter.dayCalls).toBe(0);

    const due = await service.tick(later(IN_WINDOW, DRAIN_MS));

    expect(due.drainReason).toBe('periodic');
    expect(due.drained).toBe(true);
    expect(adapter.dayCalls).toBe(1);
  });

  it('recovers filings the hot page never carried', async () => {
    const { adapter, repo, service } = await settled();
    // 41 and 42 exist on the exchange but never appeared on the 20-record page.
    adapter.latest = page([makeFiling(43), makeFiling(30)]);
    adapter.day = page([
      makeFiling(43),
      makeFiling(42),
      makeFiling(41),
      makeFiling(30),
    ]);

    const result = await service.tick(later(IN_WINDOW, DRAIN_MS));

    expect(result.drainReason).toBe('periodic');
    expect(repo.stored.has(41)).toBe(true);
    expect(repo.stored.has(42)).toBe(true);
  });

  it('routes recovered filings through the same alert gate, never around it', async () => {
    // The cold-start window is what stops a reconciliation drain flooding the
    // chat. A scheduled drain that alerted directly would bypass it.
    const { adapter, alerts, service } = await settled();
    adapter.day = page([makeFiling(41), makeFiling(30)]);
    alerts.batches.length = 0;

    await service.tick(later(IN_WINDOW, DRAIN_MS));

    expect(alerts.batches).toHaveLength(1);
    expect(alerts.batches[0].map((f) => f.seqId)).toEqual([41]);
  });

  it('restarts the interval from the drain, so it does not fire every tick', async () => {
    const { adapter, service } = await settled();

    await service.tick(later(IN_WINDOW, DRAIN_MS));
    const soonAfter = await service.tick(later(IN_WINDOW, DRAIN_MS + 1000));

    expect(soonAfter.drainReason).toBeNull();
    expect(adapter.dayCalls).toBe(1);
  });

  it('reconciles the day at 23:30 IST', async () => {
    const { adapter, service } = await settled();

    const result = await service.tick(CLOSING);

    expect(result.drainReason).toBe('closing');
    expect(adapter.dayCalls).toBe(1);
    expect(adapter.lastDayArg).toBe(CLOSING);
  });

  it('closes each IST day exactly once', async () => {
    const { adapter, service } = await settled();

    await service.tick(CLOSING);
    // Every subsequent tick of the same IST day, right through to 23:59.
    for (let i = 1; i <= 5; i += 1) {
      await service.tick(later(CLOSING, i * 60_000));
    }

    const closings = adapter.dayCalls;
    // The next IST day gets its own closing drain.
    const nextDay = await service.tick(later(CLOSING, 24 * 60 * 60 * 1000));

    expect(nextDay.drainReason).toBe('closing');
    expect(closings).toBeLessThanOrEqual(2);
  });

  it('lets a detected rollover outrank a scheduled drain, and drains once', async () => {
    const { adapter, service } = await settled();
    adapter.latest = page([makeFiling(90)]);
    adapter.day = page([makeFiling(90), makeFiling(50)]);

    const result = await service.tick(later(IN_WINDOW, DRAIN_MS));

    expect(result.drainReason).toBe('rollover');
    expect(adapter.dayCalls).toBe(1);
  });

  it('uses the existing drain-failure alert and its latch, not a second path', async () => {
    const { adapter, telegram, service } = await settled();
    adapter.failDay = new Error('drain 503 Service Unavailable');

    await service.tick(later(IN_WINDOW, DRAIN_MS));
    await service.tick(later(IN_WINDOW, 2 * DRAIN_MS));
    await service.tick(later(IN_WINDOW, 3 * DRAIN_MS));

    expect(telegram.sent).toHaveLength(1);
    expect(telegram.sent[0]).toContain('INGEST DRAIN FAILED');
    expect(telegram.sent[0]).toContain('503 Service Unavailable');
  });

  it('retries a failed scheduled drain on the interval, not on every poll', async () => {
    // Retrying every 2s against a day endpoint that is already refusing is a
    // request storm arriving through the no-loss path.
    const { adapter, service } = await settled();
    adapter.failDay = new Error('drain 503');

    await service.tick(later(IN_WINDOW, DRAIN_MS));
    await service.tick(later(IN_WINDOW, DRAIN_MS + 2000));
    await service.tick(later(IN_WINDOW, DRAIN_MS + 4000));

    expect(adapter.dayCalls).toBe(1);
  });

  it('does not hold the cursor when a scheduled drain fails', async () => {
    // The hot page proved continuity on its own, so there is no hole to hold
    // the cursor for. Holding it would manufacture a rollover on the next poll
    // and turn one failing endpoint into a permanent drain loop.
    const { adapter, service } = await settled();
    adapter.failDay = new Error('drain 503');
    adapter.latest = page([makeFiling(31), makeFiling(30)]);

    await service.tick(later(IN_WINDOW, DRAIN_MS));

    adapter.failDay = null;
    adapter.latest = page([makeFiling(32), makeFiling(31)]);
    const next = await service.tick(later(IN_WINDOW, DRAIN_MS + 2000));

    expect(next.drainReason).toBeNull();
    expect(next.drained).toBe(false);
  });

  it('never runs while a poll is still in flight', async () => {
    const { adapter, service } = await settled();
    const gate = new Gate();
    adapter.gate = gate;

    const first = service.tick(later(IN_WINDOW, DRAIN_MS));
    await flush();
    const second = await service.tick(later(IN_WINDOW, DRAIN_MS));

    expect(second.deferred).toBe(true);
    expect(second.drainReason).toBeNull();
    expect(adapter.dayCalls).toBe(0);

    gate.open();
    await first;
  });

  it('reports no drain reason on a poll that did not drain', async () => {
    const { service } = await settled();

    const result = await service.tick(IN_WINDOW);

    expect(result.drained).toBe(false);
    expect(result.drainReason).toBeNull();
  });

  it('reports no drain reason when the fetch itself failed', async () => {
    const { adapter, service } = await settled();
    adapter.failLatest = new Error('network down');

    const result = await service.tick(later(IN_WINDOW, DRAIN_MS));

    expect(result.drainReason).toBeNull();
    expect(adapter.dayCalls).toBe(0);
  });
});
