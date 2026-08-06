import type { Model } from 'mongoose';
import { IST_DAY_MS, instantMs } from '@app/common';
import type { Filing } from '../filing.types';
import type { FilingEnrichment } from '../logic/enrichment.types';
import type { FilingDocument } from './filing.schema';

/**
 * Everything the enrichment pipeline asks the filings collection.
 *
 * MONGO IS THE QUEUE, and that is the central design decision here rather than
 * an implementation detail. Bull and Redis were removed from this project as
 * unused and are deliberately not re-added, because a queue would be a SECOND
 * record of which filings still need work, sitting beside the one the filings
 * collection already keeps. Every failure mode of that arrangement is a
 * reconciliation problem: a filing inserted while Redis is down is never
 * queued and never enriched, with nothing anywhere saying so; a queue rebuilt
 * after a flush re-enqueues work already done; and the dashboard would have to
 * read two stores to answer "what is left".
 *
 * With the state on the document there is nothing to reconcile. A filing needs
 * enrichment exactly when its own record says so, a restart resumes by asking
 * the same question, and the queue depth is a `countDocuments`.
 *
 * What a real queue would buy is parallel consumers — which this worker must
 * not have. It fetches from a third party that has never been asked to tolerate
 * a fast backfill, so it is sequential by requirement. The measured load is
 * ~400 filings a day against a p90 of 436 ms per document; one worker is three
 * orders of magnitude inside capacity.
 *
 * THE CLAIM IS STILL ATOMIC. `claimNext` is a single `findOneAndUpdate` that
 * stamps a lease before the fetch begins, so two workers — a deployment overlap,
 * an operator running the backfill tool beside the service — cannot fetch the
 * same document twice. The lease is the `nextAttemptAt` field the retry backoff
 * already needed, not a second mechanism.
 */

/** The states a filing may still be claimed from. Absent means never attempted. */
const CLAIMABLE_STATES: readonly (string | null)[] = [null, 'pending'];

/** How long a claim holds a filing before another worker may retry it. */
export const DEFAULT_CLAIM_LEASE_MS = 120_000;

/** The fields the worker needs. `_id` is meaningless to it. */
const WORK_PROJECTION = {
  _id: 0,
  seqId: 1,
  symbol: 1,
  isin: 1,
  companyName: 1,
  industry: 1,
  category: 1,
  summary: 1,
  attachmentUrl: 1,
  announcedAt: 1,
  disseminatedAt: 1,
  ingestedAt: 1,
  enrichment: 1,
} as const;

/** A filing handed to the worker, with whatever enrichment it already carries. */
export interface ClaimedFiling {
  readonly filing: Filing;
  /** Attempts made INCLUDING this claim. Always at least 1. */
  readonly attempts: number;
  /**
   * Parse failures recorded BEFORE this claim. Zero on a first look.
   *
   * Not incremented by the claim, unlike `attempts`: most claims never reach
   * the parser, so incrementing here would spend the parse budget on documents
   * that fetched and read perfectly. The worker adds one when the bytes it
   * fetched will not parse.
   */
  readonly parseAttempts: number;
}

/** What the derived-context line needs counted, and the counts themselves. */
export interface ContextCounts {
  /** Same symbol and category, inside the window, disseminated before this one. */
  readonly priorInWindow: number;
  /** Newest same symbol and category BEFORE the window, or null. */
  readonly lastPriorAt: Date | null;
  /** Priors inside the window carrying a verified amount. */
  readonly priorsWithAmount: number;
  /** Of those, how many are at least as large as this filing's amount. */
  readonly priorsAtLeastAsLarge: number;
}

export interface ContextQuery {
  readonly symbol: string;
  readonly category: string;
  /** This filing's own dissemination instant; priors are strictly before it. */
  readonly disseminatedAt: Date;
  readonly windowDays: number;
  /** This filing's verified amount, or null when it has none. */
  readonly amountRupees: number | null;
}

