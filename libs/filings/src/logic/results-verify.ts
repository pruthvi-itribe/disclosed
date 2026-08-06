import { findVerbatimSpan } from './claim-span';
import { malformedGroupingIn } from './grouped-number';
import { BASIS_HEADING_REACH, governingBasis } from './results-basis';
import { metricLabelRefusal } from './results-metric';
import {
  conflictingQuarter,
  periodForColumnDate,
  type ResultsPeriod,
} from './results-period';
import {
  canonicalValue,
  columnDatesIn,
  isNegativeValue,
  isYearBefore,
  valueTokensIn,
  type ColumnDate,
  type ValueToken,
} from './results-tokens';
import {
  governingScale,
  ROW_CURRENCY,
  ROW_PERCENT,
  ROW_SCOPED_UNIT_METRICS,
} from './results-unit';
import {
  RESULTS_METRIC_RANK,
  type ProposedResults,
  type ProposedResultsFigure,
  type ResultsFigureDiscard,
  type ResultsFigureDiscardReason,
  type ResultsMetric,
  type ResultsRefusalReason,
  type VerifiedResults,
  type VerifiedResultsFigure,
} from './results.types';

/**
 * The results gate. Nothing reaches the wire that does not pass every check here.
 *
 * ================================================================
 * WHAT IS BEING DEFENDED AGAINST, AND WHY THE CLAIM GATE IS NOT ENOUGH
 * ================================================================
 *
 * The claim gate asks one question — is this sentence in the document? — and
 * that is sufficient for a claim, because a claim IS a sentence. A results
 * figure is not. It is a cell, and a cell is meaningless without three other
 * facts none of which are inside it:
 *
 *   - **which statement** the table belongs to. `results-basis.ts`.
 *   - **what the columns mean.** The row `73,977.90 73,356.74 65,607.59
 *     2,84,706.00` states this quarter, last quarter, the year-ago quarter and
 *     the prior full year. Printing the second as `(YOY)` turns +12.8% growth
 *     into +0.8%, and the sentence is still verbatim.
 *   - **what scale the table is in.** `results-unit.ts`.
 *
 * Every one of those is established from the document and then required to agree
 * with what the extractor said. Nothing is taken on the extractor's word, and
 * every disagreement refuses.
 *
 * ================================================================
 * THE ORDER OF THE CHECKS IS PART OF THE DESIGN
 * ================================================================
 *
 * The table's own properties are settled FIRST, over the whole block, and a
 * failure there refuses everything — because a block whose basis, columns or
 * scale cannot be established has nothing publishable in it however many rows
 * were quoted correctly. Only then is each row checked, and only then are the
 * surviving rows required to agree with each other about which columns they were
 * read across.
 */

/** The most figures one results line may carry. */
export const MAX_RESULTS_FIGURES = 5;

/**
 * How far below its column header a row may sit and still be in that table.
 *
 * 8,000 characters. The longest statutory statement measured runs 3,220
 * characters from its column-date line to its last row (Apollo Tyres'
 * consolidated statement, seventeen numbered rows plus a comprehensive-income
 * block), so 8,000 leaves 2.5x of headroom. It still refuses the case that
 * matters: in that same document the consolidated column header and the
 * standalone statement's rows are 14,400 characters apart, so a standalone row
 * can never be read under a consolidated header.
 */
export const RESULTS_TABLE_REACH = 8_000;

/** How much of a rejected figure is kept, and how much of the reason. */
export const MAX_DISCARDED_FIGURE_CHARS = 80;
export const MAX_RESULTS_DETAIL_CHARS = 200;

const CONTROL_CHARACTERS = /[\r\n\t]/g;

const bounded = (value: string, limit: number): string =>
  value.replace(CONTROL_CHARACTERS, ' ').trim().slice(0, limit);

const discard = (
  reason: ResultsFigureDiscardReason,
  metric: ResultsMetric,
  figure: string,
  detail: string,
): ResultsFigureDiscard => ({
  reason,
  metric,
  figure: bounded(figure, MAX_DISCARDED_FIGURE_CHARS),
  detail: bounded(detail, MAX_RESULTS_DETAIL_CHARS),
});

export interface ResultsVerificationInput {
  readonly documentText: string;
  readonly proposed: ProposedResults;
  readonly maxFigures?: number;
  /**
   * How far above its column header a statement heading may sit.
   *
   * A PARAMETER BECAUSE IT IS A PROPERTY OF THE PARSER, not of filings. 400 is
   * measured against `pdf-parse`'s output and 2,400 against Docling's, which
   * emits markdown and so puts the same real heading physically further from
   * the same real table. Defaulted to the `pdf-parse` value so every existing
   * caller keeps the bound it was measured with; the worker passes the one that
   * matches the route that actually produced the text. See
   * `basisReachFor` in `pdf/parse-route.ts`.
   */
  readonly basisReach?: number;
}

