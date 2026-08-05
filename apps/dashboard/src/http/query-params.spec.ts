import { BadRequestException } from '@nestjs/common';
import {
  MAX_FILTER_LENGTH,
  readBoundedInteger,
  readFilter,
  readSingle,
} from './query-params';

const BOUNDS = { fallback: 25, min: 1, max: 200 } as const;

describe('readSingle', () => {
  it('returns undefined for an absent key', () => {
    expect(readSingle('symbol', {})).toBeUndefined();
  });

  it('returns a trimmed value', () => {
    expect(readSingle('symbol', { symbol: '  TCS  ' })).toBe('TCS');
  });

  it('treats a value that is only whitespace as absent', () => {
    expect(readSingle('symbol', { symbol: '   ' })).toBeUndefined();
  });

  it('rejects a repeated key rather than picking one of the values', () => {
    // `?symbol=A&symbol=B` arrives as an array. Silently taking the first means
    // the page shows results for a filter the caller did not ask for.
    expect(() => readSingle('symbol', { symbol: ['A', 'B'] })).toThrow(
      BadRequestException,
    );
  });

  it('rejects a bracketed key, which is how a NoSQL operator gets smuggled in', () => {
    // `?symbol[$ne]=x` parses to an object. Interpolated into a Mongo filter it
    // becomes an operator the caller chose, reading past any intended filter.
    expect(() => readSingle('symbol', { symbol: { $ne: null } })).toThrow(
      /at most once, as a plain value/,
    );
  });

  it('rejects a numeric value, which express never produces from a query string', () => {
    expect(() => readSingle('limit', { limit: 25 })).toThrow(
      BadRequestException,
    );
  });
});

describe('readBoundedInteger', () => {
  it('returns the fallback when the key is absent', () => {
    expect(readBoundedInteger('limit', {}, BOUNDS)).toBe(25);
  });

  it('returns the fallback for a blank value', () => {
    expect(readBoundedInteger('limit', { limit: '' }, BOUNDS)).toBe(25);
  });

  it('reads a valid value', () => {
    expect(readBoundedInteger('limit', { limit: '50' }, BOUNDS)).toBe(50);
  });

  it('accepts both bounds exactly', () => {
    expect(readBoundedInteger('limit', { limit: '1' }, BOUNDS)).toBe(1);
    expect(readBoundedInteger('limit', { limit: '200' }, BOUNDS)).toBe(200);
  });

  it('accepts zero when the minimum allows it', () => {
    expect(
      readBoundedInteger(
        'offset',
        { offset: '0' },
        { fallback: 0, min: 0, max: 10 },
      ),
    ).toBe(0);
  });

  it('reads exponent notation as the number it spells, unlike parseInt', () => {
    // `parseInt('1e3')` is 1 — it stops at the 'e' and silently returns a
    // value three orders of magnitude out. `Number` reads 1000.
    expect(
      readBoundedInteger(
        'limit',
        { limit: ' 1e3 ' },
        { fallback: 25, min: 1, max: 2000 },
      ),
    ).toBe(1000);
  });

  it.each([['abc'], ['NaN'], ['50rows'], ['1e3x']])(
    'rejects the unparseable value %p instead of passing NaN to Mongo',
    (raw) => {
      // `limit(NaN)` is treated by the driver as NO limit, so an unvalidated
      // value streams the whole collection to a page that polls every 4s.
      expect(() => readBoundedInteger('limit', { limit: raw }, BOUNDS)).toThrow(
        /must be a finite number/,
      );
    },
  );

  it('rejects Infinity', () => {
    expect(() =>
      readBoundedInteger('limit', { limit: 'Infinity' }, BOUNDS),
    ).toThrow(/must be a finite number/);
  });

  it('rejects a fraction with its own message', () => {
    expect(() => readBoundedInteger('limit', { limit: '2.5' }, BOUNDS)).toThrow(
      /must be a whole number/,
    );
  });

  it.each([['0'], ['-5'], ['201'], ['999999']])(
    'rejects the out-of-range value %p',
    (raw) => {
      expect(() => readBoundedInteger('limit', { limit: raw }, BOUNDS)).toThrow(
        /must be between 1 and 200/,
      );
    },
  );

  it('raises a 400, not a 500', () => {
    // A bad query string is the caller's mistake. Reporting it as a server
    // error hides a fixable typo behind an incident.
    try {
      readBoundedInteger('limit', { limit: 'x' }, BOUNDS);
      throw new Error('expected a throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
    }
  });
});

describe('readFilter', () => {
  it('returns undefined for an absent key', () => {
    expect(readFilter('symbol', {})).toBeUndefined();
  });

  it('returns the trimmed value', () => {
    expect(readFilter('symbol', { symbol: ' TCS ' })).toBe('TCS');
  });

  it('accepts a value of exactly the maximum length', () => {
    const value = 'A'.repeat(MAX_FILTER_LENGTH);

    expect(readFilter('symbol', { symbol: value })).toBe(value);
  });

  it('rejects a value longer than the maximum', () => {
    // Nothing that long is a symbol or a category; it is a mistake or a probe.
    expect(() =>
      readFilter('symbol', { symbol: 'A'.repeat(MAX_FILTER_LENGTH + 1) }),
    ).toThrow(/at most 128 characters/);
  });

  it('rejects a non-string just as readSingle does', () => {
    expect(() => readFilter('symbol', { symbol: { $gt: '' } })).toThrow(
      BadRequestException,
    );
  });
});
