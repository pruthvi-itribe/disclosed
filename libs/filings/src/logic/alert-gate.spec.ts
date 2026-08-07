import {
  isNotRoutine,
  isWatchedByOperator,
  normaliseSymbol,
  normaliseWatchlist,
} from './alert-gate';

/**
 * The two content gates, tested apart — because being apart is the whole point
 * of this module now.
 *
 * They were one function, and the fold was a fact about the FILING (is the
 * category routine) glued to a fact about ONE PERSON (did the operator ask for
 * this symbol). With per-user watchlists in the same process, calling the fold
 * on a subscriber's behalf silences every subscriber whose symbol the operator
 * did not list — silently, forever. These tests hold the two apart so a future
 * tidy-up that re-merges them has to delete one of them first.
 */

const filing = (category: string, symbol = 'RELIANCE') => ({
  category,
  symbol,
});

const ROUTINE = 'Trading Window';
const NOTABLE = 'Acquisition';

describe('isNotRoutine — the gate every lane applies', () => {
  it('passes a filing whose category is not routine', () => {
    expect(isNotRoutine(filing(NOTABLE))).toBe(true);
  });

  it('refuses a routine category', () => {
    expect(isNotRoutine(filing(ROUTINE))).toBe(false);
  });

  it('reads the category and nothing else', () => {
    // No symbol at all. A per-user fan-out calls this gate with whatever the
    // filing carries, and reading a second field here would resurrect the
    // coupling this split removed.
    expect(isNotRoutine({ category: NOTABLE })).toBe(true);
  });
});

describe('isWatchedByOperator — the gate only the operator lanes apply', () => {
  it('passes every symbol when the operator set no watchlist', () => {
    expect(
      isWatchedByOperator(filing(NOTABLE, 'TCS'), normaliseWatchlist([])),
    ).toBe(true);
  });

  it('passes a symbol the operator listed', () => {
    expect(
      isWatchedByOperator(
        filing(NOTABLE, 'RELIANCE'),
        normaliseWatchlist(['RELIANCE']),
      ),
    ).toBe(true);
  });

  it('refuses a symbol the operator did not list', () => {
    expect(
      isWatchedByOperator(
        filing(NOTABLE, 'TCS'),
        normaliseWatchlist(['RELIANCE']),
      ),
    ).toBe(false);
  });

  it('matches case-insensitively and past the spacing a split leaves behind', () => {
    expect(
      isWatchedByOperator(
        filing(NOTABLE, 'RELIANCE'),
        normaliseWatchlist([' reliance ']),
      ),
    ).toBe(true);
  });

  it('says nothing about the category, so it cannot substitute for the other gate', () => {
    // A routine filing from a watched symbol PASSES this gate. That is correct:
    // this gate answers one question. The composition at the call site is what
    // refuses it, and asserting this stops anyone using this alone as "should I
    // alert".
    expect(
      isWatchedByOperator(
        filing(ROUTINE, 'RELIANCE'),
        normaliseWatchlist(['RELIANCE']),
      ),
    ).toBe(true);
  });
});

describe('normaliseWatchlist', () => {
  it('drops blank entries rather than keeping members that match nothing', () => {
    // `OPERATOR_WATCHLIST=` splits to `['']`. Kept, it matches no symbol and
    // mutes the channel completely — which presents as a quiet market.
    expect(normaliseWatchlist(['', '  ']).size).toBe(0);
  });

  it('folds case and trims, so both sides of the comparison agree', () => {
    expect([...normaliseWatchlist([' reliance ', 'TcS'])]).toEqual([
      'RELIANCE',
      'TCS',
    ]);
  });

  it('does not mutate the caller list', () => {
    const given = [' reliance '];
    normaliseWatchlist(given);
    expect(given).toEqual([' reliance ']);
  });
});

describe('normaliseSymbol', () => {
  it('uppercases and trims', () => {
    expect(normaliseSymbol('  m&m ')).toBe('M&M');
  });
});
