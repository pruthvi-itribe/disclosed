import type { Filing } from '../filing.types';
import { isLegallyBlocked } from './legal-block';
import { companyIdentitiesIn, SHARED_PAGE_MIN_IDENTITIES } from './shared-page';

/**
 * Which filings are read for insights, and the three reasons one is not.
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
 * WHAT REPLACED IT, AND WHY THESE TESTS CANNOT HIDE THE SAME GAP
 * ================================================================
 *
 * Three tests, and NONE OF THEM LOOKS AT THE CATEGORY:
 *
 * (A fourth was added later and does read the category, for two names. It is
 * argued under TRIAGE below, and the argument is that a fail-OPEN test on a
 * name is not the fail-closed one this rewrite deleted.)
 *
 *   1. **Legal exposure.** Not a cost control and never was. A litigation,
 *      enforcement or insolvency filing must not reach an extractor at all,
 *      because the cheapest way to be sure nothing is drafted about a regulatory
 *      action is for nothing to be drafted. `legal-block.ts` owns it.
 *   2. **The document is a covering letter.** A structural property of the bytes
 *      in hand, measured in characters.
 *   3. **The document is a page several companies share.** Also a property of
 *      the bytes, and the only one of the three that is about ATTRIBUTION rather
 *      than about content: a newspaper page carries other companies' notices
 *      beside the filer's, and the verbatim gate cannot tell whose sentence it
 *      matched. `shared-page.ts` owns it, and names the claim that shipped
 *      wrong before it existed.
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
 *
 * ================================================================
 * TRIAGE: THE TWO KINDS THAT ARE NOT READ, AND WHAT THAT COSTS
 * ================================================================
 *
 * Money was never the constraint. TIME is. `docs/measurements/2026-08-11-
 * processing-audit.md` measured the worker at 20-40 documents an hour against
 * 1,042 arrivals in a day, running 7.2 h behind at p50 and 30.4 h at p99, with
 * 299 filings (5.9%) never read at all — and it measured where the time goes:
 * 90-180 seconds a document, essentially all of it the model calls.
 *
 * Two NSE categories are a third of that spend and return almost nothing.
 * Measured over the 4,680 enriched filings in the audit's window (§7b):
 *
 *   category                                  n     already   filings with   yield
 *                                                   skipped     >=1 claim
 *   Analysts/…/Con. Call Updates          1,022         250            171   16.7%
 *   Copy of Newspaper Publication            619         105             42    6.8%
 *
 * 1,641 documents, 35.1% of everything enriched, returning 213 claim-bearing
 * filings between them. Deducting what the covering-letter and shared-page
 * tests already refuse, this gate removes 772 + 514 = **1,286 model calls** —
 * 31.3% of the 4,113 that reached a model — at a cost of **the 213 claim-bearing
 * filings those calls would have produced**. That is the price, it was decided
 * with the number in front of it, and it is not a rounding error: at 1,286 calls
 * over the audit's 6.36 days and the measured 90-180 s each, it is 5 to 10 hours
 * of worker time given back per day.
 *
 * Re-run against the live collection on 2026-08-11 before this shipped, counting
 * only the enriched filings a model was actually called on (`coverageSkip` null),
 * the same two names select 518 newspaper pages returning 43 claim-bearing
 * filings and 786 intimations returning 176 — **1,304 of the 4,172 model calls
 * made, 31.3%, for 219 claim-bearing filings**. The audit's arithmetic and a
 * direct count four days later agree to a third of a percent.
 *
 * ONE MODEL CALL IS REMOVED PER FILING, NOT TWO. `resultsEligibility` already
 * refuses both names (`RESULTS_BEARING_CATEGORIES` does not contain either, and
 * `results-eligibility.ts`'s header argues the newspaper case at length from a
 * table-attribution sweep). Measured on the live collection the same day:
 * `resultsRefusalReason` is `not-eligible` on 623 of 623 and 1,040 of 1,040.
 *
 * WHY A CATEGORY NAME IS ALLOWED TO DECIDE THIS AND NOT THAT. CLAUDE.md's
 * invariant is "**Fail open on categories.** Never key a FAIL-CLOSED gate on a
 * category name NSE controls", and the allowlist above was fail-closed: a name
 * NSE invented or renamed fell OUT of the set, so the filing was silently
 * dropped and the dashboard looked healthy. This gate is the mirror image. The
 * names are in a REFUSAL set, so the failure direction is:
 *
 *   - NSE renames `Copy of Newspaper Publication` → the name misses the set →
 *     the filing is READ. Cost: model calls this gate meant to save. Visible as
 *     spend and latency. Nothing is hidden and no claim is lost.
 *   - NSE invents a new low-yield category → it is READ, exactly as
 *     `Some Future Category` is. There is no list for it to be missing from.
 *
 * The only way this gate loses a filing is if NSE keeps a name and changes what
 * is filed under it — and that failure is visible too, because every skipped
 * filing carries `coverageSkip` and the admin panel groups by it under "why no
 * model read the document". "Nothing was found" and "nothing was looked for"
 * stay separable, which is the whole reason the skip is a recorded code rather
 * than an early return.
 *
 * NOT GENERALISED. The audit hand-checked three more near-zero kinds —
 * `Trading Window` (17 filings, 0%), `Cessation` (25, 4.0%) and
 * `Resignation of Director/KMP/SMP` (39, 7.7%) — and they are deliberately NOT
 * here. Eighty-one filings between them buy no throughput worth the risk, and
 * each name added is one more thing that has to keep meaning what it meant. Two
 * names, 35.1% of the corpus, one measured decision.
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

/**
 * NSE's name for a scan of a statutory advertisement, lowercased.
 *
 * The exact string the processing audit grouped on, so the population this
 * refuses is the population that was counted: 619 enriched filings at a 6.8%
 * claim yield in the audit's window, 623 on the live collection four days later.
 * Compared against `category.trim().toLowerCase()`, which is how
 * `results-eligibility.ts` compares its own names.
 */
