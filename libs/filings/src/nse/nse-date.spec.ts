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

  it('parses every month abbreviation', () => {
    expect(parseNseDate('15-Dec-2026 00:00:00').toISOString()).toBe(
      '2026-12-14T18:30:00.000Z',
    );
    expect(parseNseDate('15-Mar-2026 12:00:00').toISOString()).toBe(
      '2026-03-15T06:30:00.000Z',
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
});
