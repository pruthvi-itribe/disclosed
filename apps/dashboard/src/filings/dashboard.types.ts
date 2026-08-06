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

/**
 * What the background attachment worker made of one filing.
 *
 * EVERY REFUSAL IS SHOWN, and that is the reason this block exists rather than
 * a single "amount" column. The extractor's value is that it declines to guess,
 * and a refusal it will not explain is indistinguishable from a bug. So the
 * page carries the machine-readable reason, the human-readable detail, and the
 * verbatim substring the figure was read from when there is one — which is what
 * lets somebody check a headline against the source document without leaving
 * the row.
 */
export interface EnrichmentView {
  /** `pending` when the worker has never reached the filing. */
  readonly state: string;
  readonly attempts: number;
  readonly attemptedAtIst: string | null;
  /** Set only in state `unparseable`; why the document can never be read. */
  readonly unparseableReason: string | null;
  readonly lastError: string | null;
  /** Exact rupees, for anything that needs to compute rather than display. */
  readonly amountRupees: number | null;
  /** The same figure the headline states: `₹78.24 cr`. */
  readonly amountDisplay: string | null;
  /** The verbatim substring of the source document the figure was read from. */
  readonly amountEvidence: string | null;
  readonly amountAnchor: string | null;
  readonly amountRefusalReason: string | null;
  readonly amountRefusalDetail: string | null;
  readonly counterparty: string | null;
  readonly counterpartyRefusalReason: string | null;
  /** The composed line. Degrades to the exchange's own words when refused. */
  readonly headline: string | null;
  readonly contextLine: string | null;
}

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
  /**
   * The composed headline and everything behind it. Never absent: a filing the
   * worker has not reached yet reports state `pending` with nulls, which is a
   * different fact from "read and refused" and must not render the same.
   */
  readonly enrichment: EnrichmentView;
}

/** One row of the enrichment state or refusal-reason breakdown. */
export interface EnrichmentCount {
  readonly key: string;
  readonly count: number;
}

/**
 * How the attachment worker is doing, and why it refuses what it refuses.
 *
 * The refusal breakdown is the part that earns the extractor its trust: the
 * headline number ("14 amounts emitted, 14 correct") is only meaningful next to
 * "and here is every document it declined, grouped by what stopped it".
 */
export interface EnrichmentSummaryView {
  readonly total: number;
  /** Filings by enrichment state; `pending` includes those never attempted. */
  readonly byState: readonly EnrichmentCount[];
  /** Documents read where a figure was emitted. */
  readonly withAmount: number;
  /** Documents read where the extractor refused, by machine-readable reason. */
  readonly byRefusal: readonly EnrichmentCount[];
  /** Documents that can never be read, by reason. */
  readonly byUnparseable: readonly EnrichmentCount[];
  /** Filings carrying a verified counterparty. */
  readonly withCounterparty: number;
  /** Filings whose composed headline states an amount rather than the category. */
  readonly withEnrichedHeadline: number;
  readonly generatedAtIst: string;
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
