import {
  IST_DAY_MS,
  IST_OFFSET_MS,
  instantMs,
  istDayKey,
  istDayKeysEndingAt,
  istTimestamp,
  startOfIstDay,
} from '@app/common';
import { formatRupees, type Filing, type FilingEnrichment } from '@app/filings';
import type {
  CategoryCount,
  DailyCount,
  EnrichmentCount,
  EnrichmentSummaryView,
  EnrichmentView,
  FilingView,
  PageMeta,
  SummaryView,
} from './dashboard.types';
import type { FilingReadModel } from './filing-read.model';

/** Enrichment states a caller may filter on. */
export const ENRICHMENT_STATES = [
  'pending',
  'enriched',
  'unparseable',
  'failed',
] as const;

export type EnrichmentStateFilter = (typeof ENRICHMENT_STATES)[number];

/** Claim outcomes a caller may filter on. */
export const CLAIM_FILTERS = ['emitted', 'none'] as const;

export type ClaimFilter = (typeof CLAIM_FILTERS)[number];

/** Amount outcomes a caller may filter on. */
export const AMOUNT_FILTERS = ['extracted', 'refused'] as const;

export type AmountFilter = (typeof AMOUNT_FILTERS)[number];

/** The filters the recent-filings list accepts, already validated. */
export interface RecentQuery {
  readonly limit: number;
  readonly offset: number;
  readonly symbol?: string;
  readonly category?: string;
  /** Enrichment state. `pending` also matches filings never attempted. */
  readonly state?: EnrichmentStateFilter;
  /** Whether the extractor emitted a figure or declined to. */
  readonly amount?: AmountFilter;
  /** A specific machine-readable refusal reason. */
  readonly refusal?: string;
  /** Whether the document produced a wire line of notable claims. */
  readonly claim?: ClaimFilter;
}

/** A page of filings and the counts needed to page through them. */
export interface RecentPage {
  readonly items: readonly FilingView[];
  readonly meta: PageMeta;
}

/**
 * The fields the dashboard displays, and no others.
 *
 * A projection rather than a whole document on purpose. `isin` is not shown,
 * `_id` is meaningless outside the database, and a lean projected read is the
 * difference between the poller and the viewer competing for the same working
 * set and not.
 */
