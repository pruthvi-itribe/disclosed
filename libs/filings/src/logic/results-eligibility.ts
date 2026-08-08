import type { Filing } from '../filing.types';
import { isLegallyBlocked } from './legal-block';
import { basisMarkersIn } from './results-basis';
import { forStructuralTest } from './structural-text';

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
 *
 * ================================================================
 * WHY `Copy of Newspaper Publication` STAYS SHUT, MEASURED
 * ================================================================
 *
 * It is the largest category this lane refuses and the refusal is not idle:
 * 143 of the 408 cached newspaper pages carry a real statutory results
 * statement, and `shared-page.ts`'s four-CIN rule only reaches 56 of them.
 *
 * The mechanism proposed for the other 87 was a TABLE-LEVEL attribution check
 * shaped exactly like `governingBasis` — admit a table when the filer's own
 * name sits within a bounded window ABOVE its column header. It was measured
 * before it was written (`tools/results/measure-table-attribution.ts`), over
 * the 337 column headers on those pages, with the page's own layout as ground
 * truth: whichever company's name sits nearer above a header is whose table it
 * is. 158 headers are the filer's, 170 are another company's, 9 name neither.
 *
 *     window   the filer's own tables admitted   another company's published
 *        400            10/158   6.3%                    0/170   0.0%
 *        500            23/158  14.6%                    0/170   0.0%
 *        600            29/158  18.4%                    3/170   1.8%
 *      1,000            50/158  31.6%                    9/170   5.3%
 *      2,400            68/158  43.0%                   19/170  11.2%
 *     12,000           112/158  70.9%                   85/170  50.0%
 *
 * The two distributions sit on top of each other, exactly as the proximity rule
 * in `shared-page.ts` did. The widest window that mis-attributes nothing is 500
 * and it reads 14.6% of the filer's own tables; no window up to 12,000 reaches
 * 95% of them, and by then it is publishing half of everyone else's. Matching
 * the name without its corporate suffix moves both curves together — 16.2%
 * recall at 500, and the first mis-attribution arrives at 300.
 *
 * THE REASON IS STRUCTURAL AND NO BOUND FIXES IT. A statutory advertisement
 * SIGNS OFF with the company's name — "For and on behalf of the Board of
 * Directors, <COMPANY>, Sd/-" — and the next advertiser's banner and table
 * follow immediately underneath. So the filer's name appearing above a table is
 * systematically ambiguous: it is either the banner of its own table or the
 * signature at the foot of it, and the second sits directly above somebody
 * else's. RateGain's page (seqId 106731309) is the measured case: RATEGAIN
 * TRAVEL TECHNOLOGIES LIMITED is 508 characters above a column header whose
 * table belongs to SHYAM CENTURY FERROUS LIMITED, whose own banner is 414
 * characters above it. Eight more pages leak inside 1,000 characters.
 *
 * A missed table is a line nobody sees. A full financial statement published
 * under the wrong company's name is the SANOFI failure with figures attached,
 * so the category stays out until a mechanism is measured that does not have
 * this shape.
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
 *   - `Copy of Newspaper Publication` (539 live) carries a genuine results
 *     statement on 143 of the 408 pages whose text is on disk, and is refused
 *     anyway because no measured rule attributes a table on such a page to the
 *     filer. The distribution is in the module header above.
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

  // READ THROUGH THE STRUCTURAL PROJECTION, not the raw text. `pdf-parse`
  // renders some documents one word per line, and this test then answers "no
  // row labels" about a filing whose first table says `Total income`. GKENERGY
  // (seqId 106730500) is the measured case: 22,708 characters, 1,495 " \n"
  // pairs, two complete Regulation 33 statements, refused. 19 of the 124
  // filings carrying this refusal become eligible on whitespace alone.
  //
  // Only the boolean test is projected. `basisMarkersIn` below reads the STORED
  // text on purpose — it returns character offsets that `governingBasis` then
  // measures reach against, and offsets taken from a normalised string would
  // point into a document that does not exist.
  if (!RESULTS_STATEMENT_PATTERN.test(forStructuralTest(documentText))) {
    return not("the document states none of a results statement's row labels");
  }

  if (basisMarkersIn(documentText).length === 0) {
    return not(
      'the document carries no consolidated or standalone statement heading',
    );
  }

  return { eligible: true };
}