/** Counts of filings by enrichment state, for the dashboard and the report. */
export interface EnrichmentTally {
  readonly state: string;
  readonly count: number;
}

/**
 * The attempt count on a just-claimed document.
 *
 * `$inc` on a missing field creates it at the increment, so a first claim
 * always comes back as 1 and the fallbacks below cannot be provoked through
 * `claimNext`. They are here because this number drives the retry backoff and
 * the attempt budget: a document written by an older schema, or projected
 * without its enrichment block, would otherwise make `attempts` undefined,
 * `nextAttemptDelayMs` return NaN, and the filing retry on every tick forever.
 *
 * Exported so that guarantee is a tested function rather than an inline
 * expression no test can reach.
 */
export function attemptsOf(document: {
  enrichment?: { attempts?: number };
}): number {
  const attempts = document.enrichment?.attempts;
  return typeof attempts === 'number' && Number.isFinite(attempts)
    ? attempts
    : 1;
}

/**
 * Parse failures already recorded on a document, defaulting to none.
 *
 * Defaults to 0 rather than 1, unlike `attemptsOf`, and the difference is the
 * whole point of the two functions being separate. `attempts` is incremented BY
 * the claim, so a claimed document always has at least one; `parseAttempts` is
 * incremented only when bytes fail to parse, which most claims never reach.
 * Defaulting it to 1 would spend a third of the race allowance before the
 * parser had been asked anything.
 *
 * A non-numeric value — a document written by an older schema, which is every
 * document in the live collection today — reads as 0, so those filings get the
 * full budget rather than an undefined one that makes the comparison NaN.
 */
export function parseAttemptsOf(document: {
  enrichment?: { parseAttempts?: number };
}): number {
  const parseAttempts = document.enrichment?.parseAttempts;
  return typeof parseAttempts === 'number' && Number.isFinite(parseAttempts)
    ? parseAttempts
    : 0;
}

export class EnrichmentRepository {
  constructor(private readonly model: Model<FilingDocument>) {}

  /**
   * Takes the next filing that needs enrichment, newest first, and leases it.
   *
   * NEWEST FIRST is a product decision, not an arbitrary sort. A squawk is
   * worth reading about the filing that landed a minute ago and much less about
   * one from last Tuesday, so a backlog must never delay the fresh document
   * behind it. It also means an outage that builds a backlog recovers the live
   * lane first.
   *
   * The update is what makes this a claim: `attempts` increments and
   * `nextAttemptAt` moves out by the lease BEFORE the caller touches the
   * network. A worker that crashes mid-fetch therefore leaves the filing
   * unclaimable only until the lease expires, and a second worker running
   * concurrently sees a filing that is already spoken for.
   *
   * `state` is set to 'pending' explicitly rather than left absent, so a
   * document that has been attempted is distinguishable in the collection from
   * one that never has.
   *
   * @returns null when nothing is due, which is the ordinary steady state.
   */
  async claimNext(
    now: Date,
    leaseMs: number = DEFAULT_CLAIM_LEASE_MS,
  ): Promise<ClaimedFiling | null> {
    const claimed = await this.model
      .findOneAndUpdate(
        {
          // `$in` with an explicit null, NOT `$nin` of the terminal states.
          // Both match a missing field, but this form is two index-point
          // lookups against `enrichment.state` while `$nin` is a scan of
          // everything the index does not exclude.
          'enrichment.state': { $in: CLAIMABLE_STATES },
          // A missing field matches `null` in Mongo, so this covers a filing
          // that has never been attempted as well as one whose backoff expired.
          $or: [
            { 'enrichment.nextAttemptAt': null },
            { 'enrichment.nextAttemptAt': { $lte: now } },
          ],
        },
        {
          $set: {
            'enrichment.state': 'pending',
            'enrichment.attemptedAt': now,
            'enrichment.nextAttemptAt': new Date(now.getTime() + leaseMs),
          },
          $inc: { 'enrichment.attempts': 1 },
        },
        {
          sort: { disseminatedAt: -1 },
          new: true,
          projection: WORK_PROJECTION,
          lean: true,
        },
      )
      .exec();

    if (claimed === null) return null;

    const document = claimed as unknown as Filing & {
      enrichment?: { attempts?: number; parseAttempts?: number };
    };

    return {
      filing: document,
      attempts: attemptsOf(document),
      parseAttempts: parseAttemptsOf(document),
    };
  }

