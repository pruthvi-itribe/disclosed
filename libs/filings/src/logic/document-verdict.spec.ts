import { readDocument, type DocumentVerdict } from './document-verdict';

const ORDER_ROW = (amount: string, party: string): string =>
  `Intimation under Regulation 30\n` +
  `1. Name of the entity awarding the \norder(s)/contract(s); ${party}\n` +
  `2. Significant terms and conditions of order(s)/contract(s) awarded in brief; Supply.\n` +
  `3. Broad consideration or size of the order(s)/contract(s); ${amount}\n` +
  `4. Whether promoter interest exists; No\n`;

const run = (
  documentText: string,
  overrides: Partial<{
    symbol: string;
    category: string;
    summary: string;
  }> = {},
): DocumentVerdict =>
  readDocument({
    symbol: 'RAILTEL',
    category: 'Bagging/Receiving of orders/contracts',
    summary: 'RailTel has informed the Exchange about an order',
    documentText,
    ...overrides,
  });

describe('readDocument — a filing that states everything', () => {
  const verdict = run(
    ORDER_ROW('Rs. 18,53,66,820/-', '\nSouth Western Railway \n'),
  );

  it('extracts the amount', () => {
    expect(verdict.amountRupees).toBe(185_366_820);
    expect(verdict.amountAnchor).toBe('sebi-label');
    expect(verdict.amountEvidence).toContain('18,53,66,820');
    expect(verdict.amountRefusalReason).toBeNull();
    expect(verdict.amountRefusalDetail).toBeNull();
  });

  it('extracts the counterparty', () => {
    expect(verdict.counterparty).toBe('South Western Railway');
    expect(verdict.counterpartyEvidence).toContain('South Western Railway');
    expect(verdict.counterpartyRefusalReason).toBeNull();
  });

  it('composes the enriched headline', () => {
    expect(verdict.headlineForm).toBe('enriched');
    expect(verdict.headline).toBe(
      'RAILTEL BAGS ORDER ₹18.54 cr from South Western Railway',
    );
  });

  it('records how much text it read', () => {
    expect(verdict.documentChars).toBeGreaterThan(0);
  });
});

describe('readDocument — a filing whose amount is refused', () => {
  const verdict = run(
    'RailTel is in discussions and has received a Letter of Intent worth Rs. 18,53,66,820/- subject to conditions.',
  );

  it('records the refusal reason and detail', () => {
    expect(verdict.amountRupees).toBeNull();
    expect(verdict.amountRefusalReason).toBe('ambiguity-keyword');
    expect(verdict.amountRefusalDetail).not.toBeNull();
  });

  it('degrades the headline to the exchange words', () => {
    expect(verdict.headlineForm).toBe('verbatim');
    expect(verdict.headline).toBe(
      'RAILTEL — BAGGING/RECEIVING OF ORDERS/CONTRACTS',
    );
  });

  it('does not look for a counterparty it could never use', () => {
    // A counterparty may only ever reach the wire attached to an amount.
    // Storing one on a refused filing would invite a later change to use it.
    expect(verdict.counterparty).toBeNull();
    expect(verdict.counterpartyRefusalReason).toBeNull();
  });
});

describe('readDocument — an amount without a usable counterparty', () => {
  const verdict = run(
    ORDER_ROW('Rs. 18,53,66,820/-', '\nInternational Customer \n'),
  );

  it('keeps the amount and drops the party', () => {
    expect(verdict.amountRupees).toBe(185_366_820);
    expect(verdict.counterparty).toBeNull();
    expect(verdict.counterpartyRefusalReason).toBe('described-not-named');
  });

  it('composes an enriched headline without a "from" clause', () => {
    expect(verdict.headline).toBe('RAILTEL BAGS ORDER ₹18.54 cr');
    expect(verdict.headline).not.toContain('Customer');
  });
});

describe('readDocument — always complete, never partial', () => {
  const EVERY_FIELD = [
    'documentChars',
    'amountRupees',
    'amountEvidence',
    'amountAnchor',
    'amountLabel',
    'amountRefusalReason',
    'amountRefusalDetail',
    'counterparty',
    'counterpartyEvidence',
    'counterpartyRefusalReason',
    'headline',
    'headlineForm',
  ] as const;

  it.each([
    [
      'a full disclosure row',
      ORDER_ROW('Rs. 5 crore', '\nGenus Power Limited \n'),
    ],
    ['an empty document', ''],
    ['whitespace only', '    \n\n  '],
    ['a press release with no figure', 'RailTel signed something today.'],
    ['a value band', 'L&T secures a Mega* Order. Mega: 10,000 - 15,000 Cr'],
    [
      'a scale header',
      '(Rs. in thousands)\nBroad consideration or size of the order(s); 7,15,126',
    ],
  ])('sets every field for %s', (_label, documentText) => {
    const verdict = run(documentText);
    for (const field of EVERY_FIELD) {
      expect(verdict).toHaveProperty(field);
      expect(verdict[field]).not.toBeUndefined();
    }
  });

  it.each([
    ['an empty document', ''],
    ['a document of newlines', '\n\n\n'],
    ['a document with no rupee figure at all', 'Nothing to see here.'],
  ])('never throws on %s', (_label, documentText) => {
    expect(() => run(documentText)).not.toThrow();
  });

  it('never emits an amount and a refusal reason together', () => {
    for (const text of [
      ORDER_ROW('Rs. 5 crore', '\nGenus Power Limited \n'),
      'nothing here',
      'Letter of Intent for Rs. 5 crore',
    ]) {
      const verdict = run(text);
      const hasAmount = verdict.amountRupees !== null;
      const hasReason = verdict.amountRefusalReason !== null;
      expect(hasAmount).toBe(!hasReason);
    }
  });

  it('carries the category through to the action phrase', () => {
    const verdict = run(ORDER_ROW('Rs. 5 crore', '\nGenus Power Limited \n'), {
      category: 'Acquisition',
      symbol: 'GROBTEA',
    });
    // The acquisition label is not the order label, so the order row still
    // supplies the figure — but the verb comes from the stored category.
    expect(verdict.headline).toContain('GROBTEA ACQUISITION');
  });
});
