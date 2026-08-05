/**
 * Conditional-language markers. A filing containing any of these is NOT a
 * confirmed event — "emerged as L1 bidder" is not "won the order". These force
 * manual review rather than auto-drafting, which is the exact error class seen
 * in competitor headlines.
 */
const AMBIGUITY_PATTERNS: readonly RegExp[] = [
  /\bL-?1\b/i,
  /\bletter of intent\b/i,
  /\bLoI\b/,
  /\bMoU\b/i,
  /\bmemorandum of understanding\b/i,
  /\bin-?principle\b/i,
  /\bpreferred bidder\b/i,
  /\bsubject to\b/i,
  // Rumour framing. An exchange clarification request restates an unverified
  // press claim, so its rupee figure is a journalist's number, not the
  // company's. Drafting from one publishes the rumour as fact.
  /\bnews verification\b/i,
  /\bsought clarification\b/i,
  /\brecent news item\b/i,
  /\bclarification on news\b/i,
  /\bnews item\b/i,
  /\bmedia report/i,
  /\breported in the media\b/i,
  /\bin the media\b/i,
  /\blikely to\b/i,
  /\bspeculat/i,
];

export const hasAmbiguityKeyword = (text: string): boolean =>
  AMBIGUITY_PATTERNS.some((pattern) => pattern.test(text));

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

/**
 * A currency marker is mandatory. Widening the unit list to mn/bn would
 * otherwise let any bare figure ("headcount rose to 25 lakhs") read as money.
 *
 * `\b` leads `rs` and `inr` because the "rs" tail of an ordinary word is
 * otherwise a currency marker — "issued to shareholde|rs| 5 crore equity
 * shares" parsed as Rs 5 crore. No trailing `\b` on `inr`, which would reject
 * the unspaced "INR500 crore" form.
 *
 * `&#8377;` is the HTML-escaped rupee sign. The mapper now decodes entities at
 * ingest, so this is belt-and-braces for filings captured before that fix.
 */
const UNIT = 'crores?|crs?|lakhs?|lacs?|millions?|mn|billions?|bn';

/**
 * The trailing unit is optional because Indian usage compounds one scale onto
 * another: "Rs 2 lakh crore" is 2e12. Matching only the leading unit reports
 * 2e5 — wrong by 10^7, and wrong in the direction that silently fails a
 * materiality threshold rather than raising one.
 */
const AMOUNT_PATTERN = new RegExp(
  `(?:\\brs\\.?|\\binr|₹|&#8377;)\\s*([\\d,]+(?:\\.\\d+)?)\\s*(${UNIT})\\b(?:\\s*(${UNIT})\\b)?`,
  'gi',
);

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
 */
function resolveMultiplier(first: string, second?: string): number | null {
  const head = MULTIPLIERS[singular(first)];
  if (head === undefined) return null;
  if (second === undefined) return head;

  const tail = MULTIPLIERS[singular(second)];
  if (tail === undefined) return null;
  return LAKH_UNITS.has(singular(first)) && CRORE_UNITS.has(singular(second))
    ? head * tail
    : null;
}

/**
 * Extracts rupee amounts, normalised to rupees. Returns an empty array when the
 * text carries no figure — which for the newsjack lane means no hook, no post.
 */
export function extractRupeeAmounts(text: string): number[] {
  const amounts: number[] = [];
  for (const match of text.matchAll(AMOUNT_PATTERN)) {
    const value = Number(match[1].replace(/,/g, ''));
    const multiplier = resolveMultiplier(match[2], match[3]);
    if (Number.isFinite(value) && multiplier) {
      amounts.push(value * multiplier);
    }
  }
  return amounts;
}
