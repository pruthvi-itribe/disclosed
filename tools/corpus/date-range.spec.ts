import { toNseDateParam } from '@app/filings';

describe('toNseDateParam', () => {
  it('formats as dd-mm-yyyy in IST', () => {
    // 2026-08-05T04:58:18Z is 05-Aug-2026 in IST
    expect(toNseDateParam(new Date('2026-08-05T04:58:18.000Z'))).toBe(
      '05-08-2026',
    );
  });

  it('uses the IST calendar day, not the UTC day', () => {
    // 2026-08-04T20:00:00Z is 05-Aug-2026 01:30 IST — must be the 5th, not the 4th
    expect(toNseDateParam(new Date('2026-08-04T20:00:00.000Z'))).toBe(
      '05-08-2026',
    );
  });

  it('zero-pads single-digit days and months', () => {
    expect(toNseDateParam(new Date('2026-01-03T12:00:00.000Z'))).toBe(
      '03-01-2026',
    );
  });
});
