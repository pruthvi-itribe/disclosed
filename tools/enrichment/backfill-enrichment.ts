/**
 * Re-reads every stored filing with the current build, without losing anything.
 *
 * ================================================================
 * WHY THIS IS NOT `enrich:run`
 * ================================================================
 *
 * `enrich:run` drains the QUEUE: filings the worker has never reached. That is
 * the right tool for a cold collection and the wrong one here, because every
 * filing in this collection has already been read — by a build whose coverage
 * rules refused 58.86% of them before a model was called, and whose verbatim
 * gate refused a paraphrased quote as though it were an invented one. The
 * documents did not change; the code that reads them did.
 *
 * So this walks TERMINAL filings, which the ordinary queue by design will never
 * offer again, and it does three things `enrich:run` must not:
 *
 *   1. **It claims out of a terminal state, atomically, into a lease that has
 *      not expired.** One `findOneAndUpdate` moves `enriched` to `pending` with
 *      `nextAttemptAt` already in the future, so the live worker — which claims
 *      only what is due NOW — can never see the filing in a claimable state.
 *      There is no window in which both fetch the same document, and NSE sees
 *      one polite sequential stream rather than two.
 *   2. **It merges rather than overwrites.** `enrichment-merge.ts` owns the rule
 *      and argues it: a re-read may add and may replace like with like, and may
 *      never subtract. Every regression is counted and named.
 *   3. **It resumes.** The marker is `enrichment.outcome`: a record carrying one
 *      was written by this build and a record without one was not. That makes
 *      the sweep idempotent — a second run finds nothing — and restartable, with
 *      no cursor file and nothing to reconcile, for the same reason the queue
 *      itself has none.
 *
 * Everything else is the SERVICE'S OWN CODE. The same `EnrichmentWorker`, the
 * same fetcher, the same 800ms pacing, the same parser routing, the same two
 * extractors. Only Telegram is substituted, by a recorder, so a sweep of two
 * thousand filings cannot flood a chat.
 *
 * Run:  npm run enrich:backfill                 # everything not yet re-read
 *       npm run enrich:backfill -- --limit 25   # a bounded taste of it first
 */
import 'dotenv/config';
import mongoose, { type Model } from 'mongoose';
import {
  AttachmentFetcher,
  categoryGroupFor,
  composeOutcome,
  DEFAULT_CLAIM_LEASE_MS,
  EnrichmentRepository,
  FilingSchema,
  mergeEnrichment,
  type ClaimedFiling,
  type ClaimExtractionRequest,
  type ClaimExtractionResult,
  type ClaimExtractor,
  type ClaimUsage,
  type EnrichmentLane,
  type Filing,
  type FilingDocument,
  type FilingEnrichment,
  type ResultsExtractionResult,
  type ResultsExtractor,
} from '@app/filings';
import type { TelegramService } from '@app/notify';
import {
  buildClaimExtractor,
  buildResultsExtractor,
} from '../../apps/ingest/src/enrichment/claim-extractor.factory';
import { buildDoclingConverter } from '../../apps/ingest/src/enrichment/docling.factory';
import { EnrichmentWorker } from '../../apps/ingest/src/enrichment/enrichment.worker';
import { FilingContextService } from '../../apps/ingest/src/enrichment/filing-context.service';
import { loadConfig } from '../../apps/ingest/src/config/configuration';
import { yauzlReader } from '@app/filings/pdf/yauzl-reader';

/** Stands in for Telegram: counts what would have been sent, sends nothing. */
class SilentTelegram {
  public sent = 0;

  async send(): Promise<void> {
    this.sent += 1;
  }
}

/**
 * Whether the slow half of the sweep has reached this filing.
 *
 * `backfilledAt` lives at the document root rather than inside the enrichment
 * block precisely so that `recordEnrichment` — which rewrites that block whole —
 * cannot erase it. Expressed as a `$in` with an explicit null so a filing that
 * has never carried the field, which is every filing the poller stored, matches.
 */
