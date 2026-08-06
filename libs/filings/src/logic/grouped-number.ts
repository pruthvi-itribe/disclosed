/**
 * Whether a number is written with grouping separators that say what it is.
 *
 * ================================================================
 * THE HAZARD THIS MODULE EXISTS FOR
 * ================================================================
 *
 * OCR reads a decimal point as a comma. Measured on JKIL's scanned consolidated
 * statement, against the rendered page:
 *
 *     ground truth   docling emitted
 *     1,48,388.57    1,48,388,57
 *     3,114.25       3,114,25
 *
 * Every digit is correct and only the separator is wrong, which is why it is
 * dangerous rather than merely annoying. Against an exact-substring gate it is
 * harmless — it simply will not match. Against anything that strips commas and
 * reads what is left, `1,48,388,57` becomes 14,838,857 instead of 148,388.57:
 * **a hundredfold error, in the silent direction, about a named listed
 * company.** It is the same class of failure `resolveUnitMultiplier` refuses a
 * scale for, arriving through a different door.
 *
 * `pdf-parse` produces the same shape by a different mechanism. Its column
 * flattening welds adjacent cells into one token — `88,06,567000000` is
 * `88,06,567` followed by six zero columns, `4,3034,26899` is two columns of a
 * JINDALSTEL table — and it does so at a measured 8.40% of every comma-bearing
 * number, which is a HIGHER rate than OCR produces. So this is not an
 * OCR-specific guard bolted on for one new parser; it is a rule the incumbent
 * has been failing all along, and it applies to every parser's output equally.
 *
 * ================================================================
 * THE RULE, AND WHY IT IS DECIDABLE
 * ================================================================
 *
 * Indian grouping (`18,53,66,820`) and international grouping (`50,172,500`)
 * are both in daily use, often in the same document, and they disagree about
 * every group except the last. **Both always end in a group of exactly three
 * digits.** That single shared property is what makes a malformed number
 * recognisable without knowing which convention the filer used: a final group
 * of one, two, four or more digits is not a number written by either.
 *
 * A number whose value cannot be determined is REFUSED rather than guessed, for
 * the reason `rupee-parse.ts` gives about `Rs. 30,00,000,00` — a figure that
 * reads as ₹30 crore only by accident of where the commas fell.
 */

/**
 * Indian grouping: two-digit groups all the way up, three at the end.
 * `18,53,66,820`, `1,48,388`, `2,84,706`.
 */
export const INDIAN_GROUPING = /^\d{1,2}(?:,\d{2})*,\d{3}$/;

/** International grouping: three-digit groups throughout. `50,172,500`. */
export const INTERNATIONAL_GROUPING = /^\d{1,3}(?:,\d{3})*$/;

/**
 * Whether an integer's grouping separators are readable.
 *
 * A part with NO comma is well-grouped by definition: `500` and `54618` state
 * their value unambiguously and this rule has nothing to say about them. Only a
 * number that uses separators can use them wrongly.
 */
export function isWellGroupedInteger(integerPart: string): boolean {
  if (!integerPart.includes(',')) return true;
  return (
    INDIAN_GROUPING.test(integerPart) ||
    INTERNATIONAL_GROUPING.test(integerPart)
  );
}

/**
 * Everything stripped before the grouping is judged.
 *
 * Accounting parentheses, a leading sign, whitespace, a rupee sign and a
 * trailing percent are all presentation rather than value. They are removed so
 * `(4,191.73)` is judged as `4,191.73` — a loss is not a malformed number.
 */
const DECORATION = /[()\s₹%]/g;

/**
 * Whether a numeric token as the document writes it can be read as one number.
 *
 * NEVER THROWS and takes the token verbatim — parentheses, sign, currency mark
 * and all — because that is the form the extractor proposes and the form the
 * document prints. A token with no comma in it is accepted: this rule is about
 * separators being wrong, not about a value being surprising.
 *
 * Two decimal points is also a refusal. `1.48.388` is not a number either
 * convention writes, and the same OCR that turns a point into a comma turns a
 * comma into a point.
 */
export function isWellGroupedNumber(token: string): boolean {
  const bare = token.replace(DECORATION, '').replace(/^[-+]/, '');
  if (bare.length === 0) return false;

  const parts = bare.split('.');
  if (parts.length > 2) return false;

  // A fractional part carrying a comma is the same failure seen from the other
  // side: `3,114.2,5` has no readable value.
  if (parts.length === 2 && parts[1].includes(',')) return false;

  return isWellGroupedInteger(parts[0]);
}

/**
 * The first token whose grouping cannot be read, or null when all of them can.
 *
 * Takes the tokens rather than free text on purpose. Scanning prose would have
 * to exclude `March 15, 2019`, which yields `15,2019` and is a date rather than
 * a malformed number — and a rule that has to know about dates is a rule that
 * will one day have to know about something else. Every caller here already
 * holds the specific cells it is about to publish.
 */
export function malformedGroupingIn(tokens: readonly string[]): string | null {
  return tokens.find((token) => !isWellGroupedNumber(token)) ?? null;
}
