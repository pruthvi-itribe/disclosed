import { Injectable, Logger } from '@nestjs/common';
import {
  detectRollover,
  nextPollDelayMs,
  type FetchResult,
  type Filing,
  type FilingRepository,
  type SourceAdapter,
} from '@app/filings';
import {
  formatBlindFeedAlert,
  formatDegradedAlert,
  formatDrainFailureAlert,
  formatWriteFailureAlert,
  type TelegramService,
} from '@app/notify';
import type { AlertService } from '../alert/alert.service';
import type { CircuitBreaker } from './circuit-breaker';

/**
 * The cadence knobs, deliberately the exact shape `nextPollDelayMs` takes minus
 * the two per-poll values. Every one is validated at config load; this service
 * takes them on trust.
 */
export interface PollerOptions {
  hotIntervalMs: number;
  idleIntervalMs: number;
  burstThreshold: number;
}

export interface PollResult {
  /** Rows the repository confirmed as new inserts. */
  ingested: number;
  /** Filings the alert service ATTEMPTED to send. Not proof of delivery. */
  alerted: number;
  /** True when the page could not prove continuity and the day was re-pulled. */
  drained: boolean;
  /**
   * True when this tick did no work because another poll still held the lock.
   * Distinguished from a quiet poll on purpose: "nothing arrived" and "we never
   * looked" are different facts, and only one of them is a healthy feed.
   */
  deferred: boolean;
  /** What the caller should wait before the next tick. */
  delayMs: number;
}

/** Shown when a value cannot be converted to text by any means at all. */
const UNPRINTABLE = '[unprintable]';

/**
 * Describes a failure for the log, whatever shape it arrives in.
 *
 * `(error as Error).message` is unsound here: a rejection can carry a string, a
 * bare object or nothing at all, and reading `.message` off `null` THROWS from
 * inside the catch block whose whole job is to contain the failure. `String()`
 * is not total either — a null-prototype object has no `toString` — so it is
 * itself contained.
 *
 * DUPLICATION, ACCEPTED DELIBERATELY: `libs/notify` and `apps/ingest/src/alert`
 * each carry a version of this for their own catch blocks, and this is the third
 * consumer that their notes anticipated. Consolidating is the right move but not
 * here: both existing copies are pinned line-for-line by committed mutation
 * harnesses, so moving them is a refactor with its own tests and its own commit,
 * not something to smuggle into the integration task.
 */
const describeError = (error: unknown): string => {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try {
    return String(error);
  } catch {
    return UNPRINTABLE;
  }
};

const stackOf = (error: unknown): string | undefined =>
  error instanceof Error ? error.stack : undefined;

/** Newest-first union of two pages, one entry per seqId. */
const mergeById = (a: readonly Filing[], b: readonly Filing[]): Filing[] => {
  const merged = new Map<number, Filing>();
  for (const filing of [...a, ...b]) {
    if (!merged.has(filing.seqId)) merged.set(filing.seqId, filing);
  }
  return [...merged.values()];
};

/**
 * Drives the two-tier poll that carries the no-loss guarantee.
 *
 * A 2s hot poll reads NSE's 20-record live page. If the OLDEST id on that page
 * is still newer than our cursor, the page turned over between polls and there
 * is no overlap to prove continuity, so the full IST day is re-pulled and
 * reconciled. Everything else here exists to keep that loop honest when a
 * dependency misbehaves:
 *
 *   - ONE POLL AT A TIME. A hard Akamai block takes ~30s to reject (two 15s
 *     timeouts) against a 2s interval, so an unguarded caller stacks ~15 polls
 *     during exactly the outage where NSE is least willing to serve.
 *   - NO SECOND RETRY. `NseAdapter` already spends one retry on a 401/403 after
 *     refreshing the session. A retry here would multiply against that one.
 *   - THE CURSOR ONLY MOVES ON PROOF. Not from an empty page, not past a drain
 *     that failed, and not past a write that threw.
 *   - EVERY SILENCE IS ANNOUNCED. A blind poller, a feed whose every record is
 *     rejected, a day re-pull that leaves a detected hole open, and a database
 *     refusing writes all look identical from outside: no messages. Each gets
 *     its own operator alert, each edge-triggered so the channel does not get
 *     muted by the very outage it exists to report.
 *
 * `tick()` never throws. A poll failure must be counted, not propagated, or one
 * bad response ends the loop that would have recovered from it.
 */
