import { Injectable, Logger } from '@nestjs/common';
import { describeError, stackOf } from '@app/common';
import {
  detectRollover,
  drainRange,
  istDayKey,
  nextPollDelayMs,
  scheduledDrainReason,
  type DrainReason,
  type FetchResult,
  type Filing,
  type FilingRepository,
  type SourceAdapter,
} from '@app/filings';
import {
  formatBlindFeedAlert,
  formatDegradedAlert,
  formatDrainFailureAlert,
  formatSkippedRecordsAlert,
  formatWriteFailureAlert,
  type TelegramService,
} from '@app/notify';
import type { AlertService } from '../alert/alert.service';
import type { CircuitBreaker } from './circuit-breaker';
import { RecentSeqIds } from './recent-seq-ids';

/**
 * The cadence knobs, deliberately the exact shape `nextPollDelayMs` takes minus
 * the two per-poll values. Every one is validated at config load; this service
 * takes them on trust.
 */
export interface PollerOptions {
  hotIntervalMs: number;
  idleIntervalMs: number;
  burstThreshold: number;
  /**
   * How long between scheduled reconciliation drains. The rollover drain alone
   * is not enough — see `reconcile` below for the measurement.
   */
  drainIntervalMs: number;
}

export interface PollResult {
  /** Rows the repository confirmed as new inserts. */
  ingested: number;
  /** Filings the alert service ATTEMPTED to send. Not proof of delivery. */
  alerted: number;
  /** True when the IST day was re-pulled, for any of the three reasons. */
  drained: boolean;
  /** Which reason drove the re-pull, or null when there was none. */
  drainReason: DrainReason | null;
  /** IST days the drain covered. `0` when no drain ran. */
  drainedDays: number;
  /** Records the mapper refused, across the hot page and any drained day. */
  skipped: number;
  /**
   * True when this tick did no work because another poll still held the lock.
   * Distinguished from a quiet poll on purpose: "nothing arrived" and "we never
   * looked" are different facts, and only one of them is a healthy feed.
   */
  deferred: boolean;
  /** What the caller should wait before the next tick. */
  delayMs: number;
}

/**
 * The mapper's accounting for ONE fetch surface: how many records the exchange
 * sent, and how many of them were refused.
 *
 * Held per surface rather than summed, because the hot page and the drain are
 * observed on entirely different schedules and a sum cannot say which of them
 * is clean — see `reportSkippedRecords`.
 */