const NOT_YET_BACKFILLED = {
  backfilledAt: { $in: [null] },
} as const;

/**
 * Filings the live worker cannot be holding.
 *
 * Terminal filings are unclaimable by it, and a `pending` one whose lease has
 * expired is fair game for whoever wins the atomic update. What is EXCLUDED is a
 * `pending` filing with a lease still running: that is the live worker's
 * document, mid-fetch, and taking it would be the second request this sweep
 * exists to avoid.
 */
const notLeased = (now: Date): Record<string, unknown> => ({
  $or: [
    { 'enrichment.state': { $in: ['enriched', 'unparseable', 'failed'] } },
    { 'enrichment.nextAttemptAt': { $in: [null] } },
    { 'enrichment.nextAttemptAt': { $lte: now } },
  ],
});

/**
 * The queue this sweep drains, and the guard that keeps what it already knows.
 *
 * SUBCLASSED RATHER THAN REIMPLEMENTED, so the worker above it runs the same
 * code path the service runs. Only the two methods that decide WHICH filing and
 * WHAT survives are replaced; `contextCounts`, `pendingCount` and the rest are
 * the repository's own.
 */
class BackfillRepository extends EnrichmentRepository {
  public claimedCount = 0;
  public readonly regressions = new Map<EnrichmentLane, number>();
  public readFailures = 0;
  /** Filings left unmarked because the provider, not the document, failed. */
  public unasked = 0;

  constructor(
    private readonly filings: Model<FilingDocument>,
    /** How long an extractor failure holds a filing off the sweep's queue. */
    private readonly retryAfterMs: number,
  ) {
    super(filings);
  }

  /**
   * Takes the next filing this build has not written, and leases it.
   *
   * ONE ATOMIC UPDATE, which is the whole reason this is not "requeue, then let
   * the ordinary claim pick it up". That two-step version has a window between
   * the states in which the filing is claimable by the live worker, and the live
   * worker is on a previous build — so the very filings this sweep exists to fix
   * would be re-fixed wrongly, at random, by the thing it is running beside.
   */
  async claimNext(
    now: Date,
    leaseMs: number = DEFAULT_CLAIM_LEASE_MS,
  ): Promise<ClaimedFiling | null> {
    const claimed = await this.filings
      .findOneAndUpdate(
        { $and: [NOT_YET_BACKFILLED, notLeased(now)] },
        {
          $set: {
            'enrichment.state': 'pending',
            'enrichment.attemptedAt': now,
            'enrichment.nextAttemptAt': new Date(now.getTime() + leaseMs),
          },
          $inc: { 'enrichment.attempts': 1 },
        },
        { sort: { disseminatedAt: -1 }, new: true, lean: true },
      )
      .exec();

    if (claimed === null) return null;
    this.claimedCount += 1;

    const document = claimed as unknown as Filing & {
      enrichment?: { attempts?: number; parseAttempts?: number };
    };

    return {
      filing: document,
      attempts: document.enrichment?.attempts ?? 1,
      // Reset to zero on purpose, and it is the one counter this sweep does
      // rewind. `parseAttempts` is the allowance for NSE's own upload race, and
      // every filing here is long past the window in which that is a possible
      // explanation — so carrying a spent budget forward would make a document
      // that reads perfectly today inherit a verdict from a race it lost weeks
      // ago. The budget is only ever consulted inside that window, so this
      // cannot make a genuinely unreadable filing retry forever.
      parseAttempts: 0,
    };
  }

