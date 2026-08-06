import {
  contextLine,
  DEFAULT_CONTEXT_WINDOW_DAYS,
  istDayLabel,
  MIN_CONTEXT_WINDOW_DAYS,
  ordinal,
  type ContextFacts,
} from './context-line';

const facts = (overrides: Partial<ContextFacts> = {}): ContextFacts => ({
  symbol: 'PANACEABIO',
  noun: 'order',
  windowDays: DEFAULT_CONTEXT_WINDOW_DAYS,
  coverageDays: 45,
  priorInWindow: 0,
  lastPriorAt: null,
  amountRupees: null,
  priorsWithAmount: 0,
  priorsAtLeastAsLarge: 0,
  ...overrides,
});

describe('ordinal', () => {
  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [10, '10th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    [24, '24th'],
    [101, '101st'],
    [111, '111th'],
    [112, '112th'],
    [113, '113th'],
    [121, '121st'],
  ])('renders %d as %s', (value, expected) => {
    expect(ordinal(value)).toBe(expected);
  });
});

describe('istDayLabel', () => {
  it.each([
    ['2026-07-12T06:00:00.000Z', '12-Jul'],
    ['2026-01-01T12:00:00.000Z', '01-Jan'],
    ['2026-12-31T12:00:00.000Z', '31-Dec'],
  ])('renders %s as %s', (iso, expected) => {
    expect(istDayLabel(new Date(iso))).toBe(expected);
  });

  it('names the IST day, not the UTC one', () => {
    // 20:00 UTC on 11-Jul is 01:30 IST on 12-Jul. A UTC getter would say 11-Jul
    // for every filing in the Indian pre-open window.
    expect(istDayLabel(new Date('2026-07-11T20:00:00.000Z'))).toBe('12-Jul');
  });
});

describe('contextLine — the running count', () => {
  it.each([
    [1, '2nd order for PANACEABIO in 30 days'],
    [2, '3rd order for PANACEABIO in 30 days'],
    [3, '4th order for PANACEABIO in 30 days'],
    [10, '11th order for PANACEABIO in 30 days'],
    [20, '21st order for PANACEABIO in 30 days'],
  ])('counts %d priors as "%s"', (priorInWindow, expected) => {
    expect(contextLine(facts({ priorInWindow }))).toBe(expected);
  });

  it('uses the category noun it is given', () => {
    expect(
      contextLine(facts({ noun: 'credit-rating action', priorInWindow: 2 })),
    ).toBe('3rd credit-rating action for PANACEABIO in 30 days');
  });
});

describe('contextLine — the size comparison', () => {
  it('states largest-in-window only when something smaller exists to compare to', () => {
    expect(
      contextLine(
        facts({
          amountRupees: 782_412_000,
          priorsWithAmount: 3,
          priorsAtLeastAsLarge: 0,
          priorInWindow: 3,
        }),
      ),
    ).toBe('largest order for PANACEABIO in the last 30 days');
  });

  it.each([
    [
      'no prior carries an amount',
      { priorsWithAmount: 0, priorsAtLeastAsLarge: 0 },
    ],
    [
      'a prior is at least as large',
      { priorsWithAmount: 4, priorsAtLeastAsLarge: 1 },
    ],
    ['every prior is larger', { priorsWithAmount: 4, priorsAtLeastAsLarge: 4 }],
  ])('does not claim largest when %s', (_label, overrides) => {
    const line = contextLine(
      facts({ amountRupees: 782_412_000, priorInWindow: 4, ...overrides }),
    );
    expect(line).not.toMatch(/largest/);
  });

  it('falls back to the count when it cannot claim largest', () => {
    expect(
      contextLine(
        facts({
          amountRupees: 782_412_000,
          priorInWindow: 2,
          priorsWithAmount: 2,
          priorsAtLeastAsLarge: 1,
        }),
      ),
    ).toBe('3rd order for PANACEABIO in 30 days');
  });

  it('never claims largest without an amount of its own', () => {
    expect(
      contextLine(
        facts({
          amountRupees: null,
          priorsWithAmount: 5,
          priorsAtLeastAsLarge: 0,
          priorInWindow: 5,
        }),
      ),
    ).not.toMatch(/largest/);
  });
});

