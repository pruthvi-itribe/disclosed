import { duration, lagClass } from './duration';

describe('duration', () => {
  it.each([
    [5_000, '5s'],
    [90_000, '1m 30s'],
    [2 * 3_600_000 + 5 * 60_000, '2h 5m'],
    [30 * 3_600_000, '1d 6h'],
  ])('%d ms reads "%s"', (ms, expected) => {
    expect(duration(ms)).toBe(expected);
  });

  it('returns an em dash for nothing', () => {
    expect(duration(null)).toBe('—');
    expect(duration(undefined)).toBe('—');
  });
});

describe('lagClass', () => {
  // ok under two minutes, warn under thirty, bad above — the hero's lag
  // colour and the admin stat share these thresholds.
  it('classes the lag', () => {
    expect(lagClass(119_999)).toBe('ok');
    expect(lagClass(120_000)).toBe('warn');
    expect(lagClass(1_799_999)).toBe('warn');
    expect(lagClass(1_800_000)).toBe('bad');
  });

  it('returns nothing for nothing', () => {
    expect(lagClass(null)).toBe('');
    expect(lagClass(undefined)).toBe('');
  });
});
