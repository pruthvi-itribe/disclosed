import type { CoverageSkipReason } from './claim-eligibility';
import type { SummaryRefusalReason } from './claim-summary';

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
import type { ClaimTopic } from './claim-topic';

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
  /**
   * What the claim is about, derived from its text.
   *
   * SET BY `verifyClaims` ON EVERY CLAIM IT ACCEPTS, so anything this pipeline
   * writes from now on carries one. Still optional, and the option is about
   * READING rather than writing: claims stored before the classifier existed
   * have none, and a reader of one must be able to tell "not classified yet"
   * from "classified as nothing in particular" — which is what `other` means
   * and an absent field does not.
   */
  readonly topic?: ClaimTopic;
  /**
   * The document's own bytes around the heading that stated this claim's fiscal
   * period, when the period came from outside `span`. Null when the span stated
   * it itself, and null when the claim names no period.
   *
   * Present so an accepted "Q1 FY27 revenue of ₹125.2 Cr" can be reviewed
   * against a quote that actually mentions Q1 FY27. See `claim-period.ts`.
   */
  readonly periodSpan: string | null;
}

/** Why a proposed claim will not be published. */
export type ClaimDiscardReason =
  /** The quoted sentence is not in the document. The hallucination catch. */
  | 'span-not-found'
  /** The quote is too short to be evidence of anything, or absent. */
  | 'span-too-short'
  /** A figure in the claim is not in the sentence it was read from. */
  | 'number-not-in-span'
  /**
   * The claim names a fiscal period the sentence and its neighbourhood do not.
   *
   * KEPT APART from `number-not-in-span` on purpose: attributing a real figure
   * to the wrong quarter and inventing a figure outright are different errors
   * with different remedies, and folding them into one count would hide a model
   * that had started doing the first.
   */
  | 'period-not-in-context'
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
  /**
   * The machine-readable code for why no model read this document.
   *
   * SEPARATE FROM `refusalReason`, which says what the CLAIM LANE produced.
   * "The document was never sent to a model" and "the model was sent it and
   * found nothing" are the two facts the results gap made indistinguishable,
   * and only one of them is a decision this pipeline made. Null when a model
   * was called. `claim-eligibility.ts` owns the vocabulary.
   */
  readonly skip: CoverageSkipReason | null;
  /**
   * The model's own prose summary, vetted but NOT verified.
   *
   * Carried alongside the claims rather than among them. Nothing downstream
   * may treat this as a claim: it reaches no wire line, no alert and no
   * published surface. See `claim-summary.ts`.
   */
  readonly summary: string | null;
  readonly summaryRefusalReason: SummaryRefusalReason | null;
}

/** The outcome of a filing nothing was attempted on. */
export const NO_CLAIMS: ClaimOutcome = {
  claims: [],
  discards: [],
  proposed: null,
  refusalReason: null,
  refusalDetail: null,
  skip: null,
  summary: null,
  summaryRefusalReason: null,
};
