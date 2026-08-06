import { RESULTS_METRICS, type ResultsMetric } from './results.types';

/**
 * Proving that the row a figure was read from is the row it was labelled as.
 *
 * ================================================================
 * WHY A LABEL CHECK IS NOT PEDANTRY
 * ================================================================
 *
 * A Regulation 33 statement stacks a dozen rows with the same shape and very
 * different meanings. Apollo Tyres' consolidated statement prints, one under the
 * other: `Profit before share of profit in associate ... and tax` 4,440.95;
 * `Profit before exceptional items and tax` 4,441.57; `Profit before tax`
 * 4,676.93; and `Profit for the period` 3,488.72. Every one of those is a
 * "profit", every one is verbatim in the document, and only the last is the net
 * profit a wire means.
 *
 * The verbatim gate cannot tell them apart — all four rows are genuinely in the
 * document. So the metric is checked against the row's own label: a positive
 * pattern the row must match, and a disqualifying pattern it must not. Both are
 * required, because a positive test alone admits `Profit before tax` to
 * `net-profit` on the word "profit".
 *
 * ================================================================
 * EBITDA IS ONLY EVER READ, NEVER COMPUTED
 * ================================================================
 *
 * A Regulation 33 statement does not carry an EBITDA row. The competitor
 * published `Q1 EBITDA 8.68B RUPEES VS 8.68B (YOY) || Q1 EBITDA MARGIN 11.73% VS
 * 13.32% (YOY)` for the Apollo filing, and both figures are arithmetic over the
 * table: revenue less expenses, with finance costs and depreciation added back.
 * The current-quarter margin reconciles; the year-ago one does not — 8.68B over
 * 65.61B is 13.23%, not 13.32%. Two digits are transposed, and nothing in that
 * line says it was calculated rather than read, so nothing downstream could
 * catch it.
 *
 * That is the entire argument for this pipeline's rule. EBITDA is emitted only
 * when the filer prints the word beside the number — which happens in press
 * releases and investor presentations, and does not happen in a statutory
 * statement. On a filing that does not state it, this pipeline emits no EBITDA
 * line at all, and that is the correct output.
 */

interface MetricLabelRule {
  /** The row must match this. */
  readonly requires: RegExp;
  /** And must NOT match this. Absent when the positive test is the whole rule. */
  readonly excludes?: RegExp;
}

const RULES: Readonly<Record<ResultsMetric, MetricLabelRule>> = {
  revenue: {
    requires: /revenue from operations|net sales|income from operations/i,
    excludes: /segment|total income|deferred|per\s*share/i,
  },
  'total-income': {
    requires: /total income|total revenue\b/i,
    excludes: /segment|per\s*share/i,
  },
  'net-profit': {
    requires:
      /(?:profit|loss)[^.]{0,40}?for the (?:period|quarter|year)|net profit|profit after tax|\bPAT\b/i,
    excludes:
      /before tax|before exceptional|before share|before interest|non-?controlling|comprehensive|segment|per\s*share/i,
  },
  ebitda: {
    requires: /\bEBITDA\b/i,
    excludes: /margin|%/i,
  },
  // No `excludes`: the pattern already requires both words, which no other row
  // of a results statement carries, so there is nothing left to disqualify.
  'ebitda-margin': {
    requires:
      /\bEBITDA\b[^A-Za-z0-9]{0,12}margins?\b|margins?\b[^A-Za-z0-9]{0,12}\bEBITDA\b/i,
  },
  eps: {
    requires: /earnings per (?:equity )?share|\bEPS\b/i,
    excludes: /segment/i,
  },
};

/**
 * Rows that must also carry a qualifier, over and above matching their metric.
 *
 * EPS is printed twice — basic and diluted — from one parent label, and a wire
 * line reading `EPS ₹5.52` means the basic one. Requiring the word rather than
 * assuming it is what stops a quoted `(b) Diluted (₹) 5.52` becoming an
 * unqualified EPS.
 */
const QUALIFIERS: Partial<Readonly<Record<ResultsMetric, RegExp>>> = {
  eps: /\bbasic\b/i,
};

/**
 * Whether a quoted row genuinely carries this metric's label.
 *
 * Returns the rule that refused, or null when the row qualifies — so a discard
 * can say which half of the test failed rather than merely that one did.
 */
export function metricLabelRefusal(
  metric: ResultsMetric,
  row: string,
): string | null {
  const rule = RULES[metric];
  if (!rule.requires.test(row)) {
    return `the quoted row does not carry a ${metric} label`;
  }
  if (rule.excludes !== undefined && rule.excludes.test(row)) {
    return `the quoted row is a different line of the statement`;
  }
  const qualifier = QUALIFIERS[metric];
  if (qualifier !== undefined && !qualifier.test(row)) {
    return `the quoted row does not say which ${metric} figure it is`;
  }
  return null;
}

/** Whether a value is one of the metrics this pipeline reads. */
export const isResultsMetric = (value: unknown): value is ResultsMetric =>
  typeof value === 'string' &&
  (RESULTS_METRICS as readonly string[]).includes(value);
