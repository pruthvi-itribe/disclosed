import { hasRoom, MAX_WATCHED_SYMBOLS } from './watchlist-cap';

/**
 * The cap, and the measurement it comes from.
 *
 * The number is not a preference. It is the answer to "how many notable filings
 * a day does a watchlist of N symbols produce", and `npm run watch:cap` is what
 * answers it — see the constant's own comment for the run.
 */

describe('MAX_WATCHED_SYMBOLS', () => {
  it('is 50', () => {
    expect(MAX_WATCHED_SYMBOLS).toBe(50);
  });

  it('keeps the entries array small enough to be one document', () => {
    // The watchlist is one document per user with an `entries` array, and an
    // unbounded array in a document is the classic Mongo anti-pattern. At the
    // cap the array is 50 subdocuments — a few KB — which is what makes the
    // one-document shape correct rather than merely convenient.
    expect(MAX_WATCHED_SYMBOLS).toBeLessThanOrEqual(100);
  });
});

describe('hasRoom', () => {
  it('is true below the cap', () => {
    expect(hasRoom(MAX_WATCHED_SYMBOLS - 1)).toBe(true);
  });

  it('is false at the cap', () => {
    expect(hasRoom(MAX_WATCHED_SYMBOLS)).toBe(false);
  });

  it('is false above the cap, so a document that predates a lowering cannot grow', () => {
    expect(hasRoom(MAX_WATCHED_SYMBOLS + 10)).toBe(false);
  });

  it('is true for an empty watchlist', () => {
    expect(hasRoom(0)).toBe(true);
  });
});
