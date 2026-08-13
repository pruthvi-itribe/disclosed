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
 * The most claims one wire line may carry.
 *
 * THE PRESENTATION BOUND, and the only one of the two that belongs here.
 * `verifyClaims` now keeps up to `MAX_CLAIMS_EXTRACTED` so a dense document is
 * read for everything it states; this is what a reader sees of that in a
 * Telegram message they scan in one glance.
 *
 * IT MUST BE AN EXPLICIT COUNT, not a consequence of the character bound below.
 * While extraction and presentation shared a limit of three, the character
 * bound could never fire and was documented as a backstop. Handing the composer
 * twelve claims without this line would make that backstop the thing silently
 * deciding what a reader sees — a limit nobody chose, expressed in characters,
 * on a decision that is about attention.
 */
export const MAX_CLAIMS_ON_WIRE = 3;

/**
 * The longest line that may be composed.
 *
 * A BACKSTOP RATHER THAN A WORKING CONSTRAINT, and sized so it stays one.
 * `MAX_CLAIMS_ON_WIRE` claims of `MAX_CLAIM_CHARS` characters — that gate is
 * `length > MAX_CLAIM_CHARS`, so a claim of exactly 200 passes it — plus two
 * separators plus a `SYMBOL: ` head cost `600 + 8 + symbol.length + 2`, which
 * is `symbol.length + 610`. That is 624 for the 14-character symbol
 * `claim-line.spec.ts` composes with, and inside 640 for any symbol up to 30
 * characters; the longest in the 33-day corpus is 12 (`symbol-validate.ts`).
 * So a line assembled from claims `verifyClaims` has already accepted always
 * fits and this bound never fires in production. It exists because the
 * composer is also reachable with claims that did not come through that path,
 * and because a message a Telegram client refuses to render is a filing lost.
 *
 * RAISED FROM 400 ON 2026-08-13, WITH the storage bound it is derived from. At
 * `MAX_CLAIM_CHARS` of 120 the same arithmetic gave `symbol.length + 370` —
 * the 382 this comment used to quote, for a 12-character symbol — and 400
 * held. Leaving 400 in place while the storage bound moved to 200 would have
 * made this a WORKING constraint, quietly publishing two claims where three
 * were verified: the exact failure the paragraph above exists to prevent.
 * Telegram's own message limit is 4,096, so 640 is not close to anything that
 * matters.
 *
 * When it does fire it DROPS the tail rather than truncating: half a claim is a
 * different claim.
 */
export const MAX_CLAIM_LINE_CHARS = 640;

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
    if (parts.length === MAX_CLAIMS_ON_WIRE) break;
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
