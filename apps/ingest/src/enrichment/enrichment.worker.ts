import { Injectable, Logger } from '@nestjs/common';
import { describeError, stackOf } from '@app/common';
import {
  basisReachFor,
  claimEligibility,
  classifyFetchFailure,
  composeClaimLine,
  composeResultsLine,
  decideAttachment,
  decideParseFailure,
  describeParseRetry,
  extractPdfText,
  extractZipText,
  hasUsableTextLayer,
  isWithinAlertWindow,
  nextAttemptDelayMs,
  normaliseWatchlist,
  parseFailureReason,
  NO_CLAIMS,
  NO_RESULTS,
  passesContentGates,
  readDocument,
  readWithRouting,
  resultsEligibility,
  verifyClaims,
  verifyResults,
  vetSummary,
  type AttachmentFetcher,
  type ClaimedFiling,
  type ClaimExtractor,
  type ClaimOutcome,
  type DoclingConverter,
  type EnrichmentRepository,
  type Filing,
  type FilingEnrichment,
  type ParseRoute,
  type PdfParser,
  type ResultsExtractor,
  type ResultsOutcome,
  type RoutedRead,
  type UnparseableReason,
  type ZipReader,
  type ZipTextOk,
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
  /** The most verified claims one wire line may carry. */
  maxClaims: number;
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
  /** Documents that produced at least one verified claim. */
  readonly claimed_lines: number;
  /** Proposed claims the verbatim gate refused. */
  readonly claimsDiscarded: number;
  /** Documents that produced a verified results line. */
  readonly resultsLines: number;
  /** Follow-up messages ATTEMPTED. Not proof of delivery. */
  readonly alerted: number;
}

/**
 * How long the loop may sit idle before it says so.
 *
 * Five minutes: frequent enough that a dead lane is visible within one coffee
 * break, rare enough that a quiet overnight costs a dozen log lines and a dozen
 * indexed counts.
 */
export const HEARTBEAT_MS = 300_000;

/** One tick's outcome, in the order an operator reads it. */
export const describeTick = (result: EnrichmentTickResult): string =>
  `Enrichment tick: claimed ${result.claimed}, enriched ${result.enriched} ` +
  `(amount refused on ${result.refused}), unparseable ${result.unparseable}, ` +
  `parse-retried ${result.parseRetried}, retried ${result.retried}, ` +
  `failed ${result.failed}, claim-lines ${result.claimed_lines} ` +
  `(${result.claimsDiscarded} claim(s) discarded), ` +
  `results-lines ${result.resultsLines}, alerted ${result.alerted}`;

