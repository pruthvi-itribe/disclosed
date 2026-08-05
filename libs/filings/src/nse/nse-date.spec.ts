import { parseNseDate } from './nse-date';

describe('parseNseDate', () => {
  it('parses an NSE timestamp as IST, not local time', () => {
    // 05-Aug-2026 10:28:17 IST === 04:58:17 UTC
    const parsed = parseNseDate('05-Aug-2026 10:28:17');
    expect(parsed.toISOString()).toBe('2026-08-05T04:58:17.000Z');
  });

  it('handles a timestamp that crosses the UTC date boundary', () => {
    // 01-Jan-2026 03:00:00 IST === 31-Dec-2025 21:30:00 UTC
    const parsed = parseNseDate('01-Jan-2026 03:00:00');
    expect(parsed.toISOString()).toBe('2025-12-31T21:30:00.000Z');
  });

  // MONTHS is a hand-typed lookup table: one transposed index would be a
  // month-long timestamp error inherited by every downstream alert window, and
  // the recorded fixture only exercises August. Every abbreviation is checked.
  // Index derived positionally from calendar order, so the table cannot be
  // wrong in the same way the implementation's table could be.
  const MONTHS_IN_ORDER: readonly string[] = [
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

  const MONTH_CASES: ReadonlyArray<[string, number]> = MONTHS_IN_ORDER.map(
    (abbreviation, index) => [abbreviation, index],
  );

  it.each(MONTH_CASES)(
    'parses month abbreviation %s to month index %i',
    (abbreviation, index) => {
      // Midday IST stays inside the same UTC day, so the month index is a
      // direct read of the lookup table with no rollover to mask an error.
      const parsed = parseNseDate(`15-${abbreviation}-2026 12:00:00`);
      expect(parsed.getUTCMonth()).toBe(index);
      const month = String(index + 1).padStart(2, '0');
      expect(parsed.toISOString()).toBe(`2026-${month}-15T06:30:00.000Z`);
    },
  );

  it('rolls a midnight IST timestamp back into the previous UTC day', () => {
    expect(parseNseDate('15-Dec-2026 00:00:00').toISOString()).toBe(
      '2026-12-14T18:30:00.000Z',
    );
  });

  it('throws on a malformed timestamp rather than returning Invalid Date', () => {
    expect(() => parseNseDate('not a date')).toThrow(/Unparseable NSE date/);
  });

  it('throws on an unknown month abbreviation', () => {
    expect(() => parseNseDate('05-Xyz-2026 10:00:00')).toThrow(
      /Unparseable NSE date/,
    );
  });

  it('does not let an unparseable value forge a second log line', () => {
    const forged = 'bad\nUnparseable NSE date: "totally legitimate"';
    expect(() => parseNseDate(forged)).toThrow(/Unparseable NSE date/);
    try {
      parseNseDate(forged);
      throw new Error('expected parseNseDate to throw');
    } catch (error) {
      expect((error as Error).message.split('\n')).toHaveLength(1);
    }
  });

  it('truncates an over-long unparseable value in the error message', () => {
    const long = 'q'.repeat(500);
    try {
      parseNseDate(long);
      throw new Error('expected parseNseDate to throw');
    } catch (error) {
      expect((error as Error).message.length).toBeLessThan(80);
    }
  });
});