interface SkipTally {
  readonly skipped: number;
  readonly received: number;
}

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
 *   - THE DATABASE DECIDES NEWNESS, NOT THE CURSOR. The whole page is offered
 *     to `insertNew` every poll and the unique index on `seqId` rejects what we
 *     already hold. The cursor is NOT a newness filter, because seq_id is not
 *     the total order the design spec claimed: 414 of the 17,442 filings in the
 *     recorded corpus (2.37%, 12.9/day, on 23 of 32 IST days) are disseminated
 *     with an id BELOW the stream position — adjacent-id reversals two seconds
 *     apart, and block excursions of 84,000 ids followed by a descending run.
 *     Filtering on `id > cursor` discards every one of them, and `holeDetected`
 *     stays false because the page's oldest id is below the cursor, so nothing
 *     drains and nothing is logged. The cursor's real and only job is the
 *     rollover test below.
 *   - THE DAY IS RECONCILED ON A SCHEDULE, NOT ONLY ON ROLLOVER. A rollover is
 *     rarer than the design assumed: measured over the recorded corpus, no
 *     2-second window holds more than 6 filings and no 30-second window more
 *     than 9, against a 20-record page, so the page CANNOT roll at the poll
 *     cadence. Replaying all 32 days fires `holeDetected` four times — cold
 *     start and nothing else. Left to the rollover alone the reconciliation
 *     ran once per process lifetime, so the spec's periodic drain (every 5
 *     minutes) and closing drain (23:30 IST) are both here, sharing this one
 *     code path, this one in-flight guard and this one failure alert.
 *   - ONE POLL AT A TIME, AND ONE DRAIN AT A TIME. A hard Akamai block takes
 *     ~30s to reject (two 15s timeouts) against a 2s interval, so an unguarded
 *     caller stacks ~15 polls during exactly the outage where NSE is least
 *     willing to serve. Every drain runs inside that same guard, so a scheduled
 *     drain can never overlap a hot poll or another drain.
 *   - NO SECOND RETRY. `NseAdapter` already spends one retry on a 401/403 after
 *     refreshing the session. A retry here would multiply against that one.
 *   - THE CURSOR ONLY MOVES FORWARD, AND ONLY ON PROOF. Not from an empty page,
 *     not past a drain that failed, not past a write that threw — and never
 *     backwards, or an out-of-order excursion would report a hole on every
 *     subsequent poll and re-drain the day.
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

  /**
   * Highest seqId the page has been proven to overlap. `0` is a valid value;
   * `null` means none. This is a ROLLOVER marker, never a newness filter.
   */
  private cursor: number | null = null;

  /**
   * Suppresses re-offering rows the database has already accounted for. A
   * performance filter only — a miss falls through to `insertNew`.
   */
  private readonly recent = new RecentSeqIds();

  /** Epoch ms of the last drain of any kind. `null` means none has run yet. */
  private lastDrainAtMs: number | null = null;

  /** IST day the closing drain last reconciled, so it runs once per day. */
  private lastClosingDay: string | null = null;

  private running = false;
  private polling = false;

  /** Set while the feed is answering with records that all fail to map. */
  private feedBlind = false;
  /**
   * Set while SOME records ON THE HOT PAGE are dropped and the rest ingested.
   * Separate from the drain latch below on purpose — see
   * `reportSkippedRecords` for the flood that one shared latch produced.
   */
  private hotPartial = false;
  /** Set while SOME records ON A DRAINED DAY are dropped and the rest ingested. */
  private drainPartial = false;
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

    // `newSeqIds` is NOT used to decide what to ingest. It survives for one
    // purpose only — the cadence burst signal — because it is still the right
    // input there: it measures how fast the page is turning over.
    const { newSeqIds, holeDetected } = detectRollover({
      pageSeqIds: page.filings.map((filing) => filing.seqId),
      cursor: this.cursor,
    });

    // THE WHOLE PAGE, not only the ids above the cursor. See the class doc:
    // NSE disseminates out of seq_id order, so an id below the cursor can be a
    // filing we have never held. The database decides newness, not the cursor.
    let candidates: readonly Filing[] = page.filings;
    let dayFilings: readonly Filing[] = [];
    let drainFailed = false;

    // A rollover outranks a schedule: it is the only reason that means a hole
    // is already open. `holeDetected` is driven by the overlap rule alone — it
    // is independent of `newSeqIds.length` and is true with an empty list on a
    // cold start, which is the one drain that establishes the baseline.
    const reason: DrainReason | null = holeDetected
      ? 'rollover'
      : scheduledDrainReason({
          now,
          lastDrainAtMs: this.lastDrainAtMs,
          lastClosingDay: this.lastClosingDay,
          drainIntervalMs: this.options.drainIntervalMs,
        });

    let drainedDays = 0;
    // Skip accounting for the two fetch surfaces, kept APART all the way to the
    // alarm. `drainTally` stays null until a drain has both RUN and SUCCEEDED,
    // because only an observation may move the drain latch: a poll that never
    // looked at the day has learned nothing about it.
    const hotTally: SkipTally = {
      skipped: page.skipped,
      received: page.received,
    };
    let drainTally: SkipTally | null = null;

    if (reason !== null) {
      // Recorded BEFORE the attempt and for every outcome, including a failure.
      // A day endpoint that is refusing must be retried on the interval, not on
      // every 2s poll: the latter is a request storm arriving through the
      // no-loss path against an endpoint that is already unhappy. A rollover
      // keeps its own retry regardless — `holeDetected` stays true until the
      // hole closes — so this only ever throttles the scheduled sweeps.
      this.lastDrainAtMs = now.getTime();
      if (reason === 'closing') this.lastClosingDay = istDayKey(now);

      try {
        const drain = await this.drain(reason, now);
        dayFilings = drain.filings;
        drainedDays = drain.days;
        drainTally = { skipped: drain.skipped, received: drain.received };
        // The set difference is the database's job, not ours: every row is
        // offered and the unique index rejects the ones already held.
        candidates = mergeById(page.filings, dayFilings);
        this.drainFailing = false;
      } catch (error) {
        drainFailed = true;
        await this.reportDrainFailure(error);
      }
    }

    // A hole that is still open must hold the cursor: the next poll has to
    // detect the same hole and retry rather than stepping over the missing
    // records. A failed SCHEDULED drain must not, because the hot page proved
    // continuity on its own — holding the cursor there would manufacture a
    // rollover on the next poll and turn one failing endpoint into a permanent
    // drain loop.
    const holdCursor = drainFailed && reason === 'rollover';

    const offered = this.recent.unseen(candidates);

    let inserted: Filing[] = [];
    // Nothing to offer is the ordinary case once the page has settled, and it
    // is not evidence about the database either way — so the round trip is
    // skipped AND the write-failure latch is left exactly as it was.
    if (offered.length > 0) {
      try {
        inserted = await this.repository.insertNew(offered);
        this.writeFailing = false;
        // Only now: a resolved `insertNew` proves every offered row is in the
        // collection — the ones it returned because it wrote them, the rest
        // because the unique index rejected them as already present.
        this.recent.remember(offered);
      } catch (error) {
        return await this.handleWriteFailure(error, now, offered);
      }
    }

    await this.reportSkippedRecords(hotTally, drainTally);

    const alerted = await this.alertOn(inserted, now);

    if (!holdCursor) {
      this.advanceCursor([...page.filings, ...dayFilings]);
    }

    // Summed only HERE, for the caller's accounting. The alarm above never sees
    // the sum; it is the sum that hid which surface was actually clean.
    const skipped = hotTally.skipped + (drainTally?.skipped ?? 0);

    return {
      ingested: inserted.length,
      alerted,
      drained: reason !== null,
      drainReason: reason,
      drainedDays,
      skipped,
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
   * Re-pulls every IST day the drain must cover, oldest first.
   *
   * MULTI-DAY, not `fetchDay(now)`. A restart whose downtime crossed 18:30 UTC
   * leaves yesterday's filings beyond the newest twenty unfetched forever: the
   * live page carries only today, and the cursor advances past them. So the
   * range runs from the IST day of the newest record already stored — the last
   * day we have any evidence for — through now, bounded by `MAX_DRAIN_DAYS`.
   * In steady state that is exactly one day and one request.
   *
   * Throws on the first day that fails. A partial range is not a reconciled
   * range, and reporting it as one would clear the drain-failure latch over a
   * gap that is still open.
   */
  private async drain(
    reason: DrainReason,
    now: Date,
  ): Promise<{
    filings: readonly Filing[];
    days: number;
    skipped: number;
    received: number;
  }> {
    const anchor = await this.repository.getMaxDisseminatedAt();
    const { days, skippedDays } = drainRange(anchor, now);

    this.logger.log(
      `Draining ${days.length} IST day(s) (${reason}): ` +
        `${istDayKey(days[0])}..${istDayKey(days[days.length - 1])}`,
    );

    if (skippedDays > 0) {
      // Louder than the drain line itself: those days are NOT being fetched
      // and nothing else will fetch them. A backfill is an operator decision.
      this.logger.warn(
        `Drain range bounded to ${days.length} day(s); ${skippedDays} older ` +
          'IST day(s) were NOT reconciled and need a deliberate backfill',
      );
    }

    const filings: Filing[] = [];
    let skipped = 0;
    let received = 0;
    for (const day of days) {
      const result = await this.adapter.fetchDay(day);
      filings.push(...result.filings);
      skipped += result.skipped;
      received += result.received;
    }

    return { filings, days: days.length, skipped, received };
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
   * `observed` is the hot page unioned with a successfully drained day. Every
   * id in it has been offered to the database on this poll, so the highest of
   * them is a position the page demonstrably reached.
   *
   * MONOTONIC BY CONSTRUCTION. `Math.max` against the existing cursor is not a
   * tidiness measure: NSE disseminates out of seq_id order, so a page whose
   * newest id is 84,000 below the last one is a real observation. Following it
   * downward would make the next poll's oldest id exceed the cursor, report a
   * hole that does not exist, and re-drain the day on every poll thereafter.
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
   * Announces records the mapper dropped while ingesting the rest.
   *
   * The quiet half of the blindness problem, and the one nothing else reports.
   * A wholly rejected page is loud by construction — nothing is ingested. A
   * page where nineteen of twenty map looks exactly like a healthy poll in
   * every signal this class produces: the fetch succeeded, filings arrived, the
   * breaker is clean, the cursor moves. The dropped record existed only in a
   * warn line from the adapter.
   *
   * `page.skipped` was added in Task 5 precisely so this could be alarmed
   * rather than only logged, and it never was.
   *
   * The wholly-rejected case is deliberately left to `reportBlindFeed`: that
   * message names the right remedy and this one would double-report it.
   *
   * NOT a lost filing, and the message says so. The cursor is no longer a
   * newness filter, so a skipped record is re-offered on every poll it remains
   * on the page for, and by the scheduled drain's re-pull of the whole IST day
   * for as long as it keeps running. Fixing the mapper is therefore sufficient
   * to recover them — which is exactly why somebody has to be told.
   *
   * ONE LATCH PER FETCH SURFACE, and this is the load-bearing part.
   *
   * Edge-triggering only suppresses a repeat if the latch survives between two
   * observations of the condition. A single latch fed the SUM of both surfaces
   * did not: a skip originating on a drained day is visible on drain polls
   * alone, the scheduled drains are 5 minutes apart, and the ~150 hot polls in
   * between each reported zero skips and re-armed it. Measured against one
   * persistently unmappable record over 30 simulated minutes: 7 alerts where 1
   * was expected — one per drain, or ~288 messages a day at the shipped
   * interval, from a single bad record. That is precisely the flood that mutes
   * the channel, and it takes every other alert in this class down with it.
   *
   * So the hot page and the drain latch independently, and each is re-armed
   * ONLY by its own surface coming back clean. A null `drain` is a
   * NON-OBSERVATION — no drain was due, or the one that ran threw — and must
   * leave the drain latch exactly as it found it, for the same reason
   * `reportBlindFeed` refuses to re-arm on an empty page: absence of evidence
   * is not evidence of recovery.
   */
  private async reportSkippedRecords(
    hot: SkipTally,
    drain: SkipTally | null,
  ): Promise<void> {
    await this.reportHotSkips(hot);
    if (drain !== null) await this.reportDrainSkips(drain);
  }

  /** The live page's half, re-armed by a hot page that came back clean. */
  private async reportHotSkips(hot: SkipTally): Promise<void> {
    if (hot.skipped === 0) {
      this.hotPartial = false;
      return;
    }

    // Every record rejected is blindness, not a partial skip; it has its own
    // alert with its own remedy.
    if (hot.skipped === hot.received) return;

    this.logger.error(
      `Dropped ${hot.skipped} of ${hot.received} record(s) from the live page ` +
        'as unmappable; the rest were ingested, so nothing else reports this',
    );

    if (this.hotPartial) return;
    this.hotPartial = true;
    await this.telegram.send(
      formatSkippedRecordsAlert(hot.skipped, hot.received),
    );
  }

  /**
   * The drained day's half, re-armed ONLY by a drain that came back clean.
   *
   * No wholly-rejected suppression here, deliberately. `reportBlindFeed`
   * inspects the hot page and nothing else — it is the path that runs every 2s
   * and goes permanently silent — so a day endpoint whose every record is
   * refused has no other voice at all. Staying quiet about it to mirror the hot
   * rule would trade one duplicate message for one missing one.
   */
  private async reportDrainSkips(drain: SkipTally): Promise<void> {
    if (drain.skipped === 0) {
      this.drainPartial = false;
      return;
    }

    this.logger.error(
      `Dropped ${drain.skipped} of ${drain.received} record(s) from the ` +
        'drained IST day(s) as unmappable; nothing else reports this',
    );

    if (this.drainPartial) return;
    this.drainPartial = true;
    await this.telegram.send(
      formatSkippedRecordsAlert(drain.skipped, drain.received),
    );
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
      drainReason: null,
      drainedDays: 0,
      skipped: 0,
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
