import type { Filing } from '../filing.types';

/**
 * SEBI in an enforcement context, not any citation of its regulations.
 *
 * A bare /sebi/ matched 2,646 of 12,415 corpus records — almost all of it the
 * boilerplate every filing carries ("Pursuant to Regulation 30 of the SEBI
 * (LODR) Regulations"), which blocks order wins for citing the rulebook rather
 * than for being enforcement actions. Requiring an enforcement word within
 * `PROXIMITY` characters of the regulator's name cuts that to ~10 matches
 * without losing a single genuine action.
 */
const SEBI_ENFORCEMENT =
  'show[- ]?cause|adjudicat|penalt|penalis|order|notice|investigat|enforcement|debar|impound';

/** Characters allowed between the regulator and the enforcement word. */
const PROXIMITY = 60;

/**
 * Categories that carry defamation or SEBI exposure — never auto-drafted.
 *
 * Fails closed by design: a filing that merely looks like enforcement is worth
 * losing, because the cost of drafting content about a regulatory action that
 * did not happen is not symmetric with the cost of missing one post.
 */
export const LEGAL_BLOCK_PATTERNS: readonly RegExp[] = [
  /litigation|arbitration|court|tribunal/i,
  new RegExp(`\\bsebi\\b[\\s\\S]{0,${PROXIMITY}}(?:${SEBI_ENFORCEMENT})`, 'i'),
  new RegExp(`(?:${SEBI_ENFORCEMENT})[\\s\\S]{0,${PROXIMITY}}\\bsebi\\b`, 'i'),
  /\bshow[- ]?cause\b|\badjudicat|\benforcement\b/i,
  // Regulatory-action categories whose summaries are content-free ("has
  // informed the Exchange about Action(s) taken or orders passed"). Narrowing
  // the SEBI pattern removed the accidental cover these had been getting from
  // the boilerplate, so they are named explicitly. Without this rule 89
  // enforcement filings reach the candidate set.
  /action\(s\) (?:taken|initiated) or orders passed/i,
  /insolvency|ibc\b|nclt|liquidat/i,
  /auditor.*(resign|qualif)|qualif.*auditor/i,
  /whistle ?blower|fraud|default|misstatement/i,
];

/**
 * Whether a filing carries legal exposure that rules out auto-drafting.
 *
 * Matches on category as well as summary: the highest-risk categories have
 * content-free summaries, so the category is often the only signal present.
 */
export const isLegallyBlocked = (
  filing: Pick<Filing, 'category' | 'summary'>,
): boolean =>
  LEGAL_BLOCK_PATTERNS.some(
    (pattern) => pattern.test(filing.category) || pattern.test(filing.summary),
  );
