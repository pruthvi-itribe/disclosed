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
];

export const hasAmbiguityKeyword = (text: string): boolean =>
  AMBIGUITY_PATTERNS.some((pattern) => pattern.test(text));

const MULTIPLIERS: Readonly<Record<string, number>> = {
  crore: 10_000_000,
  cr: 10_000_000,
  lakh: 100_000,
  lac: 100_000,
};

const AMOUNT_PATTERN =
  /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d+)?)\s*(crore|cr|lakh|lac)\b/gi;

/**
 * Extracts rupee amounts, normalised to rupees. Returns an empty array when the
 * text carries no figure — which for the newsjack lane means no hook, no post.
 */
export function extractRupeeAmounts(text: string): number[] {
  const amounts: number[] = [];
  for (const match of text.matchAll(AMOUNT_PATTERN)) {
    const value = Number(match[1].replace(/,/g, ''));
    const multiplier = MULTIPLIERS[match[2].toLowerCase()];
    if (Number.isFinite(value) && multiplier) {
      amounts.push(value * multiplier);
    }
  }
  return amounts;
}
