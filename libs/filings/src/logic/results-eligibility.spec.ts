import {
  MIN_RESULTS_DOCUMENT_CHARS,
  RESULTS_BEARING_CATEGORIES,
  RESULTS_STATEMENT_PATTERN,
  resultsEligibility,
} from './results-eligibility';

/** A document with a statement in it, long enough to clear the length gate. */
const STATEMENT = [
  'UNAUDITED CONSOLIDATED FINANCIAL RESULTS FOR THE QUARTER ENDED JUNE 30, 2026',
  '₹ Million',
  '30.06.202631.03.202630.06.202531.03.2026',
  'Revenue from operations 73,977.90 73,356.74 65,607.59 2,84,706.00',
  'Total income (1 + 2) 74,561.21 73,708.95 65,796.53 2,86,040.05',
  'padding '.repeat(300),
].join('\n');

/** The covering letter of a board-meeting outcome that carries no table. */
const COVERING_LETTER = [
  'Pursuant to Regulation 30 of SEBI (Listing Obligations and Disclosure',
  'Requirements) Regulations, 2015, we wish to inform you that the Board of',
  'Directors at its meeting held today considered and approved the financial',
  'results of the Company. The full format of the financial results shall be',
  'available on the website of the Stock exchanges.',
  'padding '.repeat(300),
].join('\n');

const filing = (category: string) => ({ category, summary: 'a filing' });

describe('resultsEligibility', () => {
  it('admits the category this pipeline was blind to', () => {
    // APOLLOTYRE seqId 106729105: 69,723 characters of consolidated and
    // standalone statements, enriched, and refused before a model was called
    // because the category was not on any allowlist.
    expect(
      resultsEligibility(filing('Outcome of Board Meeting'), STATEMENT),
    ).toEqual({ eligible: true });
  });

  it.each([...RESULTS_BEARING_CATEGORIES])('admits %s', (category) => {
    expect(resultsEligibility(filing(category), STATEMENT).eligible).toBe(true);
  });

  it('matches the category case-insensitively and trimmed', () => {
    expect(
      resultsEligibility(filing('  OUTCOME OF BOARD MEETING '), STATEMENT)
        .eligible,
    ).toBe(true);
  });

  it.each([
    // The exchange's own discrepancy correspondence. Argued in the module.
    ['Clarification - Financial Results'],
    ['Reply to Clarification- Financial results'],
    // Names a quarter and reports on IPO proceeds, not on results.
    ['Monitoring Agency Report'],
    // Names a quarter and is a share-transfer compliance certificate.
    [
      'Certificate under SEBI (Depositories and Participants) Regulations, 2018',
    ],
    ['Copy of Newspaper Publication'],
    ['Record Date'],
  ])('refuses %s', (category) => {
    const verdict = resultsEligibility(filing(category), STATEMENT);
    expect(verdict).toEqual({
      eligible: false,
      reason: expect.stringContaining('not a results-bearing category'),
    });
  });

  it('refuses a covering letter that only announces results exist', () => {
    // The gate that stops the whole category being sent to a model: two thirds
    // of `Outcome of Board Meeting` filings carry no statement at all.
    expect(
      resultsEligibility(filing('Outcome of Board Meeting'), COVERING_LETTER),
    ).toEqual({
      eligible: false,
      reason: expect.stringContaining('row labels'),
    });
  });

  it('refuses a document with a statement row but no basis heading', () => {
    const noHeading = STATEMENT.replace(
      'UNAUDITED CONSOLIDATED FINANCIAL RESULTS FOR THE QUARTER ENDED JUNE 30, 2026',
      'FINANCIAL RESULTS FOR THE QUARTER ENDED JUNE 30, 2026',
    );
    expect(
      resultsEligibility(filing('Outcome of Board Meeting'), noHeading),
    ).toEqual({
      eligible: false,
      reason: expect.stringContaining('statement heading'),
    });
  });

  it('refuses a document too short to hold a statement', () => {
    const short =
      'UNAUDITED CONSOLIDATED FINANCIAL RESULTS Revenue from operations 1,234.00';
    expect(short.length).toBeLessThan(MIN_RESULTS_DOCUMENT_CHARS);
    expect(
      resultsEligibility(filing('Outcome of Board Meeting'), short),
    ).toEqual({
      eligible: false,
      reason: expect.stringContaining('too short'),
    });
  });

  it('bounds the length at a literal as well as at the measurement', () => {
    expect(MIN_RESULTS_DOCUMENT_CHARS).toBe(2_000);
  });

  it('refuses a filing carrying legal exposure before any model is called', () => {
    expect(
      resultsEligibility(
        {
          category: 'Outcome of Board Meeting',
          summary:
            'The Company has received a show-cause notice and the litigation is pending',
        },
        STATEMENT,
      ),
    ).toEqual({ eligible: false, reason: 'the filing carries legal exposure' });
  });

  it.each([
    ['revenue from operations', true],
    ['Total Income', true],
    ['profit for the period', true],
    ['profit after tax', true],
    ['earnings per equity share', true],
    ['earnings per share', true],
    ['the board approved the financial results', false],
    ['dividend of ₹2 per share was declared', false],
  ])('reads %s as a statement row: %s', (text, expected) => {
    expect(RESULTS_STATEMENT_PATTERN.test(text)).toBe(expected);
  });
});