@Injectable()
export class PollerService {
  private readonly logger = new Logger(PollerService.name);

  /** Highest seqId proven stored. `0` is a valid value; `null` means none. */
  private cursor: number | null = null;

  private running = false;
  private polling = false;

  /** Set while the feed is answering with records that all fail to map. */
  private feedBlind = false;
  /** Set while the day re-pull is failing, leaving a detected hole open. */
  private drainFailing = false;
  /** Set while writes are failing. */
  private writeFailing = false;

  private sleepTimer: NodeJS.Timeout | null = null;
  private wake: (() => void) | null = null;

  constructor(
    private readonly adapter: SourceAdapter,
    private readonly repository: FilingRepository,
    private readonly alerts: AlertService,
    private readonly telegram: TelegramService,
    private readonly breaker: CircuitBreaker,
    private readonly options: PollerOptions,
  ) {}

  /**
   * Startup checks, in this order and before a single poll.
   *
   * `assertIndexes()` is not optional and its failure is not recoverable here.
   * Without the unique index on seqId the repository cannot tell a new filing
   * from one it already holds: `insertNew` returns every re-seen row as new and
   * the alert gate inverts, so a restart re-alerts the whole day. It is left to
   * throw and stop the process rather than repaired underneath the operator.
   */
  async initialise(): Promise<void> {
    await this.repository.assertIndexes();

    this.cursor = await this.repository.getMaxSeqId();
    this.logger.log(
      `Resuming from cursor ${this.cursor === null ? 'cold start' : this.cursor}`,
    );
  }

