import {
  IST_DAY_MS,
  IST_OFFSET_MS,
  instantMs,
  istDayKey,
  istDayKeysEndingAt,
  istTimestamp,
  startOfIstDay,
} from '@app/common';
import {
  categoriesInGroup,
  categoryGroupFor,
  CATEGORY_GROUP_LABEL,
  CATEGORY_GROUPS,
  composeOutcome,
  confidenceTierFor,
  CONFIDENCE_TIER_LABEL,
  formatRupees,
  MAPPED_GROUP_CATEGORIES,
  FactsSeen,
  type CategoryGroup,
  type ClaimTopic,
  type Filing,
  type FilingEnrichment,
} from '@app/filings';
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
import { rankStages, SEARCH_SORT, textFilter } from '../search/search-rank';
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

/** Category groups a caller may filter on. */
export const GROUP_FILTERS = CATEGORY_GROUPS;

/**
 * Confidence tiers a caller may filter on.
 *
 * TWO VALUES RATHER THAN THREE, and the reason is honest rather than tidy.
 * `verified` is decidable from stored fields — a claim, a results line or an
 * amount — so it is a Mongo predicate over indexed data. Telling `stated` from
 * `labelled` requires comparing the exchange's summary against its category,
 * which is a string computation this application deliberately does on READ so
 * that the whole existing collection gained an outcome without a backfill.
 *
 * Expressing that as a filter would mean either an `$expr` over every document —
 * a collection scan against a live ingest on every poll of a page that
 * auto-refreshes — or storing a derived field and migrating 2,000 documents to
 * populate it. Neither is worth it for a distinction the TIER COLUMN already
 * shows on every row. So the filter cuts where the consequence is: `verified` is
 * the boundary that decides what may reach a wire.
 */
export const TIER_FILTERS = ['verified', 'unverified'] as const;

export type TierFilter = (typeof TIER_FILTERS)[number];

/**
 * What makes a filing `verified`: something survived a gate that checks against
 * the document.
 *
 * ONE DEFINITION, used by the filter, the counts and the row projection alike.
 * Three copies of this predicate is three chances for the dashboard's count of
 * verified filings to disagree with the rows it shows for the same filter.
 */
const VERIFIED_PREDICATE: readonly Record<string, unknown>[] = [
  { 'enrichment.claims.0': { $exists: true } },
  { 'enrichment.resultsLine': { $ne: null } },
  { 'enrichment.amountRupees': { $ne: null } },
];

