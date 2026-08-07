import {
  isPlausibleSymbol,
  MAX_SYMBOL_LENGTH,
  normaliseWatchSymbol,
} from './symbol-validate';

/**
 * The SHAPE gate on a symbol, which is not the same thing as the EXISTENCE gate.
 *
 * A symbol only enters a watchlist if the company directory holds it — that is
 * the check that matters and it lives at the route. This is the cheap refusal
 * in front of it: a 4 KB paste is not a ticker and should not reach a directory
 * scan, and a value carrying a `$` has no business being compared against
 * anything.
 */

describe('normaliseWatchSymbol', () => {
  it('uppercases and trims, matching what the directory holds', () => {
    expect(normaliseWatchSymbol(' reliance ')).toBe('RELIANCE');
  });

  it('is idempotent', () => {
    expect(normaliseWatchSymbol(normaliseWatchSymbol(' tcs '))).toBe('TCS');
  });

  it('returns an empty string for a value that is not a string', () => {
    expect(normaliseWatchSymbol(undefined as unknown as string)).toBe('');
    expect(normaliseWatchSymbol({ $ne: null } as unknown as string)).toBe('');
  });
});

describe('isPlausibleSymbol', () => {
  it.each(['RELIANCE', 'TCS', 'M&M', 'J&KBANK', 'BAJAJ-AUTO', '3MINDIA'])(
    'accepts %s, which NSE actually lists',
    (symbol) => {
      expect(isPlausibleSymbol(symbol)).toBe(true);
    },
  );

  it('accepts the lowercase a reader types, because it normalises first', () => {
    expect(isPlausibleSymbol('reliance')).toBe(true);
  });

  it.each<[string, string]>([
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['an inner space', 'RELIANCE LTD'],
    ['a Mongo operator', '$ne'],
    ['a dotted path', 'a.b'],
    ['a quote', "RELIANCE'"],
    ['a regex anchor', '^REL'],
    ['a newline', 'REL\nIANCE'],
  ])('refuses %s', (_label, symbol) => {
    expect(isPlausibleSymbol(symbol)).toBe(false);
  });

  it('refuses anything longer than the bound', () => {
    expect(isPlausibleSymbol('A'.repeat(MAX_SYMBOL_LENGTH + 1))).toBe(false);
  });

  it('accepts exactly the bound', () => {
    expect(isPlausibleSymbol('A'.repeat(MAX_SYMBOL_LENGTH))).toBe(true);
  });

  it('returns false rather than throwing for a value that is not a string', () => {
    expect(isPlausibleSymbol(undefined as unknown as string)).toBe(false);
    expect(isPlausibleSymbol({ $ne: null } as unknown as string)).toBe(false);
  });
});