const DISPLAY_PROJECTION = {
  _id: 0,
  seqId: 1,
  symbol: 1,
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

/** The shape a grouped count comes back as, whatever the group key is. */
interface GroupedCount<TKey> {
  readonly _id: TKey;
  readonly count: number;
}

/**
 * Every question the dashboard asks the filings collection.
 *
 * READ-ONLY BY CONSTRUCTION. The collection arrives as a `FilingReadModel`,
 * which is `Model<FilingDocument>` narrowed to `find`, `findOne`,
 * `countDocuments` and `aggregate` — so this class cannot insert, update or
 * delete even by accident. See `filing-read.model.ts` for why that matters
 * beyond tidiness: the ingest poller is reading the same collection for its
 * resume cursor while this runs.
 *
 * `now` is injected rather than called, because half of what this class
 * computes is relative to the current instant — the IST day, the feed lag, the
 * last N days — and a clock read from inside the method is a test that can only
 * assert "roughly".
 */
export class FilingQueryService {
  constructor(
    private readonly filings: FilingReadModel,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * The headline numbers.
   *
   * The four reads are issued together rather than in sequence: they are
   * independent, they run on every poll of an auto-refreshing page, and serial
   * round trips would make the dashboard's own latency the thing you notice.
   */
  async getSummary(): Promise<SummaryView> {
    const now = this.now();
    const dayStart = startOfIstDay(now);

    const [totalFilings, todayCount, newest, topSeq] = await Promise.all([
      this.filings.countDocuments({}).exec(),
      // Bounded at BOTH ends. An open-ended `$gte` would fold a filing dated
      // into the future — clock skew on the exchange side, or a mapper bug —
      // into today's count, and today's count is the number an operator uses
      // to decide whether ingestion is alive.
      this.filings
        .countDocuments({
          disseminatedAt: {
            $gte: dayStart,
            $lt: new Date(dayStart.getTime() + IST_DAY_MS),
          },
        })
        .exec(),
      this.filings
        .findOne({}, { _id: 0, disseminatedAt: 1 })
        .sort({ disseminatedAt: -1 })
        .lean()
        .exec(),
      // Deliberately NOT the newest record's seqId. NSE disseminates out of
      // seq_id order, so the highest id and the latest timestamp belong to
      // different rows — and the cursor the poller resumes from is the id.
      this.filings
        .findOne({}, { _id: 0, seqId: 1 })
        .sort({ seqId: -1 })
        .lean()
        .exec(),
    ]);

    const newestAt =
      newest === null ? null : new Date(instantMs(newest.disseminatedAt));

    return {
      totalFilings,
      todayCount,
      todayIstDay: istDayKey(now),
      newestDisseminatedAt: newestAt === null ? null : newestAt.toISOString(),
      newestDisseminatedAtIst:
        newestAt === null ? null : istTimestamp(newestAt),
      maxSeqId: topSeq?.seqId ?? null,
      // Null, not zero, on an empty collection: "no filings yet" and "the last
      // filing arrived this instant" are opposite states and must not render
      // the same.
      feedLagMs: newestAt === null ? null : now.getTime() - newestAt.getTime(),
      generatedAt: now.toISOString(),
      generatedAtIst: istTimestamp(now),
    };
  }

  /**
   * A page of filings, newest first by the exchange's own clock.
   *
   * `seqId` breaks ties in the sort. NSE stamps `disseminatedAt` to the second
   * and routinely publishes several filings within one, so a sort on the
   * timestamp alone has no defined order among them — and an undefined order
   * means a row can appear on both page 1 and page 2, or on neither, as the
   * collection grows underneath a reader who is paging through it.
   */
  async getRecent(query: RecentQuery): Promise<RecentPage> {
    const filter = this.buildFilter(query);

    const [docs, total] = await Promise.all([
      this.filings
        .find(filter, DISPLAY_PROJECTION)
        .sort({ disseminatedAt: -1, seqId: -1 })
        .skip(query.offset)
        .limit(query.limit)
        .lean()
        .exec(),
      this.filings.countDocuments(filter).exec(),
    ]);

    const items = docs.map((doc) => this.toView(doc as unknown as Filing));

    return {
      items,
      meta: {
        total,
        limit: query.limit,
        offset: query.offset,
        returned: items.length,
        hasMore: query.offset + items.length < total,
      },
    };
  }

  /**
   * The category breakdown, largest first.
   *
   * Sorted by count and then by name, so two categories on the same count keep
   * a stable order between polls instead of swapping places every few seconds
   * on a live page.
   */
  async getCategories(limit: number): Promise<readonly CategoryCount[]> {
    const grouped = await this.filings
      .aggregate<GroupedCount<string>>([
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: limit },
      ])
      .exec();

    return grouped.map((row) => ({ category: row._id, count: row.count }));
  }

  /**
   * Filings per IST day for the last `days` days, oldest first.
   *
   * The bucketing is done in the database by shifting each instant by
   * `IST_OFFSET_MS` and then formatting in UTC — which is the IST calendar day,
   * computed from the one offset constant this codebase has. The alternative,
   * `$dateToString` with `timezone: '+05:30'`, would be a sixth handwritten
   * copy of that offset living where no test can see it.
   *
   * The result is zero-filled from `istDayKeysEndingAt`. A grouped query only
   * returns days that HAVE filings, so a series drawn from it alone silently
   * closes the gap where a dead day should be — and "did ingestion stop on
   * Tuesday" is the entire question this series exists to answer.
   */
  async getDaily(days: number): Promise<readonly DailyCount[]> {
    const now = this.now();
    const keys = istDayKeysEndingAt(now, days);
    const from = new Date(
      startOfIstDay(now).getTime() - (days - 1) * IST_DAY_MS,
    );

    const grouped = await this.filings
      .aggregate<GroupedCount<string>>([
        { $match: { disseminatedAt: { $gte: from } } },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: { $add: ['$disseminatedAt', IST_OFFSET_MS] },
              },
            },
            count: { $sum: 1 },
          },
        },
      ])
      .exec();

    const counts = new Map(grouped.map((row) => [row._id, row.count]));

    return keys.map((istDay) => ({
      istDay,
      count: counts.get(istDay) ?? 0,
    }));
  }

  /**
   * How the attachment worker is doing, and every reason it refused something.
   *
   * THE REFUSAL BREAKDOWN IS THE POINT. An extractor that declines to guess is
   * only trustworthy if its declines are inspectable, so this returns the
   * machine-readable reason for every refused document, grouped and counted,
   * and the page makes each one a filter.
   *
   * Seven grouped reads, issued together. They run on a page that polls, so
   * serialising them would make the dashboard's own latency the thing you
   * notice — the same reason `getSummary` batches its four.
   */
  async getEnrichmentSummary(): Promise<EnrichmentSummaryView> {
    const [
      total,
      byState,
      withAmount,
      byRefusal,
      byUnparseable,
      withCounterparty,
      withEnrichedHeadline,
      withClaims,
      byClaimDiscard,
      byClaimRefusal,
      withResults,
      byResultsDiscard,
      byResultsRefusal,
    ] = await Promise.all([
      this.filings.countDocuments({}).exec(),
      this.groupBy('$enrichment.state'),
      this.filings
        .countDocuments({ 'enrichment.amountRupees': { $ne: null } })
        .exec(),
      this.groupBy('$enrichment.amountRefusalReason', {
        'enrichment.amountRefusalReason': { $ne: null },
      }),
      this.groupBy('$enrichment.unparseableReason', {
        'enrichment.unparseableReason': { $ne: null },
      }),
      this.filings
        .countDocuments({ 'enrichment.counterparty': { $ne: null } })
        .exec(),
      // A headline that states a figure rather than the category. Counted from
      // the amount rather than by re-parsing the stored line, because the line
      // is text and the amount is the fact that decided its form.
      this.filings
        .countDocuments({
          'enrichment.amountRupees': { $ne: null },
          'enrichment.headline': { $ne: null },
        })
        .exec(),
      this.filings
        .countDocuments({ 'enrichment.claimLine': { $ne: null } })
        .exec(),
      // Unwound, because the interesting number is per DISCARD rather than per
      // filing: one document proposing three inventions is three data points
      // about the extractor, not one.
      this.filings
        .aggregate<GroupedCount<string | null>>([
          { $unwind: '$enrichment.claimDiscards' },
          {
            $group: {
              _id: '$enrichment.claimDiscards.reason',
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1, _id: 1 } },
        ])
        .exec(),
      this.groupBy('$enrichment.claimRefusalReason', {
        'enrichment.claimRefusalReason': { $ne: null },
      }),
      this.filings
        .countDocuments({ 'enrichment.resultsLine': { $ne: null } })
        .exec(),
      // Per DISCARD rather than per filing, for the same reason the claim
      // discards are: one table proposing three unplaceable figures is three
      // data points about the extractor.
      this.filings
        .aggregate<GroupedCount<string | null>>([
          { $unwind: '$enrichment.resultsDiscards' },
          {
            $group: {
              _id: '$enrichment.resultsDiscards.reason',
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1, _id: 1 } },
        ])
        .exec(),
      this.groupBy('$enrichment.resultsRefusalReason', {
        'enrichment.resultsRefusalReason': { $ne: null },
      }),
    ]);

    return {
      total,
      // A missing block is `pending`; see `toEnrichmentView`.
      byState: toCounts(byState, 'pending'),
      withAmount,
      byRefusal: toCounts(byRefusal, 'unknown'),
      byUnparseable: toCounts(byUnparseable, 'unknown'),
      withCounterparty,
      withEnrichedHeadline,
      withClaims,
      byClaimDiscard: toCounts(byClaimDiscard, 'unknown'),
      byClaimRefusal: toCounts(byClaimRefusal, 'unknown'),
      withResults,
      byResultsDiscard: toCounts(byResultsDiscard, 'unknown'),
      byResultsRefusal: toCounts(byResultsRefusal, 'unknown'),
      generatedAtIst: istTimestamp(this.now()),
    };
  }

  /**
   * One grouped count. The pipeline is written literally at this call site and
   * the `field` argument is a compile-time constant at every one of them — a
   * caller-supplied group key would be the one way an aggregation in this
   * read-only application could be shaped from outside.
   */
  private async groupBy(
    field: string,
    match?: Record<string, unknown>,
  ): Promise<readonly GroupedCount<string | null>[]> {
    return this.filings
      .aggregate<GroupedCount<string | null>>([
        ...(match === undefined ? [] : [{ $match: match }]),
        { $group: { _id: field, count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
      ])
      .exec();
  }

  /**
   * Turns the validated filters into a Mongo filter document.
   *
   * Built by spreading rather than by assigning into an object, so no partially
   * populated filter can escape and nothing is mutated after the fact.
   *
   * `symbol` is matched EXACTLY, against the uppercased input, rather than with
   * a case-insensitive regex. Three reasons, in order of weight: a regex
   * assembled from request text is a pattern the caller chose, which is an
   * injection surface and a ReDoS one; a regex with the `i` flag cannot use the
   * `symbol` index the schema declares, turning every filtered view into a
   * collection scan against a live ingest; and NSE symbols are uppercase by
   * construction, so the case fold buys nothing the `toUpperCase` here does not
   * already give a human typing `reliance` into the box.
   *
   * `category` is matched exactly and NOT uppercased: the taxonomy strings are
   * mixed-case sentences, and the page only ever sends values it read back from
   * the category breakdown.
   */
  private buildFilter(query: RecentQuery): Record<string, unknown> {
    return {
      ...(query.symbol === undefined
        ? {}
        : { symbol: query.symbol.toUpperCase() }),
      ...(query.category === undefined ? {} : { category: query.category }),
      ...this.enrichmentFilter(query),
    };
  }

  /**
   * The enrichment filters, which are what make refusals inspectable.
   *
   * `pending` deliberately matches a MISSING `enrichment` block as well as an
   * explicit `'pending'`. A filing the worker has never reached carries no
   * block at all — the schema declares no default so the poller's hot path
   * writes nothing extra — and in Mongo `{field: {$in: [null, 'pending']}}`
   * matches both. Filtering on the string alone would show an empty queue while
   * a thousand filings waited in it.
   *
   * Every value here has already been checked against a fixed allowlist by
   * `readEnum`, so none of them is caller-chosen text reaching a filter.
   */
  private enrichmentFilter(query: RecentQuery): Record<string, unknown> {
    return {
      ...(query.state === undefined
        ? {}
        : {
            'enrichment.state':
              query.state === 'pending'
                ? { $in: [null, 'pending'] }
                : query.state,
          }),
      ...(query.amount === undefined
        ? {}
        : {
            'enrichment.amountRupees':
              query.amount === 'extracted' ? { $ne: null } : null,
          }),
      ...(query.claim === undefined
        ? {}
        : {
            'enrichment.claimLine':
              query.claim === 'emitted' ? { $ne: null } : null,
          }),
      ...(query.refusal === undefined
        ? {}
        : {
            $or: [
              { 'enrichment.amountRefusalReason': query.refusal },
              { 'enrichment.unparseableReason': query.refusal },
              { 'enrichment.claimRefusalReason': query.refusal },
              { 'enrichment.claimDiscards.reason': query.refusal },
            ],
          }),
    };
  }

  /**
   * Projects one stored filing into the shape the page renders.
   *
   * Every timestamp is rendered to IST text HERE, on the server, because this
   * is the process that has `libs/common/src/ist.ts`. A browser left on UTC
   * that formatted these itself would show every filing five and a half hours
   * early and look completely normal doing it.
   */
  private toView(doc: Filing & { enrichment?: FilingEnrichment }): FilingView {
    const disseminatedAt = new Date(instantMs(doc.disseminatedAt));

    return {
      seqId: doc.seqId,
      symbol: doc.symbol,
      companyName: doc.companyName,
      industry: doc.industry ?? null,
      category: doc.category,
      summary: doc.summary,
      attachmentUrl: doc.attachmentUrl ?? null,
      announcedAtIst: istTimestamp(doc.announcedAt),
      disseminatedAt: disseminatedAt.toISOString(),
      disseminatedAtIst: istTimestamp(disseminatedAt),
      ingestedAtIst: istTimestamp(doc.ingestedAt),
      pipelineLagMs: instantMs(doc.ingestedAt) - instantMs(doc.disseminatedAt),
      enrichment: toEnrichmentView(doc.enrichment),
    };
  }
}

/**
 * Projects the stored enrichment block, or the absence of one.
 *
 * A MISSING BLOCK IS `pending`, not an error and not an empty object. The
 * poller writes no enrichment at all — that is what keeps the two-second hot
 * path free of eighteen null fields — so "the worker has not reached this yet"
 * is expressed by absence, and this is where that absence becomes a state a
 * page can render.
 *
 * `amountDisplay` is formatted HERE, on the server, from the same
 * `formatRupees` the headline uses. The browser must not do it: a second
 * implementation of Indian crore/lakh grouping would be a second thing to keep
 * in step with the message that actually goes out.
 */
function toEnrichmentView(
  enrichment: FilingEnrichment | undefined,
): EnrichmentView {
  const amountRupees = enrichment?.amountRupees ?? null;

  return {
    state: enrichment?.state ?? 'pending',
    attempts: enrichment?.attempts ?? 0,
    attemptedAtIst:
      enrichment?.attemptedAt == null
        ? null
        : istTimestamp(enrichment.attemptedAt),
    unparseableReason: enrichment?.unparseableReason ?? null,
    lastError: enrichment?.lastError ?? null,
    documentSource: enrichment?.documentSource ?? null,
    amountRupees,
    amountDisplay: amountRupees === null ? null : formatRupees(amountRupees),
    amountEvidence: enrichment?.amountEvidence ?? null,
    amountAnchor: enrichment?.amountAnchor ?? null,
    amountRefusalReason: enrichment?.amountRefusalReason ?? null,
    amountRefusalDetail: enrichment?.amountRefusalDetail ?? null,
    counterparty: enrichment?.counterparty ?? null,
    counterpartyRefusalReason: enrichment?.counterpartyRefusalReason ?? null,
    headline: enrichment?.headline ?? null,
    contextLine: enrichment?.contextLine ?? null,
    claimLine: enrichment?.claimLine ?? null,
    // Defaulted to empty arrays rather than left undefined: every filing stored
    // before the claim lane existed carries no such field, and a page that had
    // to test for absence would render "no claims" and "not looked at" the same.
    claims: (enrichment?.claims ?? []).map((claim) => ({
      text: claim.text,
      span: claim.span,
      kind: claim.kind,
      // Nullish-coalesced rather than read directly: every claim stored before
      // the period rule existed carries no such field, and `undefined` reaching
      // the page would render as the string "undefined" beside a real quote.
      periodSpan: claim.periodSpan ?? null,
    })),
    claimDiscards: (enrichment?.claimDiscards ?? []).map((row) => ({
      reason: row.reason,
      claim: row.claim,
      detail: row.detail,
    })),
    claimsProposed: enrichment?.claimsProposed ?? null,
    documentSummary: enrichment?.documentSummary ?? null,
    documentSummaryRefusalReason:
      enrichment?.documentSummaryRefusalReason ?? null,
    claimRefusalReason: enrichment?.claimRefusalReason ?? null,
    claimRefusalDetail: enrichment?.claimRefusalDetail ?? null,
    resultsLine: enrichment?.resultsLine ?? null,
    // Mapped field by field rather than passed through, so a document written
    // by an older build — which is every document already in the collection —
    // reads back as nulls and empty arrays rather than as `undefined` reaching
    // the page and rendering as the string "undefined" beside a real figure.
    results:
      enrichment?.results == null
        ? null
        : {
            basis: enrichment.results.basis,
            basisSpan: enrichment.results.basisSpan,
            columnsSpan: enrichment.results.columnsSpan,
            period: enrichment.results.period,
            priorPeriod: enrichment.results.priorPeriod,
            // No `?? []` fallback: `results` is null on every filing written
            // before this lane existed, so a non-null block always came from
            // the schema, which defaults `figures` to an array.
            figures: enrichment.results.figures.map((figure) => ({
              metric: figure.metric,
              current: figure.current,
              prior: figure.prior,
              unit: figure.unit,
              span: figure.span,
            })),
          },
    resultsDiscards: (enrichment?.resultsDiscards ?? []).map((row) => ({
      reason: row.reason,
      metric: row.metric,
      figure: row.figure,
      detail: row.detail,
    })),
    resultsProposed: enrichment?.resultsProposed ?? null,
    resultsRefusalReason: enrichment?.resultsRefusalReason ?? null,
    resultsRefusalDetail: enrichment?.resultsRefusalDetail ?? null,
  };
}

/** Turns a grouped aggregation into the page's `{key, count}` rows. */
const toCounts = (
  grouped: readonly GroupedCount<string | null>[],
  fallbackKey: string,
): readonly EnrichmentCount[] =>
  grouped.map((row) => ({ key: row._id ?? fallbackKey, count: row.count }));

export { toEnrichmentView, toCounts };
