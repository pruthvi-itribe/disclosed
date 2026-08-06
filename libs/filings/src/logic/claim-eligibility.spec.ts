import {
  claimEligibility,
  MIN_CLAIM_DOCUMENT_CHARS,
} from './claim-eligibility';

/** Long enough to clear the covering-letter bar. */
const NARRATIVE =
  'The Company has expanded its distribution network and expects revenue growth. '.repeat(
    30,
  );

/**
 * Long, and carrying none of the words the deleted vocabulary gate looked for.
 *
 * Kept as a fixture precisely BECAUSE it must now be eligible: the vocabulary
 * gate refused documents like this and it was a fail-closed test on wording,
 * which is the same shape of mistake as the category allowlist.
 */
const NO_VOCABULARY =
  'To the Secretary, BSE Limited, Dalal Street, Mumbai. Please find the enclosed intimation and take the same on record. '.repeat(
    20,
  );

const filing = (category: string, summary = 'a summary') => ({
  category,
  summary,
});

describe('claimEligibility', () => {
  describe('no category decides whether a document is read', () => {
    // THE REGRESSION TEST FOR THE RESULTS GAP. Every one of these was refused
    // before a model was called, by a 22-name allowlist. `Outcome of Board
    // Meeting` alone is 1,346 of 17,442 corpus filings and is where a listed
    // company publishes its quarterly results.
    it.each([
      ['a board-meeting outcome', 'Outcome of Board Meeting'],
      ['an investor presentation', 'Investor Presentation'],
      ['a press release', 'Press Release'],
      [
        'an earnings-call update',
        'Analysts/Institutional Investor Meet/Con. Call Updates',
      ],
      ['an order win', 'Bagging/Receiving of orders/contracts'],
      ['a credit rating action', 'Credit Rating'],
      ['a record date', 'Record Date'],
      ['a board change', 'Change in Director(s)'],
      ['a shareholders meeting', 'Shareholders meeting'],
      ['a newspaper scan', 'Copy of Newspaper Publication'],
      ['a trading window notice', 'Trading Window'],
      ['general updates', 'General Updates'],
      ['a clarification request', 'Clarification - Financial Results'],
      ['a category NSE has not invented yet', 'Some Future Category'],
      ['a blank category', ''],
    ])('reads %s', (_label, category) => {
      expect(claimEligibility(filing(category), NARRATIVE)).toEqual({
        eligible: true,
      });
    });

    it('reads a document that uses none of the old claim vocabulary', () => {
      // The vocabulary gate refused 100 of the 932 live filings it judged —
      // 10.7% — and a filing announcing admission to an industry standards body
      // need contain none of `guidance`, `ebitda`, `capacity` or `order book`.
      expect(claimEligibility(filing('Press Release'), NO_VOCABULARY)).toEqual({
        eligible: true,
      });
    });
  });

  describe('the two tests that remain, and what each is for', () => {
    it('refuses a filing with legal exposure BEFORE any model sees it', () => {
      // NOT a cost control and never was. The cheapest way to be sure nothing is
      // drafted about a regulatory action is for nothing to be drafted.
      const verdict = claimEligibility(
        filing(
          'Press Release',
          'the Company has received a SEBI show-cause notice',
        ),
        NARRATIVE,
      );
      expect(verdict.eligible).toBe(false);
      if (verdict.eligible) throw new Error('expected a refusal');
      expect(verdict.skip).toBe('legal-exposure');
      expect(verdict.reason).toContain('legal exposure');
    });

    it('refuses a covering letter by length', () => {
      // Measured: WELENT's earnings-call intimation is 1,269 characters of
      // address block, one sentence saying an audio file exists, and a
      // signature. There is no claim in it to find.
      const verdict = claimEligibility(
        filing('Analysts/Institutional Investor Meet/Con. Call Updates'),
        'x'.repeat(MIN_CLAIM_DOCUMENT_CHARS - 1),
      );
      expect(verdict.eligible).toBe(false);
      if (verdict.eligible) throw new Error('expected a refusal');
      expect(verdict.skip).toBe('covering-letter');
      expect(verdict.reason).toContain('covering letter');
    });

    it('admits a document exactly at the bound', () => {
      // Asserted against the LITERAL as well as the constant, so a mutation of
      // the constant cannot be satisfied by a fixture sized from it.
      expect(MIN_CLAIM_DOCUMENT_CHARS).toBe(1_500);
      expect(
        claimEligibility(filing('Press Release'), 'x'.repeat(1_500)).eligible,
      ).toBe(true);
      expect(
        claimEligibility(filing('Press Release'), 'x'.repeat(1_499)).eligible,
      ).toBe(false);
    });

    it('puts the legal test FIRST, so a short blocked filing names the block', () => {
      // Order matters for the reason the module states: a filing carrying legal
      // exposure must never reach an extractor, and reporting it as "too short"
      // would make the safety refusal invisible in the counts.
      const verdict = claimEligibility(
        filing('Press Release', 'SEBI show-cause notice'),
        'short',
      );
      if (verdict.eligible) throw new Error('expected a refusal');
      expect(verdict.skip).toBe('legal-exposure');
    });
  });

  it('says WHY, so a filing nothing was tried on can explain itself', () => {
    // "Nothing was found" and "nothing was looked for" are opposite facts about
    // a filing and must not render the same — and after the results gap, a skip
    // that cannot be counted is a skip that can hide.
    const verdict = claimEligibility(filing('Press Release'), 'tiny');
    if (verdict.eligible) throw new Error('expected a refusal');
    expect(verdict.reason.length).toBeGreaterThan(10);
    expect(verdict.skip).toBe('covering-letter');
  });
});
