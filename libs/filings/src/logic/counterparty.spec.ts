import {
  extractCounterparty,
  isTraceableName,
  MAX_NAME_CHARS,
  MAX_NAME_TOKEN_CHARS,
  PARTY_WINDOW_CHARS,
  type CounterpartyRefusalReason,
} from './counterparty';

/** A Schedule III order-win row, spelled the way filers actually spell it. */
const row = (
  value: string,
  label = 'Name of the entity awarding the',
): string =>
  `Disclosure under Regulation 30\n1. ${label} \norder(s)/contract(s); ${value}\n2. Significant terms and conditions of \norder(s)/contract(s) awarded in brief; \nSupply and installation.\n`;

describe('extractCounterparty — the rows the corpus actually holds', () => {
  it.each([
    [
      'INNOVISION',
      '\nNHAI (National Highways Authority of India)\n',
      'NHAI (National Highways Authority of India)',
    ],
    [
      'OMPOWER',
      '\nPaschim Gujarat Vij Company Limited \n2 \n',
      'Paschim Gujarat Vij Company Limited',
    ],
    [
      'RMC',
      '\nGenus Power Infrastructures Limited \n2 \n',
      'Genus Power Infrastructures Limited',
    ],
    ['TEXRAIL', '\nSouth Western Railway \n', 'South Western Railway'],
    [
      'CEINSYS (municipal)',
      '\nBhandara Municipal Council, Bhandara, \nMaharashtra. \nb. \n',
      'Bhandara Municipal Council, Bhandara, Maharashtra',
    ],
    [
      'CEINSYS (private)',
      '\nEKS InTec India Private Limited \nb. ',
      'EKS InTec India Private Limited',
    ],
  ])('reads %s as %s', (_symbol, value, expected) => {
    const result = extractCounterparty(row(value));
    expect(result.outcome).toBe('extracted');
    if (result.outcome !== 'extracted') return;
    expect(result.name).toBe(expected);
  });

  it.each<[string, string, CounterpartyRefusalReason]>([
    [
      'HFCL — an anonymised international buyer',
      '\nInternational Customer \nb) \n',
      'described-not-named',
    ],
    [
      '3IINFOLTD — a described bank',
      '\nA leading private sector bank in India* \nb) \n',
      'described-not-named',
    ],
    [
      'RPPL — a described packaging manufacturer',
      '\nA large packaging manufacturer listed on Indian \nStock Exchange, majorly owned by Finland \nbased packaging giant. \n2 \n',
      'described-not-named',
    ],
    [
      'RAILTEL — a name whose spaces the PDF layer lost',
      '\nInformationTechnologyAndElectronics\nDepartmentUttarPradesh\n',
      'illegible',
    ],
  ])('refuses %s as %s', (_label, value, reason) => {
    const result = extractCounterparty(row(value));
    expect(result.outcome).toBe('refused');
    if (result.outcome !== 'refused') return;
    expect(result.reason).toBe(reason);
  });
});

describe('extractCounterparty — the label', () => {
  it.each([
    ['Name of the entity awarding the'],
    ['name of the entity awarding the'],
    ['NAME OF THE ENTITY AWARDING THE'],
    ['Name of the entity awarding'],
    ['Name  of  the  entity  awarding  the'],
    ['Nameoftheentityawardingthe'],
    ['Name of the entities awarded the'],
  ])('matches the label spelled "%s"', (label) => {
    const result = extractCounterparty(
      row('\nGenus Power Infrastructures Limited \n2 \n', label),
    );
    expect(result.outcome).toBe('extracted');
  });

  it('matches the real "contact(s)" typo in a production filer template', () => {
    const text =
      'Name of the entity awarding the \norder(s)/contact(s) \nSouth Western Railway \nb) \nSignificant terms and conditions';
    const result = extractCounterparty(text);
    expect(result.outcome).toBe('extracted');
    if (result.outcome !== 'extracted') return;
    expect(result.name).toBe('South Western Railway');
  });

  it.each([
    ['a document with no Schedule III row at all', 'Just a press release.'],
    [
      'the amount row without the entity row',
      'Broad consideration or size of the order(s)/contract(s) Rs. 1,063 Crores',
    ],
    [
      'a related-party row that mentions an entity name',
      'Name of the party entering into such an agreement; Hindustan Zinc Limited',
    ],
  ])('refuses %s with no-label', (_label, text) => {
    const result = extractCounterparty(text);
    expect(result).toEqual({ outcome: 'refused', reason: 'no-label' });
  });
});

