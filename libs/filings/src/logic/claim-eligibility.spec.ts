import {
  claimEligibility,
  CON_CALL_INTIMATION_CATEGORY,
  MIN_CLAIM_DOCUMENT_CHARS,
  NEWSPAPER_PAGE_CATEGORY,
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
    //
    // TWO NAMES LEFT THIS LIST when the triage gate shipped, and they left in
    // the opposite direction from the one that caused the gap: they are refused
    // BY name rather than for want of one. Their own tests are below, including
    // the one that proves a rename is read.
    it.each([
      ['a board-meeting outcome', 'Outcome of Board Meeting'],
      ['an investor presentation', 'Investor Presentation'],
      ['a press release', 'Press Release'],
      ['an order win', 'Bagging/Receiving of orders/contracts'],
      ['a credit rating action', 'Credit Rating'],
      ['a record date', 'Record Date'],
      ['a board change', 'Change in Director(s)'],
      ['a shareholders meeting', 'Shareholders meeting'],
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

  describe('the tests that remain, and what each is for', () => {
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

  describe('a page several companies share', () => {
    const cin = (n: number): string =>
      `L24239MH1956PLC${String(n).padStart(6, '0')}`;
    const page = (companies: number): string =>
      'NOTICE OF POSTAL BALLOT. '.padEnd(2_000, ' ') +
      Array.from({ length: companies }, (_, at) => `CIN: ${cin(at)} `).join(
        ' ',
      );

    it('refuses one, so no claim is attributed to the wrong filer', () => {
      const verdict = claimEligibility(filing('General Updates'), page(4));
      if (verdict.eligible) throw new Error('expected a refusal');
      expect(verdict.skip).toBe('shared-page');
      expect(verdict.reason).toContain('4 companies');
    });

    it('reads a filing that merely names a subsidiary', () => {
      expect(
        claimEligibility(filing('Investor Presentation'), page(2)),
      ).toEqual({ eligible: true });
    });

    it('is checked AFTER the length test, so a stub says it is a stub', () => {
      // A 300-character covering letter that happens to list four group CINs is
      // empty before it is ambiguous, and the count that matters is the one an
      // operator can act on. Nothing is lost either way — both refuse — but
      // "shared-page" is a claim about attribution and should only be made
      // about a document there was something to attribute.
      const verdict = claimEligibility(
        filing('General Updates'),
        `short. ${cin(1)} ${cin(2)} ${cin(3)} ${cin(4)}`,
      );
      if (verdict.eligible) throw new Error('expected a refusal');
      expect(verdict.skip).toBe('covering-letter');
    });
  });

  describe('the two kinds triaged out by name', () => {
    // The audit grouped on `$category` and counted 619 newspaper pages at a 6.8%
    // claim yield and 1,022 con-call intimations at 16.7% — 35.1% of everything
    // enriched, for 213 claim-bearing filings. These pin the SAME strings, so
    // the gate refuses the population that was measured and not a near-miss.
    it('uses the exact names NSE spells, normalised', () => {
      expect(NEWSPAPER_PAGE_CATEGORY).toBe('copy of newspaper publication');
      expect(CON_CALL_INTIMATION_CATEGORY).toBe(
        'analysts/institutional investor meet/con. call updates',
      );
    });

    it.each([
      ['a newspaper page', 'Copy of Newspaper Publication', 'newspaper-page'],
      [
        'an earnings-call intimation',
        'Analysts/Institutional Investor Meet/Con. Call Updates',
        'con-call-intimation',
      ],
    ])('never sends %s to a model', (_label, category, skip) => {
      const verdict = claimEligibility(filing(category), NARRATIVE);
      expect(verdict.eligible).toBe(false);
      if (verdict.eligible) throw new Error('expected a refusal');
      expect(verdict.skip).toBe(skip);
      // The reason carries the measured yield, so an operator reading one row
      // sees the price rather than a bare code.
      expect(verdict.reason).toMatch(/%/);
    });

    it.each([
      ['a padded, shouted spelling', '  COPY OF NEWSPAPER PUBLICATION  '],
      ['NSE’s own casing', 'Copy of Newspaper Publication'],
    ])('matches %s', (_label, category) => {
      expect(claimEligibility(filing(category), NARRATIVE).eligible).toBe(
        false,
      );
    });

    // THE FAIL-OPEN TEST, and the reason a category name is allowed to decide
    // this at all. CLAUDE.md forbids keying a FAIL-CLOSED gate on a name NSE
    // controls, because a rename then hides filings. Here a rename costs model
    // calls and hides nothing: every near-miss below is READ.
    it.each([
      ['a pluralised rename', 'Copy of Newspaper Publications'],
      ['a shortened rename', 'Newspaper Publication'],
      ['the con-call name without its full stop', 'Analysts/Con Call Updates'],
      ['a name NSE has not invented yet', 'Some Future Category'],
    ])('READS %s rather than guessing at it', (_label, category) => {
      expect(claimEligibility(filing(category), NARRATIVE)).toEqual({
        eligible: true,
      });
    });

    // Order. The category test runs after every test that reads the document, so
    // a filing that can be refused on its own bytes is refused on its own bytes
    // — and the two counters above then record exactly the model calls this gate
    // removed and no others.
    it('lets a short intimation say it is a covering letter', () => {
      const verdict = claimEligibility(
        filing('Analysts/Institutional Investor Meet/Con. Call Updates'),
        'x'.repeat(MIN_CLAIM_DOCUMENT_CHARS - 1),
      );
      if (verdict.eligible) throw new Error('expected a refusal');
      expect(verdict.skip).toBe('covering-letter');
    });

    it('lets a four-company newspaper page say it is a shared page', () => {
      // 105 of the 619 measured newspaper pages are refused on their bytes by
      // the attribution rule. Those must keep saying so: `shared-page` is a
      // measured property and `newspaper-page` is a name.
      const cins = Array.from(
        { length: 4 },
        (_, at) => `CIN: L24239MH1956PLC00000${at} `,
      ).join(' ');
      const verdict = claimEligibility(
        filing('Copy of Newspaper Publication'),
        NARRATIVE + cins,
      );
      if (verdict.eligible) throw new Error('expected a refusal');
      expect(verdict.skip).toBe('shared-page');
    });

    it('lets a blocked newspaper page name the legal block', () => {
      const verdict = claimEligibility(
        filing('Copy of Newspaper Publication', 'SEBI show-cause notice'),
        NARRATIVE,
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
