import { hasAmbiguityKeyword, extractRupeeAmounts } from './ambiguity';

describe('hasAmbiguityKeyword', () => {
  it.each([
    'Company emerged as L1 bidder for the project',
    'Received a Letter of Intent from the customer',
    'Signed an MoU with the state government',
    'Received in-principle approval from the board',
  ])('flags conditional language: %s', (text) => {
    expect(hasAmbiguityKeyword(text)).toBe(true);
  });

  it('does not flag an unconditional order win', () => {
    expect(
      hasAmbiguityKeyword(
        'Received a work order worth Rs. 78.24 Crore from UNICEF',
      ),
    ).toBe(false);
  });

  it('matches case-insensitively', () => {
    expect(hasAmbiguityKeyword('LETTER OF INTENT received')).toBe(true);
  });

  it('does not match L1 inside an unrelated word', () => {
    expect(hasAmbiguityKeyword('Model XL1000 launched')).toBe(false);
  });
});

describe('extractRupeeAmounts', () => {
  it('parses crore amounts into rupees', () => {
    expect(extractRupeeAmounts('order worth Rs. 78.24 Crore')).toEqual([
      782_400_000,
    ]);
  });

  it('parses lakh amounts into rupees', () => {
    expect(extractRupeeAmounts('penalty of INR 5 Lakh')).toEqual([500_000]);
  });

  it('handles comma-grouped digits', () => {
    expect(extractRupeeAmounts('Rs 1,234.50 crore')).toEqual([12_345_000_000]);
  });

  it('returns every amount found', () => {
    expect(extractRupeeAmounts('Rs 10 crore and Rs 5 lakh')).toEqual([
      100_000_000, 500_000,
    ]);
  });

  it('returns an empty array when no amount is present', () => {
    expect(extractRupeeAmounts('Board meeting scheduled')).toEqual([]);
  });
});
