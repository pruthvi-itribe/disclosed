import {
  AMOUNT_DECIMALS,
  CRORE,
  formatRupees,
  groupIndian,
  LAKH,
  splitRounded,
} from './amount-format';

describe('groupIndian', () => {
  it.each([
    ['', ''],
    ['7', '7'],
    ['63', '63'],
    ['063', '063'],
    ['1063', '1,063'],
    ['12345', '12,345'],
    ['100000', '1,00,000'],
    ['1000000', '10,00,000'],
    ['123456789', '12,34,56,789'],
    ['18536682', '1,85,36,682'],
  ])('groups %s as %s', (digits, expected) => {
    expect(groupIndian(digits)).toBe(expected);
  });

  it('does not depend on the ICU data compiled into node', () => {
    // A small-icu build falls back to en-US grouping for en-IN, which renders
    // one lakh as 100,000. This module must be immune to that.
    expect(groupIndian('100000')).not.toBe('100,000');
  });
});

describe('formatRupees', () => {
  it.each([
    // The three shapes the wire convention is specified in.
    [782_412_000, '₹78.24 cr'],
    [10_630_000_000, '₹1,063 cr'],
    [185_366_820, '₹18.54 cr'],
    // Real extracted figures from the committed corpus.
    [8_470_000_000, '₹847 cr'],
    [4_415_300_000, '₹441.53 cr'],
    [92_344_635, '₹9.23 cr'],
    [721_618_000, '₹72.16 cr'],
    [356_911_425, '₹35.69 cr'],
  ])('renders %d as %s', (rupees, expected) => {
    expect(formatRupees(rupees)).toBe(expected);
  });

  it.each([
    [CRORE, '₹1 cr'],
    [CRORE - 1, '₹100 lakh'],
    [LAKH, '₹1 lakh'],
    [LAKH - 1, '₹99,999'],
    [10_000_000_000_000, '₹10,00,000 cr'],
  ])('renders the unit boundary %d as %s', (rupees, expected) => {
    expect(formatRupees(rupees)).toBe(expected);
  });

  it.each([
    [45_000, '₹45,000'],
    [999, '₹999'],
    [0, '₹0'],
    [1000, '₹1,000'],
  ])('states sub-lakh figures whole: %d as %s', (rupees, expected) => {
    expect(formatRupees(rupees)).toBe(expected);
  });

  it.each([
    [45_000.37, '₹45,000'],
    [45_000.72, '₹45,001'],
  ])('rounds a sub-lakh figure to the rupee: %d as %s', (rupees, expected) => {
    expect(formatRupees(rupees)).toBe(expected);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['a negative amount', -1],
    ['a large negative amount', -10_000_000],
  ])('refuses to render %s', (_label, rupees) => {
    // Never a placeholder string: a headline omits what it cannot state.
    expect(formatRupees(rupees)).toBeNull();
  });

  it.each([
    [1_063_000_000, '₹106.3 cr'],
    [1_060_000_000, '₹106 cr'],
    [1_005_000_000, '₹100.5 cr'],
  ])('strips trailing zeros from %d, giving %s', (rupees, expected) => {
    expect(formatRupees(rupees)).toBe(expected);
  });

  it('rounds half away from zero at two decimals', () => {
    // 78.245 cr. toFixed uses the binary representation, so pin the result
    // rather than assume: what must hold is that it is stable and two-decimal.
    const rendered = formatRupees(782_450_000);
    expect(rendered).toMatch(/^₹78\.2[45] cr$/);
  });

  it('never renders more than the declared number of decimals', () => {
    for (const rupees of [123_456_789, 987_654_321, 111_111_111, 100_000_001]) {
      const rendered = formatRupees(rupees);
      expect(rendered).not.toBeNull();
      const fraction = (rendered as string).split('.')[1] ?? '';
      expect(fraction.replace(/\D+$/, '').length).toBeLessThanOrEqual(
        AMOUNT_DECIMALS,
      );
    }
  });

  it('never renders a zero-valued unit figure', () => {
    // The unit is chosen from the magnitude, so no value can round to 0.00 in
    // the unit it was placed in. Asserted across the boundary neighbourhood
    // because a change to the thresholds is exactly how that would break.
    for (const rupees of [LAKH, LAKH + 1, CRORE, CRORE + 1, CRORE - 1]) {
      expect(formatRupees(rupees)).not.toMatch(/^₹0(\.0+)? (cr|lakh)$/);
    }
  });
});

describe('splitRounded', () => {
  it('keeps at least one decimal place, which is what makes the split total', () => {
    // `splitRounded` slices at the decimal point without guarding for its
    // absence. That is only sound while AMOUNT_DECIMALS >= 1, so the
    // precondition is asserted here rather than defended with an unreachable
    // branch in the module.
    expect(AMOUNT_DECIMALS).toBeGreaterThanOrEqual(1);
    for (const value of [0, 1, 1.005, 1063, 78.2412, 1e15]) {
      expect(value.toFixed(AMOUNT_DECIMALS)).toContain('.');
    }
  });

  it.each([
    [1063, '1063', ''],
    [78.2412, '78', '24'],
    [100.5, '100', '5'],
    [0.01, '0', '01'],
    [0, '0', ''],
  ])('splits %d into %s and %s', (value, integer, fraction) => {
    expect(splitRounded(value)).toEqual({ integer, fraction });
  });
});
