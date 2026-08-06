/**
 * The rupee figure scanner.
 *
 * Indian filings write the same amount in three shapes, and a parser that
 * handles only the first finds the number in well under half of them:
 *
 *   1. figure + unit word      `Rs. 78.24 Crore`, `₹2 lakh crore`
 *   2. figure + no unit word   `Rs. 18,53,66,820/-`, `INR 1,23,45,678`
 *   3. either of the above, with OCR-inserted spaces around the punctuation:
 *      `Rs . 847 Crore` (a bilingual PSU scan), `Rs.\n18,53,66,820/-` (a table
 *      cell whose text layer breaks the line between marker and figure)
 *
 * Shape 2 is the single largest miss in real NSE text. Shape 3 is what a
 * filer's own OCR does to shape 1 or 2 before we ever see the document.
 *
 * This module answers only "what figures does this text state, verbatim, and
 * where". It deliberately does NOT decide which of them is material — that
 * judgement needs the document's structure and lives in amount-extraction.ts.
 */

import { matchesOf } from './regex-matches';

/**
 * Whitespace tolerated inside one figure: horizontal space plus AT MOST one
 * newline. An unbounded `\s*` would let a currency marker at the end of one
 * table cell bind to a number several blank lines away in an unrelated cell,
 * which is a wrong number rather than a missing one.
 */
const GAP = '[^\\S\\n]*\\n?[^\\S\\n]*';

/**
 * `\b` leads `rs` and `inr` because the "rs" tail of an ordinary word is
 * otherwise a currency marker — "issued to shareholde|rs| 5 crore equity
 * shares" parsed as Rs 5 crore. No trailing `\b` on `inr`, which would reject
 * the unspaced "INR500 crore" form.
 *
 * `&#8377;` is the HTML-escaped rupee sign. The mapper decodes entities at
 * ingest, so this is belt-and-braces for filings captured before that fix.
 *
 * `rupees` is NOT a marker. It introduces the words-in-brackets restatement
 * that follows almost every Indian figure — `(Rupees Three Crores Fifty-Six
 * Lakhs Ninety-One Thousand One Hundred Forty-Two…)` — and reading its leading
 * digits-in-words as a figure yields ₹3 crore for a ₹3.57 crore order. A
 * truncated amount is a WRONG amount, so the words are left unparsed.
 */
const CURRENCY_MARKER = '(?:\\brs|\\binr|₹|&#8377;)';

/** Keyed by the singular unit; plurals are normalised before lookup. */
const MULTIPLIERS: Readonly<Record<string, number>> = {
  crore: 10_000_000,
  cr: 10_000_000,
  lakh: 100_000,
  lac: 100_000,
  million: 1_000_000,
  mn: 1_000_000,
  billion: 1_000_000_000,
  bn: 1_000_000_000,
};

const UNIT = 'crores?|crs?|lakhs?|lacs?|millions?|mn|billions?|bn';

/**
 * A figure never ends on a comma, so a trailing separator ("Rs 5,00,000, plus
 * taxes") stays outside the capture. Letting it in would fail the grouping
 * check below and silently drop a perfectly good amount.
 */
const FIGURE = '(\\d(?:[\\d,]*\\d)?(?:\\.\\d+)?)';

/**
 * The trailing unit is optional because Indian usage compounds one scale onto
 * another: "Rs 2 lakh crore" is 2e12. Matching only the leading unit reports
 * 2e5 — wrong by 10^7, and wrong in the direction that silently fails a
 * materiality threshold rather than raising one.
 *
 * Both units are optional overall, which is what admits shape 2.
 */
const AMOUNT_PATTERN = new RegExp(
  `${CURRENCY_MARKER}${GAP}\\.?${GAP}${FIGURE}` +
    `(?:${GAP}(${UNIT})\\b(?:${GAP}(${UNIT})\\b)?)?`,
  'gi',
);

/** A bare figure with no currency marker at all, for label-anchored use only. */
const BARE_PATTERN = new RegExp(`${FIGURE}${GAP}(\\/[-–—])`, 'g');

/**
 * Indian grouping (`18,53,66,820`) and international grouping (`50,172,500`)
 * are both in daily use, often in the same document. Anything else is a
 * malformed figure — one real filing prints `Rs. 30,00,000,00`, which reads as
 * ₹30 crore only by accident of where the commas fell. A figure whose grouping
 * cannot be recognised has no determinable value, so it is dropped rather than
 * guessed.
 */
const INDIAN_GROUPING = /^\d{1,2}(?:,\d{2})*,\d{3}$/;
const INTERNATIONAL_GROUPING = /^\d{1,3}(?:,\d{3})*$/;

/**
 * Below one lakh a unit-less figure is far more likely to be a face value, a
 * share price, a premium or a fee than the material consideration, and those
 * are exactly the numbers that sit next to the real one in a SEBI annexure.
 */
export const MIN_UNITLESS_RUPEES = 100_000;

/** "crores" -> "crore", "lacs" -> "lac". No unit is singular-ending-in-s. */
const singular = (unit: string): string => unit.toLowerCase().replace(/s$/, '');

