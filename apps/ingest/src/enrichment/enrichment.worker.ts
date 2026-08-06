import { Injectable, Logger } from '@nestjs/common';
import { describeError, stackOf } from '@app/common';
import {
  classifyFetchFailure,
  decideAttachment,
  extractPdfText,
  hasUsableTextLayer,
  isWithinAlertWindow,
  nextAttemptDelayMs,
  normaliseWatchlist,
  parseFailureReason,
  passesContentGates,
  readDocument,
  type AttachmentFetcher,
  type ClaimedFiling,
  type EnrichmentRepository,
  type Filing,
  type FilingEnrichment,
  type PdfParser,
  type UnparseableReason,
} from '@app/filings';
import { formatInsightAlert, type TelegramService } from '@app/notify';
import type { FilingContextService } from './filing-context.service';

export interface EnrichmentOptions {
  /** How long to wait after a tick that found nothing to do. */
  idleIntervalMs: number;
  /** Delay between two consecutive fetches. The politeness knob. */
  requestDelayMs: number;
  /** Documents processed per tick before the loop yields. */
  batchSize: number;
  maxAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
  /** How long a claim reserves a filing before another worker may take it. */
  leaseMs: number;
  /** Cold-start suppression, shared with the poller's own alert gate. */
  alertWindowMs: number;
  watchlist: readonly string[];
}

/** What one tick did, counted by outcome. */
export interface EnrichmentTickResult {
  readonly claimed: number;
  readonly enriched: number;
  /** Documents read successfully whose amount the extractor refused. */
  readonly refused: number;
  readonly unparseable: number;
  /** Transient failures put back with a backoff. */
  readonly retried: number;
  /** Transient failures that exhausted the attempt budget. */
  readonly failed: number;
  /** Follow-up messages ATTEMPTED. Not proof of delivery. */
  readonly alerted: number;
}

const EMPTY_TICK: EnrichmentTickResult = {
  claimed: 0,
  enriched: 0,
  refused: 0,
  unparseable: 0,
  retried: 0,
  failed: 0,
  alerted: 0,
};

/**
 * Reads filings' source PDFs in the background and records what they say.
 *
 * ================================================================
 * WHY THIS IS NOT ON THE POLLER'S PATH
 * ================================================================
 *
 * The poller has a two-second budget and it is the reason this project exists.
 * Fetching the attachment inside it would put a third-party download on that
 * path — measured at 206 ms median but 3.6 s at p99, with a 22 MB tail, and
 * failing outright for 3.3% of documents because NSE serves them truncated. One
 * filing in thirty would then be an exception on the path that must never miss
 * a filing.
 *
 * So the filing is stored and alerted first, on `summary` alone, and this
 * worker reads the document afterwards. When the document yields a verified
 * amount it sends a SECOND message carrying the composed headline. When it does
 * not, it sends nothing at all and the first alert stands — which is the
 * correct outcome, because the first alert already said everything that could
 * be traced to a source.
 *
 * ================================================================
 * WHY AN IN-PROCESS WORKER RATHER THAN A QUEUE
 * ================================================================
 *
 * Bull and Redis were removed from this project as unused, and are not
 * re-added. The state lives on the filing document (see
 * `enrichment.repository.ts` for the full argument): Mongo is the queue, the
 * claim is a single atomic `findOneAndUpdate`, and there is nothing to
 * reconcile after a restart because there is only one record of what is
 * outstanding.
 *
 * The load is ~400 filings a day against a p90 of 436 ms per document. A queue
 * exists to buy parallelism, and parallelism is the one thing this worker must
 * not have: it fetches from an exchange archive that has been measured at 60
 * polite sequential requests and never at more.
 *
 * ================================================================
 * WHAT IS LOAD-BEARING
 * ================================================================
 *
 *   - **`tick()` never throws.** Every failure is counted and logged. A worker
 *     that dies on one bad document stops enriching every document after it.
 *   - **Terminal states are terminal.** A ZIP, a `"-"` sentinel, a truncated
 *     PDF and a raster scan all reach `unparseable` with a reason and are never
 *     claimed again. Without that, 3.3% of filings are an infinite retry loop
 *     aimed at NSE.
 *   - **Persist, then alert.** The same order the poller uses, for the same
 *     reason: a message about a verdict that was never stored cannot be
 *     explained afterwards.
 *   - **The content gates are shared.** `passesContentGates` and the alert
 *     window are the poller's own, so an operator's watchlist cannot silence
 *     one lane and leave the other running.
 */
@Injectable()
export class EnrichmentWorker {
  private readonly logger = new Logger(EnrichmentWorker.name);
  private readonly watchlist: ReadonlySet<string>;

