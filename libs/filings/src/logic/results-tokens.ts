/**
 * Reading a results table's two axes out of `pdf-parse` output.
 *
 * ================================================================
 * WHAT THE TEXT ACTUALLY LOOKS LIKE
 * ================================================================
 *
 * A SEBI Regulation 33 statement is a grid, and `pdf-parse` flattens a grid into
 * a stream. Apollo Tyres' Q1 FY27 consolidated statement arrives as:
 *
 *     ₹ Million
 *     30.06.202631.03.202630.06.202531.03.2026
 *     (UNAUDITED)
 *     ...
 *     Revenue from operations
 *     73,977.90
 *     73,356.74   65,607.59    2,84,706.00
 *
 * Two facts follow, and this module exists for both:
 *
 *   1. **The column dates run together with no separator.** `30.06.2026` and
 *      `31.03.2026` are printed in adjacent cells and arrive as one 40-character
 *      digit run. An unanchored scan reads them back correctly; anything that
 *      expects delimiters reads none of them.
 *   2. **The row's four values are in column order and nothing says so.** The
 *      ONLY thing tying `65,607.59` to the year-ago column is that it is third
 *      in the row and `30.06.2025` is third in the header. That correspondence is
 *      the whole basis on which this pipeline is allowed to print `VS ... (YOY)`,
 *      and `results-verify.ts` checks it rather than trusting the extractor.
 *
 * ================================================================
 * WHAT COUNTS AS A VALUE, AND WHY NOT EVERY NUMBER DOES
 * ================================================================
 *
 * The row also carries numbers that are not values: the serial number in
 * `11  Profit for the period / year (9 - 10)3,488.72 ...` contributes `11`, `9`
 * and `10`, and the EPS row's `(face value of ₹ 1 each)` contributes `1`. Read
 * naively, that row has seven numbers against the header's four dates and the
 * column correspondence is destroyed.
 *
 * So a VALUE is a number written the way a monetary cell is written: with
 * grouping commas, or with a decimal fraction of two to four places. Serial
 * numbers, formula references and face values are none of those. This is a
 * deliberate under-reader — a genuine value printed as a bare `500` is NOT
 * recognised, the row's count then disagrees with the header's, and the figure
 * is refused. That is the safe direction: a missed figure is invisible, a
 * misaligned one is a wrong number on a wire.
 */

/** One value cell, as the document prints it and where it sits in the row. */
export interface ValueToken {
  /** Exactly as written, parentheses and all: `(4,191.73)`, `73,977.90`. */
  readonly raw: string;
  /** Digits only, sign carried separately. The comparison key. */
  readonly canonical: string;
  /** True when the document wrapped it in accounting parentheses. */
  readonly negative: boolean;
}

/**
 * A date printed in a column header.
 *
 * `raw` is kept so a refusal can quote the header back; the parts are what the
 * period label is derived from.
 */
export interface ColumnDate {
  readonly raw: string;
  readonly day: number;
  /** 1-12. */
  readonly month: number;
  readonly year: number;
}

/**
 * A cell value: grouped digits, or a decimal fraction, optionally in accounting
 * parentheses or carrying a leading minus.
 *
 * The grouping branch comes first so `2,84,706.00` is read whole rather than as
 * `2` followed by fragments — a regex alternation is first-match, and Indian
 * grouping puts two digits in every group but the last.
 */
const VALUE_TOKEN =
  /\(\s*-?\d{1,3}(?:,\d{2,3})+(?:\.\d{1,4})?\s*\)|\(\s*-?\d+\.\d{2,4}\s*\)|-?\d{1,3}(?:,\d{2,3})+(?:\.\d{1,4})?|-?\d+\.\d{2,4}/g;

/**
 * Dates in a column header, in every spelling this corpus prints.
 *
 * `30.06.2026`, `30/06/2026`, `30-06-2026`, `June 30, 2026` and `30 June 2026`.
 * The numeric branch is unanchored on purpose — see the module comment — and the
 * two-digit day and month are required so a bare `2026.06` cannot be read as one.
 */
const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const NUMERIC_DATE = /(\d{2})[./-](\d{2})[./-](\d{4})/g;
const MONTH_NAMES = Object.keys(MONTHS).join('|');
const NAMED_DATE_DMY = new RegExp(
  String.raw`(\d{1,2})(?:st|nd|rd|th)?\s+(${MONTH_NAMES})[a-z]*\.?,?\s+(\d{4})`,
  'gi',
);
const NAMED_DATE_MDY = new RegExp(
  String.raw`(${MONTH_NAMES})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})`,
  'gi',
);

