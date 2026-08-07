/**
 * How many symbols one reader may watch, and why that number.
 *
 * ================================================================
 * DERIVED, NOT PICKED — AND THE DERIVATION WAS RUN
 * ================================================================
 *
 * The cap is an answer to "how many notable filings a day does a watchlist of N
 * symbols produce", because that is the number a person either tolerates or
 * mutes. Measured by `npm run watch:cap` on
 * `data/corpus/05-07-2026_05-08-2026.jsonl` (2026-08-08):
 *
 *     filings                17,442 over 33 IST days
 *     alertable (non-routine) 12,415 = 71.2%      -> 376 / day
 *     distinct companies      2,294
 *     alertable per company   0.164 / day
 *     at 50 symbols           8.2 notable filings / day
 *
 * Eight a day is at the upper edge of what a person tolerates in a notification
 * channel, and `alert.service.ts` already documents what a muted channel costs
 * a pipeline whose outage alarms share it. Fifty is therefore the number.
 *
 * THE DISTINCT-COMPANY FIGURE IS THE ONE THAT WAS GUESSED BEFORE. The design
 * doc bracketed it at 1,500-2,500 from a four-day sample of 960 and derived
 * "8-13 a day" — a range wide enough to justify 25 or 100. The measured 2,294
 * lands near the top of that bracket, so the honest per-day figure is 8.2
 * rather than the middle of a guess. Re-run the tool when the corpus grows;
 * these numbers are the whole justification for the constant.
 *
 * IT ALSO KEEPS THE DOCUMENT SHAPE HONEST. The watchlist is one document per
 * user with an `entries` array, and an unbounded array inside a document is the
 * classic Mongo anti-pattern. At the cap the array is 50 subdocuments — a few
 * KB — which is what makes the one-document read correct rather than merely
 * convenient.
 */
export const MAX_WATCHED_SYMBOLS = 50;

/**
 * Whether one more symbol fits.
 *
 * `<` rather than `!==`, so a document written before the cap was lowered
 * cannot grow further. An over-full watchlist keeps working and keeps its
 * entries; it simply stops accepting more.
 */
export const hasRoom = (used: number): boolean => used < MAX_WATCHED_SYMBOLS;
