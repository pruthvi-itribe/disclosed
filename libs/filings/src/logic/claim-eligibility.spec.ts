import {
  CLAIM_BEARING_CATEGORIES,
  CLAIM_SIGNAL_PATTERN,
  claimEligibility,
  MIN_CLAIM_DOCUMENT_CHARS,
} from './claim-eligibility';

/** Long enough to clear the covering-letter bar, and full of claim vocabulary. */
const NARRATIVE = `${'The Company has expanded its distribution network and expects revenue growth. '.repeat(
  30,
)}`;

/** A covering letter: long, and carrying none of the vocabulary. */
const COVERING_LETTER = `${'To the Secretary, BSE Limited, Dalal Street, Mumbai. Please find the enclosed intimation and take the same on record. '.repeat(
  20,
)}`;

const filing = (category: string, summary = 'a summary') => ({
  category,
  summary,
});

describe('claimEligibility', () => {
  it.each([
    ['an investor presentation', 'Investor Presentation'],
    ['a press release', 'Press Release'],
    [
      'an earnings-call update',
      'Analysts/Institutional Investor Meet/Con. Call Updates',
    ],
    ['an order win', 'Bagging/Receiving of orders/contracts'],
    ['a capacity addition', 'Capacity addition'],
    ['a credit rating action', 'Credit Rating'],
  ])('allows %s with a narrative document', (_label, category) => {
    expect(claimEligibility(filing(category), NARRATIVE)).toEqual({
      eligible: true,
    });
  });

  it('is case- and whitespace-insensitive about the category', () => {
    expect(
      claimEligibility(filing('  INVESTOR PRESENTATION  '), NARRATIVE).eligible,
    ).toBe(true);
  });

  describe('what it never pays for', () => {
    it.each([
      ['a newspaper scan', 'Copy of Newspaper Publication'],
      ['a trading window notice', 'Trading Window'],
      ['general updates', 'General Updates'],
    ])('skips %s as routine', (_label, category) => {
      const verdict = claimEligibility(filing(category), NARRATIVE);
      expect(verdict.eligible).toBe(false);
      if (verdict.eligible) throw new Error('expected a refusal');
      expect(verdict.reason).toContain('routine');
    });

    it.each([
      ['a record date', 'Record Date'],
      ['a board change', 'Change in Director(s)'],
      ['a shareholders meeting', 'Shareholders meeting'],
      ['a category NSE has not invented yet', 'Some Future Category'],
      // The exchange's own discrepancy correspondence, not a company stating
      // anything about itself. `results-eligibility.ts` argues both at length.
      ['a clarification request', 'Clarification - Financial Results'],
      ['a reply to one', 'Reply to Clarification- Financial results'],
    ])('skips %s as not claim-bearing', (_label, category) => {
      const verdict = claimEligibility(filing(category), NARRATIVE);
      expect(verdict.eligible).toBe(false);
      if (verdict.eligible) throw new Error('expected a refusal');
      expect(verdict.reason).toContain('not a claim-bearing category');
    });

    it('now ADMITS the category it was wrongly excluding', () => {
      // 200 of 1,699 live filings, 64.4% of them carrying results. The comment
      // that excluded them said the amount extractor already read the tables;
      // it does not and cannot, and a third of them are not results at all.
      // APOLLOTYRE seqId 106729105 is the filing that proved it.
      expect(
        claimEligibility(filing('Outcome of Board Meeting'), NARRATIVE),
      ).toEqual({ eligible: true });
    });

    it('skips a filing with legal exposure BEFORE any model sees it', () => {
      // The cheapest way to be sure nothing is drafted about a regulatory
      // action is for nothing to be drafted.
      const verdict = claimEligibility(
        filing(
          'Press Release',
          'the Company has received a SEBI show-cause notice',
        ),
        NARRATIVE,
      );
      expect(verdict.eligible).toBe(false);
      if (verdict.eligible) throw new Error('expected a refusal');
      expect(verdict.reason).toContain('legal exposure');
    });

    it('skips a covering letter by length', () => {
      // Measured: WELENT's earnings-call intimation is 1,269 characters of
      // address block, one sentence saying an audio file exists, and a
      // signature. There is no claim in it to find.
      const verdict = claimEligibility(
        filing('Analysts/Institutional Investor Meet/Con. Call Updates'),
        'x'.repeat(MIN_CLAIM_DOCUMENT_CHARS - 1),
      );
      expect(verdict.eligible).toBe(false);
      if (verdict.eligible) throw new Error('expected a refusal');
      expect(verdict.reason).toContain('covering letter');
    });

    it('skips a long document that uses none of the claim vocabulary', () => {
      const verdict = claimEligibility(
        filing('Press Release'),
        COVERING_LETTER,
      );
      expect(verdict.eligible).toBe(false);
      if (verdict.eligible) throw new Error('expected a refusal');
      expect(verdict.reason).toContain('claim vocabulary');
    });

    it('says WHY, so a filing nothing was tried on can explain itself', () => {
      // "Nothing was found" and "nothing was looked for" are opposite facts
      // about a filing and must not render the same.
      const verdict = claimEligibility(filing('Record Date'), NARRATIVE);
      if (verdict.eligible) throw new Error('expected a refusal');
      expect(verdict.reason.length).toBeGreaterThan(10);
    });
  });

  describe('the signal vocabulary', () => {
    it.each([
      ['guidance', 'the company has revised its guidance for the year'],
      ['a target', 'targets a 20% EBITDA margin'],
      ['an expectation', 'expects volume growth in the second half'],
      ['an expansion', 'expanding the commercial footprint into Spain'],
      ['a network', 'the regional supply network was strengthened'],
      ['a partnership', 'entered into a partnership with a global player'],
      [
        'joining a body',
        'joins the Microsoft Intelligent Security Association',
      ],
      ['an approval', 'received EMA approval for the second line'],
      ['a certification', 'the facility has been certified to ISO 27001'],
      ['a commissioning', 'commissioned a new plant at Hosur'],
      ['an acquisition', 'completed the acquisition of the balance stake'],
    ])('recognises %s', (_label, text) => {
      expect(CLAIM_SIGNAL_PATTERN.test(text)).toBe(true);
    });

    it.each([
      ['an enclosure note', 'please find enclosed the intimation'],
      ['a record note', 'kindly take the above information on record'],
      ['an address block', 'Exchange Plaza, Bandra Kurla Complex, Mumbai'],
    ])('does not fire on %s', (_label, text) => {
      expect(CLAIM_SIGNAL_PATTERN.test(text)).toBe(false);
    });
  });

  it('holds the allowlist lower-cased, or every lookup silently misses', () => {
    for (const category of CLAIM_BEARING_CATEGORIES) {
      expect(category).toBe(category.toLowerCase());
    }
  });

  it('covers the three categories the competitor published from', () => {
    // Pinned against literals: these are the categories the whole feature
    // exists to serve, and dropping one would be a silent regression.
    expect(CLAIM_BEARING_CATEGORIES.has('investor presentation')).toBe(true);
    expect(CLAIM_BEARING_CATEGORIES.has('press release')).toBe(true);
    expect(
      CLAIM_BEARING_CATEGORIES.has(
        'analysts/institutional investor meet/con. call updates',
      ),
    ).toBe(true);
  });
});
