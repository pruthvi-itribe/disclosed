import { IST_OFFSET_MS } from '@app/common';
import { parseBseDate } from './bse-date';

describe('parseBseDate', () => {
  it('reads a BSE dissemination timestamp as IST', () => {
    // BRITANNIA's investor presentation, the row that started this: BSE
    // disseminated it at 07:09:33.413 IST, which is 01:39:33.413Z.
    expect(parseBseDate('2026-08-07T07:09:33.413').toISOString()).toBe(
      '2026-08-07T01:39:33.413Z',
    );
  });

  it('reads a timestamp with no milliseconds', () => {
    // `News_submission_dt` omits them where `DissemDT` carries them, and both
    // are the same clock.
    expect(parseBseDate('2026-08-07T07:09:33').toISOString()).toBe(
      '2026-08-07T01:39:33.000Z',
    );
  });

  it('is exactly IST_OFFSET_MS away from the naive reading', () => {
    // THE BUG THIS FUNCTION EXISTS TO PREVENT, stated as arithmetic. BSE emits
    // an ISO-8601 string with NO ZONE MARKER. `new Date(...)` reads that in the
    // host's local zone, so the same payload parses differently on a laptop in
    // Bengaluru and a container in UTC — and on the UTC container every filing
    // is stamped 5.5 hours late, which silently moves it into the next IST day.
    const raw = '2026-08-07T07:09:33.000';
    const naiveAsUtc = Date.parse(`${raw}Z`);
    expect(naiveAsUtc - parseBseDate(raw).getTime()).toBe(IST_OFFSET_MS);
  });

  it('handles the IST day boundary without moving the date', () => {
    // 00:00 IST is 18:30Z on the PREVIOUS day. A filing at one minute past
    // midnight IST belongs to the new IST day and the previous UTC one, and
    // every day-bucketing query in this codebase depends on that holding.
    expect(parseBseDate('2026-08-07T00:01:00').toISOString()).toBe(
      '2026-08-06T18:31:00.000Z',
    );
  });

  it.each([
    ['an empty string', ''],
    ['a date with no time', '2026-08-07'],
    ['NSE’s format', '07-Aug-2026 07:09:33'],
    ['a zone marker BSE does not send', '2026-08-07T07:09:33Z'],
    ['prose', 'yesterday afternoon'],
    ['an impossible month', '2026-13-07T07:09:33'],
    ['an impossible day', '2026-08-32T07:09:33'],
    ['an impossible hour', '2026-08-07T25:09:33'],
  ])('refuses %s', (_label, input) => {
    // REFUSES rather than coerces. A timestamp this cannot read is a record
    // whose dissemination instant is unknown, and an unknown instant guessed at
    // is worse than a mapping failure the caller counts and reports: every
    // latency figure and alert window in the product is measured from it.
    expect(() => parseBseDate(input)).toThrow(/Unparseable BSE date/);
  });

  it('does not echo an unbounded amount of untrusted text', () => {
    // The message is logged, and the input is exchange-supplied.
    const long = 'x'.repeat(5000);
    expect(() => parseBseDate(long)).toThrow(/Unparseable BSE date/);
    try {
      parseBseDate(long);
    } catch (error) {
      expect((error as Error).message.length).toBeLessThan(200);
    }
  });
});
