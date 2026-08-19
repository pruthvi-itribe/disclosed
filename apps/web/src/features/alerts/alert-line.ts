import { briefGist } from '../../shared/format/gist';
import type { ClaimView, FilingView } from '../../shared/types/api';

/**
 * The ONE LINE a notification carries.
 *
 * ================================================================
 * A NOTIFICATION IS NOT A CARD
 * ================================================================
 *
 * A card has a lede, two more claims and a footer, and a reader chooses
 * to open it. A notification arrives uninvited, gets about two lines
 * before the platform elides it, and is read in a second. So it carries
 * the shortest form of ONE claim and nothing else — no second claim, no
 * category, no counts. The title already says who filed and why this
 * reader is being told.
 *
 * ================================================================
 * IT NEVER TRUNCATES, AND THAT IS THE POINT
 * ================================================================
 *
 * The old body was `line.slice(0, 139) + '…'`. A blind character cut on
 * a claim whose median length is 107 and p90 is 162 lands mid-word most
 * times it fires — and once in a while it lands just before "subject to
 * shareholder approval", turning a conditional into a fact in a banner
 * the reader cannot check.
 *
 * So the shortening is only ever done by something that can refuse:
 *
 *   1. the STORED GIST — a slice of this claim verified by the same
 *      gate the card's headline uses (`claim-gist.ts`);
 *   2. the CLIENT'S OWN CUT — a prefix ending at a boundary the claim
 *      printed (`shared/format/gist.ts`), which returns the claim whole
 *      when it cannot cut safely;
 *   3. the CLAIM ITSELF, whole.
 *
 * There is deliberately no fourth step. When nothing can shorten the
 * line, the platform elides it — a reader knows an OS ellipsis is the
 * screen running out, where a line we cut ourselves reads as the whole
 * of what was said.
 */
export const alertLine = (
  filing: FilingView,
  matched: ClaimView | null,
): string => {
  const claims = filing.enrichment?.claims ?? [];
  const claim = matched ?? claims[0] ?? null;
  // The card-length outcome sentence: the fallback for the rare verified
  // filing that carries no claim line at all.
  if (claim === null) return filing.outcome;

  const stored = claim.gist ?? '';
  if (stored !== '') return stored;
  return briefGist(claim.text).line;
};
