/**
 * The one definition of Indian Standard Time in the codebase.
 *
 * Every timestamp this system reads, buckets or renders is IST: NSE emits its
 * clocks in IST with no timezone marker, the filing day is an IST calendar day,
 * and the alert a human reads quotes an IST wall clock. Getting the offset
 * wrong is a class of bug that never fails loudly — it shifts a filing onto the
 * wrong day, or renders every alert half an hour out, and looks entirely
 * plausible.
 *
 * It was defined five times over (`nse-date.ts`, `nse-date-range.ts`,
 * `cadence.ts`, `alert-formatter.ts`, `analyse-corpus.ts`) with a comment in
 * two of them explaining that sharing would mean `libs/notify` importing
 * `libs/filings`. That reasoning was sound and the conclusion was not: a
 * library that depends on nothing removes the coupling without the duplication.
 */

/** IST is UTC+05:30 year-round; India observes no daylight saving. */
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Two-digit zero padding for a wall-clock component.
 *
 * Not cosmetic. `9:3:3` for 09:03:03 is ambiguous at a glance in a chat message
 * that exists to be read in a hurry, and `5-8-2026` is a different date from
 * `05-08-2026` to a parser that expects a fixed width.
 */
export const pad2 = (value: number): string => String(value).padStart(2, '0');
