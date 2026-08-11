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
 * ================================================================
 * WHAT A DATE LOOKS LIKE AFTER DOCLING HAS BEEN THROUGH IT
 * ================================================================
 *
 * For as long as this pipeline read `pdf-parse` output, five spellings were the
 * whole world: `30.06.2026`, `30/06/2026`, `30-06-2026`, `June 30, 2026` and
 * `30 June 2026`. Docling reads the same PDFs through a layout model, and the
 * spellings it emits are the printed page's, not that tidy set — it drops the
 * space beside a punctuation mark, keeps the two-digit year the filer typed, and
 * splits a day from its own ordinal suffix.
 *
 * MEASURED, over the 137 Docling-routed results filings of the `npm run
 * tiers:measure` sweep, counting cells in the header block of every statement
 * table (six rows or more, two value columns or more). Each row is a spelling
 * the document names a column with and `columnDatesIn` returned nothing for:
 *
 *     30-Jun-26      dashed, two-digit year         180 cells   14 filings
 *     June 30,2026   no space after the comma        21          7
 *     30.Jun-26      dotted day, dashed year          8          2
 *     31-Mar26       no separator before the year     8          2
 *     30 th June 2026  the ordinal is detached        8          3
 *     March 31 , 2026  a space before the comma       4          2
 *     30Jun26        no separator anywhere            2          1
 *     June30, 2025   no space after the month         2          2
 *     31.3.2026      a one-digit month                2          1
 *     June 30. 2026  a dot for the comma              1          1
 *
 * plus LINDEINDIA 106737549 in `__fixtures__/results-header-corpus.json`, whose
 * consolidated statement prints `30june 2026` and `30June 2025` — no space at
 * all between the day and the month name — in a one-row four-date header. That
 * filing is why this was found: its four-value rows met a two-date header and
 * every figure in it was discarded as `columns-not-aligned`.
 *
 * Those are the spellings read below. FOUR MORE ARE REFUSED, and the refusal is
 * the finding, not an omission:
 *
 *   - **A month and a year with no day** — `March 2026`, `Jun-26`, 11 cells in
 *     4 filings. Which day the period ended is the filer's to state.
 *   - **A month and a day with the year in another row** — `June 30` over
 *     `2026`, 16 cells in 1 filing (106728262). Binding them needs a column
 *     model, and that row states four years, not one.
 *   - **A digit run** — `3006 2026`, `31032026`, `300672026`, 7 cells in 1
 *     filing (106727461), which prints the first three in ONE header row. The
 *     run is not a fixed width, so no split is determined by the text.
 *   - **A damaged year** — `30/06/202S`, `30.06.202`, 6 cells in 4 filings.
 *
 * ================================================================
 * A TWO-DIGIT YEAR, AND THE ONLY RULE THAT MAKES ONE SAFE
 * ================================================================
 *
 * `30-Jun-26` is 30 June 2026. It resolves as `2000 + 26` and the same bound
 * governs a four-digit year: a column date's year must be 2000-2099, or it is
 * not read at all.
 *
 * WHY THAT IS NOT A GUESS. Section 2(41) of the Companies Act 2013 has required
 * an Indian company's financial year to end on 31 March since 2014, and this
 * pipeline reads filings as they are published; a period end in the 1900s cannot
 * appear in a column of one. The sweep agrees: the only two-digit years in
 * 137 documents are 26 (164 occurrences) and 25 (55), which are the year of
 * these filings and the year before it. Where a two-digit year would be genuinely
 * ambiguous the shape is refused instead — see the all-numeric case below.
 *
 * AND THE CENTURY BOUND EARNS ITS KEEP ON FOUR-DIGIT YEARS TOO. 106729290
 * prints `30-06-21126`; the unanchored numeric scan reads `30-06-2112` out of
 * that, a well-formed date the document does not state. The bound is what
 * refuses it, and it has to be the bound rather than a "no digit after the year"
 * guard, because run-together dates — `30.06.202631.03.2026`, the shape this
 * whole module exists for — put a digit right after every year but the last.
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

/**
 * The gap between a day, the month beside it and the year beside that.
 *
 * AT MOST ONE PUNCTUATION MARK WITH AT MOST ONE SPACE EITHER SIDE, and never a
 * newline. Every width in the table above fits: none (`30june`), one space
 * (`30 June`), one mark (`30-Jun`, `30.Jun`), or a space and a mark (`31 -Mar`,
 * `30th .June`).
 *
 * BOUNDED RATHER THAN `\s*`, because an unbounded gap is a wrong date and not
 * merely a missed one. One sweep cell prints `-27/` and then 120 spaces and then
 * `August 05, 2026`; with `\s*` and a two-digit year that reads as 27 August
 * 2005. No date inside a markdown table cell in the whole sweep has a gap wider
 * than one space — measured, zero cells — so nothing real is given up. The
 * `/` a slashed numeric date uses is deliberately absent: `30/Jun/2026` is a
 * spelling this corpus never prints (zero cells) and dropping it removes the
 * separator that made that 120-space run reachable.
 */