  /**
   * Writes the merged verdict, never the bare new one.
   *
   * The read of the previous record is a second round trip per filing, against
   * an 800ms fetch. It buys the only guarantee this sweep has to offer: that a
   * collection which took two days to accumulate cannot be made worse by a
   * sampled model having an off afternoon.
   */
  async recordEnrichment(
    seqId: number,
    enrichment: FilingEnrichment,
  ): Promise<void> {
    const stored = (await this.filings
      .findOne({ seqId }, { _id: 0, enrichment: 1 })
      .lean()
      .exec()) as unknown as { enrichment?: FilingEnrichment } | null;

    const merge = mergeEnrichment(stored?.enrichment ?? null, enrichment);
    for (const lane of merge.regressions) {
      this.regressions.set(lane, (this.regressions.get(lane) ?? 0) + 1);
    }
    if (merge.readFailed) this.readFailures += 1;
    if (merge.regressions.length > 0) {
      process.stdout.write(
        `  KEPT STORED seqId ${seqId}: the re-read produced less ` +
          `(${merge.regressions.join(', ')})` +
          `${merge.readFailed ? ' — it reached no verdict at all' : ''}\n`,
      );
    }

    // A FILING WHOSE MODEL CALL NEVER HAPPENED IS NOT DONE. The extractor
    // returning a 429, a truncated body or an unparseable reply is a fact about
    // the provider rather than about the document, and marking the filing swept
    // would make that transient failure permanent — the sweep would never offer
    // it again. Left unmarked, it is simply picked up by the next run, which is
    // what makes it safe to raise the number of lanes until the provider starts
    // refusing.
    const unasked = merge.enrichment.claimRefusalReason === 'extractor-error';
    if (unasked) {
      this.unasked += 1;
      process.stdout.write(
        `  NOT MARKED seqId ${seqId}: the extractor failed, so the sweep will ` +
          `offer this filing again after ${this.retryAfterMs}ms\n`,
      );
    }

    // A BACKOFF, NOT MERELY AN ABSENT MARKER. Without the future
    // `nextAttemptAt`, an unmarked filing is claimable again the instant it is
    // written — `recordEnrichment` nulls the lease on the way out — so a document
    // the provider refuses every time becomes a tight loop pointed at the
    // exchange. `notLeased` already excludes a filing whose next attempt is in
    // the future, so this is the same mechanism the ordinary retry backoff uses
    // rather than a second one. An `enriched` filing carrying a future attempt
    // time is invisible to the live worker, which claims only `pending`.
    const held: FilingEnrichment = unasked
      ? {
          ...merge.enrichment,
          nextAttemptAt: new Date(Date.now() + this.retryAfterMs),
        }
      : merge.enrichment;

    // The verdict and the marker in ONE update. Two writes would leave a window
    // in which a crash marks a filing done that was never written, or writes one
    // that a re-run then does again — and the second of those costs an NSE
    // request and a model call per filing, every time the sweep is restarted.
    const result = await this.filings
      .updateOne(
        { seqId },
        {
          $set: unasked
            ? { enrichment: held }
            : { enrichment: held, backfilledAt: new Date() },
        },
      )
      .exec();

    if (result.matchedCount === 0) {
      throw new Error(
        `no filing with seqId ${seqId} to record enrichment onto; ` +
          'the row was claimed and then disappeared',
      );
    }
  }
}

/**
 * `deepseek/deepseek-v4-flash-0731` list prices, per million tokens.
 *
 * Stated here rather than fetched so the arithmetic below is reproducible from
 * the file alone, exactly as `measure-claim-gate.ts` states Anthropic's. These
 * are the only numbers in this tool that are not measured; everything they are
 * multiplied by comes from the provider's own usage block.
 */
const INPUT_PER_MTOK = 0.28;
const CACHED_INPUT_PER_MTOK = 0.028;
const OUTPUT_PER_MTOK = 0.42;

/** Adds up what the two lanes actually spent, from the provider's own numbers. */
class MeteredExtractor implements ClaimExtractor, ResultsExtractor {
  public calls = 0;
  public reported = 0;
  public inputTokens = 0;
  public cachedInputTokens = 0;
  public outputTokens = 0;

  constructor(
    private readonly claims: ClaimExtractor | null,
    private readonly results: ResultsExtractor | null,
  ) {}