  private running = false;
  private ticking = false;
  private sleepTimer: NodeJS.Timeout | null = null;
  private wake: (() => void) | null = null;

  constructor(
    private readonly repository: EnrichmentRepository,
    private readonly fetcher: AttachmentFetcher,
    private readonly context: FilingContextService,
    private readonly telegram: TelegramService,
    private readonly options: EnrichmentOptions,
    /** Injected in tests so no suite ever loads pdf.js or a PDF fixture. */
    private readonly pdfParser?: PdfParser,
  ) {
    this.watchlist = normaliseWatchlist(options.watchlist);
  }

  /** Runs until `stop()` is called. Never rejects for a per-document failure. */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('EnrichmentWorker is already running');
    }
    this.running = true;
    this.logger.log(
      `Enrichment worker started: batch ${this.options.batchSize}, ` +
        `${this.options.requestDelayMs}ms between fetches`,
    );

    while (this.running) {
      const result = await this.cycle();
      if (!this.running) break;
      // A tick that filled its batch has more work waiting, so it goes straight
      // round again — the per-document delay inside the tick is what paces the
      // requests. Only an empty queue waits the idle interval.
      const delay =
        result.claimed === 0
          ? this.options.idleIntervalMs
          : this.options.requestDelayMs;
      if (delay > 0) await this.sleep(delay);
    }
  }

  /**
   * Stops the loop and cuts any sleep short.
   *
   * The idle interval is measured in tens of seconds and a SIGTERM that waits
   * it out looks like a hung shutdown to an orchestrator. Safe when not running.
   */
  stop(): void {
    this.running = false;
    const wake = this.wake;
    this.clearSleep();
    wake?.();
  }

  /**
   * Processes up to `batchSize` filings, pacing between fetches.
   *
   * NEVER THROWS. Anything that escapes a single document's handling is caught,
   * counted and logged, because the loop that would have recovered from it is
   * the caller.
   */
  async tick(now = new Date()): Promise<EnrichmentTickResult> {
    if (this.ticking) {
      // Not an error: a previous tick is still draining. Returning an empty
      // result keeps a caller that ignores this from spinning on the guard.
      this.logger.warn('Enrichment tick still in flight; skipping');
      return EMPTY_TICK;
    }

    this.ticking = true;
    try {
      return await this.drain(now);
    } finally {
      // `finally`, so a throw from anywhere below cannot wedge the guard shut
      // and silence enrichment permanently.
      this.ticking = false;
    }
  }

  private async drain(now: Date): Promise<EnrichmentTickResult> {
    let tally = EMPTY_TICK;

    // Captured, never read live. A tick invoked directly — by a test, or by the
    // backfill tool — has never been `start()`ed, so a bare `!this.running`
    // check would abandon the batch after its first document. What this is for
    // is letting `stop()` cut a long drain short DURING a shutdown, which is
    // only meaningful if the drain began while running.
    const wasRunning = this.running;

    for (let index = 0; index < this.options.batchSize; index += 1) {
      if (wasRunning && !this.running) break;

      let claimed: ClaimedFiling | null;
      try {
        claimed = await this.repository.claimNext(now, this.options.leaseMs);
      } catch (error) {
        // The database is the queue. If claiming fails there is no work to do
        // and no state to repair; the next tick tries again.
        this.logger.error(
          `Could not claim a filing to enrich: ${describeError(error)}`,
          stackOf(error),
        );
        break;
      }

      if (claimed === null) break;

      // BETWEEN documents, never before the first: a tick that processes one
      // filing should not also sit out the politeness delay for nothing.
      if (index > 0 && this.options.requestDelayMs > 0) {
        await this.sleep(this.options.requestDelayMs);
      }

      tally = merge(tally, await this.processSafely(claimed, now));
    }

    return tally;
  }

  /** One document, contained. Returns a tally rather than throwing. */
  private async processSafely(
    claimed: ClaimedFiling,
    now: Date,
  ): Promise<EnrichmentTickResult> {
    try {
      return await this.process(claimed, now);
    } catch (error) {
      // The filing keeps its lease and is retried when the lease expires, with
      // its attempt count already incremented — so a permanently poisonous
      // document still reaches `failed` rather than looping forever.
      this.logger.error(
        `Enrichment threw for seqId ${claimed.filing.seqId}: ${describeError(error)}`,
        stackOf(error),
      );
      return { ...EMPTY_TICK, claimed: 1 };
    }
  }

  private async process(
    claimed: ClaimedFiling,
    now: Date,
  ): Promise<EnrichmentTickResult> {
    const { filing, attempts } = claimed;
    const base = { ...EMPTY_TICK, claimed: 1 };

    const decision = decideAttachment(filing.attachmentUrl);
    if (decision.outcome === 'skip') {
      await this.recordUnparseable(
        filing,
        attempts,
        now,
        decision.reason,
        null,
      );
      return { ...base, unparseable: 1 };
    }

    const fetched = await this.fetcher.fetch(decision.url);

    if (fetched.outcome === 'oversized') {
      await this.recordUnparseable(
        filing,
        attempts,
        now,
        'oversized',
        `attachment exceeds the download cap (${fetched.bytes ?? 'unknown'} bytes)`,
      );
      return { ...base, unparseable: 1 };
    }

    if (fetched.outcome === 'failed') {
      const verdict = classifyFetchFailure(fetched.status);
      if (verdict.kind === 'terminal') {
        await this.recordUnparseable(
          filing,
          attempts,
          now,
          verdict.reason,
          fetched.message,
        );
        return { ...base, unparseable: 1 };
      }
      return {
        ...base,
        ...(await this.recordRetry(filing, attempts, now, fetched.message)),
      };
    }

    const parsed = await extractPdfText(fetched.body, this.pdfParser);
    if (parsed.outcome === 'unreadable') {
      // NOT retryable either way, and this is the measurement the whole
      // terminal-state design rests on: NSE serves a percent or so of its PDFs
      // truncated at origin, with its own content-length matching the short
      // body, so re-fetching returns identical bytes forever. The reason is
      // read off the bytes rather than assumed — see `parseFailureReason`.
      await this.recordUnparseable(
        filing,
        attempts,
        now,
        parseFailureReason(fetched.body),
        parsed.message,
      );
      return { ...base, unparseable: 1 };
    }

    if (!hasUsableTextLayer(parsed.text)) {
      await this.recordUnparseable(
        filing,
        attempts,
        now,
        'no-text-layer',
        `${parsed.pages} page(s) yielded no text layer`,
      );
      return { ...base, unparseable: 1 };
    }

    return {
      ...base,
      ...(await this.readAndRecord(filing, attempts, now, parsed.text)),
    };
  }

  private async readAndRecord(
    filing: Filing,
    attempts: number,
    now: Date,
    documentText: string,
  ): Promise<Partial<EnrichmentTickResult>> {
    const verdict = readDocument({
      symbol: filing.symbol,
      category: filing.category,
      summary: filing.summary,
      documentText,
    });

    const contextLine = await this.contextFor(
      filing,
      now,
      verdict.amountRupees,
    );

    const enrichment: FilingEnrichment = {
      state: 'enriched',
      attempts,
      attemptedAt: now,
      nextAttemptAt: null,
      unparseableReason: null,
      lastError: null,
      documentChars: verdict.documentChars,
      amountRupees: verdict.amountRupees,
      amountEvidence: verdict.amountEvidence,
      amountAnchor: verdict.amountAnchor,
      amountLabel: verdict.amountLabel,
      amountRefusalReason: verdict.amountRefusalReason,
      amountRefusalDetail: verdict.amountRefusalDetail,
      counterparty: verdict.counterparty,
      counterpartyEvidence: verdict.counterpartyEvidence,
      counterpartyRefusalReason: verdict.counterpartyRefusalReason,
      headline: verdict.headline,
      contextLine,
    };

    // PERSIST BEFORE ALERTING, always. A message about a verdict that was never
    // stored cannot be explained the next morning.
    await this.repository.recordEnrichment(filing.seqId, enrichment);

    const alerted = await this.announce(
      filing,
      enrichment,
      verdict.headlineForm,
      now,
    );
    return {
      enriched: 1,
      refused: verdict.amountRupees === null ? 1 : 0,
      alerted,
    };
  }

  /**
   * Sends the follow-up, when there is one to send.
   *
   * FOUR GATES, and each blocks a different way of being annoying or wrong:
   * the headline must carry a verified amount (nothing to add otherwise), the
   * category must not be routine, the symbol must be watched if a watchlist
   * exists, and the filing must still be inside the cold-start alert window —
   * without that last one, a backfill of a thousand stored filings would send a
   * hundred and fifty follow-ups about news from last week.
   *
   * Best-effort by design, exactly like the poller's alerting: a Telegram
   * outage must never turn a successful enrichment into a failed one, because
   * the verdict is already stored and re-running it would spend another NSE
   * request to reach the same answer.
   */
  private async announce(
    filing: Filing,
    enrichment: FilingEnrichment,
    form: string,
    now: Date,
  ): Promise<number> {
    if (form !== 'enriched' || enrichment.headline === null) return 0;
    if (!passesContentGates(filing, this.watchlist)) return 0;
    if (!isWithinAlertWindow(filing, now, this.options.alertWindowMs)) return 0;

    try {
      await this.telegram.send(
        formatInsightAlert(
          filing,
          enrichment.headline,
          enrichment.contextLine,
          enrichment.amountEvidence,
        ),
      );
      return 1;
    } catch (error) {
      this.logger.error(
        `Insight alert failed for seqId ${filing.seqId}: ${describeError(error)}`,
        stackOf(error),
      );
      return 0;
    }
  }

  /**
   * The derived-context line, contained.
   *
   * The verdict is already worth storing without it, so a context query that
   * fails costs the line and nothing else. Logged rather than swallowed: a
   * provider that has been throwing all week must not present as a system that
   * had nothing to say.
   */
  private async contextFor(
    filing: Filing,
    now: Date,
    amountRupees: number | null,
  ): Promise<string | null> {
    try {
      return await this.context.contextForAmount(filing, now, amountRupees);
    } catch (error) {
      this.logger.error(
        `Derived context failed for seqId ${filing.seqId}: ${describeError(error)}`,
        stackOf(error),
      );
      return null;
    }
  }

  private async recordUnparseable(
    filing: Filing,
    attempts: number,
    now: Date,
    reason: UnparseableReason,
    lastError: string | null,
  ): Promise<void> {
    this.logger.log(
      `seqId ${filing.seqId} (${filing.symbol}) is unparseable: ${reason}`,
    );
    await this.repository.recordEnrichment(filing.seqId, {
      state: 'unparseable',
      attempts,
      attemptedAt: now,
      // Explicitly null: a terminal filing must not carry a future attempt
      // time, or a later reader will believe it is still queued.
      nextAttemptAt: null,
      unparseableReason: reason,
      lastError,
      documentChars: null,
      amountRupees: null,
      amountEvidence: null,
      amountAnchor: null,
      amountLabel: null,
      amountRefusalReason: null,
      amountRefusalDetail: null,
      counterparty: null,
      counterpartyEvidence: null,
      counterpartyRefusalReason: null,
      headline: null,
      contextLine: null,
    });
  }

  /** Puts a transient failure back with a backoff, or gives up on it. */
  private async recordRetry(
    filing: Filing,
    attempts: number,
    now: Date,
    message: string,
  ): Promise<Partial<EnrichmentTickResult>> {
    const delayMs = nextAttemptDelayMs({
      attempts,
      maxAttempts: this.options.maxAttempts,
      baseMs: this.options.retryBaseMs,
      maxMs: this.options.retryMaxMs,
    });

    const exhausted = delayMs === null;
    if (exhausted) {
      this.logger.warn(
        `seqId ${filing.seqId} (${filing.symbol}) failed ${attempts} time(s); ` +
          `giving up: ${message}`,
      );
    }

    await this.repository.recordEnrichment(filing.seqId, {
      state: exhausted ? 'failed' : 'pending',
      attempts,
      attemptedAt: now,
      nextAttemptAt: exhausted ? null : new Date(now.getTime() + delayMs),
      unparseableReason: null,
      lastError: message,
      documentChars: null,
      amountRupees: null,
      amountEvidence: null,
      amountAnchor: null,
      amountLabel: null,
      amountRefusalReason: null,
      amountRefusalDetail: null,
      counterparty: null,
      counterpartyEvidence: null,
      counterpartyRefusalReason: null,
      headline: null,
      contextLine: null,
    });

    return exhausted ? { failed: 1 } : { retried: 1 };
  }

  /**
   * One loop iteration.
   *
   * `tick()` is contracted never to throw, so this catch should be unreachable.
   * It is here because the alternative to an unreachable catch is an unhandled
   * rejection that kills the loop — and a dead worker is indistinguishable,
   * from outside, from an empty queue.
   */
  private async cycle(): Promise<EnrichmentTickResult> {
    try {
      return await this.tick();
    } catch (error) {
      this.logger.error(
        `Enrichment tick threw, which it is contracted never to do: ${describeError(error)}`,
        stackOf(error),
      );
      return EMPTY_TICK;
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

/**
 * Adds one document's outcome to the running tally.
 *
 * Takes a COMPLETE result rather than a partial: every path through `process`
 * spreads `EMPTY_TICK` before it returns, so a per-field fallback here would be
 * seven branches no input can reach — and an unreachable branch is a claim
 * nobody can check.
 */
const merge = (
  tally: EnrichmentTickResult,
  delta: EnrichmentTickResult,
): EnrichmentTickResult => ({
  claimed: tally.claimed + delta.claimed,
  enriched: tally.enriched + delta.enriched,
  refused: tally.refused + delta.refused,
  unparseable: tally.unparseable + delta.unparseable,
  retried: tally.retried + delta.retried,
  failed: tally.failed + delta.failed,
  alerted: tally.alerted + delta.alerted,
});
