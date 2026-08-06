/**
 * A quarter's financial results, and every way one can fail to become a line.
 *
 * TYPES ONLY, for the same reason `claim.types.ts` is types only: the REFUSAL
 * VOCABULARY is the product. An extractor that reads a results table is only
 * trustworthy when the ways it can decline are enumerable, countable and
 * visible, and every reason below is one the dashboard groups by.
 *
 * ================================================================
 * WHY THIS IS NOT A CLAIM
 * ================================================================
 *
 * A claim is one sentence compressed into one line, and the gate that admits it
 * asks one question: is this sentence in the document? A results figure is read
 * ACROSS a table row and DOWN a column header, and the questions that decide
 * whether it may be published are different ones:
 *
 *   - which of the two statements is this row in — consolidated or standalone?
 *   - what does the column this number sits in mean?
 *   - what scale is the table denominated in?
 *   - is the number beside it the year-ago figure, or last quarter's?
 *
 * None of those is answered by finding a sentence. They are answered by reading
 * the table's own header block, which is why `results-verify.ts` requires the
 * header to be quoted as well as the row, and checks the two against each other.
 */

/**
 * The metrics a results line may carry.
 *
 * A SMALL CLOSED SET, on purpose. Every one of these is a row a SEBI
 * Regulation 33 statement is required to carry, or — for `ebitda` and
 * `ebitda-margin` — a figure a filer sometimes states itself. Nothing here is
 * ever computed: see `results-metric.ts` for why EBITDA is emitted only when the
 * document prints the word.
 */
export type ResultsMetric =
  /** "Revenue from operations". The top line. */
  | 'revenue'
  /** "Total income" — revenue plus other income. A different number. */
  | 'total-income'
  /** "Profit for the period" / "Net profit" / "Profit after tax". */
  | 'net-profit'
  /** Only when the filer states it. Never derived. */
  | 'ebitda'
  /** Only when the filer states it, as a percentage. Never derived. */
  | 'ebitda-margin'
  /** Basic earnings per share, in rupees per share. */
  | 'eps';

export const RESULTS_METRICS: readonly ResultsMetric[] = [
  'revenue',
  'total-income',
  'net-profit',
  'ebitda',
  'ebitda-margin',
  'eps',
];

/**
 * Order on the wire when a table offers more rows than a line can carry.
 *
 * Lower sorts first. Net profit leads because it is the number a results
 * headline is about; `total-income` is last of the monetary rows because it is
 * revenue plus other income and a reader who has the revenue line already has
 * most of it.
 */
export const RESULTS_METRIC_RANK: Readonly<Record<ResultsMetric, number>> = {
  'net-profit': 0,
  revenue: 1,
  ebitda: 2,
  'ebitda-margin': 3,
  eps: 4,
  'total-income': 5,
};

/** How a metric is spelled on the wire. */
export const RESULTS_METRIC_LABEL: Readonly<Record<ResultsMetric, string>> = {
  revenue: 'REVENUE',
  'total-income': 'TOTAL INCOME',
  'net-profit': 'NET PROFIT',
  ebitda: 'EBITDA',
  'ebitda-margin': 'EBITDA MARGIN',
  eps: 'EPS',
};

/**
 * Which of the two statements a figure was read from.
 *
 * ================================================================
 * THE SINGLE MOST DANGEROUS CONFUSION IN THIS WHOLE FEATURE
 * ================================================================
 *
 * A results PDF contains BOTH. Apollo Tyres' Q1 FY27 filing states consolidated
 * revenue of ₹73,977.90 million and standalone revenue of ₹54,618.69 million —
 * the same row label, the same column header, the same units, fourteen thousand
 * characters apart, differing by 35%. Publishing one under the other's name is
 * not a rounding error; it is a wrong number about a named listed company, which
 * is the class of harm this pipeline exists to refuse.
 *
 * So the basis is never inferred from the row. `results-basis.ts` reads it from
 * the statement heading that governs the table, the extractor is asked for it
 * independently, and a figure is published only when those two agree.
 */