export type ResultsVerification =
  | {
      readonly outcome: 'ok';
      readonly results: VerifiedResults;
      readonly discards: readonly ResultsFigureDiscard[];
    }
  | {
      readonly outcome: 'refused';
      readonly reason: ResultsRefusalReason;
      readonly detail: string;
      readonly discards: readonly ResultsFigureDiscard[];
    };

const refuse = (
  reason: ResultsRefusalReason,
  detail: string,
  discards: readonly ResultsFigureDiscard[] = [],
): ResultsVerification => ({
  outcome: 'refused',
  reason,
  detail: bounded(detail, MAX_RESULTS_DETAIL_CHARS),
  discards,
});

/** One row that made it as far as having a column pair. */
interface ResolvedRow {
  readonly figure: ProposedResultsFigure;
  /** The document's own bytes for the row. */
  readonly evidence: string;
  readonly tokens: readonly ValueToken[];
  /** Index of the current value among the row's cells, and of the year-ago one. */
  readonly currentIndex: number;
  readonly priorIndex: number;
}

/**
 * Where a value sits among a row's cells, or why it cannot be placed.
 *
 * A value that appears twice in one row has no knowable column. That is not
 * pedantry: a statement row reading `- - 26.61 -` repeats its sentinel, and a
 * row whose figure genuinely repeats across two quarters cannot say which of
 * them the extractor meant.
 */
type Placement =
  | { readonly outcome: 'ok'; readonly index: number }
  | { readonly outcome: 'missing' }
  | { readonly outcome: 'ambiguous' };

function placeValue(
  tokens: readonly ValueToken[],
  proposed: string,
): Placement {
  const wanted = canonicalValue(proposed);
  const negative = isNegativeValue(proposed);
  const hits: number[] = [];
  tokens.forEach((token, index) => {
    if (token.canonical === wanted && token.negative === negative) {
      hits.push(index);
    }
  });
  if (hits.length === 0) return { outcome: 'missing' };
  if (hits.length > 1) return { outcome: 'ambiguous' };
  return { outcome: 'ok', index: hits[0] };
}

/**
 * Turns one placement failure into the discard that names it.
 *
 * Shared by the current and the year-ago value rather than looped over, so the
 * narrowing that follows is real rather than asserted.
 */
const placementDiscard = (
  placement: Exclude<Placement, { readonly outcome: 'ok' }>,
  figure: ProposedResultsFigure,
  which: string,
  value: string,
): ResultsFigureDiscard =>
  placement.outcome === 'missing'
    ? discard(
        'value-not-in-row',
        figure.metric,
        figure.span,
        `the ${which} value ${value} is not in the quoted row`,
      )
    : discard(
        'value-ambiguous',
        figure.metric,
        figure.span,
        `the ${which} value ${value} appears more than once in the row, so ` +
          'its column is not knowable',
      );

/** Checks one row against the document, or says which rule refused it. */
function resolveRow(
  figure: ProposedResultsFigure,
  documentText: string,
  columnsOffset: number,
  columnsLength: number,
  columnCount: number,
): ResolvedRow | ResultsFigureDiscard {
  const match = findVerbatimSpan(documentText, figure.span);
  if (match === null) {
    return discard(
      'row-not-found',
      figure.metric,
      figure.span,
      `the quoted row is not in the document: "${figure.span}"`,
    );
  }

  // The row must be inside the table whose header was quoted. Without this a
  // consolidated header and a standalone row make a well-formed, verifiable,
  // completely wrong line.
  const below = match.offset - (columnsOffset + columnsLength);
  if (match.offset < columnsOffset || below > RESULTS_TABLE_REACH) {
    return discard(
      'row-outside-table',
      figure.metric,
      figure.span,
      `the row is ${match.offset - columnsOffset} characters from the column ` +
        `header, which is outside the ${RESULTS_TABLE_REACH} a table spans`,
    );
  }

  const labelRefusal = metricLabelRefusal(figure.metric, match.evidence);
  if (labelRefusal !== null) {
    return discard('label-mismatch', figure.metric, figure.span, labelRefusal);
  }

  // BEFORE the value is placed in a column, because a figure whose grouping
  // cannot be read has no value to place. `1,48,388,57` is what OCR makes of
  // `1,48,388.57`; every digit is right, the separator is wrong, and a reader
  // that strips commas gets a hundredfold error in the silent direction.
  // Checked against the PROPOSED tokens, which is where such a figure enters —
  // the extractor is reading the same damaged text.
  const malformed = malformedGroupingIn([figure.current, figure.prior]);
  if (malformed !== null) {
    return discard(
      'malformed-grouping',
      figure.metric,
      figure.span,
      `"${malformed}" is not grouped the way either Indian or international ` +
        'convention writes a number, so its value is not determinable',
    );
  }

  const tokens = valueTokensIn(match.evidence);
  if (tokens.length !== columnCount) {
    return discard(
      'columns-not-aligned',
      figure.metric,
      figure.span,
      `the row states ${tokens.length} value(s) against the header's ` +
        `${columnCount} column(s), so no value can be placed in a column`,
    );
  }

  const current = placeValue(tokens, figure.current);
  if (current.outcome !== 'ok') {
    return placementDiscard(current, figure, 'current', figure.current);
  }
  const prior = placeValue(tokens, figure.prior);
  if (prior.outcome !== 'ok') {
    return placementDiscard(prior, figure, 'year-ago', figure.prior);
  }

  return {
    figure,
    evidence: match.evidence,
    tokens,
    currentIndex: current.index,
    priorIndex: prior.index,
  };
}

