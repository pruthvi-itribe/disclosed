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
 *
 * ================================================================
 * WHAT IS NOT A FIGURE AT ALL
 * ================================================================
 *
 * The digits inside `Q1` and `FY27`. They name the PERIOD a statement is about,
 * not a quantity it asserts, and reading them as figures was measured to be
 * wrong in both directions at once — it threw away five of the six claims the
 * live run discarded, and it accepted a wrong quarter whenever a stray `1`
 * happened to sit in the sentence, which is 24.3% of them. `claim-period.ts`
 * owns that argument and the rule that replaces it; this module's job is only to
 * stop counting a period's digits as money.
 */

import { periodLabelsIn } from './claim-period';

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
 * Every digit run in a piece of text, canonicalised, in the order written.
 *
 * Duplicates are kept: "grew from 15 to 15" says something different from "grew
 * to 15", and collapsing them here would hide it from a caller that cared.
 *
 * INCLUDES the digits inside a period label. This is the raw tokeniser; the
 * caller that wants figures rather than digits wants `figuresIn`.
 */
export const numbersIn = (text: string): readonly string[] =>
  (text.match(NUMBER_TOKEN) ?? []).map(canonicalise);

/**
 * Every figure in a piece of text — the digit runs that are NOT part of a
 * fiscal period label.
 *
 * `Q1 FY27 revenue of ₹125.2 Cr` states one figure, 125.2. The `1` and the `27`
 * are the quarter and the year, and `claim-period.ts` verifies those as labels
 * against the sentence's neighbourhood, which is both where a document states
 * them and a stricter test than looking for their bare digits.
 */
export function figuresIn(text: string): readonly string[] {
  const periods = periodLabelsIn(text);
  const figures: string[] = [];
  for (const match of text.matchAll(NUMBER_TOKEN)) {
    const start = match.index;
    const end = start + match[0].length;
    // Half-open overlap: a token that shares any character with a period label
    // belongs to the label, not to the claim's arithmetic.
    const inPeriod = periods.some(
      (period) => start < period.end && end > period.start,
    );
    if (!inPeriod) figures.push(canonicalise(match[0]));
  }
  return figures;
}

/**
 * Figures the claim states that its own span does not.
 *
 * Returns them rather than a boolean so the discard record can name the offending
 * figure — "the claim states 30, which its span does not" is reviewable, while
 * "a number check failed" is not.
 *
 * BOTH SIDES exclude period digits, so a claim's `125.2` can never be satisfied
 * by the span's `FY2025`. The asymmetric alternative — figures on the claim,
 * every digit on the span — would have been a looser check than the one this
 * replaces, and the whole point of the change is that it is tighter.
 */
export function unsupportedNumbers(
  claimText: string,
  span: string,
): readonly string[] {
  const supported = new Set(figuresIn(span));
  return [...new Set(figuresIn(claimText))].filter(
    (value) => !supported.has(value),
  );
}
