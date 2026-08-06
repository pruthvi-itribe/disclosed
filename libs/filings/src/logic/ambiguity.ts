import { scanRupeeAmounts } from './rupee-parse';

/**
 * Language that means a figure in a filing is not a confirmed number — split by
 * the SCOPE over which the language is evidence.
 *
 * ================================================================
 * WHY ONE LIST WAS TWO RULES WEARING ONE NAME
 * ================================================================
 *
 * These patterns were one list, tested against the whole document. Live, that
 * refused 590 filings for `ambiguity-keyword` — the second-largest refusal
 * reason in the pipeline — and the phrase doing most of the work was
 * `subject to`, which is in the boilerplate of nearly every Indian filing:
 * "subject to shareholder approval", "subject to applicable taxes", "subject to
 * the terms of the agreement". A document-wide test on that phrase does not
 * mean "this event is conditional". It means "this is a filing".
 *
 * The two halves of the list are not the same kind of claim, and that is the
 * whole of the fix:
 *
 *   - **Rumour framing is a property of the FILING.** If the exchange asked the
 *     company to clarify a news item, then EVERY figure in the document is a
 *     journalist's number that the company is responding to, wherever it
 *     appears and however clearly it is stated. There is no sentence in such a
 *     filing whose figure is safe, so there is nothing to scope: the check
 *     stays document-wide, and drafting from one of these publishes a rumour as
 *     fact.
 *   - **Conditional framing is a property of the SENTENCE.** "Emerged as L1
 *     bidder" conditions the figure IN THAT CLAUSE. It says nothing about the
 *     Schedule III consideration row four pages later, and it says nothing at
 *     all when the words it conditions are a shareholder-approval formality in
 *     a paragraph with no figure in it. So the check is applied to the sentence
 *     a candidate figure was read from, by `sentence-scope.ts`.
 *
 * `hasAmbiguityKeyword` KEEPS ITS OLD MEANING — both lists, whole text — because
 * `claim-verify.ts` calls it on a claim's own quoted span, where the text
 * already IS one sentence and the union is exactly the right test. Splitting the
 * lists must not change that call site, so the union is preserved rather than
 * reassembled by its callers.
 */

/**
 * Rumour framing: the filing is restating something it did not originate.
 *
 * An exchange clarification request quotes an unverified press claim, so its
 * rupee figure is a journalist's number rather than the company's. Document
 * scope is not a compromise here — it is the correct scope, because what these
 * phrases describe is what the whole document is FOR.
 */
export const RUMOUR_PATTERNS: readonly RegExp[] = [
  /\bnews verification\b/i,
  /\bsought clarification\b/i,
  /\brecent news item\b/i,
  /\bclarification on news\b/i,
  /\bnews item\b/i,
  /\bmedia report/i,
  /\breported in the media\b/i,
  /\bin the media\b/i,
  /\bspeculat/i,
];

/**
 * Conditional framing: the figure in this clause is not a settled amount.
 *
 * "Emerged as L1 bidder" is not "won the order"; a letter of intent is not a
 * contract; "subject to" names something that has not happened yet. Every one of
 * these qualifies the words next to it and nothing further away, which is why
 * the amount extractor tests them against a candidate's own sentence instead of
 * against the filing.
 */
export const CONDITIONAL_PATTERNS: readonly RegExp[] = [
  /\bL-?1\b/i,
  /\bletter of intent\b/i,
  /\bLoI\b/,
  /\bMoU\b/i,
  /\bmemorandum of understanding\b/i,
  /\bin-?principle\b/i,
  /\bpreferred bidder\b/i,
  /\bsubject to\b/i,
  /\blikely to\b/i,
];

/**
 * The union, in the order the single list used to carry them.
 *
 * Assembled from the two lists rather than written out again, so a pattern
 * added to either half cannot be forgotten here — a divergence that would show
 * up as a claim slipping through `claim-verify.ts` and nowhere else.
 */
const AMBIGUITY_PATTERNS: readonly RegExp[] = [
  ...CONDITIONAL_PATTERNS,
  ...RUMOUR_PATTERNS,
];

/**
 * True when a text carries conditional OR rumour framing.
 *
 * THE WHOLE-TEXT TEST, UNCHANGED. Correct when the text handed in is already a
 * single statement — `claim-verify.ts` passes a claim's quoted span — and
 * correct nowhere else. New callers with a whole document in hand want
 * `hasRumourFraming` and a sentence-scoped `hasConditionalFraming` instead.
 */
export const hasAmbiguityKeyword = (text: string): boolean =>
  AMBIGUITY_PATTERNS.some((pattern) => pattern.test(text));

/** True when a text frames its content as an unverified report. */
export const hasRumourFraming = (text: string): boolean =>
  RUMOUR_PATTERNS.some((pattern) => pattern.test(text));

/** True when a text conditions what it states on something not yet done. */
export const hasConditionalFraming = (text: string): boolean =>
  conditionalFramingIn(text) !== null;

/**
 * The conditional phrase a text uses, exactly as it spells it, or null.
 *
 * Returns the PHRASE rather than a boolean because it goes into the refusal
 * detail, and a refusal that cannot name the words it fired on is one a
 * reviewer has to re-derive by reading the filing themselves.
 */
export function conditionalFramingIn(text: string): string | null {
  for (const pattern of CONDITIONAL_PATTERNS) {
    const found = pattern.exec(text);
    if (found !== null) return found[0];
  }
  return null;
}

/**
 * Extracts rupee amounts, normalised to rupees. Returns an empty array when the
 * text carries no figure — which for the newsjack lane means no hook, no post.
 *
 * The parsing itself lives in rupee-parse.ts, which also records where each
 * figure was found. This wrapper is the value-only view of the same scan, kept
 * here because the summary-level callers only ever needed the numbers.
 */
export function extractRupeeAmounts(text: string): number[] {
  return scanRupeeAmounts(text).map((match) => match.rupees);
}
