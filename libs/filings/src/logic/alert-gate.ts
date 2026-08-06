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
 * The cold-start ALERT WINDOW is deliberately not here. It is a different kind
 * of gate — it asks about time rather than content, it needs a clock, and
 * `alert-window.ts` already owns it for both callers.
 */

/**
 * Uppercases and trims, so the two sides of a watchlist comparison are
 * normalised identically. A config value arrives as `WATCHLIST=RELIANCE, TCS`
 * split on commas, which leaves a leading space on every entry but the first.
 */
export const normaliseSymbol = (symbol: string): string =>
  symbol.trim().toUpperCase();

/**
 * Blank entries are dropped rather than kept as members that match nothing.
 *
 * `WATCHLIST=` parses to `['']`, not `[]`. Kept as a real entry it matches no
 * symbol and mutes the bot completely — and because the failure mode is "no
 * alerts" rather than an error, a dead channel is indistinguishable from a
 * quiet market. Dropped, it takes the documented empty-watchlist branch and
 * means what the operator wrote: no watchlist.
 */
export const normaliseWatchlist = (
  watchlist: readonly string[],
): ReadonlySet<string> =>
  new Set(watchlist.map(normaliseSymbol).filter((symbol) => symbol.length > 0));

/**
 * Whether a filing passes both content gates.
 *
 * An EMPTY watchlist means alert on everything non-routine, which is the
 * documented default. Reads `category` and `symbol`, both of which throw a
 * TypeError on a malformed record, so callers must invoke it from inside their
 * own per-filing containment.
 */
export function passesContentGates(
  filing: { readonly category: string; readonly symbol: string },
  watchlist: ReadonlySet<string>,
): boolean {
  if (isRoutine(filing.category)) return false;
  if (watchlist.size === 0) return true;
  return watchlist.has(normaliseSymbol(filing.symbol));
}
