/**
 * Whether a verified claim is the company talking about a period still AHEAD,
 * and the words the document printed that say so.
 *
 * ================================================================
 * WHY THE KIND ALONE IS NOT ENOUGH
 * ================================================================
 *
 * `PLAN_CLAIM_KINDS` is the extractor's reading of a sentence, and a surface
 * headed "what this company says it plans" cannot rest on it. Measured over all
 * 813 claims stored under `guidance` or `target` on 2026-08-08, only 179
 * (22.0%) print a word about a period still ahead. The other 634 are last
 * quarter's figures, a declared dividend, an AGM date or a rating affirmation —
 * every one of them verbatim and true, and none of them a plan:
 *
 *   "Cash and Cash Equivalents (including investments) were at
 *    ₹ 4566.70 million as at June 30, 2026."                      GOLDIAM
 *   "To declare dividend at the rate of ₹1.50 per equity share"   INDUSINDBK
 *   "Approved convening 31 st AGM ... on Friday, September 25"    HGS
 *
 * Quoting those under that heading is a characterisation the document does not
 * support — which is the failure `claim-direction.ts` refuses when it will not
 * read a movement the filing did not print. So the page asks for BOTH: the
 * extractor filed it as forward-looking AND the sentence itself says so.
 *
 * ================================================================
 * WHAT THIS IS
 * ================================================================
 *
 * A word list over the SPAN — the document's own bytes, already matched
 * character for character by `claim-span.ts` — and nothing else. It calls no
 * model, computes nothing, and returns a slice of the sentence rather than a
 * phrase it composed, so every line the page shows can be checked against the
 * PDF by a reader who never leaves it.
 *
 * A NARROW LIST, DELIBERATELY, and `will` and `shall` are the measurement worth
 * keeping. Admitting them adds 42 claims — and a sample of 22 of those 42 split
 * almost exactly in half: eleven are real plans ("the current level of dividend
 * will be maintained despite higher capex", MGL; "our share of value-added
 * products ... will increase to almost 75%, 80%", APLAPOLLO) and eleven are
 * paperwork the future tense happens to be written in (a record date, an ESOP
 * pool, an AGM notice, a buyback's minimum size). Six per cent more coverage at
 * fifty per cent precision is a worse section, so they stay out. `outlook` is
 * out for a smaller reason: in this collection it is nearly always a rating
 * agency's word rather than the company's.
 *
 * The cost of that narrowness is measured and accepted: 179 claims, 22.0% of
 * the 813, across 124 filings and 109 companies — and KALYANKJIL's "September
 * we will be debt free" is one of the sentences it refuses. Refusing to quote
 * is the failure this product is built to prefer.
 *
 * ================================================================
 * ONE RULE, TWO SURFACES
 * ================================================================
 *
 * The feed's chip filters in Mongo with `PLAN_SPAN_PATTERN`; the company page
 * reads `planEvidence` off the response. They are the same pattern because two
 * rules would be two answers to one question — a chip promising plans that led
 * to a page holding none. The spaces in the phrases become `\s+` so that a
 * phrase the PDF broke across a line ("on\ntrack") is found in the stored bytes
 * as well as in the collapsed span the page reads.
 */

import { PLAN_CLAIM_KINDS, type ClaimKind } from './claim.types';

/**
 * The words a filing uses when it is talking about a period still ahead.
 *
 * Every one was read off matched spans in the live collection, and the count
 * beside it is how many of the 179 accepted claims it is the deciding word for
 * — measured 2026-08-08, and re-measure rather than re-guess:
 *
 *   guidance 29    expected 28   expect 26    target 16    expects 7
 *   planned 7      targeted 7    targeting 6  upcoming 5   targets 5
 *   on track 5     by <year> 17  over the next 3           plans to 3
 *   expecting 3    aims to 2     plan to 2    going forward 2
 *   next year 1    planning 1    intends to 1 projected 1  anticipate 1
 *   to be completed 1            coming years 1            looking ahead 1
 *
 * Written as regular-expression sources rather than plain words because the
 * inflections matter: `target` and `targeted` are the company setting one,
 * while `retargeting` is not, so every alternative sits inside one word-bounded
 * group below.
 *
 * EVERY GAP BETWEEN TWO WORDS IS `\s+` AND IS WRITTEN OUT, rather than a space
 * some later step rewrites. The first version substituted spaces wholesale and
 * turned the optional space in `FY ?27` into `FY\s+?27`, which requires one —
 * so "by FY31" stopped being a plan and "by FY 31" stayed one. A span carries
 * the line breaks of the PDF page it was set on, so the gaps have to tolerate a
 * newline; they must not start requiring whitespace that was never there.
 */
const PLAN_PHRASES: readonly string[] = [
  'expect(?:s|ed|ing)?',
  'anticipat(?:e|es|ed|ing)',
  'guidance',
  'target(?:s|ed|ing)?',
  'aim(?:s|ing)?\\s+to',
  'plan(?:s|ning)?\\s+to',
  'planned',
  'intend(?:s)?\\s+to',
  'on\\s+track',
  'projected',
  'looking\\s+ahead',
  'going\\s+forward',
  'over\\s+the\\s+next',
  'upcoming',
  'coming\\s+(?:months|quarters|years|year)',
  'next\\s+(?:year|quarter|financial\\s+year)',
  // A year the sentence is pointing AT. `by` is what makes it a deadline; the
  // same year without it is usually the period just reported ("for the
  // financial year ended March 31, 2026"). The space inside `FY 27` is optional
  // because both spellings are in the corpus.
  'by\\s+(?:FY\\s?[0-9]{2,4}|20[0-9][0-9])',
  'to\\s+be\\s+(?:completed|commissioned|operational|launched)',
  'roadmap',
];

/**
 * The same rule as one case-insensitive pattern, for a Mongo `$regex`.
 *
 * A CONSTANT, never assembled from caller input, so it is a fixed predicate
 * rather than a pattern a request chose — the distinction `readEnum` exists to
 * keep. Mongo reads the STORED span, line breaks and all, which is why the gaps
 * above are `\s+` rather than spaces; `planEvidence` reads the same span
 * collapsed and gets the same answer.
 */
export const PLAN_SPAN_PATTERN = `\\b(?:${PLAN_PHRASES.join('|')})\\b`;

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * The company's own forward-looking words in one verified claim, or null.
 *
 * NEVER THROWS and always answers. Null means one of three things and the
 * caller does not need to tell them apart, because all three end the same way —
 * the sentence is not quoted under a heading about plans: the claim is not one
 * of the two forward-looking kinds, the span is empty, or the document printed
 * no word about a period ahead.
 */
export function planEvidence(kind: ClaimKind, span: string): string | null {
  if (!PLAN_CLAIM_KINDS.includes(kind)) return null;
  if (typeof span !== 'string' || span.trim() === '') return null;

  const found = new RegExp(PLAN_SPAN_PATTERN, 'i').exec(collapse(span));
  return found === null ? null : found[0];
}
