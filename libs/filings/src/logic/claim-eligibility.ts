import type { Filing } from '../filing.types';
import { isLegallyBlocked } from './legal-block';

/**
 * Which filings are read for insights, and the two reasons one is not.
 *
 * ================================================================
 * THIS WAS A CATEGORY ALLOWLIST, AND THE ALLOWLIST WAS THE BUG
 * ================================================================
 *
 * Until this rewrite, the first thing this function did was look the filing's
 * category up in a set of 22 names and refuse anything absent. It was justified
 * as a cost control — "failing closed costs a claim from a category nobody has
 * added yet, which is recoverable by adding it" — and that justification was
 * wrong in a way that took weeks to surface.
 *
 * `Outcome of Board Meeting` was not in the set. It is 1,346 of the 17,442
 * filings in the recorded month, 243 of the 2,085 live, and it is where a listed
 * company publishes its quarterly results. Every one of them was refused before
 * a model was called, and the refusal was invisible: a filing that was never
 * read renders exactly like a filing with nothing in it. **The largest recurring
 * event in an equity market's calendar produced no output at all, and the
 * dashboard looked healthy throughout.**
 *
 * Adding the category back fixed that instance. It did not fix the mechanism.
 * The mechanism is that a fail-closed test keyed on a name NSE controls will
 * silently drop the next thing NSE names differently — and NSE publishes 111
 * distinct categories, 44 of them five times or fewer, adding new ones without
 * notice.
 *
 * ================================================================
 * WHAT REPLACED IT, AND WHY THESE TWO TESTS CANNOT HIDE THE SAME GAP
 * ================================================================
 *
 * Two tests, and NEITHER LOOKS AT THE CATEGORY:
 *
 *   1. **Legal exposure.** Not a cost control and never was. A litigation,
 *      enforcement or insolvency filing must not reach an extractor at all,
 *      because the cheapest way to be sure nothing is drafted about a regulatory
 *      action is for nothing to be drafted. `legal-block.ts` owns it.
 *   2. **The document is a covering letter.** A structural property of the bytes
 *      in hand, measured in characters.
 *
 * The distinction that matters: **a test on the document cannot hide a
 * category.** If NSE invents `Quarterly Results Summary` tomorrow, it is read —
 * there is no list for it to be missing from. If a filing in a category nobody
 * anticipated carries a genuine business update, it is read. The only filings
 * skipped are ones this pipeline is holding and can see are empty, and it can
 * say so about each of them by name.
 *
 * ================================================================
 * WHAT WAS DELIBERATELY NOT KEPT
 * ================================================================
 *
 * **The vocabulary gate.** `CLAIM_SIGNAL_PATTERN` required a document to use one
 * of about forty words before a model saw it, and it refused 100 of the 932
 * live filings the gate has judged — 10.7%. It is the same fail-closed shape as
 * the category list wearing different clothes: a filing announcing that a
 * company has been admitted to an industry standards body states something worth
 * a line and need not contain any of `guidance`, `ebitda`, `capacity` or
 * `order book`. A cost filter that can only be shown to be safe by enumerating
 * every phrasing a company might use is not safe.
 *
 * **The routine-category list.** `taxonomy.ts` still owns it and it still
 * decides what reaches TELEGRAM, which is a volume problem with a measured
 * 388-messages-a-day constraint behind it. It is not reused here, and the
 * measurement says why: 98.1% of `Updates` summaries and 74.6% of
 * `General Updates` summaries state something their category does not — one of
 * them is a ₹-crore investment approval by a committee of directors. Those are
 * routine to ALERT on and are not empty.
 *
 * ================================================================
 * COST, MEASURED RATHER THAN FEARED
 * ================================================================
 *
 * The old comment argued that failing open "costs money on every newspaper scan,
 * forever". At the configured provider that is $0.00081 a document, so reading
 * every filing this pipeline stores is on the order of **$0.80 a day** at the
 * live rate of ~1,000 filings — which is a Q1-results-season peak, not an
 * average. That is not a number worth going blind on quarterly results for.
 */

/**
 * Characters below which a document is a covering letter and nothing else.
 *
 * Measured against the live collection: the median earnings-call intimation is
 * 1,967 characters and consists of two exchange addresses, one sentence saying
 * a recording exists, and a signature block. `WELENT`'s is 1,269 and says only
 * that an audio file is on the company website.
 *
 * Set at 1,500 rather than at the median, because the cost of being wrong is
 * asymmetric: a skipped document is invisible, so the threshold sits low enough
 * that it only removes documents which are structurally incapable of carrying
 * anything.
 *
 * NOTE that a filing skipped here still produces an OUTCOME and a CATEGORY
 * GROUP — see `filing-outcome.ts`. This decides whether a model reads the
 * document, not whether the filing appears. That separation is the whole of the
 * coverage fix: the expensive, fallible step became optional, and the row did
 * not.
 */
export const MIN_CLAIM_DOCUMENT_CHARS = 1_500;

/** Why a document was not read for insights. */
export type CoverageSkipReason =
  /** Litigation, enforcement, insolvency or fraud. A safety refusal. */
  | 'legal-exposure'
  /** The document is too short to be more than a covering letter. */
  | 'covering-letter';

export type ClaimEligibility =
  | { readonly eligible: true }
  | {
      readonly eligible: false;
      readonly skip: CoverageSkipReason;
      readonly reason: string;
    };

const not = (skip: CoverageSkipReason, reason: string): ClaimEligibility => ({
  eligible: false,
  skip,
  reason,
});

/**
 * Whether this filing's document is read for insights.
 *
 * The reason AND a machine-readable skip code are returned rather than a
 * boolean, so a filing that was never sent can say why on the dashboard and be
 * counted there. "Nothing was found" and "nothing was looked for" are opposite
 * facts about a filing and must not render the same — and after the results gap,
 * a skip that cannot be counted is a skip that can hide.
 *
 * NEVER THROWS. Reads `category` and `summary` through `isLegallyBlocked`, which
 * a malformed record would throw from, so callers invoke it inside their own
 * per-filing containment.
 */
export function claimEligibility(
  filing: Pick<Filing, 'category' | 'summary'>,
  documentText: string,
): ClaimEligibility {
  // FIRST, and before any consideration of what the document might be worth. A
  // filing carrying legal exposure must never reach an extractor.
  if (isLegallyBlocked(filing)) {
    return not('legal-exposure', 'the filing carries legal exposure');
  }

  if (documentText.length < MIN_CLAIM_DOCUMENT_CHARS) {
    return not(
      'covering-letter',
      `the document is ${documentText.length} characters, which is a covering letter`,
    );
  }

  return { eligible: true };
}
