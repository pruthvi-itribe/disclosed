import { advisoryHitIn } from './claim-advisory';
import { LEGAL_BLOCK_PATTERNS } from './legal-block';

/**
 * The model's own prose summary of a document, and everything it is not.
 *
 * ================================================================
 * A SUMMARY IS NOT A CLAIM, AND THE DIFFERENCE IS THE WHOLE MODULE
 * ================================================================
 *
 * Every claim this pipeline publishes carries the sentence it was read from,
 * matched character for character against the source. That is what makes a
 * claim publishable: a reader can check it, and an invented one dies at the
 * gate. A SUMMARY CANNOT BE CHECKED THAT WAY. It is compressed prose over a
 * whole document, so there is no single sentence to match it against and no
 * gate that can tell a faithful summary from a fluent invention.
 *
 * So it is treated as what it is — model output, unverified — and the design
 * follows from that one fact:
 *
 *   1. **It is stored in its own field**, `documentSummary`, and is never
 *      appended to `claims`, never composed into `claimLine`, and never
 *      counted as one. A reader of the claim list must not have to know which
 *      entries were verified.
 *   2. **It NEVER reaches the wire.** `formatInsightAlert` is not given it and
 *      the worker does not pass it. Telegram is the outward-facing surface and
 *      the one thing that must carry only what the document says.
 *   3. **The dashboard marks it as model-generated**, next to verified claims
 *      that are visually distinct from it.
 *   4. **The output filters still run.** They are not verification — nothing
 *      here checks whether the summary is TRUE — but a summary that tells a
 *      reader what to do with a security is the SEBI research-analyst line
 *      whether or not anybody publishes it, and a summary about litigation is
 *      exposure sitting in a database.
 *
 * ================================================================
 * WHY THE INDIVIDUAL FILTER IS DELIBERATELY NOT APPLIED
 * ================================================================
 *
 * `claim-verify.ts` fails closed on any claim naming a person, because a wire
 * line about a person is a defamation claim rather than a correction. A summary
 * reaches no wire. And the largest category this pipeline has just stopped
 * being blind to — `Resignation of Director/KMP/SMP`, 213 filings a month, 100%
 * ZIP — is by definition about people: applying the individual filter here
 * would refuse a summary on every one of them and leave the category as
 * invisible as it was before the archives were opened.
 *
 * The protection that matters is that the summary is never published, and that
 * is enforced where publication happens rather than by refusing to write the
 * thing down.
 */

/**
 * The longest summary kept.
 *
 * Two sentences. Long enough to say what a filing is about, short enough that
 * it cannot become a substitute for reading the document — and short enough
 * that a model which starts writing an essay is truncated rather than stored.
 */
export const MAX_SUMMARY_CHARS = 400;

/** Below this it is a fragment rather than a summary. */
export const MIN_SUMMARY_CHARS = 20;

/** Why a document carries no summary. */
export type SummaryRefusalReason =
  /** The model returned nothing, or something too short to be prose. */
  | 'empty'
  /** Predictive, advisory or valuation framing about the security. */
  | 'advisory-language'
  /** Litigation, enforcement, insolvency or fraud. */
  | 'legally-blocked';

export interface SummaryAccepted {
  readonly outcome: 'ok';
  /** Whitespace-collapsed, bounded, and NOT verified against the document. */
  readonly summary: string;
}

export interface SummaryRefused {
  readonly outcome: 'refused';
  readonly reason: SummaryRefusalReason;
  readonly detail: string;
}

export type SummaryVerdict = SummaryAccepted | SummaryRefused;

const CONTROL_CHARACTERS = /\s+/g;

/**
 * Bounds and filters a model-written summary.
 *
 * NEVER THROWS. An absent, empty or unusable summary is a refusal with a
 * reason, exactly as an unusable claim is — "the model wrote nothing" and
 * "what it wrote was refused" are different facts about a document and a
 * dashboard that rendered them the same would hide a broken extractor.
 *
 * TRUNCATION IS NOT AN OPTION. A summary over the bound is refused rather than
 * cut, because half a sentence of model prose about a listed company reads as
 * a statement the model did not make.
 */
export function vetSummary(raw: unknown): SummaryVerdict {
  if (typeof raw !== 'string') {
    return { outcome: 'refused', reason: 'empty', detail: 'no summary' };
  }

  const text = raw.replace(CONTROL_CHARACTERS, ' ').trim();
  if (text.length < MIN_SUMMARY_CHARS) {
    return {
      outcome: 'refused',
      reason: 'empty',
      detail: `the summary is ${text.length} characters, which is a fragment`,
    };
  }
  if (text.length > MAX_SUMMARY_CHARS) {
    return {
      outcome: 'refused',
      reason: 'empty',
      detail: `${text.length} characters exceeds the ${MAX_SUMMARY_CHARS} a summary may carry`,
    };
  }

  // A prompt is a request and a filter is a control, exactly as in
  // `claim-verify.ts`. One unhonoured instruction is "positive for the stock"
  // sitting in a database against a named listed company.
  const advisory = advisoryHitIn(text);
  if (advisory !== null) {
    return {
      outcome: 'refused',
      reason: 'advisory-language',
      detail: advisory,
    };
  }

  const legal = LEGAL_BLOCK_PATTERNS.find((pattern) => pattern.test(text));
  if (legal !== undefined) {
    return {
      outcome: 'refused',
      reason: 'legally-blocked',
      detail: 'the summary carries legal exposure',
    };
  }

  return { outcome: 'ok', summary: text };
}
