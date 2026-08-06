import { composeHeadline, MAX_COMPONENT_CHARS } from './headline';

const base = {
  symbol: 'PANACEABIO',
  category: 'Bagging/Receiving of orders/contracts',
  amountRupees: null as number | null,
  counterparty: null as string | null,
};

describe('composeHeadline — the enriched form', () => {
  it.each([
    [
      'RAILTEL',
      'Bagging/Receiving of orders/contracts',
      185_366_820,
      'South Western Railway',
      'RAILTEL BAGS ORDER ₹18.54 cr from South Western Railway',
    ],
    [
      'KEC',
      'Press Release',
      10_630_000_000,
      null,
      'KEC PRESS RELEASE ₹1,063 cr',
    ],
    [
      'INNOVISION',
      'Awarding of order(s)/contract(s)',
      92_344_635,
      'NHAI (National Highways Authority of India)',
      'INNOVISION AWARDS CONTRACT ₹9.23 cr from NHAI (National Highways Authority of India)',
    ],
    [
      'GROBTEA',
      'Acquisition',
      721_618_000,
      null,
      'GROBTEA ACQUISITION ₹72.16 cr',
    ],
    [
      'ceinsys',
      'Bagging/Receiving of orders/contracts',
      169_052_450,
      'EKS InTec India Private Limited',
      'CEINSYS BAGS ORDER ₹16.91 cr from EKS InTec India Private Limited',
    ],
  ])(
    'composes %s / %s into a wire line',
    (symbol, category, amountRupees, counterparty, expected) => {
      const headline = composeHeadline({
        symbol,
        category,
        amountRupees,
        counterparty,
      });
      expect(headline.form).toBe('enriched');
      expect(headline.text).toBe(expected);
    },
  );

  it('records every component that went into the line', () => {
    const headline = composeHeadline({
      symbol: 'RAILTEL',
      category: 'Bagging/Receiving of orders/contracts',
      amountRupees: 185_366_820,
      counterparty: 'South Western Railway',
    });
    expect(headline.components).toEqual({
      symbol: 'RAILTEL',
      actionPhrase: 'BAGS ORDER',
      amount: '₹18.54 cr',
      counterparty: 'South Western Railway',
    });
  });

  it.each([
    ['an empty counterparty', ''],
    ['a whitespace counterparty', '   \n '],
  ])(
    'omits %s rather than rendering a dangling "from"',
    (_label, counterparty) => {
      const headline = composeHeadline({
        ...base,
        amountRupees: 185_366_820,
        counterparty,
      });
      expect(headline.text).toBe('PANACEABIO BAGS ORDER ₹18.54 cr');
      expect(headline.text).not.toMatch(/from\s*$/);
    },
  );
});

describe('composeHeadline — degrading to verbatim', () => {
  it('states the exchange words when the amount was refused', () => {
    const headline = composeHeadline(base);
    expect(headline.form).toBe('verbatim');
    expect(headline.text).toBe(
      'PANACEABIO — BAGGING/RECEIVING OF ORDERS/CONTRACTS',
    );
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a negative amount', -5],
  ])('degrades when the stored amount is %s', (_label, amountRupees) => {
    const headline = composeHeadline({ ...base, amountRupees });
    expect(headline.form).toBe('verbatim');
    expect(headline.text).not.toMatch(/NaN|Infinity|₹-/);
  });

  it('degrades for a category the action table does not map', () => {
    const headline = composeHeadline({
      symbol: 'ACME',
      category: 'Some Category NSE Invented Yesterday',
      amountRupees: 185_366_820,
      counterparty: 'South Western Railway',
    });
    expect(headline.form).toBe('verbatim');
    expect(headline.text).toBe('ACME — SOME CATEGORY NSE INVENTED YESTERDAY');
  });

  it('never carries a counterparty on a degraded line', () => {
    // A named counterparty with no size is an invitation to guess the size.
    const headline = composeHeadline({
      ...base,
      amountRupees: null,
      counterparty: 'South Western Railway',
    });
    expect(headline.text).not.toContain('South Western Railway');
    expect(headline.components.counterparty).toBeNull();
  });

  it('is byte-identical to the format the alert already sends', () => {
    // This is the compatibility guarantee. The degraded line must be exactly
    // what `formatFilingAlert` puts on its first line today, or every refused
    // filing silently changes shape on the wire.
    const symbol = 'M&M';
    const category = 'Outcome of Board Meeting';
    expect(composeHeadline({ ...base, symbol, category }).text).toBe(
      `${symbol.toUpperCase()} — ${category.toUpperCase()}`,
    );
  });
});

describe('composeHeadline — the wire discipline', () => {
  it.each([
    [
      'a symbol with a newline',
      'RAIL\nTEL',
      'Bagging/Receiving of orders/contracts',
    ],
    [
      'a category with a newline',
      'RAILTEL',
      'Bagging/Receiving\nof orders/contracts',
    ],
    [
      'tabs and doubled spaces',
      'RAIL\tTEL',
      'Bagging/Receiving  of orders/contracts',
    ],
  ])('collapses %s to a single line', (_label, symbol, category) => {
    const headline = composeHeadline({
      symbol,
      category,
      amountRupees: 185_366_820,
      counterparty: null,
    });
    expect(headline.text).not.toContain('\n');
    expect(headline.text).not.toContain('\t');
  });

  it('collapses a counterparty carrying a newline', () => {
    const headline = composeHeadline({
      ...base,
      amountRupees: 185_366_820,
      counterparty: 'South Western\nRailway',
    });
    expect(headline.text).toBe(
      'PANACEABIO BAGS ORDER ₹18.54 cr from South Western Railway',
    );
  });

  it.each([
    ['symbol', { symbol: 'X'.repeat(500) }],
    ['category', { category: 'Y'.repeat(500) }],
    [
      'counterparty',
      { counterparty: 'Z'.repeat(500), amountRupees: 185_366_820 },
    ],
  ])('bounds an over-long %s', (_label, overrides) => {
    const headline = composeHeadline({ ...base, ...overrides });
    for (const component of Object.values(headline.components)) {
      if (typeof component !== 'string') continue;
      expect(component.length).toBeLessThanOrEqual(MAX_COMPONENT_CHARS);
    }
  });

  it('carries no advisory, predictive or valuation framing', () => {
    const headline = composeHeadline({
      ...base,
      amountRupees: 185_366_820,
      counterparty: 'South Western Railway',
    });
    expect(headline.text).not.toMatch(
      /\b(?:bullish|bearish|buy|sell|target|upside|downside|expect|should|likely|positive|negative)\b/i,
    );
  });

  it('states nothing about an amount it was not given', () => {
    const headline = composeHeadline(base);
    expect(headline.text).not.toMatch(/₹|crore|cr\b|lakh/i);
  });
});
