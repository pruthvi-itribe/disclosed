/**
 * The two document features that make a figure unreadable rather than absent.
 *
 * Both are detectors only. Neither adjusts a value — a detection is always a
 * refusal, because knowing that SOME table on the page is denominated in
 * thousands does not tell you which figures belong to it.
 */

const SCALE_UNIT =
  'thousands?|lakhs?|lacs?|millions?|mn|crores?|cr|billions?|bn';

/**
 * A unit-scaled table header re-denominates every figure beneath it. One real
 * filing prints `Turnover … (Rs. in thousands): Rs.7,15,126` — ₹71.5 crore
 * written as if it were ₹7.15 lakh. Reading it at face value is a 1,000x
 * under-report, in the direction that silently fails a materiality test.
 *
 * The forms below are all drawn from filings actually sampled. They are
 * deliberately several narrow patterns rather than one loose one: a false
 * positive here costs recall on every figure in the document, and a false
 * negative costs a wrong number.
 */
const SCALE_HEADER_PATTERNS: readonly RegExp[] = [
  // `Rs. in thousands`, `₹ in Lakhs`, `Rupees in Lakh`, `Rs.in lakh,`
  new RegExp(
    `(?:\\brs\\b|\\brs\\.|\\binr\\b|₹|&#8377;|\\brupees\\b)\\s*\\.?\\s*in\\s+(?:${SCALE_UNIT})\\b`,
    'i',
  ),
  // `Amounts in million except share and per share data`
  new RegExp(`\\bamounts?\\s+in\\s+(?:${SCALE_UNIT})\\b`, 'i'),
  // `(In Lakhs)`, `(in ₹ Crores)`, `({ in lakhs)` once the rupee sign mojibakes
  new RegExp(
    `\\(\\s*\\S{0,2}\\s*in\\s+(?:\\brs\\b|\\brs\\.|\\binr\\b|₹|&#8377;)?\\s*(?:${SCALE_UNIT})\\s*[,)]`,
    'i',
  ),
  // `(INR Mn)`, `(Rs. crore)`, `(Rs. Crore)` used as a column header
  new RegExp(
    `\\(\\s*(?:\\brs\\b|\\brs\\.|\\binr\\b|₹|&#8377;)\\s*\\.?\\s*(?:${SCALE_UNIT})\\s*\\)`,
    'i',
  ),
  // `Size of Issue (million)`, `Rated Amount (Rs. crore)` — the amount column
  // of a credit-rating annexure, whose figures are bare.
  new RegExp(
    `\\b(?:amount|size\\s+of\\s+issue)\\b[^\\n]{0,40}?\\(\\s*(?:\\brs\\.?|\\binr|₹)?\\s*\\.?\\s*(?:${SCALE_UNIT})\\s*[.)]`,
    'i',
  ),
];

/**
 * Every unit-scale declaration in the document, verbatim, so a refusal can name
 * what triggered it. Empty when the document declares no scale anywhere.
 */
export function findUnitScaleHeaders(text: string): readonly string[] {
  const found: string[] = [];
  for (const pattern of SCALE_HEADER_PATTERNS) {
    const match = pattern.exec(text);
    if (match !== null) found.push(match[0].replace(/\s+/g, ' ').trim());
  }
  return found;
}

/**
 * Some filers publish a value BAND instead of a figure. L&T classifies every
 * order win — "Mega* Order" means ₹10,000–15,000 crore — and prints the key in
 * the same document:
 *
 *   Classification  Significant  Large  Major  Mega  Ultra-Mega
 *   Value in ₹ Cr   1,000 to 2,500 …
 *
 * A band is a real disclosure, but it is not a point value, and collapsing it
 * to one would invent precision the company deliberately withheld.
 */
const VALUE_BAND_PATTERNS: readonly RegExp[] = [
  new RegExp(
    `\\bvalue\\s+in\\s+(?:\\brs\\.?|\\binr|₹|&#8377;)\\s*(?:${SCALE_UNIT})\\b`,
    'i',
  ),
  // `in the range of Rs 500 crore to Rs 700 crore`
  new RegExp(
    `\\brange\\s+of\\s+(?:\\brs\\.?|\\binr|₹)\\s*[\\d,.]+\\s*(?:${SCALE_UNIT})?\\s*(?:to|–|—)\\s*`,
    'i',
  ),
];

export const hasValueBand = (text: string): boolean =>
  VALUE_BAND_PATTERNS.some((pattern) => pattern.test(text));