  private meter(usage: ClaimUsage | undefined): void {
    this.calls += 1;
    // A reply that carried no usage block is counted apart rather than as zero:
    // a spend figure that silently treats unreported calls as free is a spend
    // figure that under-reports by exactly the amount nobody can see.
    if (usage === undefined) return;
    this.reported += 1;
    this.inputTokens += usage.inputTokens + usage.cacheWriteInputTokens;
    this.cachedInputTokens += usage.cachedInputTokens;
    this.outputTokens += usage.outputTokens;
    // PRINTED PER CALL, not only in the summary. A sweep of this size runs for
    // hours and can be stopped at any moment, and a spend figure that only
    // exists when the process exits cleanly is a spend figure nobody has when
    // they need it — which is while it is still running.
    process.stdout.write(
      `  SPEND calls=${this.calls} in=${this.inputTokens} ` +
        `cached=${this.cachedInputTokens} out=${this.outputTokens} ` +
        `$${this.spend().toFixed(4)}\n`,
    );
  }

  /** What the calls so far have cost, at the list prices stated below. */
  spend(): number {
    return (
      (this.inputTokens / 1e6) * INPUT_PER_MTOK +
      (this.cachedInputTokens / 1e6) * CACHED_INPUT_PER_MTOK +
      (this.outputTokens / 1e6) * OUTPUT_PER_MTOK
    );
  }

  async extract(
    request: ClaimExtractionRequest,
  ): Promise<ClaimExtractionResult> {
    if (this.claims === null) {
      return { outcome: 'failed', message: 'no claim extractor is configured' };
    }
    const result = await this.claims.extract(request);
    this.meter(result.outcome === 'ok' ? result.usage : undefined);
    return result;
  }

  async extractResults(
    request: ClaimExtractionRequest,
  ): Promise<ResultsExtractionResult> {
    if (this.results === null) {
      return {
        outcome: 'failed',
        message: 'no results extractor is configured',
      };
    }
    const result = await this.results.extractResults(request);
    this.meter(result.outcome === 'ok' ? result.usage : undefined);
    return result;
  }
}

const readArg = (name: string, fallback: number): number => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`--${name} must be a finite number >= 0`);
  }
  return value;
};

const pct = (part: number, whole: number): string =>
  whole === 0 ? '0.0%' : `${((part / whole) * 100).toFixed(2)}%`;

/** The four numbers this sweep exists to move, counted straight off the DB. */
async function coverage(
  model: Model<FilingDocument>,
): Promise<readonly (readonly [string, number])[]> {
  const total = await model.countDocuments({}).exec();
  const of = async (filter: Record<string, unknown>): Promise<number> =>
    model.countDocuments(filter).exec();

  return [
    ['filings', total],
    ['outcome', await of({ 'enrichment.outcome': { $nin: [null] } })],
    [
      'categoryGroup',
      await of({ 'enrichment.categoryGroup': { $nin: [null] } }),
    ],
    [
      'documentSummary',
      await of({ 'enrichment.documentSummary': { $nin: [null] } }),
    ],
    ['verified claims', await of({ 'enrichment.claims.0': { $exists: true } })],
    ['results line', await of({ 'enrichment.resultsLine': { $nin: [null] } })],
    ['amount', await of({ 'enrichment.amountRupees': { $nin: [null] } })],
    ['coverageSkip', await of({ 'enrichment.coverageSkip': { $nin: [null] } })],
    ['re-read', await of({ backfilledAt: { $nin: [null] } })],
  ];
}

const report = (
  label: string,
  rows: readonly (readonly [string, number])[],
): string => {
  const total = rows[0][1];
  return (
    `--- coverage ${label} ---\n` +
    rows
      .map(
        ([key, count]) =>
          `${key.padEnd(18)} ${String(count).padStart(6)}  ${pct(count, total)}`,
      )
      .join('\n') +
    '\n\n'
  );
};