  /** Runs the poll loop until `stop()` is called. */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('PollerService is already running');
    }

    this.running = true;
    try {
      await this.initialise();
    } catch (error) {
      this.running = false;
      throw error;
    }

    while (this.running) {
      const delayMs = await this.cycle();
      if (this.running && delayMs > 0) await this.sleep(delayMs);
    }
  }

  /**
   * Stops the loop and cuts any sleep short.
   *
   * Waking the sleeper matters operationally: the idle interval is 30s, and a
   * SIGTERM that waits it out looks like a hung shutdown to an orchestrator
   * whose patience is measured in seconds. Safe to call when not running.
   */
  stop(): void {
    this.running = false;
    const wake = this.wake;
    this.clearSleep();
    wake?.();
  }

  /**
   * One poll cycle.
   *
   * NEVER THROWS. Every failure is turned into a counted, announced result so
   * the loop that owns recovery survives to make the next attempt.
   */
  async tick(now = new Date()): Promise<PollResult> {
    if (this.polling) {
      // Not an error and not an empty market: another poll is simply still in
      // flight. Returning an interval keeps a caller that ignores `deferred`
      // from spinning on the guard.
      this.logger.warn('Poll still in flight; skipping this tick');
      return this.barrenResult(now, true);
    }

    this.polling = true;
    try {
      return await this.poll(now);
    } finally {
      // `finally`, so a throw from anywhere below cannot wedge the guard shut
      // and silence the poller permanently.
      this.polling = false;
    }
  }

  private async poll(now: Date): Promise<PollResult> {
    let page: FetchResult;
    try {
      page = await this.adapter.fetchLatest();
    } catch (error) {
      return await this.handleFetchFailure(error, now);
    }

    // A response is a healthy fetch even when it carried nothing new. Gating
    // this on new filings would let a quiet market trip the breaker and report
    // an outage that is not happening.
    this.breaker.recordSuccess();
    await this.reportBlindFeed(page);

    const { newSeqIds, holeDetected } = detectRollover({
      pageSeqIds: page.filings.map((filing) => filing.seqId),
      cursor: this.cursor,
    });

    const fresh = new Set(newSeqIds);
    const newOnPage = page.filings.filter((filing) => fresh.has(filing.seqId));

    // The drain is driven by `holeDetected` alone. It is independent of
    // `newSeqIds.length` and is true with an empty list on a cold start, which
    // is the one drain that establishes the baseline.
    let candidates: readonly Filing[] = newOnPage;
    let dayFilings: readonly Filing[] = [];
    let drainFailed = false;

    if (holeDetected) {
      this.logger.warn('Rollover detected; draining the IST day');
      try {
        const day = await this.adapter.fetchDay(now);
        dayFilings = day.filings;
        candidates = mergeById(newOnPage, dayFilings);
        this.drainFailing = false;
      } catch (error) {
        // The hole is unresolved. Store what the hot page did give us, but
        // leave the cursor where it is so the next poll detects the same hole
        // and retries rather than stepping over the missing records.
        drainFailed = true;
        await this.reportDrainFailure(error);
      }
    }

    let inserted: Filing[];
    try {
      inserted = await this.repository.insertNew(candidates);
      this.writeFailing = false;
    } catch (error) {
      return await this.handleWriteFailure(error, now, candidates);
    }

    const alerted = await this.alertOn(inserted, now);

    if (!drainFailed) {
      this.advanceCursor([...page.filings, ...dayFilings]);
    }

    return {
      ingested: inserted.length,
      alerted,
      drained: holeDetected,
      deferred: false,
      // A FAILED drain must not feed the burst rule. `newSeqIds` is derived
      // from the cursor, and a failed drain HOLDS the cursor — so the same ids
      // stay "new" on every subsequent poll. Passing that count through returns
      // a zero delay forever, `start()` skips the sleep, and the loop issues
      // fetchLatest + fetchDay back to back at network speed for as long as the
      // day endpoint stays unhappy. That is a request storm against Akamai
      // arriving through the no-loss path, and the in-flight guard cannot stop
      // it because the calls are sequential rather than stacked. The breaker
      // cannot either: the hot fetch keeps succeeding. Fall back to the
      // ordinary interval, which is what an unresolved hole deserves — retry
      // steadily, not as fast as the socket allows.
      delayMs: this.delayFor(drainFailed ? 0 : newSeqIds.length, now),
    };
  }

  /**
   * Alerts on rows the repository CONFIRMED as new, and only those.
   *
   * A notification failure must never wedge the pipeline, so this is contained:
   * the write already succeeded and is the source of truth, while alerting is
   * best-effort by design all the way down to `TelegramService.send`. Letting it
   * propagate would skip the cursor advance below, and one poison record would
   * then re-drain the whole day on every poll, forever.
   */
  private async alertOn(
    inserted: readonly Filing[],
    now: Date,
  ): Promise<number> {
    if (inserted.length === 0) return 0;

    try {
      return (await this.alerts.processInserted(inserted, now)).length;
    } catch (error) {
      this.logger.error(
        `Alerting failed for ${inserted.length} stored filing(s): ${describeError(error)}`,
        stackOf(error),
      );
      return 0;
    }
  }

  /**
   * Moves the cursor to the highest id this poll can prove is stored.
   *
   * `observed` is the hot page unioned with a successfully drained day. Both
   * are proven: ids above the old cursor were just inserted, and ids at or
   * below it were inserted by an earlier poll — that is the induction the
   * overlap rule maintains.
   *
   * An empty set leaves the cursor untouched. An empty page proves nothing at
   * all, and advancing from one would mean claiming continuity we never saw.
   */
  private advanceCursor(observed: readonly Filing[]): void {
    if (observed.length === 0) return;

    const highest = Math.max(...observed.map((filing) => filing.seqId));
    // A null check, never a truthiness check: a stored seqId of 0 is a real
    // cursor, and reading it as "no cursor" re-drains the day on every poll.
    this.cursor =
      this.cursor === null ? highest : Math.max(this.cursor, highest);
  }

  /**
   * Announces a page whose every record was rejected.
   *
   * `received === 0` is the ordinary quiet-market and market-holiday signal and
   * must stay silent. `received > 0` with nothing mapped is the opposite: the
   * exchange had records and we understood none of them.
   *
   * Edge-triggered, like the circuit breaker and for the same reason — the
   * condition persists across every poll, and a message every 2s would get the
   * channel muted. The hot page alone is checked: it runs every 2s and is the
   * path that goes permanently silent, while the drain shares its mapper and
   * logs its own skips.
   */
  private async reportBlindFeed(page: FetchResult): Promise<void> {
    // Filings arriving is the ONLY evidence the mapper works again. An empty
    // page is evidence of nothing, so it must not re-arm the latch: a feed
    // alternating empty and all-rejected would otherwise re-arm on every empty
    // poll and re-alert on every blind one, which is the flood the latch exists
    // to prevent.
    if (page.filings.length > 0) {
      this.feedBlind = false;
      return;
    }

    // `received === 0` is the ordinary quiet-market and market-holiday signal.
    if (page.received === 0) return;

    this.logger.error(
      `NSE returned ${page.received} record(s) and all ${page.skipped} were ` +
        'rejected as unmappable; nothing can be ingested',
    );

    if (this.feedBlind) return;
    this.feedBlind = true;
    await this.telegram.send(formatBlindFeedAlert(page.received));
  }

  /**
   * Announces a day re-pull that failed, leaving a detected hole open.
   *
   * The most consequential silence this class produces, and the least visible
   * without a message. Nothing else notices: the hot fetch succeeded so the
   * breaker stays healthy, and the cursor is held so no filing is skipped and
   * nothing downstream misbehaves. The records inside the gap are simply never
   * fetched — and a drain that keeps failing means the hole the whole no-loss
   * guarantee exists to close is never closed.
   *
   * Deliberately NOT counted on the breaker: the poll itself worked, and
   * reporting it as a poll failure would claim an outage that is not happening
   * while masking the one that is. Edge-triggered like the others, and re-armed
   * by a drain that succeeds.
   */
  private async reportDrainFailure(error: unknown): Promise<void> {
    const message = describeError(error);
    this.logger.error(
      `Drain failed, cursor held at ${this.cursor}: ${message}`,
      stackOf(error),
    );

    if (this.drainFailing) return;
    this.drainFailing = true;
    await this.telegram.send(formatDrainFailureAlert(message));
  }

  /**
   * A failed fetch: counted, announced on the transition, and survived.
   *
   * The breaker is driven by `recordFailure()`'s RETURN VALUE, which is true
   * exactly once per outage. Branching on `isDegraded()` instead would be true
   * on every poll after the first and reproduce the message storm the breaker
   * exists to prevent.
   *
   * Nothing here gates the next request. A retry is the only thing that can
   * recover, so polling continues at the ordinary cadence while degraded.
   */
  private async handleFetchFailure(
    error: unknown,
    now: Date,
  ): Promise<PollResult> {
    const message = describeError(error);
    this.logger.error(`Poll failed: ${message}`, stackOf(error));

    if (this.breaker.recordFailure()) {
      await this.telegram.send(
        formatDegradedAlert(this.breaker.consecutiveFailures(), message),
      );
    }

    return this.barrenResult(now, false);
  }

  /**
   * A failed write: an incident, not a retryable no-op.
   *
   * Mongoose can put valid documents in the collection before it reports a
   * validation failure, so rows may be persisted and never alerted — and the
   * unique index will reject them on a retry, so they never come back. The
   * cursor is therefore NOT advanced (the next poll re-offers the same batch)
   * and the operator is told, because no other signal exists for a filing that
   * is stored but silent.
   */
  private async handleWriteFailure(
    error: unknown,
    now: Date,
    batch: readonly Filing[],
  ): Promise<PollResult> {
    const message = describeError(error);
    this.logger.error(
      `Insert of ${batch.length} filing(s) failed, cursor held at ${this.cursor}. ` +
        `Rows may be stored without having alerted: ${message}`,
      stackOf(error),
    );

    if (!this.writeFailing) {
      this.writeFailing = true;
      await this.telegram.send(formatWriteFailureAlert(batch.length, message));
    }

    return this.barrenResult(now, false);
  }

  /** A poll that ingested nothing, for whatever reason. */
  private barrenResult(now: Date, deferred: boolean): PollResult {
    return {
      ingested: 0,
      alerted: 0,
      drained: false,
      deferred,
      delayMs: this.delayFor(0, now),
    };
  }

  private delayFor(newCount: number, now: Date): number {
    return nextPollDelayMs({ newCount, now, ...this.options });
  }

  /**
   * One iteration of the loop, returning the delay to honour.
   *
   * `tick()` is contracted never to throw, so this catch should be unreachable.
   * It is here because the alternative to an unreachable catch is an unhandled
   * rejection that kills the loop — and a loop that dies on a contract
   * violation is indistinguishable, from outside, from a quiet market.
   */
  private async cycle(): Promise<number> {
    try {
      return (await this.tick()).delayMs;
    } catch (error) {
      this.logger.error(
        `Poll cycle threw, which tick() is contracted never to do: ${describeError(error)}`,
        stackOf(error),
      );
      // Back off to the idle interval rather than hot-looping on a broken tick.
      return this.options.idleIntervalMs;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.wake = resolve;
      this.sleepTimer = setTimeout(() => {
        this.clearSleep();
        resolve();
      }, ms);
    });
  }

  private clearSleep(): void {
    if (this.sleepTimer !== null) clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
    this.wake = null;
  }
}
