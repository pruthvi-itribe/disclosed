const MONTHS: Readonly<Record<string, number>> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/** IST is UTC+05:30 year-round; India observes no daylight saving. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const PATTERN = /^(\d{2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/;

/**
 * Parses an NSE timestamp such as "05-Aug-2026 10:28:17".
 *
 * NSE emits these in IST with no timezone marker. Parsing with `new Date(...)`
 * would interpret them in the server's local zone - a 5.5-hour error on a UTC
 * host. This function always treats the input as IST and returns a correct
 * absolute instant.
 */
export function parseNseDate(input: string): Date {
  const match = PATTERN.exec(input.trim());
  if (!match) {
    throw new Error(`Unparseable NSE date: "${input}"`);
  }

  const [, dd, mon, yyyy, hh, mm, ss] = match;
  const month = MONTHS[mon.toLowerCase()];
  if (month === undefined) {
    throw new Error(
      `Unparseable NSE date: "${input}" (unknown month "${mon}")`,
    );
  }

  const utcMillis = Date.UTC(
    Number(yyyy),
    month,
    Number(dd),
    Number(hh),
    Number(mm),
    Number(ss),
  );

  return new Date(utcMillis - IST_OFFSET_MS);
}
