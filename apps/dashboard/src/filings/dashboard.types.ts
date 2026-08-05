/**
 * The read models the dashboard serves. Types only — no runtime behaviour.
 *
 * Every timestamp appears TWICE: once as an ISO-8601 UTC instant, and once as
 * pre-rendered IST text. That is not redundancy, it is the fix for the most
 * repeated bug in this codebase. The browser showing this page is not
 * necessarily set to IST — a laptop on UTC formatting a stored instant itself
 * renders every filing five and a half hours early, and the result looks
 * entirely plausible. So the server, which has the one IST definition in
 * `libs/common/src/ist.ts`, does the formatting; the page prints the string it
 * is given. The raw instant is kept alongside it for anything that needs to
 * compute rather than display.
 */

/** One filing, as the recent-filings table shows it. */
export interface FilingView {
  readonly seqId: number;
  readonly symbol: string;
  readonly companyName: string;
  readonly industry: string | null;
  readonly category: string;
  readonly summary: string;
  /** Exchange-supplied source document. Never rendered as a link unhandled — see `ui/page-script.ts`. */
  readonly attachmentUrl: string | null;
  readonly announcedAtIst: string;
  /** ISO-8601 UTC. The authoritative exchange clock, and the sort key. */
  readonly disseminatedAt: string;
  readonly disseminatedAtIst: string;
  readonly ingestedAtIst: string;
  /**
   * Milliseconds between the exchange disseminating the filing and this
   * pipeline storing it. The number the whole project exists to keep small.
   */
  readonly pipelineLagMs: number;
}

/** Headline numbers, recomputed on every poll. */
export interface SummaryView {
  readonly totalFilings: number;
  /** Filings whose `disseminatedAt` falls in the current IST calendar day. */
  readonly todayCount: number;
  /** The IST day `todayCount` counts, as `YYYY-MM-DD`. */
  readonly todayIstDay: string;
  /** ISO-8601 UTC of the newest filing held, or null when the collection is empty. */
  readonly newestDisseminatedAt: string | null;
  readonly newestDisseminatedAtIst: string | null;
  /** The poller's persisted cursor: the highest `seqId` stored. */
  readonly maxSeqId: number | null;
  /**
   * Now minus the newest `disseminatedAt`. Null on an empty collection, where
   * there is no lag to report rather than a lag of zero.
   *
   * This is FEED lag, not pipeline lag: it grows through every quiet hour
   * because the exchange published nothing, so a large value outside the
   * filing window is normal and a large value inside it is not.
   */
  readonly feedLagMs: number | null;
  readonly generatedAt: string;
  readonly generatedAtIst: string;
}

/** One row of the category breakdown. */
export interface CategoryCount {
  readonly category: string;
  readonly count: number;
}

/** One bucket of the per-day series. */
export interface DailyCount {
  /** IST calendar day as `YYYY-MM-DD`. */
  readonly istDay: string;
  readonly count: number;
}

/** Pagination metadata for the recent-filings list. */
export interface PageMeta {
  /** Filings matching the filters, before the page window is applied. */
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly returned: number;
  readonly hasMore: boolean;
}
