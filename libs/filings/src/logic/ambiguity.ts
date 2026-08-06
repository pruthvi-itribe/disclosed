import { scanRupeeAmounts } from './rupee-parse';

/**
 * Conditional-language markers. A filing containing any of these is NOT a
 * confirmed event — "emerged as L1 bidder" is not "won the order". These force
 * manual review rather than auto-drafting, which is the exact error class seen
 * in competitor headlines.
 */
const AMBIGUITY_PATTERNS: readonly RegExp[] = [
  /\bL-?1\b/i,
  /\bletter of intent\b/i,
  /\bLoI\b/,
  /\bMoU\b/i,
  /\bmemorandum of understanding\b/i,
  /\bin-?principle\b/i,
  /\bpreferred bidder\b/i,
  /\bsubject to\b/i,
  // Rumour framing. An exchange clarification request restates an unverified
  // press claim, so its rupee figure is a journalist's number, not the
  // company's. Drafting from one publishes the rumour as fact.
  /\bnews verification\b/i,
  /\bsought clarification\b/i,
  /\brecent news item\b/i,
  /\bclarification on news\b/i,
  /\bnews item\b/i,
  /\bmedia report/i,
  /\breported in the media\b/i,
  /\bin the media\b/i,
  /\blikely to\b/i,
  /\bspeculat/i,
];

export const hasAmbiguityKeyword = (text: string): boolean =>
  AMBIGUITY_PATTERNS.some((pattern) => pattern.test(text));

/**
 * Extracts rupee amounts, normalised to rupees. Returns an empty array when the
 * text carries no figure — which for the newsjack lane means no hook, no post.
 *
 * The parsing itself lives in rupee-parse.ts, which also records where each
 * figure was found. This wrapper is the value-only view of the same scan, kept
 * here because the summary-level callers only ever needed the numbers.
 */
export function extractRupeeAmounts(text: string): number[] {
  return scanRupeeAmounts(text).map((match) => match.rupees);
}
