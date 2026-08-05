import { IST_OFFSET_MS, pad2 } from './ist';

describe('IST_OFFSET_MS', () => {
  it('is exactly five and a half hours', () => {
    // The half hour is the part that gets lost. A 5-hour offset renders every
    // alert 30 minutes wrong and moves the IST day boundary, and both failures
    // look entirely plausible in a log.
    expect(IST_OFFSET_MS).toBe(19_800_000);
    expect(IST_OFFSET_MS).toBe(5.5 * 60 * 60 * 1000);
  });

  it('places the IST day boundary at 18:30 UTC', () => {
    const boundary = new Date('2026-08-05T18:30:00.000Z');

    expect(new Date(boundary.getTime() + IST_OFFSET_MS).toISOString()).toBe(
      '2026-08-06T00:00:00.000Z',
    );
  });
});

describe('pad2', () => {
  const CASES: ReadonlyArray<readonly [number, string]> = [
    [0, '00'],
    [3, '03'],
    [9, '09'],
    [10, '10'],
    [59, '59'],
    [2026, '2026'],
  ];

  it.each(CASES)('pads %s to %s', (value, expected) => {
    expect(pad2(value)).toBe(expected);
  });

  it('never truncates a value wider than two digits', () => {
    // A truncating pad would turn a year into a two-digit fragment and produce
    // a date NSE would accept as a different year.
    expect(pad2(123)).toBe('123');
  });
});