const DATE_GAP = String.raw`[ \t]?[.\-]?[ \t]?`;

/**
 * The all-numeric spelling. One or two digits of day and of month, and a
 * four-digit year.
 *
 * UNANCHORED on purpose — see the module comment — which is why the day and
 * month were pinned at two digits until now. Widening them to one reads
 * `31.3.2026` (2 cells, 1 filing) and `1-4-2026`; the four-digit year is what
 * keeps the widening safe, since it is the only thing separating a date from the
 * `9.32.99` and `4.8.55` an OCR pass makes of a damaged value.
 *
 * THE YEAR IS NOT ALLOWED TO BE TWO DIGITS HERE, and that is measured rather
 * than cautious: `DD.MM.YY` names ZERO columns in 137 documents, and the same
 * corpus writes phone numbers (`+91-22-25`), circular and CIN references
 * (`/26-27/47`, `/49/14/14`) and damaged values (`9.32.99`, `4-1.65`) in exactly
 * that shape. A month NAME is what makes a two-digit year readable; without one
 * there is nothing to tell a date from a fragment.
 */
const NUMERIC_DATE = /(\d{1,2})[./-](\d{1,2})[./-](\d{4})/g;

const MONTH_NAMES = Object.keys(MONTHS).join('|');

/**
 * Day first, then the month name: `30 June 2026`, `30-Jun-26`, `30june 2026`.
 *
 * The day may NOT be preceded by a digit, so `111 August 2026` (106730901) is
 * refused rather than read as the 11th — with the separators optional, a day
 * taken from the tail of a longer number is a column the document never stated.
 * The year may not be followed by one, for the same reason in the other
 * direction; a named date never runs together with the next, so unlike the
 * numeric branch this one can afford the guard.
 */
const NAMED_DATE_DMY = new RegExp(
  String.raw`(?<!\d)(\d{1,2})[ \t]?(?:st|nd|rd|th)?${DATE_GAP}(${MONTH_NAMES})` +
    String.raw`[a-z]*\.?,?${DATE_GAP}(\d{4}|\d{2})(?!\d)`,
  'gi',
);

/**
 * Month name first: `June 30, 2026`, `June 30,2026`, `June30, 2025`.
 *
 * THE SEPARATOR BEFORE THE YEAR IS THE ONE THING THAT STAYS MANDATORY, and it
 * is what lets the one before the day become optional. `May 2026` and
 * `March 2026` are header cells in this corpus (11 of them); with both gaps
 * optional they would read as the 20th of May and the 20th of March, which is a
 * period end invented out of a year. Requiring a comma, a dot or a space
 * between the day and the year refuses both and still reads every spelling the
 * sweep prints.
 *
 * The year stays four digits: no `June 30, 26` appears in the sweep, and adding
 * it would put this branch back in reach of `May 2026`.
 */
const NAMED_DATE_MDY = new RegExp(
  String.raw`(${MONTH_NAMES})[a-z]*\.?[ \t]?(\d{1,2})(?:st|nd|rd|th)?` +
    String.raw`(?:[ \t]?[,.][ \t]?|[ \t])(\d{4})`,
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

/** The century a column date is allowed to sit in. See the module comment. */
const CENTURY_FIRST_YEAR = 2000;
const CENTURY_LAST_YEAR = CENTURY_FIRST_YEAR + 99;

/** `2026` as written, `26` resolved into this century. */
const yearFrom = (written: string): number =>
  written.length === 2 ? CENTURY_FIRST_YEAR + Number(written) : Number(written);

const pushDate = (
  into: Map<number, ColumnDate>,
  index: number,
  raw: string,
  day: number,
  month: number,
  year: number,
): void => {
  if (day < 1 || day > 31 || month < 1 || month > 12) return;
  if (year < CENTURY_FIRST_YEAR || year > CENTURY_LAST_YEAR) return;
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
      yearFrom(match[3]),
    );
  }
  for (const match of header.matchAll(NAMED_DATE_DMY)) {
    pushDate(
      found,
      match.index,
      match[0],
      Number(match[1]),
      MONTHS[match[2].slice(0, 3).toLowerCase()],
      yearFrom(match[3]),
    );
  }
  for (const match of header.matchAll(NAMED_DATE_MDY)) {
    pushDate(
      found,
      match.index,
      match[0],
      Number(match[2]),
      MONTHS[match[1].slice(0, 3).toLowerCase()],
      yearFrom(match[3]),
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
