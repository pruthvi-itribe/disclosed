/**
 * What a claim is, and every way one can fail to become a published line.
 *
 * TYPES ONLY. The vocabulary is here rather than spread across the modules that
 * use it because the DISCARD REASONS are the product: an extractor that refuses
 * is only trustworthy when its refusals are enumerable, countable and visible,
 * and every reason below is one the dashboard groups by and an operator can
 * click. A discard nobody can name is indistinguishable from a bug.
 */

/**
 * What kind of thing a claim states.
 *
 * Used to PRIORITISE, not to filter — the verification gate does not care which
 * of these a claim is. It exists because a document can hold more notable
 * statements than a wire line can carry, and "quantified guidance" outranks "a
 * new certification" when something has to be dropped.
 */
export type ClaimKind =
  /** A stated expectation about the company's own future numbers. */
  | 'guidance'
  /** A committed target with a date or a figure attached. */
  | 'target'
  /** New capacity, geography, plant, product or market. */
  | 'expansion'
  /** A partnership, tie-up, membership or customer win. */
  | 'partnership'
  /** A regulator's or a standards body's approval, licence or certification. */
  | 'approval'
  /** Anything else notable and stated as fact. */
  | 'operational';

export const CLAIM_KINDS: readonly ClaimKind[] = [
  'guidance',
  'target',
  'expansion',
  'partnership',
  'approval',
  'operational',
];

/**
 * Priority when a document offers more than the line can carry.
 *
 * Lower sorts first. Quantified forward statements lead because they are what a
 * reader cannot get from the category alone; `operational` is last because it
 * is the bucket for everything that did not fit a sharper description.
 */
export const CLAIM_KIND_RANK: Readonly<Record<ClaimKind, number>> = {
  guidance: 0,
  target: 1,
  expansion: 2,
  partnership: 3,
  approval: 4,
  operational: 5,
};

/** One claim as proposed by the extractor. UNVERIFIED — never publish this. */
export interface ProposedClaim {
  /**
   * The sentence from the document the claim was read from, quoted.
   *
   * Required, and the reason the whole design works: a claim whose span is not
   * in the document is discarded, so an invented statement has nothing to stand
   * on. See `claim-span.ts`.
   */
  readonly span: string;
  /** The compressed wire claim, before the gate and before uppercasing. */
  readonly text: string;
  readonly kind: ClaimKind;
}

/** One claim that survived every check. Safe to publish. */
export interface VerifiedClaim {
  readonly text: string;
  /**
   * The document's OWN bytes at the matched position, whitespace and all — not
   * the extractor's version of them.
   */
  readonly span: string;
  readonly kind: ClaimKind;
}

/** Why a proposed claim will not be published. */
export type ClaimDiscardReason =
  /** The quoted sentence is not in the document. The hallucination catch. */
  | 'span-not-found'
  /** The quote is too short to be evidence of anything, or absent. */
  | 'span-too-short'
  /** A figure in the claim is not in the sentence it was read from. */
  | 'number-not-in-span'
  /** Predictive, advisory or valuation framing. */
  | 'advisory-language'
  /** The claim is about a person. */
  | 'names-an-individual'
  /** Litigation, enforcement, insolvency or fraud. */
  | 'legally-blocked'
  /** The source sentence is conditional or reports a rumour. */
  | 'conditional-language'
  /** Nothing usable was proposed. */
  | 'empty-claim'
  /** Longer than a wire line may carry. */
  | 'too-long'
  /** The same claim, already accepted. */
  | 'duplicate'
  /** Good, but the line was already full. */
  | 'over-limit';

/** A discarded claim, with enough to review the decision. */
export interface ClaimDiscard {
  readonly reason: ClaimDiscardReason;
  /** What was proposed, bounded. Shown so a refusal can be checked. */
  readonly claim: string;
  /** Which rule fired, in words. */
  readonly detail: string;
}

/** Why a filing carries no claim line at all. */
export type ClaimRefusalReason =
  /** The cheap filters ruled the filing out before any model was called. */
  | 'not-eligible'
  /** The extractor was called and proposed nothing. */
  | 'no-claims'
  /** Everything proposed was discarded by the gate. */
  | 'all-discarded'
  /** No extractor is configured, so nothing was attempted. */
  | 'extractor-unavailable'
  /** The extractor failed. Distinct from "it found nothing". */
  | 'extractor-error';

/** Everything the claim stage produced for one filing. */
export interface ClaimOutcome {
  readonly claims: readonly VerifiedClaim[];
  readonly discards: readonly ClaimDiscard[];
  /** How many the extractor proposed. Null when it was never called. */
  readonly proposed: number | null;
  readonly refusalReason: ClaimRefusalReason | null;
  readonly refusalDetail: string | null;
}

/** The outcome of a filing nothing was attempted on. */
export const NO_CLAIMS: ClaimOutcome = {
  claims: [],
  discards: [],
  proposed: null,
  refusalReason: null,
  refusalDetail: null,
};