  /**
   * Writes the verdict.
   *
   * `$set` of the whole block rather than field-by-field, so a filing cannot
   * end up with an amount from one attempt and a refusal reason from another.
   * The state field is what the claim query reads, so it is written last within
   * the same atomic update — a partial write here would leave a filing that is
   * neither claimable nor finished.
   */
  async recordEnrichment(
    seqId: number,
    enrichment: FilingEnrichment,
  ): Promise<void> {
    const result = await this.model
      .updateOne({ seqId }, { $set: { enrichment } })
      .exec();

    // Never silent. A filing that vanished between the claim and the write is
    // not a no-op: it means the collection is being modified by something this
    // pipeline does not know about, and the enrichment has been lost.
    if (result.matchedCount === 0) {
      throw new Error(
        `no filing with seqId ${seqId} to record enrichment onto; ` +
          'the row was claimed and then disappeared',
      );
    }
  }

  /**
   * Puts a filing ruled `unparseable` back on the queue, conditionally.
   *
   * WHY THE COUNTERS ARE NOT IN THE `$set`, which is the whole decision here.
   * `attempts` and `parseAttempts` are left EXACTLY as they stand — neither
   * reset to zero nor incremented — and both alternatives are worse:
   *
   *   - **Reset to zero** loses the only durable record that this pipeline
   *     already looked at the document and reached a verdict. `attemptedAt` and
   *     `lastError` are overwritten by the very next attempt, so the counters
   *     are what remains, and a filing that reads as never-attempted after
   *     three failures is a filing nobody can triage.
   *   - **Increment** would be a lie in the other direction. The counters count
   *     attempts against the exchange; re-queuing makes none.
   *
   * And leaving them costs no headroom. `attempts` is 1 on every live candidate
   * against a budget of 5, so a re-queued filing still has four transient
   * failures in hand — more than a filing arriving fresh gets before its first
   * hiccup matters. `parseAttempts` is at most 1 against 3, and for these
   * filings it is inert anyway: the parse budget is consulted only for
   * `truncated-at-origin` and `unreadable-pdf`, and only inside an hour of
   * dissemination, which every re-queued filing is long past.
   *
   * `lastError` is left standing too. Once `unparseableReason` is nulled — and
   * it must be, because the dashboard groups by it and a pending filing
   * carrying a terminal reason is a contradiction — that string is the only
   * surviving trace of what the previous build decided. A `pending` filing with
   * a `lastError` is an established shape here, not a novelty: it is exactly
   * what `parse-retry.ts` writes for a provisional parse failure.
   *
   * CONDITIONAL ON THE STATE, so this cannot clobber a concurrent write. A
   * terminal filing is unclaimable, so the live worker cannot be holding one —
   * but a second operator running this same sweep can, and the filter turns
   * that race into a `false` return rather than into two workers fetching the
   * same document.
   *
   * @returns true when this call is the one that moved the filing.
   */
  async requeueUnparseable(seqId: number): Promise<boolean> {
    const result = await this.model
      .updateOne(
        { seqId, 'enrichment.state': 'unparseable' },
        {
          $set: {
            'enrichment.state': 'pending',
            'enrichment.nextAttemptAt': null,
            'enrichment.unparseableReason': null,
          },
        },
      )
      .exec();

    return result.modifiedCount === 1;
  }

