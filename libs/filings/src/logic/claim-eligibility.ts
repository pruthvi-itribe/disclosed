import type { Filing } from '../filing.types';
import { isLegallyBlocked } from './legal-block';
import { isRoutine } from './taxonomy';

/**
 * Which filings are worth spending a model call on.
 *
 * ================================================================
 * THIS IS THE COST CONTROL, AND IT IS DETERMINISTIC ON PURPOSE
 * ================================================================
 *
 * ~700 documents a day reach the worker. Sending every one to a frontier model
 * would be both wasteful and pointless: 147 of the 1,075 filings in the live
 * collection are newspaper-publication scans, 27 are record-date notices, and
 * a large share of the rest are covering letters whose entire content is "the
 * enclosed is enclosed". None of those contain a notable claim, and no amount
 * of model capability makes one appear.
 *
 * So four cheap tests run first, in this order, and each is a regex or a set
 * lookup over text already in memory:
 *
 *   1. the category is one where a company states things about itself
 *   2. the filing carries no legal exposure
 *   3. the document is long enough to be more than a covering letter
 *   4. the document uses at least one word from the claim vocabulary
 *
 * ================================================================
 * WHY A CATEGORY ALLOWLIST AND NOT A BLOCKLIST
 * ================================================================
 *
 * The opposite of the amount extractor's choice, and deliberately so. The
 * extractor refuses to gate on category because its anchors are structural and
 * hold whatever the category says. This gate is not about correctness at all —
 * a claim from an unusual category would still have to survive the verbatim
 * gate — it is about not paying for calls that cannot pay back. Failing closed
 * costs a claim from a category nobody has added yet, which is recoverable by
 * adding it; failing open costs money on every newspaper scan, forever.
 */

/**
 * Categories where a company states things about itself in prose.
 *
 * Chosen from the live collection's own distribution. The three at the top are
 * where every one of the competitor's published lines came from — an investor
 * presentation, a press release and an earnings-call intimation — and the rest
 * are the categories whose documents are narrative rather than tabular.
 *
 * ================================================================
 * `Outcome of Board Meeting` WAS EXCLUDED, AND THAT WAS WRONG
 * ================================================================
 *
 * This list used to carry a comment excluding the category as "almost entirely
 * results tables the amount extractor already reads". Both halves were false.
 *
 * The first half: 200 of the 1,699 live filings are in this category and 64.4%
 * of the 1,346 in the recorded month say in their own exchange summary that they
 * carry financial results — so a third of them are NOT results tables at all.
 * They are dividend declarations, fundraising approvals, plant approvals and
 * business updates, and every one of them was refused before a model was called.
 *
 * The second half: the amount extractor does not read a results table and cannot.
 * It returns ONE rupee figure — the value of a single disclosed event — and it
 * refuses a statement of accounts outright, because a statement has no single
 * material amount in it. What a results filing carries is a SET of figures with
 * their year-ago comparisons, which is a different shape needing a different
 * gate: `results-eligibility.ts` and `results-verify.ts`.
 *
 * So the category is admitted here for the claims it genuinely carries, and the
 * results lane reads the table separately. APOLLOTYRE seqId 106729105 is the
 * filing that proved it: 69,723 characters of consolidated and standalone
 * statements, `enrichment.state=enriched`, `claims: []`, and the recorded reason
 * "Outcome of Board Meeting is not a claim-bearing category".
 *
 * Still deliberately NOT here: `Copy of Newspaper Publication` (241 live, raster
 * scans of adverts), `Record Date`, `Shareholders meeting` and the whole
 * board-change family, which name people and are blocked downstream anyway; and
 * `Clarification - Financial Results` / `Reply to Clarification- Financial
 * results`, which are the exchange's discrepancy correspondence rather than a
 * company stating anything about itself — `results-eligibility.ts` argues those
 * two at length.
 */