const isDiscard = (
  value: ResolvedRow | ResultsFigureDiscard,
): value is ResultsFigureDiscard => 'reason' in value;

const sameDate = (left: ColumnDate, right: ColumnDate): boolean =>
  left.day === right.day &&
  left.month === right.month &&
  left.year === right.year;

const occurrences = (dates: readonly ColumnDate[], date: ColumnDate): number =>
  dates.filter((candidate) => sameDate(candidate, date)).length;

/** How a figure's value is rendered, given the unit token it carries. */
export const renderResultsValue = (raw: string, unit: string): string => {
  const negative = isNegativeValue(raw);
  const digits = raw.replace(/[()\s]/g, '').replace(/^-/, '');
  const sign = negative ? '-' : '';
  if (unit === '%') return `${sign}${digits}%`;
  if (unit === '') return `${sign}₹${digits}`;
  return `${sign}₹${digits} ${unit}`;
};

/**
 * The unit a figure is published in, or why it has none.
 *
 * EPS and margin take theirs from their own row rather than from the table's
 * scale header — a statement in millions still prints earnings per share in
 * rupees per share — so a row that declares no unit is refused rather than
 * inheriting one that does not apply to it.
 */
function unitFor(
  metric: ResultsMetric,
  row: string,
  tableScale: string,
):
  | { readonly outcome: 'ok'; readonly unit: string }
  | { readonly outcome: 'none' } {
  if (!ROW_SCOPED_UNIT_METRICS.has(metric)) {
    return { outcome: 'ok', unit: tableScale };
  }
  if (metric === 'ebitda-margin') {
    return ROW_PERCENT.test(row)
      ? { outcome: 'ok', unit: '%' }
      : { outcome: 'none' };
  }
  return ROW_CURRENCY.test(row)
    ? { outcome: 'ok', unit: '' }
    : { outcome: 'none' };
}

/**
 * Verifies a whole results block against the document it claims to come from.
 *
 * NEVER THROWS and never partially accepts. Either a block of figures every one
 * of which is traceable to a quoted row in a table whose basis, columns and
 * scale the document itself states — or a refusal with the reason.
 */