  /**
   * Counts everything the derived-context line is allowed to know.
   *
   * BOUNDED AND INDEXED. This runs on the alert path, so the shape matters:
   * every query here is answered by `symbol_1_category_1_disseminatedAt_-1`,
   * and the count is at most three round trips — one always, one when the
   * filing carries an amount, and one only when the window turned out empty.
   * There is no collection scan and no aggregation pipeline.
   */
  async contextCounts(query: ContextQuery): Promise<ContextCounts> {
    const { symbol, category, disseminatedAt, windowDays, amountRupees } =
      query;
    const at = new Date(instantMs(disseminatedAt));
    const from = new Date(at.getTime() - windowDays * IST_DAY_MS);

    // STRICTLY BEFORE this filing, never `$lte`. NSE stamps `disseminatedAt` to
    // the second and publishes several filings within one, so `$lte` would
    // count the filing against itself and report every first order as a second.
    const inWindow = {
      symbol,
      category,
      disseminatedAt: { $gte: from, $lt: at },
    };

    const [priorInWindow, priorsWithAmount, priorsAtLeastAsLarge] =
      await Promise.all([
        this.model.countDocuments(inWindow).exec(),
        amountRupees === null
          ? Promise.resolve(0)
          : this.model
              .countDocuments({
                ...inWindow,
                'enrichment.amountRupees': { $ne: null },
              })
              .exec(),
        amountRupees === null
          ? Promise.resolve(0)
          : this.model
              .countDocuments({
                ...inWindow,
                'enrichment.amountRupees': { $gte: amountRupees },
              })
              .exec(),
      ]);

    // Only asked when the window is empty, because that is the only branch of
    // the context line that uses it.
    const lastPriorAt =
      priorInWindow > 0
        ? null
        : await this.newestBefore(symbol, category, from);

    return {
      priorInWindow,
      lastPriorAt,
      priorsWithAmount,
      priorsAtLeastAsLarge,
    };
  }

  /**
   * IST days of filings the collection holds, ending at `now`.
   *
   * The honesty bound on every windowed claim. A collection two days old cannot
   * support "largest in the last 30 days", however true each word of it is.
   *
   * @returns 0 on an empty collection, and never a negative number — a stored
   * timestamp in the future (exchange clock skew, or a mapper bug) would
   * otherwise produce a negative coverage that compares as "less than the
   * window" in the right direction only by accident.
   */
  async coverageDays(now: Date): Promise<number> {
    const oldest = await this.model
      .findOne({}, { _id: 0, disseminatedAt: 1 })
      .sort({ disseminatedAt: 1 })
      .lean()
      .exec();

    if (oldest === null) return 0;
    const span = now.getTime() - instantMs(oldest.disseminatedAt);
    return Math.max(0, span / IST_DAY_MS);
  }

  /** How many filings sit in each enrichment state. Absent counts as pending. */
  async tallyByState(): Promise<readonly EnrichmentTally[]> {
    const grouped = await this.model
      .aggregate<{ _id: string | null; count: number }>([
        { $group: { _id: '$enrichment.state', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
      ])
      .exec();

    return grouped.map((row) => ({
      state: row._id ?? 'pending',
      count: row.count,
    }));
  }

  /** How many filings are waiting to be enriched right now. */
  async pendingCount(now: Date): Promise<number> {
    return this.model
      .countDocuments({
        'enrichment.state': { $in: CLAIMABLE_STATES },
        $or: [
          { 'enrichment.nextAttemptAt': null },
          { 'enrichment.nextAttemptAt': { $lte: now } },
        ],
      })
      .exec();
  }

  private async newestBefore(
    symbol: string,
    category: string,
    before: Date,
  ): Promise<Date | null> {
    const previous = await this.model
      .findOne(
        { symbol, category, disseminatedAt: { $lt: before } },
        { _id: 0, disseminatedAt: 1 },
      )
      .sort({ disseminatedAt: -1 })
      .lean()
      .exec();

    return previous === null
      ? null
      : new Date(instantMs(previous.disseminatedAt));
  }
}