export const CLAIM_BEARING_CATEGORIES: ReadonlySet<string> = new Set([
  'investor presentation',
  'press release',
  'analysts/institutional investor meet/con. call updates',
  'monthly business updates',
  'business update',
  'updates on acquisition',
  'acquisition',
  'agreements',
  'arrangements for strategic, technical, manufacturing, or marketing tie up',
  'joint venture',
  'capacity addition',
  'commencement of commercial production/operations',
  'product launch',
  'new product launch',
  'awarding of order(s)/contract(s)',
  'bagging/receiving of orders/contracts',
  'amalgamation/merger',
  'credit rating',
  'credit rating- new',
  'credit rating- revision',
  'disclosure of material issue',
  'integrated filing- financial',
  // Admitted by this work. See the argument above.
  'outcome of board meeting',
  'press release (revised)',
]);

/**
 * Characters below which a document is a covering letter and nothing else.
 *
 * Measured against the live collection: the median earnings-call intimation is
 * 1,967 characters and consists of two exchange addresses, one sentence saying
 * a recording exists, and a signature block. `WELENT`'s is 1,269 and says only
 * that an audio file is on the company website — there is no claim in it to
 * find, and the competitor's Welspun line was tagged `TV INTERVIEWS` because it
 * did not come from the filing either.
 *
 * Set at 1,500 rather than at the median, because the cost of being wrong is
 * asymmetric: a skipped claim is invisible, so the threshold sits low enough
 * that it only removes documents which are structurally incapable of carrying
 * one. The keyword gate below does the rest of the work.
 */
export const MIN_CLAIM_DOCUMENT_CHARS = 1_500;

/**
 * Vocabulary a document must use before it is worth reading for claims.
 *
 * DELIBERATELY BROAD. This is a cost filter, not a correctness one, and every
 * word it fails to include is a claim nobody will ever see was missed. It is
 * calibrated against the six lines the competitor actually published: guidance
 * and volume growth (`guidance`, `growth`), an adjusted-EBITDA target
 * (`target`, `ebitda`), a strengthened supply network and an expanding
 * commercial footprint (`network`, `expand`, `footprint`), and joining an
 * industry association (`join`, `partner`).
 *
 * A covering letter contains none of them: "please find enclosed", "take the
 * above on record", "the audio recording is available at the following link".
 */
export const CLAIM_SIGNAL_PATTERN =
  /\b(?:guidance|outlook|target\w*|expect\w*|anticipat\w*|aims?|aiming|on track|trajector\w*|growth|margins?|ebitda|revenue|volumes?|capacit\w*|expand\w*|expansion|footprint|network|commission\w*|commenc\w*|launch\w*|entered into|partner\w*|tie-?up|collaborat\w*|alliance|joins?|joined|member of|approv\w*|certif\w*|accredit\w*|clearance|licen[cs]e|acquir\w*|acquisition|divest\w*|stake|order book|greenfield|brownfield|plant|facility|facilities)\b/i;

export type ClaimEligibility =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reason: string };

const not = (reason: string): ClaimEligibility => ({ eligible: false, reason });

/**
 * Whether this filing's document is worth a model call.
 *
 * The reason is returned rather than a boolean so a filing that was never sent
 * can say why on the dashboard. "Nothing was found" and "nothing was looked
 * for" are opposite facts about a filing and must not render the same.
 */
export function claimEligibility(
  filing: Pick<Filing, 'category' | 'summary'>,
  documentText: string,
): ClaimEligibility {
  const category = filing.category.trim().toLowerCase();

  // Routine first: it is the cheapest test and it removes the largest single
  // block of the collection.
  if (isRoutine(filing.category)) {
    return not(`${filing.category} is a routine category`);
  }

  if (!CLAIM_BEARING_CATEGORIES.has(category)) {
    return not(`${filing.category} is not a claim-bearing category`);
  }

  // BEFORE the model, not after. A litigation or enforcement filing must never
  // reach an extractor at all — the cheapest way to be sure nothing is drafted
  // about a regulatory action is for nothing to be drafted.
  if (isLegallyBlocked(filing)) {
    return not('the filing carries legal exposure');
  }

  if (documentText.length < MIN_CLAIM_DOCUMENT_CHARS) {
    return not(
      `the document is ${documentText.length} characters, which is a covering letter`,
    );
  }

  if (!CLAIM_SIGNAL_PATTERN.test(documentText)) {
    return not('the document uses none of the claim vocabulary');
  }

  return { eligible: true };
}