const EMPTY_TICK: EnrichmentTickResult = {
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
    /**
     * Null when no extractor is configured, which is a supported state rather
     * than a broken one: everything else in this worker keeps working and every
     * eligible filing records `extractor-unavailable` instead of a claim.
     */
    private readonly claimExtractor: ClaimExtractor | null = null,
    /**
     * Null when no archive reader is wired, which is a supported state: ZIP
     * attachments then reach `not-a-pdf` exactly as they did before, and
     * nothing else changes. Injected for the same reason `pdfParser` is — a
     * suite must be able to hand over a hostile archive without building one.
     */
    private readonly zipReader: ZipReader | null = null,
    /**
     * Null when no results extractor is wired, which is a supported state
     * exactly as a null claim extractor is: every results-eligible filing then
     * records `extractor-unavailable` rather than a silent nothing.
     *
     * SEPARATE FROM `claimExtractor` even though one object usually satisfies
     * both, so a deployment can run one lane without the other and so a test can
     * hand over a results extractor that answers and a claim extractor that does
     * not.
     */
    private readonly resultsExtractor: ResultsExtractor | null = null,
    /**
     * Null when no Docling service is wired, which is a FULLY SUPPORTED
     * deployment and not a degraded one.
     *
     * Docling is a Python service holding 2.3-7.7 GB resident, and this pipeline
     * must keep working on a machine that has no Python on it. With this null
     * every document is read by `pdf-parse` exactly as it was before the hybrid
     * existed: scanned filings reach `no-text-layer`, results filings are read
     * by the flattening parser, and nothing fails. What changes is that the
     * filing records which parser read it, so the two situations are
     * distinguishable afterwards.
     */
    private readonly docling: DoclingConverter | null = null,
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
    await this.reportQueueDepth();

    let idleMs = 0;

    while (this.running) {
      const result = await this.cycle();
      if (!this.running) break;

      // A WORKER THAT IS NOT RUNNING LOOKS EXACTLY LIKE A QUEUE WITH NOTHING IN
      // IT, from outside. That is how this lane came to be silently absent from
      // a running deployment for a day, so the loop says what it did: a line
      // per tick that touched anything, and a queue depth on a cadence when it
      // did not. Both are cheap — the depth is one `countDocuments` against the
      // index the claim query already needs.
      if (result.claimed > 0) {
        this.logger.log(describeTick(result));
        idleMs = 0;
      } else {
        idleMs += this.options.idleIntervalMs;
        if (idleMs >= HEARTBEAT_MS) {
          idleMs = 0;
          await this.reportQueueDepth();
        }
      }

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
   * Says how much work is outstanding.
   *
   * CONTAINED, because this is instrumentation. A database hiccup while
   * counting must not stop the loop that does the actual work — the count is
   * how an operator sees the queue, not how the worker finds it.
   */
  private async reportQueueDepth(): Promise<void> {
    try {
      const pending = await this.repository.pendingCount(new Date());
      this.logger.log(`Enrichment queue: ${pending} filing(s) awaiting a read`);
    } catch (error) {
      this.logger.warn(
        `Could not read the enrichment queue depth: ${describeError(error)}`,
      );
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
      // The size is stated, and whether it is the document's or merely what
      // arrived is stated too. All 8 filings the previous cap refused recorded
      // "unknown bytes", so the collection could not answer the one question
      // that decides whether a cap is set correctly: by how much did it miss?
      return noDocument(
        'oversized',
        fetched.bytes === null
          ? 'attachment exceeds the download cap (size not reported)'
          : `attachment exceeds the download cap (${fetched.bytes} bytes` +
              `${fetched.advertised ? '' : ' read before the transfer was cut'})`,
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

    if (decision.kind === 'zip') {
      return {
        ...base,
        ...(await this.readArchive(
          filing,
          attempts,
          parseAttempts,
          now,
          fetched.body,
          noDocument,
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

    // ROUTING HAPPENS BEFORE THE `no-text-layer` VERDICT, not after it, and the
    // order is the whole of the scanned-document fix. `pdf-parse` returning 8
    // characters of page furniture is not a fact about the document, it is a
    // fact about `pdf-parse`: measured over every scanned PDF in the live
    // collection, Docling with OCR recovers 20 of 20 with 25 of 25 ground-truth
    // digits verbatim. So the empty read becomes the ROUTING EVIDENCE, and only
    // a document that neither parser could read reaches the terminal state.
    const routed = await this.readRouted(filing, fetched.body, parsed);

    if (!hasUsableTextLayer(routed.text)) {
      return noDocument(
        'no-text-layer',
        `${parsed.pages} page(s) yielded no text layer` +
          (routed.fallbackReason === null ? '' : `; ${routed.fallbackReason}`),
      );
    }

    return {
      ...base,
      ...(await this.readAndRecord(
        filing,
        attempts,
        parseAttempts,
        now,
        routed.text,
        null,
        routed,
      )),
    };
  }

  /**
   * Escalates to Docling where it measurably pays, contained.
   *
   * CONTAINED FOR THE SAME REASON THE CONTEXT QUERY IS. The `pdf-parse` reading
   * is already in hand and is already worth storing; an optional Python service
   * throwing must cost the escalation and never the filing. `readWithRouting`
   * is contracted not to throw and returns the cheap text on every failure —
   * this is the belt to that brace, because the alternative to an unreachable
   * catch is a filing lost to a dependency the design calls optional.
   */
  private async readRouted(
    filing: Filing,
    body: Buffer,
    parsed: { readonly text: string; readonly pages: number },
  ): Promise<RoutedRead> {
    try {
      const routed = await readWithRouting({
        category: filing.category,
        data: body,
        fileName: `${filing.seqId}.pdf`,
        text: parsed.text,
        pages: parsed.pages,
        converter: this.docling,
      });
      if (routed.route !== 'pdf-parse') {
        this.logger.log(
          `seqId ${filing.seqId} (${filing.symbol}): read by ${routed.route} ` +
            `(${routed.text.length} chars, was ${parsed.text.length})`,
        );
      } else if (routed.fallbackReason !== null) {
        this.logger.warn(
          `seqId ${filing.seqId} (${filing.symbol}): ${routed.fallbackReason}`,
        );
      }
      return routed;
    } catch (error) {
      this.logger.error(
        `Parse routing threw for seqId ${filing.seqId}: ${describeError(error)}`,
        stackOf(error),
      );
      return {
        text: parsed.text,
        route: 'pdf-parse',
        routeReason: 'the router threw and the cheap read was kept',
        fallbackReason: describeError(error),
      };
    }
  }

  /**
   * Reads a ZIP attachment's PDFs, or records why it could not.
   *
   * EVERY REFUSAL BECOMES `not-a-pdf`, which is the state the whole category
   * already had — so a zip bomb, a traversal name and an archive of nothing but
   * XML all land where a ZIP landed before this existed, and none of them can
   * be retried against the exchange. The specific reason goes to `lastError`,
   * which the dashboard shows, because "we refused this archive" and "we
   * refused this archive because it claims to expand 4000x" are the same state
   * and very different facts.
   */
  private async readArchive(
    filing: Filing,
    attempts: number,
    parseAttempts: number,
    now: Date,
    archive: Buffer,
    noDocument: (
      reason: UnparseableReason,
      detail: string | null,
    ) => Promise<EnrichmentTickResult>,
  ): Promise<Partial<EnrichmentTickResult>> {
    if (this.zipReader === null) {
      return noDocument('not-a-pdf', 'no archive reader is configured');
    }

    const opened = await extractZipText(archive, this.zipReader, {
      parser: this.pdfParser,
    });
    if (opened.outcome !== 'ok') {
      return noDocument('not-a-pdf', `${opened.reason}: ${opened.detail}`);
    }

    if (!hasUsableTextLayer(opened.text)) {
      return noDocument(
        'no-text-layer',
        `${opened.members.length} archived PDF(s) yielded no text layer`,
      );
    }

    this.logger.log(
      `seqId ${filing.seqId} (${filing.symbol}): read ` +
        `${opened.members.length} PDF(s) out of a ZIP attachment`,
    );
    return this.readAndRecord(
      filing,
      attempts,
      parseAttempts,
      now,
      opened.text,
      describeZipSource(opened),
    );
  }

  private async readAndRecord(
    filing: Filing,
    attempts: number,
    parseAttempts: number,
    now: Date,
    documentText: string,
    documentSource: string | null = null,
    /**
     * How the text was produced. Defaulted for the ZIP path, whose members are
     * read by `pdf-parse` and concatenated — an archive of several PDFs is not
     * one document for a layout parser to find a reading order in.
     */
    routed: RoutedRead = {
      text: documentText,
      route: 'pdf-parse',
      routeReason: 'archived PDFs are concatenated and read by pdf-parse',
      fallbackReason: null,
    },
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

    const claims = await this.claimsFor(filing, documentText);
    const results = await this.resultsFor(filing, documentText, routed.route);

    const enrichment: FilingEnrichment = {
      state: 'enriched',
      attempts,
      parseAttempts,
      attemptedAt: now,
      nextAttemptAt: null,
      unparseableReason: null,
      lastError: null,
      documentChars: verdict.documentChars,
      documentSource,
      parseRoute: routed.route,
      parseFallbackReason: routed.fallbackReason,
      coverageSkip: claims.skip,
      amountRupees: verdict.amountRupees,
      amountEvidence: verdict.amountEvidence,
      amountAnchor: verdict.amountAnchor,
      amountLabel: verdict.amountLabel,
      amountRefusalReason: verdict.amountRefusalReason,
      amountRefusalDetail: verdict.amountRefusalDetail,
      counterparty: verdict.counterparty,
      counterpartyEvidence: verdict.counterpartyEvidence,
      counterpartyRefusalReason: verdict.counterpartyRefusalReason,
      claims: claims.claims,
      claimLine: composeClaimLine(filing.symbol, claims.claims),
      claimDiscards: claims.discards,
      claimsProposed: claims.proposed,
      claimRefusalReason: claims.refusalReason,
      claimRefusalDetail: claims.refusalDetail,
      results: results.results,
      resultsLine: results.line,
      resultsDiscards: results.discards,
      resultsProposed: results.proposed,
      resultsRefusalReason: results.refusalReason,
      resultsRefusalDetail: results.refusalDetail,
      // STORED, NEVER PUBLISHED. `announce` below is handed the claim line and
      // the headline and nothing else, so there is no path from here to
      // Telegram — see `claim-summary.ts` for why that separation is the whole
      // design rather than an oversight.
      documentSummary: claims.summary,
      documentSummaryRefusalReason: claims.summaryRefusalReason,
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
      claimed_lines: enrichment.claimLine === null ? 0 : 1,
      claimsDiscarded: claims.discards.length,
      resultsLines: enrichment.resultsLine === null ? 0 : 1,
      alerted,
    };
  }

  /**
   * Reads the notable claims out of a document, contained.
   *
   * ================================================================
   * THE ORDER OF THE GATES IS THE COST CONTROL
   * ================================================================
   *
   * `claimEligibility` is deterministic, runs over text already in memory, and
   * removes the large majority of filings — newspaper scans, record dates,
   * covering letters — before anything is spent. Only what survives it reaches
   * a model. Everything after that is contained the same way the context query
   * is: a failing extractor costs the claims and never the enrichment, because
   * the amount, the counterparty and the headline are already worth storing and
   * re-running the filing would spend another NSE request to reach them again.
   *
   * EVERY OUTCOME IS RECORDED WITH A REASON. "Nothing was found", "nothing was
   * looked for", "nothing is configured" and "everything found was refused" are
   * four different facts about a filing, and a dashboard that rendered them the
   * same would make a broken extractor indistinguishable from a quiet market.
   */
  private async claimsFor(
    filing: Filing,
    documentText: string,
  ): Promise<ClaimOutcome> {
    const eligibility = claimEligibility(filing, documentText);
    if (!eligibility.eligible) {
      return {
        ...NO_CLAIMS,
        refusalReason: 'not-eligible',
        refusalDetail: eligibility.reason,
        // COUNTED, not merely recorded. See `ClaimOutcome.skip`.
        skip: eligibility.skip,
      };
    }

    if (this.claimExtractor === null) {
      return {
        ...NO_CLAIMS,
        refusalReason: 'extractor-unavailable',
        refusalDetail: 'no claim extractor is configured',
      };
    }

    let extraction;
    try {
      extraction = await this.claimExtractor.extract({
        symbol: filing.symbol,
        category: filing.category,
        summary: filing.summary,
        documentText,
      });
    } catch (error) {
      // The extractor is contracted never to throw. This is the belt to that
      // brace: an exception escaping it must not turn a good enrichment into a
      // failed one.
      this.logger.error(
        `Claim extraction threw for seqId ${filing.seqId}: ${describeError(error)}`,
        stackOf(error),
      );
      return {
        ...NO_CLAIMS,
        refusalReason: 'extractor-error',
        refusalDetail: describeError(error),
      };
    }

    if (extraction.outcome === 'failed') {
      this.logger.warn(
        `Claim extraction failed for seqId ${filing.seqId}: ${extraction.message}`,
      );
      return {
        ...NO_CLAIMS,
        refusalReason: 'extractor-error',
        refusalDetail: extraction.message,
      };
    }

    const proposed = extraction.claims.length;
    // THE SUMMARY IS READ WHETHER OR NOT THERE ARE CLAIMS, and vetted rather
    // than verified — nothing can verify it. A document with nothing worth a
    // wire line is exactly the document a reviewer most wants a sentence about.
    const vetted = vetSummary(extraction.summary);
    const summary = vetted.outcome === 'ok' ? vetted.summary : null;
    const summaryRefusalReason = vetted.outcome === 'ok' ? null : vetted.reason;

    if (proposed === 0) {
      // The ordinary answer. Most filings state nothing worth a wire line.
      return {
        ...NO_CLAIMS,
        proposed: 0,
        refusalReason: 'no-claims',
        summary,
        summaryRefusalReason,
      };
    }

    const { claims, discards } = verifyClaims({
      documentText,
      proposed: extraction.claims,
      maxClaims: this.options.maxClaims,
    });

    if (claims.length === 0) {
      this.logger.warn(
        `seqId ${filing.seqId} (${filing.symbol}): all ${proposed} proposed ` +
          `claim(s) were refused (${discards.map((row) => row.reason).join(', ')})`,
      );
    }

    return {
      claims,
      discards,
      proposed,
      refusalReason: claims.length === 0 ? 'all-discarded' : null,
      refusalDetail: null,
      // A model WAS called on this path, so nothing was skipped.
      skip: null,
      summary,
      summaryRefusalReason,
    };
  }

  /**
   * Reads the financial results out of a document, contained.
   *
   * ================================================================
   * A SECOND LANE, NOT A SECOND KIND OF CLAIM
   * ================================================================
   *
   * It runs alongside the claim lane rather than inside it, and the separation
   * is the same one `claim-summary.ts` insists on for a different reason: the
   * two have different gates. A claim is admitted by finding its sentence; a
   * results figure is admitted by the document's own header block agreeing about
   * the statement, the column and the scale. Nothing downstream may treat one as
   * the other, so nothing upstream may carry them in one structure.
   *
   * Contained exactly as the claim lane is: a failing results extractor costs
   * the results and never the enrichment, because the amount, the claims and the
   * headline are already worth storing and re-running the filing would spend
   * another NSE request to reach them again.
   */
  private async resultsFor(
    filing: Filing,
    documentText: string,
    /**
     * Which parser produced `documentText`.
     *
     * NOT COSMETIC. The bound on how far above a table its statement heading may
     * sit is a property of the parser's output, measured separately for each:
     * 400 characters for `pdf-parse` and 2,400 for Docling, whose markdown puts
     * the same real heading further from the same real table. Reading Docling
     * output with the `pdf-parse` bound refuses 74 of 77 measured tables — the
     * hybrid would look like an upgrade and make results coverage worse.
     */
    route: ParseRoute,
  ): Promise<ResultsOutcome> {
    const eligibility = resultsEligibility(filing, documentText);
    if (!eligibility.eligible) {
      return {
        ...NO_RESULTS,
        refusalReason: 'not-eligible',
        refusalDetail: eligibility.reason,
      };
    }

    if (this.resultsExtractor === null) {
      return {
        ...NO_RESULTS,
        refusalReason: 'extractor-unavailable',
        refusalDetail: 'no results extractor is configured',
      };
    }

    let extraction;
    try {
      extraction = await this.resultsExtractor.extractResults({
        symbol: filing.symbol,
        category: filing.category,
        summary: filing.summary,
        documentText,
      });
    } catch (error) {
      // The extractor is contracted never to throw. This is the belt to that
      // brace.
      this.logger.error(
        `Results extraction threw for seqId ${filing.seqId}: ${describeError(error)}`,
        stackOf(error),
      );
      return {
        ...NO_RESULTS,
        refusalReason: 'extractor-error',
        refusalDetail: describeError(error),
      };
    }

    if (extraction.outcome === 'failed') {
      this.logger.warn(
        `Results extraction failed for seqId ${filing.seqId}: ${extraction.message}`,
      );
      return {
        ...NO_RESULTS,
        refusalReason: 'extractor-error',
        refusalDetail: extraction.message,
      };
    }

    if (extraction.results === null) {
      // The ordinary answer for most of the eligible categories: a board-meeting
      // outcome about a dividend carries no statement at all.
      return {
        ...NO_RESULTS,
        proposed: 0,
        refusalReason: 'no-results',
      };
    }

    const proposed = extraction.results.figures.length;
    const verified = verifyResults({
      documentText,
      proposed: extraction.results,
      basisReach: basisReachFor(route),
    });

    if (verified.outcome === 'refused') {
      this.logger.warn(
        `seqId ${filing.seqId} (${filing.symbol}): the results table was ` +
          `refused (${verified.reason}): ${verified.detail}`,
      );
      return {
        ...NO_RESULTS,
        discards: verified.discards,
        proposed,
        refusalReason: verified.reason,
        refusalDetail: verified.detail,
      };
    }

    return {
      results: verified.results,
      line: composeResultsLine(filing.symbol, verified.results),
      discards: verified.discards,
      proposed,
      refusalReason: null,
      refusalDetail: null,
    };
  }

  /**
   * Sends the follow-up, when there is one to send.
   *
   * FOUR GATES, and each blocks a different way of being annoying or wrong:
   * there must be something verified to add (a headline carrying an amount, or
   * a claim line whose sentences were found in the document), the category must
   * not be routine, the symbol must be watched if a watchlist exists, and the
   * filing must still be inside the cold-start alert window —
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
    // TWO INDEPENDENT REASONS TO SEND, and the second is the point of the claim
    // work: most of what a filings desk wants to read carries no figure at all,
    // so a follow-up gated on the amount alone stays silent on exactly the
    // filings this pipeline was built to stop missing.
    const headline = form === 'enriched' ? enrichment.headline : null;
    if (
      headline === null &&
      enrichment.claimLine === null &&
      enrichment.resultsLine === null
    ) {
      return 0;
    }
    if (!passesContentGates(filing, this.watchlist)) return 0;
    if (!isWithinAlertWindow(filing, now, this.options.alertWindowMs)) return 0;

    try {
      await this.telegram.send(
        formatInsightAlert(filing, {
          headline,
          claimLine: enrichment.claimLine,
          resultsLine: enrichment.resultsLine,
          contextLine: enrichment.contextLine,
          evidence: enrichment.amountEvidence,
        }),
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
  documentSource: null,
  parseRoute: null,
  parseFallbackReason: null,
  coverageSkip: null,
  amountRupees: null,
  amountEvidence: null,
  amountAnchor: null,
  amountLabel: null,
  amountRefusalReason: null,
  amountRefusalDetail: null,
  counterparty: null,
  counterpartyEvidence: null,
  counterpartyRefusalReason: null,
  claims: [],
  claimLine: null,
  claimDiscards: [],
  claimsProposed: null,
  claimRefusalReason: null,
  claimRefusalDetail: null,
  results: null,
  resultsLine: null,
  resultsDiscards: [],
  resultsProposed: null,
  resultsRefusalReason: null,
  resultsRefusalDetail: null,
  documentSummary: null,
  documentSummaryRefusalReason: null,
  headline: null,
  contextLine: null,
});

/**
 * The one-line provenance a ZIP-sourced document carries.
 *
 * Names every PDF entry with its own character count, because the text stored
 * on the filing is the concatenation of several documents and a reviewer
 * reading a span needs to know which of them it came out of. The ignored names
 * are listed too: an archive whose MP3 was skipped and one that contained only
 * the PDF are different facts about the filing.
 */
export const describeZipSource = (opened: ZipTextOk): string => {
  const members = opened.members
    .map(
      (member) =>
        `${member.fileName} (${member.chars === null ? `unreadable: ${member.message ?? 'no reason given'}` : `${member.chars} chars`})`,
    )
    .join(', ');
  const ignored =
    opened.ignored.length === 0 ? '' : `; ignored ${opened.ignored.join(', ')}`;
  return `zip: ${members}${ignored}`.slice(0, MAX_DOCUMENT_SOURCE_CHARS);
};

/** How much provenance is kept. Long enough for three entries and their names. */
export const MAX_DOCUMENT_SOURCE_CHARS = 500;

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
  claimed_lines: tally.claimed_lines + delta.claimed_lines,
  claimsDiscarded: tally.claimsDiscarded + delta.claimsDiscarded,
  resultsLines: tally.resultsLines + delta.resultsLines,
  alerted: tally.alerted + delta.alerted,
});