/** The filters the recent-filings list accepts, already validated. */
export interface RecentQuery {
  readonly limit: number;
  readonly offset: number;
  /**
   * Free text: a company name, a ticker, a category, or something a filing
   * said. Served by the `filing_text` index and ranked by `search-rank.ts`.
   *
   * SEPARATE FROM `symbol`, deliberately. `symbol` is an exact identifier the
   * type-ahead applies when a reader PICKS a company, and it stays exact — a
   * reader who chose BRITANNIA from the list wants Britannia and not every
   * filing that mentions biscuits. `q` is what they typed before they chose.
   */
  readonly q?: string;
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
  /** NSE's categories collapsed to a readable set. */
  readonly group?: CategoryGroup;
  /**
   * What a filing's claims are ABOUT: dividends, results, orders.
   *
   * SEPARATE FROM `group`, which is what KIND of filing NSE says it is. The two
   * disagree constantly and both are right: a dividend declaration arrives as
   * `Outcome of Board Meeting` (group `results`) and says something about a
   * payout (topic `dividend`). A reader hunting payouts wants the second, and
   * before topics existed there was no way to ask for it — 67% of claims sat
   * under the single kind `operational`.
   */
  readonly topic?: ClaimTopic;
  /** Whether anything about this filing survived a gate against the document. */
  readonly tier?: TierFilter;
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
 * Marks a claim that repeats a fact an EARLIER item in this page already made.
 *
 * A company reporting a quarter files it more than once. DHARMAJ filed an
 * investor presentation and a press release a minute apart, one saying
 * "Revenue growth of 5% YOY in Q1FY27" and the other "Revenue grew 5% YOY in
 * Q1FY27." Both are true and both were matched against their own source
 * document; printing both tells a reader one thing twice, and the grid layout
 * puts them side by side where it is unmissable.
 *
 * MARKED, NOT REMOVED. The claim stays in the response with its span, its topic
 * and its kind, because it is real evidence for the filing it came from and the
 * detail view must still show it. Only the feed's headline treatment changes.
 *
 * SCOPED TO THE PAGE, deliberately. What counts as a repeat is "something the
 * reader has just been shown", which is a property of the view rather than of
 * the filing — the same claim on page two of a different filter is the first
 * time that reader has seen it. Persisting the verdict would make it a fact
 * about the document, which it is not.
 *
 * Items arrive newest first, so the NEWEST telling keeps the claim and the
 * older restatement is the echo. That is the right way round: a company that
 * restates a figure in a later document is usually confirming or correcting it.
 */
function markEchoedClaims(items: readonly FilingView[]): FilingView[] {
  const seen = new FactsSeen();
  return items.map((item) => {
    const claims = item.enrichment?.claims;
    if (claims === undefined || claims.length === 0) return item;
    return {
      ...item,
      enrichment: {
        ...item.enrichment,
        claims: claims.map((claim) => ({
          ...claim,
          echo: seen.addAndCheck(item.symbol, claim.text),
        })),
      },
    } as FilingView;
  });
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
  /**
   * `resolveSymbols` IS THE PREFIX HALF OF SEARCH, and it is a function rather
   * than a collaborator so this class keeps depending on nothing but a read
   * handle and a clock.
   *
   * A text index matches WHOLE WORDS. That is exactly right for `solar` finding
   * `Vikram Solar Limited` and exactly wrong for `brit` finding anything at all
   * — and `brit` is what a reader has typed for the first four keystrokes of
   * every search for Britannia. Measured on the live collection: `$search:
   * 'solar'` returns 29 filings and does NOT include Solarworld Energy
   * Solutions, whose name tokenises to the single word `solarworld`.
   *
   * The company directory answers prefixes because it holds 954 pre-tokenised
   * companies in memory. So a search that the text index cannot answer is
   * resolved to SYMBOLS and asked again as `{symbol: {$in: [...]}}`, which the
   * `symbol_1` index serves exactly. Two round trips, but only on the miss path
   * — and only when the directory has something to offer, so a genuinely absent
   * query still costs one.
   *
   * It defaults to resolving nothing, which is what keeps this class testable
   * on its own and what makes the fallback a wiring decision rather than a
   * hidden behaviour.
   */
  constructor(
    private readonly filings: FilingReadModel,
    private readonly now: () => Date = () => new Date(),
    private readonly resolveSymbols: (
      query: string,
    ) => Promise<readonly string[]> = async () => [],
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

    const dayWindow = {
      disseminatedAt: {
        $gte: dayStart,
        $lt: new Date(dayStart.getTime() + IST_DAY_MS),
      },
    };

    const [totalFilings, todayCount, newest, topSeq, todayShape] =
      await Promise.all([
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
        // TODAY'S SHAPE, not the collection's. The enrichment route already
        // counts category groups, but over everything ever stored — using that
        // for a bar labelled "today" would be a true number answering a
        // different question, which is the failure mode this codebase treats as
        // the most dangerous one it has.
        //
        // Bounded at both ends by the same IST window as the count above, and
        // served by `disseminatedAt_-1`. `category` is required on every filing,
        // so this summary's coverage is 100% and stays there — unlike claims,
        // amounts or results, which is why it is the one shape worth leading
        // the feed with.
        this.filings
          .aggregate<{ _id: string; n: number; verified: number }>([
            { $match: dayWindow },
            {
              $group: {
                _id: '$category',
                n: { $sum: 1 },
                verified: {
                  $sum: {
                    $cond: [
                      {
                        $gt: [
                          { $size: { $ifNull: ['$enrichment.claims', []] } },
                          0,
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ])
          .exec(),
      ]);

    // Folded into groups in Node rather than in the pipeline: the category to
    // group mapping is a table this codebase owns, and duplicating it as an
    // aggregation `$switch` would be a second copy to drift.
    const todayByGroup: Record<string, number> = {};
    let todayVerified = 0;
    for (const row of todayShape) {
      const group = categoryGroupFor(row._id);
      todayByGroup[group] = (todayByGroup[group] ?? 0) + row.n;
      todayVerified += row.verified;
    }

    const newestAt =
      newest === null ? null : new Date(instantMs(newest.disseminatedAt));

    return {
      totalFilings,
      todayCount,
      todayByGroup,
      todayVerified,
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
    // A QUERY THAT REDUCES TO NO TERM IS NOT NO FILTER. `?q=---` holds nothing
    // searchable, and dropping it would return the whole collection through a
    // route the reader believes they narrowed — the same failure the numeric
    // parsers in `query-params.ts` refuse. It is answered as an empty page,
    // without a round trip, because there is no question to ask.
    if (query.q !== undefined && textFilter(query.q) === null) {
      return emptyPage(query);
    }

    const page = await this.filterPage(
      query,
      this.buildFilter(query),
      query.q ?? null,
    );
    if (query.q === undefined || page.meta.total > 0) return page;

    // Nothing said the reader's word — but they may have typed only part of
    // one. See `resolveSymbols`.
    const symbols = await this.resolveSymbols(query.q);
    if (symbols.length === 0) return page;

    // Asked UNRANKED, and that is the honest ordering rather than a shortcut.
    // Every row here matched because its company's ticker or name completes
    // what the reader typed, so all of them are identity matches — the same
    // tier — and inside a tier this page orders by the clock.
    return this.filterPage(
      query,
      {
        ...this.buildFilter({ ...query, q: undefined }),
        symbol: { $in: [...symbols] },
      },
      null,
    );
  }

  /**
   * One page for an already-built filter, with the count beside it.
   *
   * The two reads are issued together rather than in sequence: they are
   * independent and this route is polled every four seconds, so serialising
   * them would make the dashboard's own latency the thing you notice.
   *
   * `rankFor` is the text the rows are ranked against, or null for the ordinary
   * newest-first page. It is a SEPARATE ARGUMENT from `query.q` because the
   * prefix fallback above runs with a query that still carries `q` and a filter
   * that carries no `$text` — and asking for `$meta: 'textScore'` without a
   * `$text` predicate is a MongoServerError, not an empty column.
   */
  private async filterPage(
    query: RecentQuery,
    filter: Record<string, unknown>,
    rankFor: string | null,
  ): Promise<RecentPage> {
    const [docs, total] = await Promise.all([
      // TWO READ PATHS, and the fork is the whole point rather than an
      // oversight. Unranked this is the `find` it has always been: same filter,
      // same sort, same plan, so adding search changed the cost of every OTHER
      // view on this page by exactly nothing. Ranked, the rows have to come
      // back in rank order, which is a computed key — and a computed sort key
      // is an aggregation or it is nothing.
      rankFor === null
        ? this.filings
            .find(filter, DISPLAY_PROJECTION)
            .sort({ disseminatedAt: -1, seqId: -1 })
            .skip(query.offset)
            .limit(query.limit)
            .lean()
            .exec()
        : this.rankedPage(query, filter, rankFor),
      this.filings.countDocuments(filter).exec(),
    ]);

    const items = markEchoedClaims(
      docs.map((doc) => this.toView(doc as unknown as Filing)),
    );

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
   * One page of a ranked search.
   *
   * `$sort` IS ADJACENT TO `$skip` AND `$limit` on purpose. MongoDB coalesces
   * the three into a top-k sort that holds only `offset + limit` documents in
   * memory — verified in the explain output, which reports `limit: 50` on the
   * sort stage for a second page of 25. Without that adjacency a query matching
   * a common word would sort its entire match set in memory and, past 100MB,
   * fail rather than degrade. `$project` comes after, because the sort keys have
   * to still exist when the sort runs.
   */
  private async rankedPage(
    query: RecentQuery,
    filter: Record<string, unknown>,
    rankFor: string,
  ): Promise<unknown[]> {
    return this.filings
      .aggregate<unknown>([
        { $match: filter },
        ...rankStages(rankFor),
        { $sort: SEARCH_SORT },
        { $skip: query.offset },
        { $limit: query.limit },
        { $project: DISPLAY_PROJECTION },
      ])
      .exec();
  }

  /**
   * One page of filings from a set of symbols — the v1 alert surface.
   *
   * THE SAME SHAPE `api/filings` RETURNS, deliberately, so the page's
   * `renderFeedInto` draws this unchanged. That reuse is the largest saving in
   * the whole accounts design: the Watching view is a new query and no new
   * rendering, so claim lines, results lines, quiet cards, Copy and Source all
   * arrive with the `createElement`/`textContent`/`safeHref` discipline already
   * on them.
   *
   * NO NEW INDEX. `{symbol: {$in: [...]}} ` sorted `disseminatedAt: -1` is
   * served by the existing `symbol_1_category_1_disseminatedAt_-1`.
   *
   * WHAT IS NOT CLAIMED: that MongoDB plans it as a sort-merge rather than a
   * blocking SORT. The design names that as a measurement to run
   * (`explain()` over a real collection with a 50-symbol `$in`), and it has not
   * been run — so the plan is not written down here as though it had been. The
   * bound that DOES hold whatever the plan is: the symbol list is capped at 50
   * by `MAX_WATCHED_SYMBOLS` and the page is capped by `limit`.
   *
   * An empty symbol list is answered WITHOUT A READ. `{$in: []}` matches
   * nothing, so the round trip is knowable in advance.
   */
  async getWatchedPage(
    symbols: readonly string[],
    limit: number,
    offset: number,
  ): Promise<RecentPage> {
    if (symbols.length === 0) {
      return {
        items: [],
        meta: { total: 0, limit, offset, returned: 0, hasMore: false },
      };
    }

    return this.filterPage(
      { limit, offset },
      { symbol: { $in: [...symbols] } },
      null,
    );
  }

  /**
   * How many filings from these symbols arrived since the reader last looked.
   *
   * `null` for `since` means they have never looked, and the honest answer then
   * is the whole set rather than zero — a badge reading 0 on a watchlist full
   * of filings would be the page telling a reader there is nothing to see.
   */
  async countWatchedSince(
    symbols: readonly string[],
    since: Date | null,
  ): Promise<number> {
    if (symbols.length === 0) return 0;

    const filter: Record<string, unknown> = { symbol: { $in: [...symbols] } };
    if (since !== null) filter.disseminatedAt = { $gt: since };

    return this.filings.countDocuments(filter).exec();
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
      byRawCategory,
      verifiedCount,
      byParseRoute,
      byCoverageSkip,
      parseFallbacks,
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
      // BY RAW CATEGORY, then folded into groups in this process. Grouping in
      // the database would need the 116-row mapping table expressed as a
      // `$switch`, which is the same table written twice in two languages — and
      // the second copy is the one that silently stops matching when NSE renames
      // something. There are 111 distinct categories, so the intermediate result
      // is a hundred rows, not a collection.
      this.groupBy('$category'),
      // Verified is decidable from stored fields; the other two tiers are not,
      // for the reason `TIER_FILTERS` gives at length.
      this.filings.countDocuments({ $or: [...VERIFIED_PREDICATE] }).exec(),
      this.groupBy('$enrichment.parseRoute', {
        'enrichment.parseRoute': { $ne: null },
      }),
      this.groupBy('$enrichment.coverageSkip', {
        'enrichment.coverageSkip': { $ne: null },
      }),
      this.filings
        .countDocuments({ 'enrichment.parseFallbackReason': { $ne: null } })
        .exec(),
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
      // EQUAL TO `total` BY CONSTRUCTION, and reported anyway. "Every filing
      // produces an outcome" is the claim this change makes, and a claim that is
      // not counted is a claim nobody can falsify.
      withOutcome: total,
      byCategoryGroup: foldIntoGroups(byRawCategory),
      // `stated` and `labelled` are computed on read, so they are counted here
      // by subtraction from a figure the database CAN answer rather than by a
      // second pass over every document.
      byConfidenceTier: [
        { key: 'verified', count: verifiedCount },
        { key: 'stated or labelled', count: total - verifiedCount },
      ],
      byParseRoute: toCounts(byParseRoute, 'pdf-parse'),
      byCoverageSkip: toCounts(byCoverageSkip, 'unknown'),
      parseFallbacks,
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
      // `$text` sits at the TOP LEVEL and never inside the `$or` the refusal and
      // tier filters build. MongoDB permits at most one `$text` per query and
      // requires every sibling of one inside an `$or` to be indexed; keeping it
      // out here means neither rule can be broken by a filter combination
      // somebody adds later.
      ...(query.q === undefined ? {} : (textFilter(query.q) ?? {})),
      ...(query.symbol === undefined
        ? {}
        : { symbol: query.symbol.toUpperCase() }),
      ...(query.category === undefined ? {} : { category: query.category }),
      ...groupFilter(query.group),
      // Matches a filing ANY of whose claims carries the topic, which is what a
      // reader means by "show me dividends" — a results presentation that also
      // declares a payout belongs in both. Served by the `claims.topic` index.
      ...(query.topic === undefined
        ? {}
        : { 'enrichment.claims.topic': query.topic }),
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
      // WRAPPED IN `$and` rather than spread as a bare `$or`, because the
      // refusal filter below also uses `$or` and two `$or` keys in one object
      // literal is not a combined query — the second silently replaces the
      // first, and a page showing the wrong rows for a filter it says it applied
      // is worse than one that refuses the filter.
      ...(query.tier === undefined
        ? {}
        : query.tier === 'verified'
          ? { $and: [{ $or: [...VERIFIED_PREDICATE] }] }
          : // `$nor` rather than a negated `$or`, so a filing missing the
            // enrichment block entirely — the poller writes none — counts as
            // unverified rather than matching nothing.
            { $and: [{ $nor: [...VERIFIED_PREDICATE] }] }),
      ...(query.refusal === undefined
        ? {}
        : {
            $or: [
              { 'enrichment.amountRefusalReason': query.refusal },
              { 'enrichment.unparseableReason': query.refusal },
              { 'enrichment.claimRefusalReason': query.refusal },
              { 'enrichment.claimDiscards.reason': query.refusal },
              { 'enrichment.coverageSkip': query.refusal },
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

    // DERIVED HERE, FROM FIELDS THE POLLER ALWAYS WRITES. `category` and
    // `summary` are stored for every filing on the two-second hot path, so an
    // outcome exists for a filing the worker has never reached, one whose PDF is
    // a raster scan, and one whose model call failed. Every one of those was a
    // blank row before.
    const outcome = composeOutcome({
      symbol: doc.symbol,
      category: doc.category,
      summary: doc.summary,
    });
    const group = categoryGroupFor(doc.category);
    const enrichment = doc.enrichment;
    const tier = confidenceTierFor({
      hasVerifiedClaim: (enrichment?.claims?.length ?? 0) > 0,
      hasVerifiedResults: (enrichment?.resultsLine ?? null) !== null,
      hasVerifiedAmount: (enrichment?.amountRupees ?? null) !== null,
      outcomeSource: outcome.source,
    });

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
      // THE IST DAY, COMPUTED HERE AND NOT IN THE BROWSER. The company page's
      // filing strip buckets by IST calendar day, and the rule at the top of
      // `page-script.ts` is that the server owns every IST decision — a browser
      // in another timezone would bucket the same filing differently, and the
      // 18:30Z boundary is exactly where that goes wrong.
      //
      // Sent as its own field rather than sliced off `disseminatedAtIst`. The
      // slice would work today and would be a silent coupling to a server
      // format that can change, which is the shape of bug that survives review.
      istDay: istDayKey(disseminatedAt),
      ingestedAtIst: istTimestamp(doc.ingestedAt),
      pipelineLagMs: instantMs(doc.ingestedAt) - instantMs(doc.disseminatedAt),
      outcome: outcome.text,
      outcomeSource: outcome.source,
      categoryGroup: group,
      categoryGroupLabel: CATEGORY_GROUP_LABEL[group],
      confidenceTier: tier,
      confidenceTierLabel: CONFIDENCE_TIER_LABEL[tier],
      enrichment: toEnrichmentView(enrichment),
    };
  }
}

/**
 * A page of nothing, shaped like a page of something.
 *
 * Built rather than returned as a constant so `limit` and `offset` are the ones
 * the caller asked for: a client that reads `meta.limit` back to decide its next
 * request must not be handed a number nobody sent.
 */
const emptyPage = (query: RecentQuery): RecentPage => ({
  items: [],
  meta: {
    total: 0,
    limit: query.limit,
    offset: query.offset,
    returned: 0,
    hasMore: false,
  },
});

/**
 * The Mongo clause for a category group.
 *
 * `$in` over the group's own NSE spellings, which uses the `category` index the
 * schema declares. `other` is the awkward one and is expressed as a NEGATION —
 * it is defined by absence from the mapping table, so it cannot be enumerated
 * from it, and `$nin` over every mapped name is the only honest translation.
 */
const groupFilter = (
  group: CategoryGroup | undefined,
): Record<string, unknown> => {
  if (group === undefined) return {};
  if (group === 'other') {
    return { category: { $nin: [...MAPPED_GROUP_CATEGORIES] } };
  }
  return { category: { $in: [...categoriesInGroup(group)] } };
};

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
      // The field the topic filter already queries, now also sent. Without it
      // the page could filter BY topic and not show what the topics were, so a
      // company's mix came back as one segment reading "Everything else".
      topic: claim.topic ?? null,
      // The movement the source sentence printed, and the words that printed
      // it. Sent together and nullish-coalesced together: a mark whose evidence
      // did not arrive is a mark a reader cannot check, and the whole reason a
      // derived tag is allowed on this page is that they can.
      direction: claim.direction ?? null,
      directionEvidence: claim.directionEvidence ?? null,
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
    parseRoute: enrichment?.parseRoute ?? null,
    parseFallbackReason: enrichment?.parseFallbackReason ?? null,
    coverageSkip: enrichment?.coverageSkip ?? null,
  };
}

/**
 * Folds a per-category count into per-group counts.
 *
 * The mapping table stays in TypeScript, where it is one table checked against
 * the corpus by a test, rather than being restated as a Mongo `$switch` that
 * nothing checks. Sorted largest first and then by name, so two groups on the
 * same count keep a stable order between polls instead of swapping places every
 * few seconds on a live page.
 */
const foldIntoGroups = (
  byCategory: readonly GroupedCount<string | null>[],
): readonly EnrichmentCount[] => {
  const totals = new Map<CategoryGroup, number>();
  for (const row of byCategory) {
    const group = categoryGroupFor(row._id ?? '');
    totals.set(group, (totals.get(group) ?? 0) + row.count);
  }
  return [...totals.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.key.localeCompare(right.key),
    );
};

/** Turns a grouped aggregation into the page's `{key, count}` rows. */
const toCounts = (
  grouped: readonly GroupedCount<string | null>[],
  fallbackKey: string,
): readonly EnrichmentCount[] =>
  grouped.map((row) => ({ key: row._id ?? fallbackKey, count: row.count }));

export { toEnrichmentView, toCounts };
