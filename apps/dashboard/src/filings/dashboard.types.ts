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
  /**
   * Which archived files the text came from, when it was not simply one PDF.
   *
   * Null for the ordinary case. A filing whose text is the concatenation of
   * three documents is a different object from one whose text is a document,
   * and a reviewer reading a span needs to know which file it came out of.
   */
  readonly documentSource: string | null;
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

  /**
   * The wire line of notable claims, or null.
   *
   * The claim lane and the amount lane refuse for different reasons and must be
   * readable apart: a filing can carry a verified figure and no claim, a claim
   * and no figure, both, or neither, and each of those four says something
   * different about the document.
   */
  readonly claimLine: string | null;
  /** Each accepted claim with the document's own sentence behind it. */
  readonly claims: readonly ClaimView[];
  /** Each refused claim, with the rule that refused it. */
  readonly claimDiscards: readonly ClaimDiscardView[];
  readonly claimsProposed: number | null;
  /**
   * The model's own prose summary. UNVERIFIED, and rendered as such.
   *
   * Never merged into `claims` and never sent anywhere outward-facing. The
   * page marks it visibly as model-generated, because a reader scanning a
   * column of verified quotes must be able to tell at a glance which line is
   * not one. See `libs/filings/src/logic/claim-summary.ts`.
   */
  readonly documentSummary: string | null;
  readonly documentSummaryRefusalReason: string | null;
  readonly claimRefusalReason: string | null;
  readonly claimRefusalDetail: string | null;

  /**
   * The wire line of financial results, or null.
   *
   * KEPT APART from `claimLine` all the way to the page, because the two were
   * admitted by different gates. A claim is published because its sentence is in
   * the document; a results figure is published because the table's own header
   * block says which statement it belongs to, which period its column is, and
   * what scale it is in. Rendering them as one line would make a reader unable
   * to tell which guarantee is behind which number.
   */
  readonly resultsLine: string | null;
  /** The statement heading and column header the line rests on. */
  readonly results: ResultsView | null;
  /** Each refused figure, with the rule that refused it. */
  readonly resultsDiscards: readonly ResultsDiscardView[];
  readonly resultsProposed: number | null;
  readonly resultsRefusalReason: string | null;
  readonly resultsRefusalDetail: string | null;

  /**
   * Which parser produced the text. Null on every filing read before the hybrid.
   *
   * Shown because it changes how a stored verdict should be read: Docling's
   * markdown carries row-aligned table cells and puts a statement heading before
   * its own table, and `pdf-parse`'s flattening does neither.
   */
  readonly parseRoute: string | null;
  /**
   * Why an expensive parser was wanted and not used.
   *
   * THE FIELD THAT MAKES AN OPTIONAL DEPENDENCY HONEST. A results filing read by
   * `pdf-parse` because a Python service has been down since Tuesday must not
   * look identical to one `pdf-parse` was the right answer for.
   */
  readonly parseFallbackReason: string | null;
  /** Why no model read this document. Null when one did. */
  readonly coverageSkip: string | null;
}

/** The evidence behind a results line, for review. */
export interface ResultsView {
  readonly basis: string;
  /** The document's own words at the heading that fixed the basis. */
  readonly basisSpan: string;
  /** The document's own column-date line, which made the comparison YoY. */
  readonly columnsSpan: string;
  readonly period: string;
  readonly priorPeriod: string;
  readonly figures: readonly ResultsFigureView[];
}

export interface ResultsFigureView {
  readonly metric: string;
  readonly current: string;
  readonly prior: string;
  readonly unit: string;
  /** The verbatim table row. This is what makes the figures checkable. */
  readonly span: string;
}

/** One refused figure and the rule that refused it. */
export interface ResultsDiscardView {
  readonly reason: string;
  readonly metric: string;
  readonly figure: string;
  readonly detail: string;
}

/** One published claim and the sentence it was read from. */
export interface ClaimView {
  readonly text: string;
  /** The verbatim source sentence. This is what makes the claim checkable. */
  readonly span: string;
  readonly kind: string;
  /**
   * The verbatim heading that stated the claim's fiscal period, when the period
   * came from outside the sentence. Null otherwise, which is the usual case.
   *
   * Shown for the same reason `span` is: a claim reading "Q1 FY27 revenue of
   * ₹125.2 Cr" whose only evidence mentions neither Q1 nor FY27 cannot be
   * checked by the person the dashboard exists for.
   */
  readonly periodSpan: string | null;
}

/**
 * One refused claim.
 *
 * SHOWN, NOT COUNTED. A model that starts inventing appears here as a rising
 * `span-not-found` count against text somebody can read; a bare number would
 * say the rate moved and nothing about what moved it.
 */
export interface ClaimDiscardView {
  readonly reason: string;
  readonly claim: string;
  readonly detail: string;
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
  /**
   * The IST calendar day this filing was disseminated on, as `YYYY-MM-DD`.
   *
   * Carried separately from `disseminatedAtIst` so the company page's filing
   * strip can bucket by day without the browser computing IST — which it must
   * not, because the 18:30Z boundary would put the same filing on different
   * days for readers in different timezones.
   */
  readonly istDay: string;
  readonly ingestedAtIst: string;
  /**
   * Milliseconds between the exchange disseminating the filing and this
   * pipeline storing it. The number the whole project exists to keep small.
   */
  readonly pipelineLagMs: number;