export const NEWSPAPER_PAGE_CATEGORY = 'copy of newspaper publication';

/**
 * NSE's name for an earnings-call intimation, lowercased.
 *
 * Also verbatim from the audit, full stop in `Con.` and all — NSE's spelling,
 * not a tidied version of it. 1,022 enriched filings at a 16.7% claim yield; 250
 * of them were already refused as covering letters, so what this name adds is
 * the 772 that are longer than a covering letter and say the same thing.
 */
export const CON_CALL_INTIMATION_CATEGORY =
  'analysts/institutional investor meet/con. call updates';

/** Why a document was not read for insights. */
export type CoverageSkipReason =
  /** Litigation, enforcement, insolvency or fraud. A safety refusal. */
  | 'legal-exposure'
  /** The document is too short to be more than a covering letter. */
  | 'covering-letter'
  /**
   * The document is a page several companies share. An attribution refusal.
   *
   * The verbatim gate proves a sentence is IN the document and says nothing
   * about whose sentence it is; on a newspaper page those come apart. See
   * `shared-page.ts` for the measurement and for the one that already shipped
   * wrong.
   */
  | 'shared-page'
  /**
   * A scan of a statutory newspaper advertisement. A triage refusal.
   *
   * DISTINCT FROM `shared-page`, which is a measured property of the bytes (four
   * or more company identities) and refuses 105 of these on its own. This one is
   * the category name, and it refuses the other 514 — pages that name too few
   * companies to trip the attribution rule and still yielded a claim on 6.8% of
   * the 619 measured. See TRIAGE in this module's header for the price.
   */
  | 'newspaper-page'
  /**
   * An intimation that an earnings call happened. A triage refusal.
   *
   * DISTINCT FROM `covering-letter`, which is a length test and already refuses
   * 250 of these. The remaining 772 are longer than 1,500 characters — an
   * agenda, a disclaimer, a transcript cover — and still state only that a
   * recording exists: a 16.7% claim yield over 1,022 measured.
   */
  | 'con-call-intimation';

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

  // LAST, because it is the most expensive test to run and the only one that can
  // be wrong in the direction of losing a real filing. The two above are about
  // whether there is anything to read; this one is about whether what is read
  // can be attributed to the company whose name would go on it.
  const identities = companyIdentitiesIn(documentText);
  if (identities.size >= SHARED_PAGE_MIN_IDENTITIES) {
    return not(
      'shared-page',
      `the document names ${identities.size} companies, so a sentence in it ` +
        'cannot be attributed to this filer',
    );
  }

  // LAST OF ALL, and after every test that reads the document, so a filing that
  // can be refused on its own bytes is refused on its own bytes. A category name
  // is the weakest evidence in this file and it gets the last word rather than
  // the first: the 105 newspaper pages the attribution rule catches keep saying
  // `shared-page`, the 250 short intimations keep saying `covering-letter`, and
  // what the two codes below count is exactly the model calls this gate — and
  // nothing else — removed.
  //
  // Fail-OPEN, which is the whole argument for reading a name here at all. A
  // renamed category misses this set and is READ; see TRIAGE in the header for
  // the failure directions and for the 213 claim-bearing filings knowingly
  // forgone.
  const category = filing.category.trim().toLowerCase();
  if (category === NEWSPAPER_PAGE_CATEGORY) {
    return not(
      'newspaper-page',
      'the document is a newspaper page, which yields a claim on 6.8% of them',
    );
  }
  if (category === CON_CALL_INTIMATION_CATEGORY) {
    return not(
      'con-call-intimation',
      'the document is an earnings-call intimation, which yields a claim on ' +
        '16.7% of them',
    );
  }

  return { eligible: true };
}
