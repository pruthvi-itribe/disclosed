import { IST_OFFSET_MS } from '@app/common';
import { safeEcho } from '../logic/safe-echo';

/**
 * BSE emits ISO-8601 with no zone marker: `2026-08-07T07:09:33.413`.
 *
 * Anchored at both ends and digit-exact, so a string that merely STARTS like a
 * timestamp is refused rather than half-read. Milliseconds are optional because
 * `DissemDT` carries them and `News_submission_dt` does not, and both are the
 * same clock.
 */
const PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;

/**
 * Parses a BSE timestamp into a correct absolute instant.
 *
 * THE SAME TRAP AS `parseNseDate`, IN A DIFFERENT COSTUME. NSE sends
 * `05-Aug-2026 10:28:17` and BSE sends `2026-08-07T07:09:33.413`; the second
 * one looks like an ISO string a runtime can be trusted with, and it is not.
 * There is no `Z` and no offset, so `new Date(...)` resolves it in the HOST's
 * zone — correct by accident on a laptop set to IST, and 5.5 hours wrong on the
 * UTC container this actually runs in. A filing stamped 5.5 hours late crosses
 * the 18:30Z boundary into the wrong IST day, which moves it out of the day
 * bucket every drain and every dashboard count is built on.
 *
 * So the zone is applied here, once, from the same constant the NSE parser
 * uses, and the value is never handed to a bare `new Date`.
 *
 * THROWS RATHER THAN GUESSES. Dissemination time is the authoritative clock for
 * every latency figure and every alert window in this product; a record whose
 * instant cannot be read is a mapping failure the caller counts, not a record
 * to be admitted with an invented timestamp.
 */
export function parseBseDate(input: string): Date {
  const match = PATTERN.exec(input.trim());
  if (!match) {
    // Exchange-supplied and logged, so truncated and stripped before echoing.
    throw new Error(`Unparseable BSE date: "${safeEcho(input)}"`);
  }

  const [, yyyy, mm, dd, hh, mi, ss, frac] = match;
  const year = Number(yyyy);
  const month = Number(mm) - 1;
  const day = Number(dd);
  const hour = Number(hh);
  const minute = Number(mi);
  const second = Number(ss);
  // `.4` means four hundred milliseconds, not four. Padded rather than parsed
  // as an integer, which would read `.413` and `.4` as 413 and 4.
  const ms = frac === undefined ? 0 : Number(frac.padEnd(3, '0'));

  const utcMillis = Date.UTC(year, month, day, hour, minute, second, ms);

  // `Date.UTC` ROLLS OVER rather than rejecting: month 13 becomes January of the
  // next year and hour 25 becomes 01:00 the following day. Both would be
  // accepted here as a real instant that is not the one BSE sent, so the parsed
  // components are read back and compared. This is the check the regex cannot
  // make, because `\d{2}` has no opinion about what 32 means in a date.
  const check = new Date(utcMillis);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  ) {
    throw new Error(
      `Unparseable BSE date: "${safeEcho(input)}" (no such calendar instant)`,
    );
  }

  return new Date(utcMillis - IST_OFFSET_MS);
}