  /**
   * One line saying what happened. NEVER NULL, for any filing.
   *
   * ================================================================
   * THIS IS THE COVERAGE FIX, AND IT IS DERIVED RATHER THAN STORED
   * ================================================================
   *
   * Built here, on read, from `category` and `summary` — two fields the poller
   * writes on the two-second hot path for every filing it stores. So it is
   * present for a filing the worker has not reached, for one whose PDF is a
   * raster scan, for one whose attachment URL is NSE's `"-"` sentinel, and for
   * one whose model call failed. Every one of those produced a blank row before.
   *
   * Deriving rather than storing also means the whole existing collection gained
   * an outcome the moment this shipped, with no backfill and nothing to migrate,
   * and that a change to how an outcome reads cannot leave stale text behind.
   */
  readonly outcome: string;
  /** Whether the outcome is the exchange's own sentence or only its category. */
  readonly outcomeSource: string;
  /** NSE's 111 categories collapsed to a readable set. Never null. */
  readonly categoryGroup: string;
  /** Reader-facing spelling of the group. */
  readonly categoryGroupLabel: string;
  /**
   * How much of this row can be trusted: `verified`, `stated` or `labelled`.
   *
   * THE GATE, RELABELLED. It used to decide whether a filing produced anything
   * at all; now nothing is dropped and everything carries the tier that says how
   * somebody would check it. Only `verified` is allowed near an alert.
   */
  readonly confidenceTier: string;
  readonly confidenceTierLabel: string;

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
  /** Filings carrying at least one verified claim. */
  readonly withClaims: number;
  /** Proposed claims the verbatim gate refused, by reason. */
  readonly byClaimDiscard: readonly EnrichmentCount[];
  /** Read documents that produced no claim line, by reason. */
  readonly byClaimRefusal: readonly EnrichmentCount[];
  /** Filings carrying a verified results line. */
  readonly withResults: number;
  readonly byResultsDiscard: readonly EnrichmentCount[];
  readonly byResultsRefusal: readonly EnrichmentCount[];

  /**
   * Filings carrying an outcome line.
   *
   * REPORTED AS A NUMBER RATHER THAN ASSERTED IN A COMMENT, because "every
   * filing produces an outcome" is the claim this whole change makes and a claim
   * that is not counted is a claim nobody can falsify. It equals `total` by
   * construction — the outcome is derived from fields the poller always writes —
   * and the day it does not, the dashboard says so.
   */
  readonly withOutcome: number;
  /** Filings by category group, largest first. */
  readonly byCategoryGroup: readonly EnrichmentCount[];
  /** Filings by confidence tier. The shape of what can be trusted. */
  readonly byConfidenceTier: readonly EnrichmentCount[];
  /** Read documents by the parser that read them. */
  readonly byParseRoute: readonly EnrichmentCount[];
  /**
   * Documents no model read, by reason.
   *
   * COUNTED, NOT MERELY RECORDED. The results gap existed because a skipped
   * filing and an empty filing rendered identically.
   */
  readonly byCoverageSkip: readonly EnrichmentCount[];
  /** Reads where an expensive parser was wanted and could not be used. */
  readonly parseFallbacks: number;
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

/**
 * ================================================================
 * TYPE-AHEAD
 * ================================================================
 *
 * What the search box offers as a reader types. Three kinds, because a reader
 * typing into one box means one of three things and the page must not guess:
 * `britannia` names a COMPANY, `stock split` names a CATEGORY, and `results`
 * names a GROUP. Each suggestion carries the exact filter it applies, so
 * picking one is a precise query rather than a better-ranked fuzzy one.
 *
 * `filings` is on every row because it is the cheapest possible answer to "is
 * this the one I meant". Two companies whose names both complete `solar` are
 * told apart by which of them the reader has been seeing in the feed.
 */

/** One company the reader may have meant. Applies `symbol=`, matched exactly. */
export interface CompanySuggestion {
  readonly symbol: string;
  readonly companyName: string;
  readonly filings: number;
}

/** One NSE category. Applies `category=`, matched exactly. */
export interface CategorySuggestion {
  readonly category: string;
  readonly filings: number;
}

/** One reader-facing group. Applies `group=`, which is an allowlisted enum. */
export interface GroupSuggestion {
  readonly group: string;
  readonly label: string;
  readonly filings: number;
}

/**
 * A whole type-ahead response.
 *
 * `builtAtIst` is the DIRECTORY's build time, not this request's. The list is
 * served from a snapshot refreshed on a timer rather than rebuilt per keystroke
 * — see `search/company-directory.ts` — and a reader whose brand-new company is
 * missing deserves to be able to see why rather than conclude the box is
 * broken.
 */
export interface SuggestionsView {
  readonly companies: readonly CompanySuggestion[];
  readonly categories: readonly CategorySuggestion[];
  readonly groups: readonly GroupSuggestion[];
  readonly builtAtIst: string;
  /** Distinct companies the directory holds, whatever this query matched. */
  readonly companiesKnown: number;
}