/**
 * A date anywhere in the text, in the same spellings, so value scanning can
 * remove them before it runs.
 *
 * Load-bearing rather than tidy: `30.06.2026` matches the decimal-fraction
 * branch of `VALUE_TOKEN` as `30.06`, so a row span that happens to carry its own
 * date would gain a phantom value and lose its column alignment.
 */
const ANY_DATE = new RegExp(
  [
    String.raw`\d{1,2}[./-]\d{1,2}[./-]\d{2,4}`,
    String.raw`\d{1,2}(?:st|nd|rd|th)?\s+(?:${MONTH_NAMES})[a-z]*\.?,?\s+\d{4}`,
    String.raw`(?:${MONTH_NAMES})[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}`,
  ].join('|'),
  'gi',
);

const canonicaliseValue = (raw: string): string =>
  raw.replace(/[(),\s]/g, '').replace(/^-/, '');

/**
 * Every value cell in a row, in the order the document prints them.
 *
 * Dates are struck out first, replaced by spaces of equal length so nothing
 * else shifts. NEVER THROWS; a row with no values returns an empty list, which
 * the caller refuses on.
 */
export function valueTokensIn(row: string): readonly ValueToken[] {
  const masked = row.replace(ANY_DATE, (match) => ' '.repeat(match.length));
  return (masked.match(VALUE_TOKEN) ?? []).map((raw) => ({
    raw: raw.trim(),
    canonical: canonicaliseValue(raw),
    negative:
      raw.trimStart().startsWith('(') || raw.trimStart().startsWith('-'),
  }));
}

/**
 * The comparison key for a figure the extractor proposed.
 *
 * Commas, spaces and accounting parentheses removed; the sign is compared
 * separately, so a claim that dropped a loss's parentheses does not match the
 * document's own token. Nothing else is normalised — no rescaling, no rounding —
 * for the reason `claim-numbers.ts` gives at length: `10,000 Cr` and
 * `100 billion` are the same money and not the same evidence.
 */
export const canonicalValue = (raw: string): string => canonicaliseValue(raw);

/** Whether a proposed figure is written as a negative. */
export const isNegativeValue = (raw: string): boolean => {
  const trimmed = raw.trim();
  return trimmed.startsWith('(') || trimmed.startsWith('-');
};

const pushDate = (
  into: Map<number, ColumnDate>,
  index: number,
  raw: string,
  day: number,
  month: number,
  year: number,
): void => {
  if (day < 1 || day > 31 || month < 1 || month > 12) return;
  into.set(index, { raw, day, month, year });
};

/**
 * Every column date in a header, in the order printed.
 *
 * Keyed by position so the three spellings cannot produce a list out of order,
 * and so an overlapping match — `June 30, 2026` found by both named branches —
 * is counted once.
 *
 * NEVER THROWS. A header with no dates returns an empty list.
 */
export function columnDatesIn(header: string): readonly ColumnDate[] {
  const found = new Map<number, ColumnDate>();

  for (const match of header.matchAll(NUMERIC_DATE)) {
    pushDate(
      found,
      match.index,
      match[0],
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
    );
  }
  for (const match of header.matchAll(NAMED_DATE_DMY)) {
    pushDate(
      found,
      match.index,
      match[0],
      Number(match[1]),
      MONTHS[match[2].slice(0, 3).toLowerCase()],
      Number(match[3]),
    );
  }
  for (const match of header.matchAll(NAMED_DATE_MDY)) {
    pushDate(
      found,
      match.index,
      match[0],
      Number(match[2]),
      MONTHS[match[1].slice(0, 3).toLowerCase()],
      Number(match[3]),
    );
  }

  return [...found.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, date]) => date);
}

/** Whether two column dates are the same calendar day. */
export const sameDay = (left: ColumnDate, right: ColumnDate): boolean =>
  left.day === right.day && left.month === right.month;

/** Whether `prior` is exactly one year before `current`. */
export const isYearBefore = (current: ColumnDate, prior: ColumnDate): boolean =>
  sameDay(current, prior) && current.year - prior.year === 1;
