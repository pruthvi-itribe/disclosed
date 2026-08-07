import { isRoutine } from './taxonomy';

/**
 * The two content gates that decide whether a filing becomes a message.
 *
 * EXTRACTED SO THERE IS ONE COPY. Two paths now send Telegram messages about a
 * filing: the poller's immediate alert, and the background worker's follow-up
 * when the source PDF yields a verified amount. If each carried its own copy of
 * "is this routine, and is this symbol watched", an operator could set a
 * watchlist, see the primary lane fall silent, and still receive the enrichment
 * lane in full — a filter that half worked, which is worse than none.
 *
 * ================================================================
 * WHY THEY ARE TWO FUNCTIONS AND NOT ONE
 * ================================================================
 *
 * They used to be one, `passesContentGates`, and it folded two unrelated things
 * together: `isNotRoutine` is a fact ABOUT THE FILING, and the operator's
 * `OPERATOR_WATCHLIST` is a fact about ONE PERSON'S PREFERENCES. That is
 * harmless while the operator is the only subscriber and a bug the moment they
 * are not: with per-user watchlists in the same process, an operator who sets
 * `OPERATOR_WATCHLIST=RELIANCE` would silence every subscriber watching TCS,
 * forever, with no error raised anywhere.
 *
 * So the routine gate applies to EVERY lane and the operator watchlist applies
 * to the OPERATOR LANES ONLY. The two Telegram call sites compose both; anything
 * fanning out to users calls `isNotRoutine` alone.
 *
 * The cold-start ALERT WINDOW is deliberately not here. It is a different kind
 * of gate — it asks about time rather than content, it needs a clock, and
 * `alert-window.ts` already owns it for both callers.
 */

/**
 * Uppercases and trims, so the two sides of a watchlist comparison are
 * normalised identically. A config value arrives as
 * `OPERATOR_WATCHLIST=RELIANCE, TCS` split on commas, which leaves a leading
 * space on every entry but the first.
 */
export const normaliseSymbol = (symbol: string): string =>
  symbol.trim().toUpperCase();

/**
 * Blank entries are dropped rather than kept as members that match nothing.
 *
 * `OPERATOR_WATCHLIST=` parses to `['']`, not `[]`. Kept as a real entry it
 * matches no symbol and mutes the bot completely — and because the failure mode
 * is "no alerts" rather than an error, a dead channel is indistinguishable from
 * a quiet market. Dropped, it takes the documented empty-watchlist branch and
 * means what the operator wrote: no watchlist.
 */
export const normaliseWatchlist = (
  watchlist: readonly string[],
): ReadonlySet<string> =>
  new Set(watchlist.map(normaliseSymbol).filter((symbol) => symbol.length > 0));

/**
 * THE GATE EVERY LANE APPLIES: is this filing's category one nobody wants a
 * message about.
 *
 * A fact about the filing, so it holds for the operator's channel and for any
 * subscriber alike. Reads `category`, which throws a TypeError on a malformed
 * record, so callers must invoke it from inside their own per-filing
 * containment.
 */
export function isNotRoutine(filing: { readonly category: string }): boolean {
  return !isRoutine(filing.category);
}

/**
 * THE GATE ONLY THE OPERATOR'S LANES APPLY: is this symbol one the operator
 * asked their own channel to carry.
 *
 * An EMPTY watchlist means every symbol, which is the documented default.
 * Reads `symbol`, which throws a TypeError on a malformed record, so callers
 * must invoke it from inside their own per-filing containment.
 *
 * NOT FOR A SUBSCRIBER. A user's watchlist is a document in `watchlists`, not
 * this set, and passing a filing through this on a user's behalf is the bug the
 * header describes.
 */
export function isWatchedByOperator(
  filing: { readonly symbol: string },
  watchlist: ReadonlySet<string>,
): boolean {
  if (watchlist.size === 0) return true;
  return watchlist.has(normaliseSymbol(filing.symbol));
}
