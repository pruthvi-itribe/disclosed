/**
 * Every figure in a claim must come from the sentence it was read from.
 *
 * ================================================================
 * WHY THE SPAN AND NOT THE WHOLE DOCUMENT
 * ================================================================
 *
 * The stated rule is that a number in a claim must appear in the source text.
 * Checked against the whole document that is nearly no constraint at all: an
 * investor presentation is forty pages of tables, and almost any two-digit
 * number appears somewhere in it. A claim reading "targets 25% margin" would
 * pass because `25` is a row in an unrelated segment table on page nine.
 *
 * So the check is SPAN-SCOPED, which is strictly stronger and is what makes it
 * mean something: the figure must be in the one sentence the claim quotes. That
 * ties the number to the evidence a reviewer will actually read, and it
 * subsumes the document-level rule — a number in the span is in the document by
 * construction, because the span itself was matched against the document first.
 *
 * ================================================================
 * WHAT COUNTS AS THE SAME NUMBER
 * ================================================================
 *
 * Digits only, with separators removed. `10,000` and `10000` are the same
 * figure written two ways, and `1,00,000` is the same again in Indian grouping —
 * a filer's comma placement is a typographic choice and refusing over it would
 * discard true claims for no gain.
 *
 * NOTHING ELSE IS NORMALISED. `10,000 Cr` and `100 billion` are NOT the same
 * figure to this module, even though they are the same amount of money, because
 * turning one into the other is arithmetic — and arithmetic performed by a
 * language model on a filing about a named listed company is exactly the class
 * of error this pipeline refuses to make. A claim that converts units is
 * discarded and the document's own units survive instead.
 */

/**
 * A run of digits, with optional grouping separators and a decimal part.
 *
 * Anchored on a digit at both ends so a trailing comma or full stop — "₹10,000
 * Cr." — is not swallowed into the figure.
 */
const NUMBER_TOKEN = /\d[\d,]*(?:\.\d+)?/g;

/** Commas removed and a trailing decimal point trimmed. */
const canonicalise = (token: string): string =>
  token.replace(/,/g, '').replace(/\.$/, '');

/**
 * Every figure in a piece of text, canonicalised, in the order written.
 *
 * Duplicates are kept: "grew from 15 to 15" says something different from "grew
 * to 15", and collapsing them here would hide it from a caller that cared.
 */
export const numbersIn = (text: string): readonly string[] =>
  (text.match(NUMBER_TOKEN) ?? []).map(canonicalise);

/**
 * Figures the claim states that its own span does not.
 *
 * Returns them rather than a boolean so the discard record can name the offending
 * figure — "the claim states 30, which its span does not" is reviewable, while
 * "a number check failed" is not.
 */
export function unsupportedNumbers(
  claimText: string,
  span: string,
): readonly string[] {
  const supported = new Set(numbersIn(span));
  return [...new Set(numbersIn(claimText))].filter(
    (value) => !supported.has(value),
  );
}