export type ResultsBasis = 'consolidated' | 'standalone';

export const RESULTS_BASES: readonly ResultsBasis[] = [
  'consolidated',
  'standalone',
];

/** How a basis is spelled on the wire. Never abbreviated. See `results-line.ts`. */
export const RESULTS_BASIS_LABEL: Readonly<Record<ResultsBasis, string>> = {
  consolidated: 'CONSOLIDATED',
  standalone: 'STANDALONE',
};

/**
 * One results figure as the extractor proposed it. UNVERIFIED.
 *
 * `current` and `prior` are STRINGS, and deliberately not numbers. What is
 * published is the token the document prints, character for character —
 * `73,977.90`, `(4,191.73)`, `0.20` — because parsing to a float and printing it
 * back is a transformation that can silently drop a digit, and because the
 * verbatim gate compares text.
 */
export interface ProposedResultsFigure {
  readonly metric: ResultsMetric;
  /** The current period's value, exactly as the row prints it. */
  readonly current: string;
  /** The year-ago value, exactly as the row prints it. */
  readonly prior: string;
  /** The table row, quoted from the document. Must contain both values. */
  readonly span: string;
}

/**
 * A whole results block as proposed: one table, one basis, one header.
 *
 * ONE BLOCK RATHER THAN LOOSE FIGURES, and that shape is itself a control. Every
 * figure on a line must come from the SAME table, so the basis and the column
 * header are established once and every figure is checked against them. A schema
 * that let each figure carry its own basis would let one line mix a consolidated
 * revenue with a standalone profit and look perfectly well-formed.
 */
export interface ProposedResults {
  readonly basis: ResultsBasis;
  /**
   * The line of column period-end dates at the head of the table, quoted.
   *
   * This is what makes "VS ... (YOY)" checkable rather than asserted: the dates
   * say which column is the year-ago one, and `results-verify.ts` matches each
   * value's position in the row against each date's position in this header.
   */
  readonly columnsSpan: string;
  readonly figures: readonly ProposedResultsFigure[];
}

/** One figure that survived every check. Safe to publish. */
export interface VerifiedResultsFigure {
  readonly metric: ResultsMetric;
  /** The document's own bytes for the current value. */
  readonly current: string;
  /** The document's own bytes for the year-ago value. */
  readonly prior: string;
  /**
   * The unit token this figure is published in, derived from the document's own
   * declaration. `CR`, `LAKH`, `MN`, `BN`, `THOUSAND`, `%`, or `` for a
   * per-share figure. Never a rescaling of what the document printed.
   */
  readonly unit: string;
  /** The document's own bytes for the row this was read from. */
  readonly span: string;
}

/** A whole verified results block. Everything here is traceable to the source. */
export interface VerifiedResults {
  readonly basis: ResultsBasis;
  /** The document's own bytes at the statement heading that fixed the basis. */
  readonly basisSpan: string;
  /** The document's own bytes at the column header the periods came from. */
  readonly columnsSpan: string;
  /** Derived from the current column's date. `Q1 FY27`. */
  readonly period: string;
  /** Derived from the year-ago column's date. `Q1 FY26`. */
  readonly priorPeriod: string;
  readonly figures: readonly VerifiedResultsFigure[];
}