describe('contextLine — breaking a quiet run', () => {
  it('names the last one when nothing is inside the window', () => {
    expect(
      contextLine(
        facts({
          noun: 'credit-rating action',
          priorInWindow: 0,
          lastPriorAt: new Date('2026-07-12T06:00:00.000Z'),
        }),
      ),
    ).toBe('first credit-rating action for PANACEABIO since 12-Jul');
  });

  it('says nothing at all when the symbol is unknown in this category', () => {
    // "First ever" would be a claim about the exchange's history. This
    // collection is not that.
    expect(
      contextLine(facts({ priorInWindow: 0, lastPriorAt: null })),
    ).toBeNull();
  });
});

describe('contextLine — the coverage guard', () => {
  it.each([
    [45, 30, '3rd order for PANACEABIO in 30 days'],
    [32, 30, '3rd order for PANACEABIO in 30 days'],
    [12, 30, '3rd order for PANACEABIO in 12 days'],
    [2, 30, '3rd order for PANACEABIO in 2 days'],
    [7.9, 30, '3rd order for PANACEABIO in 7 days'],
  ])(
    'clamps a %d-day collection asked about %d days',
    (coverageDays, windowDays, expected) => {
      expect(
        contextLine(facts({ coverageDays, windowDays, priorInWindow: 2 })),
      ).toBe(expected);
    },
  );

  it.each([
    [0],
    [0.5],
    [1],
    [MIN_CONTEXT_WINDOW_DAYS - 0.01],
    [Number.NaN],
    [-5],
  ])('says nothing on a collection covering %s days', (coverageDays) => {
    // A window claim is a claim about data. Two days of filings cannot support
    // "largest in the last 30 days", and every word of it would be true.
    expect(
      contextLine(
        facts({
          coverageDays,
          priorInWindow: 4,
          amountRupees: 1,
          priorsWithAmount: 2,
        }),
      ),
    ).toBeNull();
  });

  it('never states a window longer than the data held', () => {
    for (const coverageDays of [2, 5, 9, 17, 31, 60]) {
      const line = contextLine(
        facts({ coverageDays, priorInWindow: 1, windowDays: 30 }),
      );
      if (line === null) continue;
      const stated = Number(/(\d+) days/.exec(line)?.[1]);
      expect(stated).toBeLessThanOrEqual(Math.floor(coverageDays));
      expect(stated).toBeLessThanOrEqual(30);
    }
  });
});

describe('contextLine — what it refuses to say', () => {
  it('says nothing for a category with no countable event', () => {
    expect(
      contextLine(
        facts({ noun: null, priorInWindow: 5, lastPriorAt: new Date() }),
      ),
    ).toBeNull();
  });

  it.each([
    [{ priorInWindow: 4 }],
    [{ priorInWindow: 0, lastPriorAt: new Date('2026-07-12T06:00:00.000Z') }],
    [
      {
        amountRupees: 1_000_000_000,
        priorsWithAmount: 2,
        priorInWindow: 2,
      },
    ],
  ])('never uses predictive or advisory language: %j', (overrides) => {
    const line = contextLine(facts(overrides));
    expect(line).not.toBeNull();
    expect(line as string).not.toMatch(
      /\b(?:bullish|bearish|buy|sell|target|upside|downside|expect|should|likely|positive|negative|strong|weak|rally|surge)\b/i,
    );
  });

  it('states only counts, comparisons and dates', () => {
    const line = contextLine(facts({ priorInWindow: 2 })) as string;
    expect(line).toMatch(
      /^\d+(?:st|nd|rd|th) order for PANACEABIO in \d+ days$/,
    );
  });
});
