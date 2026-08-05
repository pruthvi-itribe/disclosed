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

  // Rumour framing is a distinct risk class from conditional deal language: the
  // exchange asking a company to confirm a press report is the least verified
  // filing on the wire, and it reads as fact if drafted from uncritically.
  it.each([
    'The Exchange has sought clarification with respect to recent news item captioned Flipkart likely to sell stake worth Rs 700 crore',
    'The Exchange has sought clarification from the Company with respect to recent news item captioned Ujjivan SFB enters wealth business',
    'Clarification on news item appearing in the media',
    'The company denies the story reported in the media',
    'Response to media report regarding a possible stake sale',
    'The Company categorically denies market speculation about a merger',
  ])('flags rumour framing: %s', (text) => {
    expect(hasAmbiguityKeyword(text)).toBe(true);
  });

  it('does not flag a confirmed result announcement', () => {
    expect(
      hasAmbiguityKeyword(
        'Dabur Q1 Consol Net Profit Surges 15% at Rs 591 Crore',
      ),
    ).toBe(false);
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

  // Plural units are the single largest miss in real NSE text: the trailing \b
  // cannot match after "crore" when the word is "crores".
  it('parses plural crore', () => {
    expect(
      extractRupeeAmounts(
        'KEC International wins New Orders of Rs. 1,063 crores',
      ),
    ).toEqual([10_630_000_000]);
  });

  it.each([
    ['fine of Rs 25 lakhs', 2_500_000],
    ['INR 3 Lacs', 300_000],
    ['Rs 12 Crs', 120_000_000],
  ])('parses plural unit spellings: %s', (text, expected) => {
    expect(extractRupeeAmounts(text)).toEqual([expected]);
  });

  // NSE emits the rupee sign HTML-escaped. Filings ingested before the mapper
  // decoded entities still carry the raw form, so the pattern handles both.
  it('parses the HTML entity form of the rupee sign', () => {
    expect(extractRupeeAmounts('RITES Q1FY27 Revenue &#8377;561 cr')).toEqual([
      5_610_000_000,
    ]);
  });

  it.each([
    ['MobiKwik delivers PAT of &#8377;76 Mn', 76_000_000],
    ['Moneyboxx Finance raises INR 500 million', 500_000_000],
    ['fund raise of Rs 1.5 bn', 1_500_000_000],
    ['Rs 2 billion outlay', 2_000_000_000],
  ])('parses million and billion units: %s', (text, expected) => {
    expect(extractRupeeAmounts(text)).toEqual([expected]);
  });

  // Widening the unit list to mn/bn makes an unanchored number dangerous: a
  // currency marker stays mandatory so bare figures are never read as rupees.
  it.each([
    'EBITDA grew to 500 mn',
    'order book of 1,063 crores',
    'headcount rose to 25 lakhs',
  ])('does not match a bare number with no currency marker: %s', (text) => {
    expect(extractRupeeAmounts(text)).toEqual([]);
  });

  // "shareholde|rs| 5 crore" — without a leading word boundary the "rs" tail of
  // an ordinary word acts as a currency marker.
  it('does not treat the tail of a word as a currency marker', () => {
    expect(
      extractRupeeAmounts('issued to shareholders 5 crore equity shares'),
    ).toEqual([]);
  });

  // The bare rupee sign is the sole currency marker on roughly a third of the
  // corpus candidates. Untested, dropping it from the alternation would cut the
  // gate number by ~30% with every other assertion still green.
  it('parses the rupee sign with no space before the figure', () => {
    expect(extractRupeeAmounts('order worth ₹78.24 crore')).toEqual([
      782_400_000,
    ]);
  });

  it('parses the rupee sign with a space before the figure', () => {
    expect(extractRupeeAmounts('Revenue ₹ 561 cr')).toEqual([5_610_000_000]);
  });

  it.each([
    ['Arisinfra Bags ₹79.05 Crore Work Order', 790_500_000],
    ['consolidated revenue of ₹1,063 crores', 10_630_000_000],
    ['PAT of ₹76 Mn', 76_000_000],
  ])('parses rupee-sign amounts across units: %s', (text, expected) => {
    expect(extractRupeeAmounts(text)).toEqual([expected]);
  });

  // "2 lakh crore" is 2e12, not 2e5. Reading the leading unit and ignoring the
  // trailing one under-reports by 10^7 — invisible in a funnel count, but it
  // would silently fail a materiality threshold in the scorer.
  it.each([
    ['Rs. 2 Lakh crore', 2e12],
    ['Rs 1.5 lakh crores', 1.5e12],
    ['INR 3 lac crore', 3e12],
    ['₹2 lakh cr', 2e12],
  ])('parses compound lakh-crore units: %s', (text, expected) => {
    expect(extractRupeeAmounts(text)).toEqual([expected]);
  });

  // Any other doubled unit is nonsense. Refusing to extract is safe; guessing
  // one of the two units yields a wrong number presented as a right one.
  it.each([
    'Rs 10 crore crore',
    'Rs 10 lakh lakh',
    'Rs 5 crore million',
    'Rs 5 crore lakh',
  ])('refuses to extract a nonsensical compound unit: %s', (text) => {
    expect(extractRupeeAmounts(text)).toEqual([]);
  });

  it('still separates two independent amounts after compound support', () => {
    expect(extractRupeeAmounts('Rs 10 crore and Rs 5 lakh')).toEqual([
      100_000_000, 500_000,
    ]);
  });
});