export function verifyResults(
  input: ResultsVerificationInput,
): ResultsVerification {
  const { documentText, proposed } = input;
  const limit = input.maxFigures ?? MAX_RESULTS_FIGURES;

  // --- the table's own properties, settled once ------------------------------

  const header = findVerbatimSpan(documentText, proposed.columnsSpan);
  if (header === null) {
    return refuse(
      'columns-not-found',
      `the quoted column header is not in the document: "${proposed.columnsSpan}"`,
    );
  }

  const dates = columnDatesIn(header.evidence);
  if (dates.length < 2) {
    return refuse(
      'period-not-derivable',
      `the quoted column header states ${dates.length} period-end date(s), ` +
        'so no column can be identified',
    );
  }

  const basis = governingBasis(
    documentText,
    header.offset,
    input.basisReach ?? BASIS_HEADING_REACH,
  );
  if (basis.outcome === 'none') {
    return refuse('basis-not-determinable', basis.detail);
  }
  if (basis.basis !== proposed.basis) {
    return refuse(
      'basis-not-determinable',
      `the extractor read this table as ${proposed.basis} and the statement ` +
        `heading above it says ${basis.basis}: "${basis.evidence}"`,
    );
  }

  const scale = governingScale(
    documentText,
    header.offset,
    header.evidence.length,
  );
  if (scale.outcome === 'none') {
    return refuse('unit-not-determinable', scale.detail);
  }

  // --- each row --------------------------------------------------------------

  const discards: ResultsFigureDiscard[] = [];
  const resolved: ResolvedRow[] = [];
  for (const figure of proposed.figures) {
    const row = resolveRow(
      figure,
      documentText,
      header.offset,
      header.evidence.length,
      dates.length,
    );
    if (isDiscard(row)) discards.push(row);
    else resolved.push(row);
  }

  if (resolved.length === 0) {
    return refuse(
      'all-discarded',
      `all ${proposed.figures.length} proposed figure(s) were refused`,
      discards,
    );
  }

  // --- the columns the rows were read across, agreed and checked -------------

  const pair = {
    current: resolved[0].currentIndex,
    prior: resolved[0].priorIndex,
  };
  const disagreeing = resolved.find(
    (row) => row.currentIndex !== pair.current || row.priorIndex !== pair.prior,
  );
  if (disagreeing !== undefined) {
    return refuse(
      'columns-inconsistent',
      `one row was read across columns ${pair.current + 1} and ` +
        `${pair.prior + 1} and another across ${disagreeing.currentIndex + 1} ` +
        `and ${disagreeing.priorIndex + 1}`,
      discards,
    );
  }

  const currentDate = dates[pair.current];
  const priorDate = dates[pair.prior];
  if (
    occurrences(dates, currentDate) > 1 ||
    occurrences(dates, priorDate) > 1
  ) {
    return refuse(
      'period-ambiguous',
      `the column header repeats ${currentDate.raw} or ${priorDate.raw}, so ` +
        'which column a value sits in does not say which period it is',
      discards,
    );
  }

  if (!isYearBefore(currentDate, priorDate)) {
    return refuse(
      'not-year-on-year',
      `the column beside ${currentDate.raw} is ${priorDate.raw}, which is not ` +
        'the year-ago period',
      discards,
    );
  }

  const period = periodForColumnDate(currentDate);
  const priorPeriod = periodForColumnDate(priorDate);
  if (period === null || priorPeriod === null) {
    return refuse(
      'period-not-derivable',
      `${currentDate.raw} does not close a statutory quarter, so this ` +
        'pipeline cannot say which quarter it is',
      discards,
    );
  }

  const conflict = conflictingQuarter(
    documentText,
    header.offset,
    header.evidence.length,
    period,
  );
  if (conflict !== null) {
    return refuse(
      'period-conflict',
      `the column dates make this ${period.label} and the document writes ` +
        `"${conflict}" beside the table`,
      discards,
    );
  }

  // --- units, duplicates, ranking, limit -------------------------------------

  const accepted: VerifiedResultsFigure[] = [];
  const seen = new Set<ResultsMetric>();
  for (const row of resolved) {
    // THE SECOND HALF OF THE GROUPING GUARD, and it is not redundant with the
    // one in `resolveRow`. What gets published is the DOCUMENT'S token, not the
    // proposed one, and the two only have to agree once commas are stripped —
    // so a model proposing a well-formed `14,838,857` matches a document
    // printing the OCR-damaged `1,48,388,57`, and without this the damaged form
    // is what reaches the wire.
    const published = malformedGroupingIn([
      row.tokens[pair.current].raw,
      row.tokens[pair.prior].raw,
    ]);
    if (published !== null) {
      discards.push(
        discard(
          'malformed-grouping',
          row.figure.metric,
          row.figure.span,
          `the document prints "${published}", which is not grouped the way ` +
            'either convention writes a number',
        ),
      );
      continue;
    }

    const unit = unitFor(row.figure.metric, row.evidence, scale.token);
    if (unit.outcome === 'none') {
      discards.push(
        discard(
          'unit-not-in-row',
          row.figure.metric,
          row.figure.span,
          "the quoted row declares no unit of its own, and the table's scale " +
            'does not govern this line',
        ),
      );
      continue;
    }
    if (seen.has(row.figure.metric)) {
      discards.push(
        discard(
          'duplicate',
          row.figure.metric,
          row.figure.span,
          'the same metric was already accepted',
        ),
      );
      continue;
    }
    seen.add(row.figure.metric);
    accepted.push({
      metric: row.figure.metric,
      current: row.tokens[pair.current].raw,
      prior: row.tokens[pair.prior].raw,
      unit: unit.unit,
      span: row.evidence,
    });
  }

  if (accepted.length === 0) {
    return refuse(
      'all-discarded',
      `all ${proposed.figures.length} proposed figure(s) were refused`,
      discards,
    );
  }

  const ranked = [...accepted].sort(
    (left, right) =>
      RESULTS_METRIC_RANK[left.metric] - RESULTS_METRIC_RANK[right.metric],
  );

  return {
    outcome: 'ok',
    results: {
      basis: basis.basis,
      basisSpan: basis.evidence,
      columnsSpan: header.evidence,
      period: period.label,
      priorPeriod: priorPeriod.label,
      figures: ranked.slice(0, limit),
    },
    discards: [
      ...discards,
      ...ranked
        .slice(limit)
        .map((figure) =>
          discard(
            'over-limit',
            figure.metric,
            figure.span,
            `the line already carries ${limit} figure(s)`,
          ),
        ),
    ],
  };
}

/** Re-exported so a caller can render a stored figure without the gate. */
export type { ResultsPeriod };