describe('extractCounterparty — the guards', () => {
  it.each<[string, string, CounterpartyRefusalReason]>([
    ['an empty row', '\n\n2. ', 'empty-row'],
    ['a row holding only the next enumerator', '\nb.\n', 'empty-row'],
    [
      'a refusal to disclose',
      '\nThe name of the customer cannot be disclosed. \n',
      'described-not-named',
    ],
    ['an explicit non-answer', '\nNot disclosed \n', 'described-not-named'],
    [
      'a hedged identification',
      '\nOne of the largest PSUs \n',
      'described-not-named',
    ],
    [
      'a plain noun phrase with no legal form',
      '\nSouth Indian Textiles Group \n',
      'no-entity-form',
    ],
    ['a bare acronym with no form word', '\nABC XYZ \n', 'no-entity-form'],
    ['a row holding only punctuation', '\n--- \n', 'illegible'],
    [
      'a name longer than a headline can carry',
      `\n${'Very Long Name Limited '.repeat(6)}\n`,
      'illegible',
    ],
  ])('refuses %s as %s', (_label, value, reason) => {
    const result = extractCounterparty(row(value));
    expect(result.outcome).toBe('refused');
    if (result.outcome !== 'refused') return;
    expect(result.reason).toBe(reason);
  });

  it('accepts a real name that begins with "The"', () => {
    // "A"/"An" are anonymisation tells. "The" is not — it opens real names.
    const result = extractCounterparty(
      row('\nThe Tata Power Company Limited \n2 \n'),
    );
    expect(result.outcome).toBe('extracted');
    if (result.outcome !== 'extracted') return;
    expect(result.name).toBe('The Tata Power Company Limited');
  });

  it.each([
    [MAX_NAME_TOKEN_CHARS, true],
    [MAX_NAME_TOKEN_CHARS + 1, false],
  ])('accepts a %d-character token: %s', (length, accepted) => {
    const token = 'A'.repeat(length);
    const result = extractCounterparty(row(`\n${token} Limited \n`));
    expect(result.outcome).toBe(accepted ? 'extracted' : 'refused');
  });

  it('never returns a name longer than the declared bound', () => {
    for (const words of [1, 3, 6, 10, 20]) {
      const result = extractCounterparty(
        row(`\n${'Nagar '.repeat(words)}Limited \n`),
      );
      if (result.outcome !== 'extracted') continue;
      expect(result.name.length).toBeLessThanOrEqual(MAX_NAME_CHARS);
    }
  });
});

describe('extractCounterparty — row boundaries', () => {
  it.each([
    [
      'Significant terms',
      '\nGenus Power Limited \n2. Significant terms and conditions',
    ],
    [
      'Whether promoter',
      '\nGenus Power Limited \nc. Whether promoter interest exists',
    ],
    [
      'Nature of the contract',
      '\nGenus Power Limited \nNature of the contract: supply',
    ],
    [
      'Time period',
      '\nGenus Power Limited \nTime period by which the order is',
    ],
    [
      'the consideration row',
      '\nGenus Power Limited \nBroad consideration or size of the order Rs. 10 crore',
    ],
    [
      'a line-leading enumerator',
      '\nGenus Power Limited \n3) Delivery schedule',
    ],
  ])('stops the row at %s', (_label, text) => {
    const result = extractCounterparty(
      `Name of the entity awarding the order(s)/contract(s);${text}`,
    );
    expect(result.outcome).toBe('extracted');
    if (result.outcome !== 'extracted') return;
    expect(result.name).toBe('Genus Power Limited');
  });

  it('never reaches past the declared window', () => {
    const filler = 'x'.repeat(PARTY_WINDOW_CHARS + 50);
    const result = extractCounterparty(
      `Name of the entity awarding the order(s)/contract(s);\n${filler}\nGenus Power Limited`,
    );
    // Whatever it decides, it must not have found the name beyond the window.
    if (result.outcome === 'extracted') {
      expect(result.name).not.toContain('Genus');
    }
  });

  it('does not let the consideration row leak a rupee figure into the name', () => {
    const result = extractCounterparty(
      'Name of the entity awarding the order(s)/contract(s);\nGenus Power Infrastructures Limited\nBroad consideration or size of the order(s)/contract(s) Rs. 1,063 Crores',
    );
    expect(result.outcome).toBe('extracted');
    if (result.outcome !== 'extracted') return;
    expect(result.name).toBe('Genus Power Infrastructures Limited');
    expect(result.name).not.toMatch(/1,063|Rs/);
  });
});

describe('extractCounterparty — provenance', () => {
  it('quotes an exact substring of the source at the offset it claims', () => {
    const text = row('\nGenus Power Infrastructures Limited \n2 \n');
    const result = extractCounterparty(text);
    expect(result.outcome).toBe('extracted');
    if (result.outcome !== 'extracted') return;

    expect(
      text.slice(result.offset, result.offset + result.evidence.length),
    ).toBe(result.evidence);
    for (const word of result.name.split(' ')) {
      expect(result.evidence).toContain(word);
    }
  });

  it('records the label exactly as the filer spelled it', () => {
    const result = extractCounterparty(
      row('\nGenus Power Limited \n', 'name  of  the  entity  awarding  the'),
    );
    expect(result.outcome).toBe('extracted');
    if (result.outcome !== 'extracted') return;
    // Whitespace collapsed for storage, but the filer's own words and case.
    expect(result.label).toMatch(/^name of the entity awarding the/);
  });

  it('reads the FIRST labelled row when a document carries two', () => {
    const text = `${row('\nGenus Power Limited \n')}${row('\nSouth Western Railway \n')}`;
    const result = extractCounterparty(text);
    expect(result.outcome).toBe('extracted');
    if (result.outcome !== 'extracted') return;
    expect(result.name).toBe('Genus Power Limited');
  });
});

describe('isTraceableName', () => {
  const text = 'awarded to Genus Power Limited on Monday';

  it('accepts evidence that is genuinely at the offset claimed', () => {
    expect(
      isTraceableName(text, 'Genus Power Limited', 11, 'Genus Power Limited'),
    ).toBe(true);
  });

  it.each([
    ['the offset is wrong', 'Genus Power Limited', 12, 'Genus Power Limited'],
    [
      'the evidence is not in the document',
      'Reliance Limited',
      11,
      'Reliance Limited',
    ],
    [
      'the name holds a word the evidence does not',
      'Genus Power Limited',
      11,
      'Genus Power Industries Limited',
    ],
  ])('rejects when %s', (_label, evidence, offset, name) => {
    expect(isTraceableName(text, evidence, offset, name)).toBe(false);
  });
});
