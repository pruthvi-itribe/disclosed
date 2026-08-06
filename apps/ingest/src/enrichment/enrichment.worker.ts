import { Injectable, Logger } from '@nestjs/common';
import { describeError, stackOf } from '@app/common';
import {
  classifyFetchFailure,
  decideAttachment,
  decideParseFailure,
  describeParseRetry,
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
  /** How long after dissemination a parse failure may still be an upload race. */
  parseWindowMs: number;
  /** Reads that ended without usable text before the failure becomes terminal. */
  maxParseAttempts: number;
  /** First parse-retry delay. Doubles per parse attempt. */
  parseRetryBaseMs: number;
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
  /**
   * Parse failures put back to be looked at again, because the filing is young
   * enough that NSE's own upload could still be the explanation.
   */
  readonly parseRetried: number;
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
  parseRetried: 0,
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
 *   - **Terminal states are terminal.** A ZIP, a `"-"` sentinel and a raster
 *     scan all reach `unparseable` with a reason and are never claimed again.
 *     Without that, 3.3% of filings are an infinite retry loop aimed at NSE.
 *   - **Except while the filing is young enough to be an upload in progress.**
 *     Bytes that will not parse are provisional for the first hour after
 *     dissemination and permanent afterwards, because this pipeline has already
 *     lost a filing to NSE's own upload race. `parse-retry.ts` owns that call
 *     and argues the window; every no-document verdict is routed through it, so
 *     no state can reach the database without it having been consulted.
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
    const { filing, attempts, parseAttempts } = claimed;
    const base = { ...EMPTY_TICK, claimed: 1 };

    /**
     * Every no-document verdict leaves through here, so no reason can reach the
     * database without the retry policy having seen it. Routing the states that
     * can never be a race (a ZIP, a `"-"` url) through the same call is what
     * makes that true — the policy answers `terminal` for them and the worker
     * has one path rather than two that must be kept in step.
     */
    const noDocument = async (
      reason: UnparseableReason,
      detail: string | null,
    ): Promise<EnrichmentTickResult> => ({
      ...base,
      ...(await this.recordParseVerdict(
        filing,
        attempts,
        parseAttempts + 1,
        now,
        reason,
        detail,
      )),
    });

    const decision = decideAttachment(filing.attachmentUrl);
    if (decision.outcome === 'skip') {
      return noDocument(decision.reason, null);
    }

    const fetched = await this.fetcher.fetch(decision.url);

    if (fetched.outcome === 'oversized') {
      return noDocument(
        'oversized',
        `attachment exceeds the download cap (${fetched.bytes ?? 'unknown'} bytes)`,
      );
    }

    if (fetched.outcome === 'failed') {
      const verdict = classifyFetchFailure(fetched.status);
      if (verdict.kind === 'terminal') {
        return noDocument(verdict.reason, fetched.message);
      }
      return {
        ...base,
        ...(await this.recordRetry(
          filing,
          attempts,
          parseAttempts,
          now,
          fetched.message,
        )),
      };
    }

    const parsed = await extractPdfText(fetched.body, this.pdfParser);
    if (parsed.outcome === 'unreadable') {
      // The reason is READ OFF THE BYTES rather than assumed — see
      // `parseFailureReason` — and whether it is final is a separate question
      // the policy answers from the filing's age. NSE serves a percent or so of
      // its PDFs genuinely truncated at origin and re-fetching those returns
      // identical bytes forever; it also serves a document that is simply still
      // being written, and this pipeline has already lost one of those.
      return noDocument(parseFailureReason(fetched.body), parsed.message);
    }

    if (!hasUsableTextLayer(parsed.text)) {
      return noDocument(
        'no-text-layer',
        `${parsed.pages} page(s) yielded no text layer`,
      );
    }

    return {
      ...base,
      ...(await this.readAndRecord(
        filing,
        attempts,
        parseAttempts,
        now,
        parsed.text,
      )),
    };
  }

  private async readAndRecord(
    filing: Filing,
    attempts: number,
    parseAttempts: number,
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
      parseAttempts,
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

  /**
   * Records a read that produced no document, terminally or provisionally.
   *
   * THE POLICY DECIDES, NOT THIS METHOD. `decideParseFailure` is pure and owns
   * both the age window and the parse-attempt budget; everything here is the
   * write that follows from its answer. Keeping the decision out of the worker
   * is what lets the LICHSGFIN case — a filing lost to NSE's own upload race —
   * be exercised without a network, a clock or a database.
   *
   * On a retry the filing goes back to `pending` with `unparseableReason` left
   * NULL. That is deliberate: the dashboard groups unreadable documents by that
   * field, and a filing still queued for another look is not yet an unreadable
   * document. What it saw is written to `lastError`, which the dashboard already
   * shows, so the operator loses nothing.
   */
  private async recordParseVerdict(
    filing: Filing,
    attempts: number,
    parseAttempts: number,
    now: Date,
    reason: UnparseableReason,
    lastError: string | null,
  ): Promise<Partial<EnrichmentTickResult>> {
    const disposition = decideParseFailure({
      reason,
      disseminatedAt: filing.disseminatedAt,
      now,
      parseAttempts,
      maxParseAttempts: this.options.maxParseAttempts,
      windowMs: this.options.parseWindowMs,
      baseMs: this.options.parseRetryBaseMs,
    });

    if (disposition.kind === 'retry') {
      this.logger.log(
        `seqId ${filing.seqId} (${filing.symbol}) would not parse (${reason}) ` +
          `and is young enough to be NSE's upload still running; ` +
          `parse attempt ${parseAttempts} of ${this.options.maxParseAttempts}, ` +
          `next at ${disposition.nextAttemptAt.toISOString()}`,
      );
      await this.repository.recordEnrichment(filing.seqId, {
        ...blankVerdict(attempts, parseAttempts, now),
        state: 'pending',
        nextAttemptAt: disposition.nextAttemptAt,
        lastError: describeParseRetry(reason, lastError),
      });
      return { parseRetried: 1 };
    }

    this.logger.log(
      `seqId ${filing.seqId} (${filing.symbol}) is unparseable: ${reason}`,
    );
    await this.repository.recordEnrichment(filing.seqId, {
      ...blankVerdict(attempts, parseAttempts, now),
      state: 'unparseable',
      // `nextAttemptAt` stays null from `blankVerdict`: a terminal filing must
      // not carry a future attempt time, or a later reader will believe it is
      // still queued.
      unparseableReason: reason,
      lastError,
    });
    return { unparseable: 1 };
  }

  /** Puts a transient failure back with a backoff, or gives up on it. */
  private async recordRetry(
    filing: Filing,
    attempts: number,
    parseAttempts: number,
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
      // The parse budget is carried through UNCHANGED. A timeout is not a
      // failure to read bytes, and spending the upload-race allowance on one
      // would put a filing back in exactly the hole `parse-retry.ts` exists to
      // fill.
      ...blankVerdict(attempts, parseAttempts, now),
      state: exhausted ? 'failed' : 'pending',
      nextAttemptAt: exhausted ? null : new Date(now.getTime() + delayMs),
      lastError: message,
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
/**
 * An enrichment carrying no verdict: the counters, the clock, and eighteen
 * nulls.
 *
 * Exists because `recordEnrichment` `$set`s the WHOLE block rather than the
 * fields that changed, which is what stops a filing ending up with an amount
 * from one attempt and a refusal reason from another. Three call sites need
 * that same wall of nulls, and three hand-written copies is three chances for
 * one of them to forget a field and silently carry a stale value forward.
 */
const blankVerdict = (
  attempts: number,
  parseAttempts: number,
  now: Date,
): Omit<FilingEnrichment, 'state'> => ({
  attempts,
  parseAttempts,
  attemptedAt: now,
  nextAttemptAt: null,
  unparseableReason: null,
  lastError: null,
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

const merge = (
  tally: EnrichmentTickResult,
  delta: EnrichmentTickResult,
): EnrichmentTickResult => ({
  claimed: tally.claimed + delta.claimed,
  enriched: tally.enriched + delta.enriched,
  refused: tally.refused + delta.refused,
  unparseable: tally.unparseable + delta.unparseable,
  parseRetried: tally.parseRetried + delta.parseRetried,
  retried: tally.retried + delta.retried,
  failed: tally.failed + delta.failed,
  alerted: tally.alerted + delta.alerted,
});
