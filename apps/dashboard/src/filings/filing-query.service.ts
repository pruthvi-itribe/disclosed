import {
  IST_DAY_MS,
  IST_OFFSET_MS,
  instantMs,
  istDayKey,
  istDayKeysEndingAt,
  istTimestamp,
  startOfIstDay,
} from '@app/common';
import type { Filing } from '@app/filings';
import type {
  CategoryCount,
  DailyCount,
  FilingView,
  PageMeta,
  SummaryView,
} from './dashboard.types';
import type { FilingReadModel } from './filing-read.model';

/** The filters the recent-filings list accepts, already validated. */
export interface RecentQuery {
  readonly limit: number;
  readonly offset: number;
  readonly symbol?: string;
  readonly category?: string;
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
  private toView(doc: Filing): FilingView {
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
    };
  }
}