/**
 * The half of coverage that needs no network, no model and no parser.
 *
 * ================================================================
 * WHY THIS IS A SEPARATE PASS AND RUNS FIRST
 * ================================================================
 *
 * `composeOutcome` and `categoryGroupFor` are pure functions of `symbol`,
 * `category` and `summary` — three fields the poller writes for every filing on
 * the two-second hot path and nothing ever updates. So the outcome for the whole
 * collection is computable in one pass over the database, in seconds, and it
 * costs nothing.
 *
 * The read sweep below is the opposite: it is bounded by a language model
 * measured at 7 to 192 seconds a call, and on a collection of this size it runs
 * for hours. Making universal coverage wait on that would repeat the exact
 * mistake this whole change set exists to correct — a guarantee that depends on
 * a fallible remote call is a guarantee with a bad afternoon in it.
 *
 * So the two are separated, and the cheap one is the one that carries the
 * promise. Every filing states an outcome the moment this returns, whether or
 * not the sweep behind it ever reaches them.
 *
 * IDEMPOTENT: only filings with no stored outcome are touched, and the value
 * written is a pure function of fields that never change.
 */
async function stampOutcomes(
  filings: Model<FilingDocument>,
): Promise<{ readonly scanned: number; readonly written: number }> {
  const rows = (await filings
    .find(
      { 'enrichment.outcome': { $in: [null] } },
      { _id: 0, seqId: 1, symbol: 1, category: 1, summary: 1 },
    )
    .lean()
    .exec()) as unknown as readonly Pick<
    Filing,
    'seqId' | 'symbol' | 'category' | 'summary'
  >[];

  if (rows.length === 0) return { scanned: 0, written: 0 };

  const operations = rows.map((row) => {
    const outcome = composeOutcome(row);
    return {
      updateOne: {
        filter: { seqId: row.seqId },
        update: {
          $set: {
            'enrichment.outcome': outcome.text,
            'enrichment.outcomeSource': outcome.source,
            'enrichment.categoryGroup': categoryGroupFor(row.category),
            // `state` IS NOT TOUCHED, and that is the one line most easily got
            // wrong here. Setting it to 'pending' would put two thousand
            // already-enriched filings back on the live worker's queue, which is
            // a full re-fetch of the collection against the exchange, started by
            // a pass whose whole selling point is that it touches no network.
            // A filing that has no enrichment block gains one carrying these
            // three fields and no state, which every reader in this codebase
            // already treats as never-attempted.
          },
        },
        upsert: false,
      },
    };
  });

  const result = await filings.bulkWrite([...operations], { ordered: false });
  return { scanned: rows.length, written: result.modifiedCount };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const limit = readArg('limit', Number.MAX_SAFE_INTEGER);
  const delayMs = readArg('delay', config.enrichmentRequestDelayMs);
  const batchSize = readArg('batch', 25);

  await mongoose.connect(config.mongoUri);
  const model = mongoose.model<FilingDocument>('Filing', FilingSchema);

  const before = await coverage(model);
  process.stdout.write(report('BEFORE', before));

  if (!process.argv.includes('--skip-outcomes')) {
    const stamped = await stampOutcomes(model);
    process.stdout.write(
      `--- pass 1: what the filings SAY, deterministic ---\n` +
        `filings with no stored outcome  ${stamped.scanned}\n` +
        `stamped                         ${stamped.written}\n\n`,
    );
  }
  if (process.argv.includes('--outcomes-only')) {
    process.stdout.write(report('AFTER', await coverage(model)));
    await mongoose.disconnect();
    return;
  }

  const repository = new BackfillRepository(model, config.enrichmentLeaseMs);
  const telegram = new SilentTelegram();
  const extractor = new MeteredExtractor(
    buildClaimExtractor(config),
    buildResultsExtractor(config),
  );

  const worker = new EnrichmentWorker(
    repository,
    new AttachmentFetcher(config.enrichmentMaxBytes),
    new FilingContextService(repository, config.contextWindowDays),
    telegram as unknown as TelegramService,
    {
      idleIntervalMs: config.enrichmentIdleIntervalMs,
      requestDelayMs: delayMs,
      batchSize,
      maxAttempts: config.enrichmentMaxAttempts,
      retryBaseMs: config.enrichmentRetryBaseMs,
      retryMaxMs: config.enrichmentRetryMaxMs,
      parseWindowMs: config.enrichmentParseWindowMs,
      maxParseAttempts: config.enrichmentMaxParseAttempts,
      parseRetryBaseMs: config.enrichmentParseRetryBaseMs,
      // The lease has to outlast one document's whole handling — a fetch, an OCR
      // pass and two model calls — because it is what keeps the live worker off
      // this filing for the duration.
      leaseMs: config.enrichmentLeaseMs,
      // ZERO, deliberately, and it is the one option that differs from the
      // service. `isWithinAlertWindow` is what stops a sweep of two thousand
      // stored filings sending a hundred and fifty follow-ups about last week's
      // news; setting the window to nothing means nothing is ever inside it.
      alertWindowMs: 0,
      watchlist: config.watchlist,
      maxClaims: config.claimMaxClaims,
    },
    undefined,
    extractor,
    yauzlReader(),
    extractor,
    buildDoclingConverter(config),
  );

  const started = Date.now();
  let processed = 0;
  let tally = { enriched: 0, unparseable: 0, retried: 0, failed: 0 };

  // Ticks rather than one enormous batch, so progress is visible and a stop is
  // cheap. Each tick claims up to `batchSize` and returns when the queue this
  // sweep defines is empty.
  for (;;) {
    const result = await worker.tick();
    if (result.claimed === 0) break;
    processed += result.claimed;
    tally = {
      enriched: tally.enriched + result.enriched,
      unparseable: tally.unparseable + result.unparseable,
      retried: tally.retried + result.retried + result.parseRetried,
      failed: tally.failed + result.failed,
    };
    process.stdout.write(
      `${new Date().toISOString()} processed ${processed} ` +
        `(enriched ${tally.enriched}, unparseable ${tally.unparseable}, ` +
        `retried ${tally.retried}, failed ${tally.failed}, ` +
        `model calls ${extractor.calls})\n`,
    );
    if (processed >= limit) break;
    if (delayMs > 0) await new Promise((wait) => setTimeout(wait, delayMs));
  }

  const elapsed = (Date.now() - started) / 1000;
  const spend = extractor.spend();

  const after = await coverage(model);
  process.stdout.write(
    `\n--- the sweep ---\n` +
      `filings re-read     ${processed}\n` +
      `enriched            ${tally.enriched}\n` +
      `unparseable         ${tally.unparseable}\n` +
      `retried / failed    ${tally.retried} / ${tally.failed}\n` +
      `alerts suppressed   ${telegram.sent}\n` +
      `elapsed             ${(elapsed / 60).toFixed(1)} minute(s)\n\n` +
      `--- what was kept because the re-read produced less ---\n` +
      `${
        repository.regressions.size === 0
          ? 'nothing: every lane came back at least as good as it was stored.\n'
          : [...repository.regressions]
              .map(([lane, count]) => `${lane.padEnd(18)} ${count}`)
              .join('\n') + '\n'
      }` +
      `reads that reached no verdict at all  ${repository.readFailures}\n` +
      `left for another run (extractor failed) ${repository.unasked}\n\n` +
      `--- spend, from the provider's own usage blocks ---\n` +
      `model calls         ${extractor.calls} (${extractor.reported} reported usage)\n` +
      `input tokens        ${extractor.inputTokens}\n` +
      `cached input        ${extractor.cachedInputTokens}\n` +
      `output tokens       ${extractor.outputTokens}\n` +
      `TOTAL               $${spend.toFixed(4)}\n\n`,
  );
  process.stdout.write(report('AFTER', after));

  await mongoose.disconnect();
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `backfill failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
