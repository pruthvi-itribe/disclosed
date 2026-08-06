import { findUnitScaleHeaders, hasValueBand } from './amount-hazards';

describe('findUnitScaleHeaders', () => {
  // Every string below is copied out of a filing in the sampled corpus. The
  // first one is the reason this detector exists: NIPPOBATRY's turnover row
  // reads `(Rs. in thousands): Rs.7,15,126`, which is Rs 71.5 crore written as
  // if it were Rs 7.15 lakh — a 1,000x under-report of a defence acquisition.
  it.each([
    'Turnover of the Target Entity for FY 2024-25 (Rs. in thousands): Rs.7,15,126',
    'Turnover (last 3 years): Rs. In thousands FY 2024-25 Rs. 7,43,123',
    'Statement of Standalone Financial Results (Rs. In Lakh except per share data)',
    'Statement of Unaudited Consolidated Financial Results (Rs.in lakh, except per share data)',
    'Statement of Unaudited Consolidated Financial Results (Rupees in Lakh)',
    'Unaudited Financial Results of BSE Limited (₹ in Lakhs)',
    'Amounts in million except share and per share data, unless otherwise stated',
    'Revenue (INR Mn) & EBITDA Margins (%)',
    'Particulars (In Mn) Q1-FY27 Q1-FY26',
    'Rated Amount (Rs. crore) Rating Action',
    'Instrument Type Size of Issue (million) Rating assigned',
    'Consolidated Turnover of IIBHL (in ₹ Crores)',
  ])('detects a declared scale in: %s', (text) => {
    expect(findUnitScaleHeaders(text).length).toBeGreaterThan(0);
  });

  it('reports the declaration verbatim so a refusal can name it', () => {
    expect(
      findUnitScaleHeaders('Turnover (Rs. in thousands): Rs.7,15,126'),
    ).toEqual(['Rs. in thousands']);
  });

  // A false positive here refuses every figure in the document, so the
  // detector must stay off ordinary order-win prose. All of these are real.
  it.each([
    'g) Broad consideration or size of order(s)/contract(s) (in INR); Rs. 18,53,66,820/-',
    'HFCL secures Export Order of ~USD 46.13 million (equivalent to ~INR 441.53 crore)',
    'has secured new orders of Rs. 1,063 crores across various businesses',
    'Order value of ₹ 1.03 Cr. approx.',
    'BEL receives order worth Rs . 847 Crore',
    'a total value of the Purchase Order amounting to Rs. 3,56,91,142.50 /-',
  ])('does not fire on: %s', (text) => {
    expect(findUnitScaleHeaders(text)).toEqual([]);
  });
});

describe('hasValueBand', () => {
  // L&T withholds the figure by design and prints the key in the same PDF.
  it('detects the L&T order-classification table', () => {
    expect(
      hasValueBand(
        'Classification Significant Large Major Mega Ultra-Mega\n' +
          'Value in ₹ Cr 1,000 to  2,500 2,500 to  5,000 5,000 to  10,000',
      ),
    ).toBe(true);
  });

  it('detects a prose value range', () => {
    expect(
      hasValueBand('the order is in the range of Rs 500 crore to Rs 700 crore'),
    ).toBe(true);
  });

  it.each([
    'new orders of Rs. 1,063 crores',
    'Rs. 0.74 crores (including taxes)',
    'the contract will be executed over 5 to 6 months',
  ])('does not treat a plain figure as a band: %s', (text) => {
    expect(hasValueBand(text)).toBe(false);
  });
});