/** Why one proposed figure will not be published. */
export type ResultsFigureDiscardReason =
  /** The quoted row is not in the document. The hallucination catch. */
  | 'row-not-found'
  /** The quoted row does not carry this metric's label, or carries a rival's. */
  | 'label-mismatch'
  /** The current or the year-ago value is not in the quoted row. */
  | 'value-not-in-row'
  /** The row's value count does not match the header's column count. */
  | 'columns-not-aligned'
  /** A value appears more than once in the row, so its column is not knowable. */
  | 'value-ambiguous'
  /** The row is too far from the column header to belong to that table. */
  | 'row-outside-table'
  /** A per-share or percentage figure whose row declares no unit. */
  | 'unit-not-in-row'
  /**
   * The figure's grouping separators do not spell a number either convention
   * writes, so its value is not determinable.
   *
   * THE OCR HAZARD, AND THE INCUMBENT'S TOO. OCR reads a decimal point as a
   * comma — `1,48,388.57` arrives as `1,48,388,57`, every digit correct and the
   * separator wrong — and anything that strips commas then reads 14,838,857
   * instead of 148,388.57. `pdf-parse`'s column flattening produces the same
   * shape by welding cells together, at a measured 8.40% of comma-bearing
   * numbers. Both are refused here rather than published. See
   * `grouped-number.ts`.
   */
  | 'malformed-grouping'
  /** The same metric was already accepted. */
  | 'duplicate'
  /** Good, but the line was already full. */
  | 'over-limit';

/** A discarded figure, with enough to review the decision. */
export interface ResultsFigureDiscard {
  readonly reason: ResultsFigureDiscardReason;
  /** Which metric was proposed. */
  readonly metric: ResultsMetric;
  /** What was proposed, bounded. */
  readonly figure: string;
  /** Which rule fired, in words. */
  readonly detail: string;
}

/**
 * Why a filing carries no results line at all.
 *
 * The first five are about the lane; the rest are about the TABLE, and they are
 * kept apart from the per-figure discards because they refuse the whole block.
 * A document whose basis cannot be established has nothing publishable in it, no
 * matter how many rows the extractor found.
 */
export type ResultsRefusalReason =
  /** The cheap filters ruled the filing out before any model was called. */
  | 'not-eligible'
  /** The extractor was called and found no results table. */
  | 'no-results'
  /** No extractor is configured. */
  | 'extractor-unavailable'
  /** The extractor failed. Distinct from "it found nothing". */
  | 'extractor-error'
  /** Every figure the extractor proposed was discarded. */
  | 'all-discarded'
  /** The quoted column header is not in the document. */
  | 'columns-not-found'
  /**
   * The document's own statement heading does not agree that this table is the
   * basis the extractor said it was — or there is no heading close enough to
   * say. THE REFUSAL THAT MATTERS MOST. See `results-basis.ts`.
   */
  | 'basis-not-determinable'
  /** The column dates do not name a quarter this pipeline can label. */
  | 'period-not-derivable'
  /** A column date appears twice in the header, so the column is not knowable. */
  | 'period-ambiguous'
  /** The document states a quarter beside the table that contradicts the dates. */
  | 'period-conflict'
  /**
   * The column beside the current one is not the year-ago column.
   *
   * A BLOCK-LEVEL REFUSAL rather than a per-figure discard, because it is a
   * statement about the table: an Indian results statement prints the previous
   * quarter, the year-ago quarter and the full prior year side by side, and
   * reading the wrong one turns a flat quarter into a collapse. If the pair of
   * columns the figures were read across is not a year apart, nothing in that
   * table can be published as `(YOY)`.
   */
  | 'not-year-on-year'
  /** Two rows were read across different pairs of columns. */
  | 'columns-inconsistent'
  /** No scale declaration governs the table, or two disagree. */
  | 'unit-not-determinable';

/** Everything the results stage produced for one filing. */
export interface ResultsOutcome {
  /** Null when nothing survived, which is the ordinary case. */
  readonly results: VerifiedResults | null;
  /** The composed wire line, or null. */
  readonly line: string | null;
  readonly discards: readonly ResultsFigureDiscard[];
  /** How many figures the extractor proposed. Null when it was never called. */
  readonly proposed: number | null;
  readonly refusalReason: ResultsRefusalReason | null;
  readonly refusalDetail: string | null;
}

/** The outcome of a filing nothing was attempted on. */
export const NO_RESULTS: ResultsOutcome = {
  results: null,
  line: null,
  discards: [],
  proposed: null,
  refusalReason: null,
  refusalDetail: null,
};
