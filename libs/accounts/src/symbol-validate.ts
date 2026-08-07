/**
 * The SHAPE check on a symbol a reader asked to watch.
 *
 * NOT THE EXISTENCE CHECK. Whether a symbol is real is answered by the company
 * directory at the route, and a symbol the directory does not hold is refused
 * with `422 UNKNOWN_SYMBOL` — refused rather than accepted, because a silently
 * stored typo is a watchlist entry that will never alert and that the reader
 * believes is working.
 *
 * This is the cheap gate in front of that one. A 4 KB paste is not a ticker and
 * should not reach a directory scan, and a value carrying `$` or `.` has no
 * business being compared against anything in a Mongo query — even though
 * `readSingle` has already refused the object shape a bracketed query key
 * parses to.
 */

/**
 * The longest symbol accepted. NSE's own are well inside this — the longest in
 * the 33-day corpus is 12 characters — and the margin is for a listing
 * convention nobody has seen yet rather than for a paste.
 */
export const MAX_SYMBOL_LENGTH = 20;

/**
 * Uppercased and trimmed, which is the form the directory and the filings
 * collection both hold. Non-strings fold to the empty string rather than
 * throwing: this is fed from a query parameter.
 */
export const normaliseWatchSymbol = (raw: string): string =>
  typeof raw === 'string' ? raw.trim().toUpperCase() : '';

/**
 * The characters NSE actually uses, and no others.
 *
 * An ALLOWLIST, unlike the email check, and the asymmetry is deliberate: an
 * email local part legitimately holds punctuation nobody can enumerate from
 * memory, while a ticker is a closed alphabet. `&` is in it for M&M and
 * J&KBANK, `-` for BAJAJ-AUTO, and digits for 3MINDIA. A dot is NOT: it is the
 * path separator in a Mongo field name.
 */
const SHAPE = /^[A-Z0-9&-]+$/;

/** Whether the normalised value could be a ticker. */
export const isPlausibleSymbol = (raw: string): boolean => {
  const symbol = normaliseWatchSymbol(raw);
  if (symbol === '' || symbol.length > MAX_SYMBOL_LENGTH) return false;
  return SHAPE.test(symbol);
};
