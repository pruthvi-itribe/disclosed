import type { OutcomeSource } from './filing-outcome';

/**
 * How much of what this pipeline says about a filing can be trusted.
 *
 * ================================================================
 * THE GATE STOPPED BEING A FILTER AND BECAME A LABEL
 * ================================================================
 *
 * `claimEligibility` used to decide whether a filing produced anything at all,
 * from a list of 22 categories. 71% of filings failed it and produced nothing —
 * no outcome, no line, no row worth looking at — and because a filing that was
 * never read looks exactly like a filing with nothing in it, the fact that
 * `Outcome of Board Meeting` was missing from the list stayed invisible for
 * weeks while the largest recurring event in an equity market's calendar went
 * unreported.
 *
 * The replacement is not a looser filter. It is a different mechanism: **nothing
 * is dropped, and everything is labelled by how much it can be trusted.** A
 * filing whose figures survived a character-for-character match against the
 * source document and a filing whose only description is the exchange's category
 * both appear; they carry different tiers and the tier decides what may be done
 * with them.
 *
 * ================================================================
 * WHY THREE TIERS AND NOT A SCORE
 * ================================================================
 *
 * Because each tier is a different KIND of evidence, not a different amount of
 * it, and the actions they permit differ in kind too:
 *
 *   `verified`  a span of the source document was found, character for
 *               character, and the number, period, statement basis, column and
 *               scale were all checked against the document's own header block.
 *               PUBLISHABLE AS FACT. This is what reaches Telegram.
 *
 *   `stated`    the EXCHANGE said this, in its own summary line, and said
 *               something its category does not already say. Not our claim and
 *               not a model's — NSE's. Strong provenance, but nobody has checked
 *               it against the attached document, and the summary is written by
 *               the filer. Dashboard and teardown material.
 *
 *   `labelled`  all that is known is what kind of filing this is. The exchange's
 *               summary restated its category and nothing survived the verbatim
 *               gate. AN HONEST FLOOR, and it is emphatically not the same as
 *               "nothing happened" — 100% of `Investor Presentation` summaries
 *               are boilerplate, and an investor presentation is not a quiet
 *               filing.
 *
 * A single 0-to-1 score would collapse those into a number that invites a
 * threshold, and a threshold on a mixed scale is how a verified figure and a
 * confident-sounding summary end up on the same side of a line.
 *
 * ================================================================
 * THE TIER IS NOT A QUALITY JUDGEMENT
 * ================================================================
 *
 * `labelled` does not mean unimportant and `verified` does not mean interesting.
 * A verified claim can be an ESOP allotment nobody cares about; a `labelled`
 * investor presentation can be the most-read document of the day. The tier
 * answers exactly one question — how would somebody check this? — and
 * materiality is a separate judgement made separately.
 */

export const CONFIDENCE_TIERS = ['verified', 'stated', 'labelled'] as const;

export type ConfidenceTier = (typeof CONFIDENCE_TIERS)[number];

/** How a tier is spelled for a reader. */
export const CONFIDENCE_TIER_LABEL: Readonly<Record<ConfidenceTier, string>> = {
  verified: 'Verified',
  stated: 'Exchange-stated',
  labelled: 'Category only',
};

/**
 * What the pipeline managed to establish about one filing.
 *
 * BOOLEANS RATHER THAN THE OBJECTS THEMSELVES, so this module cannot be tempted
 * to look inside a claim and start judging its content. The three verified
 * sources are listed separately rather than pre-combined because they are
 * admitted by three different gates and a future reader needs to see that all
 * three were considered.
 */
export interface ConfidenceInput {
  /** At least one claim survived the verbatim span gate. */
  readonly hasVerifiedClaim: boolean;
  /** A results block survived the basis, column, period and scale checks. */
  readonly hasVerifiedResults: boolean;
  /** The amount extractor found a figure it could anchor to the document. */
  readonly hasVerifiedAmount: boolean;
  /** Whether the outcome line came from the exchange's words or its category. */
  readonly outcomeSource: OutcomeSource;
}

/**
 * The tier for one filing.
 *
 * PURE and total: every combination of inputs yields a tier, because a filing
 * without one is a filing the dashboard cannot render and the whole point is
 * that there are no longer any of those.
 */
export function confidenceTierFor(input: ConfidenceInput): ConfidenceTier {
  if (
    input.hasVerifiedClaim ||
    input.hasVerifiedResults ||
    input.hasVerifiedAmount
  ) {
    return 'verified';
  }
  return input.outcomeSource === 'exchange-summary' ? 'stated' : 'labelled';
}

/**
 * Whether a tier may reach an outward-facing wire.
 *
 * ================================================================
 * ONLY `verified`, AND THE REASON IS VOLUME AS WELL AS TRUTH
 * ================================================================
 *
 * The truth half is the obvious one: `stated` is the filer's own description of
 * their filing, relayed by the exchange, and nobody has checked it against the
 * document. Publishing it as though this pipeline had read it would be
 * attributing to ourselves a sentence we did not verify.
 *
 * The volume half is what makes this non-negotiable. `.env.example` documents
 * it and the poller warns about it at startup: 12,415 of 17,442 corpus filings
 * (71.2%) survive the routine-category gate, which is **about 388 Telegram
 * messages a day and a peak of 106 in one hour**. A channel at that volume gets
 * muted inside a day — and every operator alert (INGEST DEGRADED, BLIND, DRAIN
 * FAILED) is muted with it, so the pipeline goes dark exactly when it most needs
 * to be heard. Universal coverage on the dashboard is a feature; universal
 * coverage on Telegram is how the alerting channel dies.
 *
 * So this widened the dashboard to 100% and left the wire exactly where it was.
 * The alert path additionally applies the routine-category gate, the watchlist
 * and the cold-start window; this is the first of those tests, not the only one.
 */
export const isAlertableTier = (tier: ConfidenceTier): boolean =>
  tier === 'verified';
