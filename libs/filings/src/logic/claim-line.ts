import type { VerifiedClaim } from './claim.types';

/**
 * The wire line, in the convention the desk already reads.
 *
 *     SYMBOL: CLAIM IN CAPS
 *     SYMBOL: FIRST CLAIM || SECOND CLAIM
 *
 * Copied from the format the competitor publishes, because a wire convention is
 * worth nothing if it is not the one readers already parse. Three parts and no
 * others: the stored symbol, a colon, and the verified claims joined by ` || `.
 *
 * EVERY CHARACTER ORIGINATES IN A VERIFIED FACT. The symbol is the stored
 * field; each claim has already been matched against a verbatim span in the
 * source document, checked for advisory framing, checked for figures it cannot
 * support, and checked against the legal blocklist. This module adds no words —
 * it uppercases, joins, and bounds, and if it were removed the claims would say
 * exactly the same thing.
 *
 * There is deliberately no source tag. The competitor's lines sometimes carry
 * one (`TV INTERVIEWS`), and this pipeline holds exchange filings only, so a
 * tag here would either be a constant nobody needs or a claim about a source
 * this system never saw.
 */

/** What separates two claims about the same filing. */
export const CLAIM_SEPARATOR = ' || ';

/**
 * The longest line that may be composed.
 *
 * A BACKSTOP RATHER THAN A WORKING CONSTRAINT, and sized so it stays one. Three
 * claims of 120 characters, two separators and the longest NSE symbol come to
 * 382, so a line assembled from claims `verifyClaims` has already accepted
 * always fits and this bound never fires in production. It exists because the
 * composer is also reachable with claims that did not come through that path,
 * and because a message a Telegram client refuses to render is a filing lost.
 *
 * When it does fire it DROPS the tail rather than truncating: half a claim is a
 * different claim.
 */
export const MAX_CLAIM_LINE_CHARS = 400;

/** Collapses to one line and uppercases, in that order. */
const wireCase = (value: string): string =>
  value.replace(/\s+/g, ' ').trim().toUpperCase();

/**
 * Composes the line, or returns null when there is nothing to say.
 *
 * NULL RATHER THAN AN EMPTY STRING, and rather than a line carrying only the
 * symbol. "This filing produced no claim" and "this filing produced a claim
 * that happened to be blank" are different facts, and a bare `SYMBOL:` on the
 * wire reads as the second while meaning the first.
 *
 * Claims arrive already ranked by `verifyClaims`, so the head of the line is
 * the most notable thing the document said. Any claim that would push the line
 * past the bound is dropped rather than cut.
 */
export function composeClaimLine(
  symbol: string,
  claims: readonly VerifiedClaim[],
): string | null {
  const head = `${wireCase(symbol)}:`;
  if (head === ':') return null;

  const parts: string[] = [];
  let length = head.length;

  for (const claim of claims) {
    const text = wireCase(claim.text);
    if (text.length === 0) continue;
    const cost =
      text.length + (parts.length === 0 ? 1 : CLAIM_SEPARATOR.length);
    if (length + cost > MAX_CLAIM_LINE_CHARS) break;
    parts.push(text);
    length += cost;
  }

  return parts.length === 0 ? null : `${head} ${parts.join(CLAIM_SEPARATOR)}`;
}
