import { claimFact, FactsSeen, sameFact } from './claim-fact';

const same = (a: string, b: string): boolean =>
  sameFact(claimFact(a), claimFact(b));

/**
 * Every pair here is a real one, taken from the live collection over 36 hours.
 * A fixture invented to suit the rule would only prove the rule matches the
 * fixture.
 */
describe('sameFact — real duplicate pairs', () => {
  it.each([
    [
      'the pair that prompted this',
      'Revenue growth of 5% YOY in Q1FY27',
      'Revenue grew 5% YOY in Q1FY27.',
    ],
    [
      'a reordered figure and unit',
      'Q1 consolidated EBITDA rose 18% YoY to INR 765.5 Lakhs',
      'Q1 consolidated EBITDA INR 765.5 lakhs, up 18% YoY',
    ],
    [
      'a date written two ways',
      'Record date fixed as August 20, 2026 for dividend payment',
      'NIIT fixes Aug 20, 2026 as record date for dividend.',
    ],
    [
      'a plant described twice',
      'Inaugurates 5.6 GW Seetharampur module plant',
      'Inaugurated 5.6 GW Seetharampur module manufacturing facility',
    ],
    [
      'guidance restated',
      'Sees FY27 EBIT margin in 12.25% to 12.75% band.',
      'Guides FY27 EBIT margin of 12.25-12.75%',
    ],
    [
      'the same board decision in two filings',
      'Board approves further investment of up to INR 16 crore in HCG Rajkot Hospitals LLP, wholly owned subsidiary.',
      'Board approved further investment of up to INR 16 Crore in wholly owned subsidiary HCG Rajkot Hospitals LLP.',
    ],
    [
      'the same figure with and without a tilde',
      'Q1 FY27 Adjusted EBITDA INR 1,339 Mn, up ~20% YoY',
      'Q1 FY27 adjusted EBITDA INR 1,339 Mn, up 20% YoY.',
    ],
    [
      'a grouping separator',
      'Q1 revenue from operations Rs 1,089 Cr, up 2.3% YoY',
      'Q1 revenue from operations Rs 1089 Cr, up 2.3% YoY',
    ],
  ])('recognises %s', (_label, a, b) => {
    expect(same(a, b)).toBe(true);
  });

  it('is symmetric', () => {
    const a = 'Revenue growth of 5% YOY in Q1FY27';
    const b = 'Revenue grew 5% YOY in Q1FY27.';
    expect(same(a, b)).toBe(same(b, a));
  });
});

describe('sameFact — what it must NOT collapse', () => {
  it('keeps two facts that merely share their numbers', () => {
    // The one genuine non-duplicate in the measured set: an identical figure
    // set and no vocabulary in common. Two of 122 pairs looked like this, and
    // they are the entire reason the shared-word guard exists.
    // Both HCG, both carrying exactly {30, 2026}, sharing no content word.
    expect(
      same(
        'Investment to be completed on or before 30 September 2026.',
        'Confirms no deviation or variation in utilisation of Rights Issue proceeds for quarter ended June 30, 2026.',
      ),
    ).toBe(false);
  });

  it('keeps two metrics that happen to move by the same percentage', () => {
    expect(same('Revenue up 5% YoY', 'EBITDA up 5% YoY')).toBe(false);
  });

  it('keeps claims whose figures differ at all', () => {
    expect(
      same('Q1 revenue Rs 1,089 Cr, up 2.3% YoY', 'Q1 revenue Rs 1,089 Cr'),
    ).toBe(false);
  });

  it('NEVER collapses two unquantified claims', () => {
    // The empty figure set is shared by every qualitative claim in the
    // collection. Treating it as a match would fold a company's whole
    // narrative output into one line.
    expect(
      same(
        'Entered into a partnership with a European distributor',
        'Entered into a partnership with a Japanese distributor',
      ),
    ).toBe(false);
    expect(same('Commissioned the plant', 'Commissioned the plant')).toBe(
      false,
    );
  });

  it.each([[''], ['   '], [null], [undefined], [42]])(
    'answers false for %p rather than throwing',
    (input) => {
      expect(same(input as unknown as string, 'Revenue up 5%')).toBe(false);
    },
  );
});

describe('FactsSeen', () => {
  it('keeps the first telling and suppresses the repeat', () => {
    const seen = new FactsSeen();
    expect(
      seen.addAndCheck('DHARMAJ', 'Revenue growth of 5% YOY in Q1FY27'),
    ).toBe(false);
    expect(seen.addAndCheck('DHARMAJ', 'Revenue grew 5% YOY in Q1FY27.')).toBe(
      true,
    );
  });

  it('never collapses across companies', () => {
    // Two firms can report the same revenue in the same quarter. Folding those
    // together would hide one company's results entirely, which is a far worse
    // failure than showing a fact twice.
    const seen = new FactsSeen();
    expect(
      seen.addAndCheck('ACME', 'Q1 revenue Rs 1,089 Cr, up 2.3% YoY'),
    ).toBe(false);
    expect(
      seen.addAndCheck('OTHER', 'Q1 revenue Rs 1,089 Cr, up 2.3% YoY'),
    ).toBe(false);
  });

  it('lets a company state several different facts', () => {
    const seen = new FactsSeen();
    expect(seen.addAndCheck('X', 'Q1 revenue Rs 1,089 Cr')).toBe(false);
    expect(seen.addAndCheck('X', 'Q1 EBITDA Rs 203 Cr')).toBe(false);
    expect(seen.addAndCheck('X', 'Q1 PAT Rs 108 Cr')).toBe(false);
  });

  it('recognises a repeat of the third fact, not only the first', () => {
    const seen = new FactsSeen();
    seen.addAndCheck('X', 'Q1 revenue Rs 1,089 Cr');
    seen.addAndCheck('X', 'Q1 EBITDA Rs 203 Cr');
    seen.addAndCheck('X', 'Q1 PAT Rs 108 Cr');
    expect(seen.addAndCheck('X', 'PAT for Q1 was Rs 108 Cr')).toBe(true);
  });

  it('does not suppress unquantified claims, however many there are', () => {
    const seen = new FactsSeen();
    expect(seen.addAndCheck('X', 'Commissioned the plant')).toBe(false);
    expect(seen.addAndCheck('X', 'Commissioned the plant')).toBe(false);
  });
});
