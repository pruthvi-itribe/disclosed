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

import { safeText } from './describe-error';

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

/**
 * Milliseconds in a calendar day.
 *
 * Exact for IST specifically: India observes no daylight saving, so every IST
 * day is 86,400,000ms long and day arithmetic can be integer division. The same
 * assumption would be wrong in a zone with DST, which is why this constant
 * lives beside the offset it is only sound next to.
 */
export const IST_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The absolute instant a value represents, or a throw naming what arrived.
 *
 * The `new Date(value)` re-wrap is not redundant. A Filing read back from Mongo
 * through a lean query, replayed from the JSONL corpus, or round-tripped
 * through JSON carries its timestamps as ISO STRINGS despite the type saying
 * `Date`, and calling `.getTime()` on one of those throws.
 *
 * An unusable value throws rather than flowing on as `NaN`. `NaN` formats as
 * the literal text "NaN-NaN-NaN NaN:NaN:NaN", which renders as a plausible-
 * looking cell in a table and is the exact failure mode this module exists to
 * prevent: a wrong time that nobody notices. The schema requires these fields,
 * so reaching this throw means the stored document is not what the schema says.
 */
export const instantMs = (value: Date): number => {
  const millis = new Date(value).getTime();
  if (!Number.isFinite(millis)) {
    throw new Error(`Not a usable timestamp: ${safeText(value)}`);
  }
  return millis;
};

/**
 * Shifts an instant so that reading its UTC fields yields IST wall-clock
 * fields. The returned Date is a rendering vehicle, NOT a real instant — never
 * store it, compare it against a real timestamp, or send it anywhere.
 */
const istWallClock = (value: Date): Date =>
  new Date(instantMs(value) + IST_OFFSET_MS);

/** The IST calendar day as `YYYY-MM-DD`; the bucket key for per-day counts. */
export const istDayKey = (value: Date): string => {
  const ist = istWallClock(value);
  return `${ist.getUTCFullYear()}-${pad2(ist.getUTCMonth() + 1)}-${pad2(
    ist.getUTCDate(),
  )}`;
};

/** The IST wall clock as `HH:MM:SS`. */
export const istClock = (value: Date): string => {
  const ist = istWallClock(value);
  return `${pad2(ist.getUTCHours())}:${pad2(ist.getUTCMinutes())}:${pad2(
    ist.getUTCSeconds(),
  )}`;
};

/**
 * The IST wall clock as `YYYY-MM-DD HH:MM:SS`.
 *
 * Rendered SERVER-side on purpose wherever it is shown to a person. The browser
 * showing the dashboard is not necessarily set to IST — a laptop on UTC would
 * render every stored instant five and a half hours early if the page did its
 * own formatting — so the server sends the IST text and the page prints it.
 */
export const istTimestamp = (value: Date): string =>
  `${istDayKey(value)} ${istClock(value)}`;

/**
 * The months, spelled the way a person writes a date rather than sorts one.
 *
 * Three letters, English, indexed by `getUTCMonth()` on the shifted clock. A
 * lookup rather than `toLocaleString`: the process's locale is not a property
 * anybody sets deliberately, and a server that renamed August because a
 * container image shipped a different ICU build would be an unreadable bug.
 */
const IST_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * The IST wall clock as a person reads it aloud: `12 Aug 2026, 8:48 am`.
 *
 * A SIBLING OF `istTimestamp`, NOT A REPLACEMENT. `2026-08-12 08:48:10` is the
 * right string in a table, a tooltip and a log line — fixed width, sortable,
 * unambiguous — and it is the wrong string on a picture somebody sends to a
 * friend, where it reads as a machine's output. Both are composed HERE, on the
 * server, because the browser may not be on IST and the invariant is that it
 * never formats a timestamp.
 *
 * THREE DELIBERATE CHOICES, so the next editor does not have to re-derive them:
 *
 *   - NO SECONDS. `08:48:10` is dissemination precision and this string is
 *     prose; the second is still one field away in `istTimestamp` for anyone
 *     who needs it.
 *   - THE DAY IS NOT PADDED. `5 Aug 2026`, not `05 Aug 2026` — nothing parses
 *     this string, so the fixed width `pad2` exists for buys nothing, and the
 *     unpadded day is what a person writes. The MINUTE is still padded, because
 *     `8:5 am` is not a time.
 *   - LOWER-CASE `am`/`pm`, and midnight is `12 am` rather than `0 am`.
 */
export const istHumanTimestamp = (value: Date): string => {
  const ist = istWallClock(value);
  const hours = ist.getUTCHours();
  const clock = `${hours % 12 === 0 ? 12 : hours % 12}:${pad2(
    ist.getUTCMinutes(),
  )} ${hours < 12 ? 'am' : 'pm'}`;
  return `${ist.getUTCDate()} ${IST_MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}, ${clock}`;
};

/**
 * The instant at which the IST day containing `value` began.
 *
 * That is 18:30 UTC the previous day. `Math.floor` rather than a truncating
 * cast because it is also correct for instants before the epoch.
 */
export const startOfIstDay = (value: Date): Date => {
  const shifted = instantMs(value) + IST_OFFSET_MS;
  return new Date(
    Math.floor(shifted / IST_DAY_MS) * IST_DAY_MS - IST_OFFSET_MS,
  );
};

/**
 * The last `days` IST day keys, oldest first, ending with the day containing
 * `value`.
 *
 * Exists so a per-day series can be zero-filled. A grouped database query only
 * returns days that HAVE filings, and a chart drawn from that alone silently
 * closes the gap where a quiet day should be — which is the one thing a
 * "did ingestion stop?" chart has to show.
 *
 * @throws when `days` is not a whole number of at least 1. `NaN` is rejected
 * explicitly: `Array.from({length: NaN})` yields an empty array rather than an
 * error, so an unvalidated count would present as "no data" instead of a fault.
 */
export const istDayKeysEndingAt = (
  value: Date,
  days: number,
): readonly string[] => {
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`days must be a whole number >= 1, but was ${days}`);
  }

  const end = startOfIstDay(value).getTime();
  return Array.from({ length: days }, (_unused, index) =>
    istDayKey(new Date(end - (days - 1 - index) * IST_DAY_MS)),
  );
};
