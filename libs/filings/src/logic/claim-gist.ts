import { findVerbatimSpan } from './claim-span';

/**
 * The gate for a claim's SHORT FORM — the one line a card leads with.
 *
 * ================================================================
 * WHY THIS IS NOT A SUMMARY, AND MAY NEVER BECOME ONE
 * ================================================================
 *
 * `claim-summary.ts` states the rule this module lives under: compressed
 * prose over a document cannot be checked, so it is stored in its own
 * field, never published, and never counted as a claim. A gist is the
 * opposite construction and that is the entire point — it is a
 * CONTIGUOUS SLICE OF THE DOCUMENT'S OWN SENTENCE, so the same matcher
 * that admits a claim admits it, character for character. The model
 * chooses which words; it never gets to write any.
 *
 * A model that returns a fluent paraphrase gets `not-found` here and the
 * filing keeps its full claim. That is the design working, not failing.
 *
 * ================================================================
 * THE OTHER FOUR RULES ARE ABOUT MEANING, NOT PROVENANCE
 * ================================================================
 *
 * A slice can be perfectly verbatim and still say something the sentence
 * did not. Each rule below was written against a claim this product has
 * actually published (measured over the 2,000 most recent verified
 * filings, 2026-08-19):
 *
 *  - CONDITION DROPPED. "…approved, subject to shareholder approval"
 *    sliced before the comma states a done deal. If the span carries a
 *    condition, a negation or a reversal, the gist must carry it too.
 *  - FIGURE LOST. "CareEdge reaffirmed CARE A; Stable rating on
 *    facilities of Rs 60.90 crore" sliced at the semicolon keeps the
 *    rating and drops the money. A span that prints a figure needs a
 *    gist that prints one.
 *  - DANGLING END. "…of Rs 10 each for FY ended March 31" — a date cut
 *    from its year. Refused: it reads as a rendering fault.
 *  - NO GAIN. A gist that saves a handful of characters is churn on the
 *    reader for nothing; below the threshold the claim stands.
 *
 * Every refusal is NAMED and returned. A gate whose refusals are
 * invisible cannot be told from one that is not running — the rule
 * `claim-verify.ts` opens with.
 */

/**
 * MEASURED ON PRODUCTION, 2026-08-19: across 2,000 verified filings the
 * claim a card leads with runs to a median of 107 characters, p90 162,
 * max 198. At the deck's 21px a 390px phone holds ~35 characters a line,
 * so 100 is three lines — the point at which a headline stops being one.
 */
export const GIST_MAX_CHARS = 100;

/** Below this a slice is a fragment, not a shorter sentence. */
export const GIST_MIN_CHARS = 45;

/**
 * The gist must be shorter than the claim by enough to be worth showing
 * a reader a second version of the line. 0.8 = a fifth off, at least.
 */
export const GIST_MAX_RATIO = 0.8;

export type GistRefusal =
  /** Not a slice of the span: the model wrote rather than chose. */
  | 'not-found'
  | 'too-long'
  | 'too-short'
  | 'no-gain'
  | 'figure-lost'
  | 'condition-dropped'
  | 'dangling-end';

export type GistVerdict =
  | { readonly ok: true; readonly gist: string }
  | { readonly ok: false; readonly refused: GistRefusal };

/** Conditions, negations and reversals: dropping one changes the fact. */
const CONDITIONAL =
  /\b(?:not|nor|without|subject to|pending|proposed|withdrawn|cancelled|revoked|deferred|postponed|revised|except|unless|conditional|contingent|in-?principle)\b/i;

/** Any printed figure. */
const FIGURE = /\d[\d,]*(?:\.\d+)?/;

/**
 * A slice may not end on a word that needs the next one, nor halfway
 * through a date.
 */
const DANGLING =
  /(?:\b(?:of|for|to|at|on|in|by|with|from|and|or|the|a|an|per|as|its|their|that|which)|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)[\s,]*$/i;

export interface GistCandidate {
  /** What the model returned. */
  readonly candidate: string;
  /** The claim's stored span: the document's own bytes. */
  readonly span: string;
  /** The claim line the gist would replace. */
  readonly claimText: string;
}

/**
 * Accepts a proposed gist, or names the reason it cannot be published.
 *
 * THE STORED STRING IS THE DOCUMENT'S, NOT THE MODEL'S. What comes back
 * on success is the slice of the SPAN that matched — the same rule
 * `findVerbatimSpan` follows when it returns the document's own bytes
 * rather than the caller's tidied version of them.
 */
export const verifyGist = ({
  candidate,
  span,
  claimText,
}: GistCandidate): GistVerdict => {
  const proposed = String(candidate).trim();
  if (proposed.length > GIST_MAX_CHARS)
    return { ok: false, refused: 'too-long' };
  if (proposed.length < GIST_MIN_CHARS) {
    return { ok: false, refused: 'too-short' };
  }

  // Character-exact against the span, through the same canonical
  // projection every claim is admitted by. A paraphrase dies here.
  const match = findVerbatimSpan(span, proposed);
  if (match === null) return { ok: false, refused: 'not-found' };
  const gist = match.evidence.trim();

  if (gist.length > String(claimText).trim().length * GIST_MAX_RATIO) {
    return { ok: false, refused: 'no-gain' };
  }
  if (FIGURE.test(span) && !FIGURE.test(gist)) {
    return { ok: false, refused: 'figure-lost' };
  }
  if (CONDITIONAL.test(span) && !CONDITIONAL.test(gist)) {
    return { ok: false, refused: 'condition-dropped' };
  }
  if (DANGLING.test(gist)) return { ok: false, refused: 'dangling-end' };

  return { ok: true, gist };
};