const LAKH_UNITS: ReadonlySet<string> = new Set(['lakh', 'lac']);
const CRORE_UNITS: ReadonlySet<string> = new Set(['crore', 'cr']);

/**
 * Resolves one or two stacked unit words to a single multiplier.
 *
 * "lakh crore" is the only compound in real use; "crore crore" and "crore
 * lakh" are nonsense. Returns null for anything unrecognised so the caller
 * skips the match entirely — refusing to read an amount is recoverable, while
 * emitting a plausible-looking wrong number is not.
 *
 * The unrecognised-unit guards are not decorative: the unit list lives in the
 * regex and the multipliers live in a table, and adding a spelling to one
 * without the other must refuse rather than read the figure unscaled.
 */
export function resolveUnitMultiplier(
  first: string,
  second?: string,
): number | null {
  const head = MULTIPLIERS[singular(first)];
  if (head === undefined) return null;
  if (second === undefined) return head;

  const tail = MULTIPLIERS[singular(second)];
  if (tail === undefined) return null;
  return LAKH_UNITS.has(singular(first)) && CRORE_UNITS.has(singular(second))
    ? head * tail
    : null;
}

/** null when the digits cannot be read with certainty. */
function readFigure(figure: string): number | null {
  const [integerPart] = figure.split('.');
  if (integerPart.includes(',')) {
    if (
      !INDIAN_GROUPING.test(integerPart) &&
      !INTERNATIONAL_GROUPING.test(integerPart)
    ) {
      return null;
    }
  }
  const value = Number(figure.replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

/** One figure found in the source text, with everything needed to audit it. */
export interface RupeeMatch {
  /** Value normalised to rupees. */
  readonly rupees: number;
  /** The exact substring of the source that carries the figure. */
  readonly text: string;
  /** Index of `text` in the source, so a caller can re-verify it verbatim. */
  readonly start: number;
  /**
   * True when the figure names its own scale ("Rs 78.24 crore"). Such a figure
   * is self-describing and cannot be misread by a table header declaring a
   * scale; a unit-less one takes its scale entirely from context and can.
   */
  readonly carriesUnit: boolean;
}

/**
 * Every rupee figure in the text, in document order, normalised to rupees.
 *
 * A currency marker is mandatory. Without one, "headcount rose to 25 lakhs"
 * and "order book of 1,063 crores" both read as money.
 */
export function scanRupeeAmounts(text: string): readonly RupeeMatch[] {
  const matches: RupeeMatch[] = [];
  for (const match of matchesOf(text, AMOUNT_PATTERN)) {
    const [whole, figure, firstUnit, secondUnit] = match;
    const start = match.index;
    const value = readFigure(figure);
    if (value === null) continue;

    if (firstUnit === undefined) {
      // Shape 2. Grouping separators are required: they are what distinguishes
      // a written-out rupee amount from a tender number, a year or a code.
      if (!figure.includes(',') || value < MIN_UNITLESS_RUPEES) continue;
      matches.push({ rupees: value, text: whole, start, carriesUnit: false });
      continue;
    }

    const multiplier = resolveUnitMultiplier(firstUnit, secondUnit);
    if (multiplier === null) continue;
    matches.push({
      rupees: value * multiplier,
      text: whole,
      start,
      carriesUnit: true,
    });
  }
  return matches;
}

/**
 * Currency codes that are NOT rupees. A bare grouped figure sitting behind one
 * of these is a foreign amount, and reading `USD 70,000,000` as ₹7 crore is the
 * worst class of error this module can make.
 */
const FOREIGN_CURRENCY = /(?:usd|us\$|\$|eur|€|gbp|£|jpy|aed|sgd|cad|aud)\s*$/i;

/**
 * Figures written with no currency marker at all, e.g. INNOVISION's
 * `9,23,44,635/- (Rupees Nine crore…)` and OMPOWER's `Rupees 82,17,40,528/-`.
 *
 * Nothing in the digits themselves says "rupees", so this is only safe where
 * the surrounding structure already supplies that meaning — a SEBI disclosure
 * row that asks for the consideration. It is therefore not exported through
 * `scanRupeeAmounts`, and callers must scope it to such a window.
 *
 * The trailing `/-` is required. It is the near-universal Indian terminator for
 * a rupee amount, and demanding it excludes the counts and quantities that
 * share the same grouping — `50,00,00,000 equity shares`, `15,96,500 shares` —
 * which are the false positives that would otherwise poison the window.
 */
export function scanBareAmounts(text: string): readonly RupeeMatch[] {
  const matches: RupeeMatch[] = [];
  for (const match of matchesOf(text, BARE_PATTERN)) {
    const [whole, figure] = match;
    const start = match.index;
    if (FOREIGN_CURRENCY.test(text.slice(Math.max(0, start - 12), start))) {
      continue;
    }
    const value = readFigure(figure);
    if (value === null) continue;
    if (!figure.includes(',') || value < MIN_UNITLESS_RUPEES) continue;
    matches.push({ rupees: value, text: whole, start, carriesUnit: false });
  }
  return matches;
}
