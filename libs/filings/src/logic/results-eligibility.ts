import type { Filing } from '../filing.types';
import { isLegallyBlocked } from './legal-block';
import { basisMarkersIn } from './results-basis';

/**
 * Which filings are worth asking a model to read a results table out of.
 *
 * ================================================================
 * THE CATEGORY THIS PIPELINE WAS BLIND TO
 * ================================================================
 *
 * `Outcome of Board Meeting` is 1,346 of the 17,442 filings in the recorded
 * month and 200 of the 1,699 live; 64.4% of them state in their own exchange
 * summary that they carry financial results. Every one was refused before a
 * model was called, by a comment in `claim-eligibility.ts` asserting they were
 * "almost entirely results tables the amount extractor already reads".
 *
 * The premise was false in the way that matters. The amount extractor returns
 * ONE rupee figure — the value of a single disclosed event — and it refuses a
 * results statement outright, because a statement of accounts has no single
 * material amount in it and every anchor the extractor has says so. What a
 * results filing carries is a SET: a top line, a bottom line, an earnings per
 * share, each with the year-ago figure printed beside it. Nothing in this
 * pipeline could read that, so the largest recurring event in an equity market's
 * calendar produced no output at all.
 *
 * ================================================================
 * WHY THE DOCUMENT TEST IS STRUCTURAL AND NOT A KEYWORD
 * ================================================================
 *
 * A board-meeting outcome is a category, not a document type: the same category
 * carries a dividend declaration, a fundraising approval and a change of
 * registered office. The words "financial results" appear in the covering letter
 * of nearly all of them, so a keyword gate would send every one to a model.
 *
 * So the gate asks whether the ATTACHED DOCUMENT contains a statement — a row
 * label a Regulation 33 statement is required to print, and a consolidated or
 * standalone statement heading. Both are structural properties of the thing
 * being looked for, both are already needed by the verifier downstream, and a
 * covering letter announcing that results were approved has neither.
 */

/**
 * Categories whose documents carry a results statement.
 *
 * Read off the live collection and the 17,442-filing corpus rather than guessed.
 * Every category whose NAME contains "result", "financial", "quarter" or "audit"
 * was enumerated; of those, `Integrated Filing- Financial` (76.5% results by its
 * own summary) is here, and the two clarification categories are deliberately
 * not — see below. `Outcome of Board Meeting` carries no such word in its name
 * and is the one that matters.
 *
 * DELIBERATELY NOT HERE:
 *
 *   - `Clarification - Financial Results` (41 in the corpus) is the EXCHANGE'S
 *     letter asking a company to explain a discrepancy. It is not the company
 *     stating results.
 *   - `Reply to Clarification- Financial results` (141) is the company's answer
 *     to that letter. It does carry figures, and it carries them in the one
 *     context where publishing them without saying so would mislead: the whole
 *     document exists because what was filed earlier needed explaining. The
 *     amount lane already refuses this category's documents on `sought
 *     clarification`, and the same judgement applies here.
 *   - `Monitoring Agency Report` (110, 76.4% mentioning a quarter) reports on
 *     the use of IPO proceeds, not on results.
 *   - `Certificate under SEBI (Depositories and Participants) Regulations, 2018`
 *     (1,973, 19.8%) is a share-transfer compliance certificate that names a
 *     quarter and states no results at all.
 */
export const RESULTS_BEARING_CATEGORIES: ReadonlySet<string> = new Set([
  'outcome of board meeting',
  'integrated filing- financial',
  'press release',
  'press release (revised)',
  'investor presentation',
]);

/**
 * Row labels a Regulation 33 statement is required to print.
 *
 * The presence test, and it is deliberately a list of ROW LABELS rather than of
 * topic words: a covering letter says "financial results" and an attached
 * statement says "Revenue from operations". Only the second is a table.
 */
export const RESULTS_STATEMENT_PATTERN =
  /revenue from operations|total income|profit for the period|profit after tax|earnings per (?:equity )?share/i;

/**
 * Characters below which a document cannot be carrying a statement.
 *
 * A Regulation 33 statement is a seventeen-row table with four columns and a
 * notes block; the smallest one measured in this corpus is several thousand
 * characters. 2,000 is well below that and exists only to remove the covering
 * letters that would otherwise reach the pattern test.
 */
export const MIN_RESULTS_DOCUMENT_CHARS = 2_000;

export type ResultsEligibility =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reason: string };

const not = (reason: string): ResultsEligibility => ({
  eligible: false,
  reason,
});

/**
 * Whether this filing's document is worth a results extraction call.
 *
 * The reason is returned rather than a boolean, for the reason
 * `claimEligibility` gives: "nothing was found" and "nothing was looked for" are
 * opposite facts about a filing and must not render the same.
 */
export function resultsEligibility(
  filing: Pick<Filing, 'category' | 'summary'>,
  documentText: string,
): ResultsEligibility {
  const category = filing.category.trim().toLowerCase();
  if (!RESULTS_BEARING_CATEGORIES.has(category)) {
    return not(`${filing.category} is not a results-bearing category`);
  }

  // BEFORE the model, exactly as the claim lane does it. A filing carrying legal
  // exposure must never reach an extractor at all.
  if (isLegallyBlocked(filing)) {
    return not('the filing carries legal exposure');
  }

  if (documentText.length < MIN_RESULTS_DOCUMENT_CHARS) {
    return not(
      `the document is ${documentText.length} characters, which is too short ` +
        'to carry a results statement',
    );
  }

  if (!RESULTS_STATEMENT_PATTERN.test(documentText)) {
    return not("the document states none of a results statement's row labels");
  }

  if (basisMarkersIn(documentText).length === 0) {
    return not(
      'the document carries no consolidated or standalone statement heading',
    );
  }

  return { eligible: true };
}
