import {
  governingScale,
  ROW_CURRENCY,
  ROW_PERCENT,
  ROW_SCOPED_UNIT_METRICS,
  SCALE_REACH,
  SCALE_TOKENS,
  scaleDeclarationsIn,
} from './results-unit';

describe('scaleDeclarationsIn', () => {
  it.each([
    ['a bare rupee sign and a scale', '₹ Million', 'MN'],
    ['a parenthesised declaration', '(₹ in Crores)', 'CR'],
    ['the abbreviation', 'Rs. in Lakhs', 'LAKH'],
    ['no full stop', 'Rs in Lakh', 'LAKH'],
    ['the ISO code', 'Amounts in INR Millions', 'MN'],
    ['the word', 'Rupees in Crore', 'CR'],
    ['a regional spelling', '₹ in Lacs', 'LAKH'],
    ['thousands', '₹ in Thousands', 'THOUSAND'],
    ['billions', 'INR Billion', 'BN'],
  ])('reads %s', (_label, text, expected) => {
    expect(scaleDeclarationsIn(text).map((row) => row.token)).toEqual([
      expected,
    ]);
  });

  it.each([
    ['a scale word with no currency marker', 'a million units were shipped'],
    ['a currency marker with no scale', 'the consideration was ₹ 5,000'],
    ['prose about a lakh of something else', 'one lakh shares'],
  ])('reads nothing from %s', (_label, text) => {
    // The currency marker is REQUIRED. Reading a table's denomination out of a
    // sentence is how a figure ends up three orders of magnitude wrong.
    expect(scaleDeclarationsIn(text)).toEqual([]);
  });

  it('names every scale word its own pattern can match', () => {
    // The pattern's alternation is generated from the table's keys, so there is
    // no reachable case where a match has no token. This asserts the property
    // that makes the direct index safe rather than leaving an unreachable guard
    // standing in for it.
    for (const word of Object.keys(SCALE_TOKENS)) {
      const [declaration] = scaleDeclarationsIn(`₹ in ${word}`);
      expect(declaration.token).toBe(SCALE_TOKENS[word]);
    }
  });

  it('locates each declaration so a refusal can quote it', () => {
    const text = 'header line\n₹ Million\n30.06.2026';
    const [declaration] = scaleDeclarationsIn(text);
    expect(
      text.slice(
        declaration.offset,
        declaration.offset + declaration.raw.length,
      ),
    ).toBe('₹ Million');
  });
});

describe('governingScale', () => {
  /** A document with a scale declared `gap` characters above its columns. */
  const table = (
    declaration: string,
    gap: number,
  ): { readonly text: string; readonly offset: number } => {
    const before = `${declaration}${' '.repeat(gap)}`;
    return { text: `${before}30.06.202630.06.2025`, offset: before.length };
  };

  it('reads the scale declared immediately above the columns', () => {
    const { text, offset } = table('₹ Million', 1);
    expect(governingScale(text, offset, 20)).toEqual({
      outcome: 'ok',
      token: 'MN',
      evidence: '₹ Million',
    });
  });

  it('reads a scale declared INSIDE the column header', () => {
    // Filers write it both ways: on its own line above the dates, and inside
    // the header row as `PARTICULARS (₹ in Lakhs)`.
    const header = 'PARTICULARS (₹ in Lakhs) 30.06.2026 30.06.2025';
    expect(governingScale(header, 0, header.length)).toMatchObject({
      token: 'LAKH',
    });
  });

  it('REFUSES when nothing declares a scale', () => {
    // A default would be this module choosing a magnitude the document did not
    // state, which is the whole error class the amount lane refuses on.
    expect(governingScale('30.06.202630.06.2025', 0, 20)).toEqual({
      outcome: 'none',
      detail: expect.stringContaining('no currency scale'),
    });
  });

  it('REFUSES when two scales are in reach and disagree', () => {
    const text = '₹ Million  (₹ in Crores)  ';
    expect(governingScale(`${text}30.06.2026`, text.length, 10)).toEqual({
      outcome: 'none',
      detail: expect.stringContaining('two scales'),
    });
  });

  it('accepts a scale repeated identically', () => {
    // A statement that prints `(₹ Million)` on every row of an additional
    // disclosure block is not two scales, it is one stated several times.
    const text = '(₹ Million) (₹ Million) ';
    expect(governingScale(`${text}30.06.2026`, text.length, 10)).toMatchObject({
      token: 'MN',
    });
  });

  it('bounds the reach at a measured distance', () => {
    // Literal as well as measurement.
    expect(SCALE_REACH).toBe(400);
    const just = table('₹ Million', SCALE_REACH - '₹ Million'.length);
    const past = table('₹ Million', SCALE_REACH - '₹ Million'.length + 2);
    expect(governingScale(just.text, just.offset, 20)).toMatchObject({
      outcome: 'ok',
    });
    expect(governingScale(past.text, past.offset, 20)).toMatchObject({
      outcome: 'none',
    });
  });

  it('never reads a scale declared BELOW the table', () => {
    const text = '30.06.202630.06.2025 and later, (₹ in Crores)';
    expect(governingScale(text, 0, 20)).toMatchObject({ outcome: 'none' });
  });
});

describe('the row-scoped metrics', () => {
  it('names exactly the two whose unit the table scale does not govern', () => {
    // A statement in millions still prints earnings per share in rupees per
    // share and a margin in per cent. Applying the table's scale to those rows
    // would publish `₹5.52 MN` for an EPS of five rupees fifty-two.
    expect([...ROW_SCOPED_UNIT_METRICS].sort()).toEqual([
      'ebitda-margin',
      'eps',
    ]);
  });

  it.each([
    ['a rupee sign', '(a) Basic (₹) 5.52', true],
    ['the abbreviation', 'Basic EPS (Rs.) 5.52', true],
    ['the ISO code', 'Basic EPS (INR) 5.52', true],
    ['no currency at all', '(a) Basic 5.52', false],
  ])('reads %s in a row', (_label, row, expected) => {
    expect(ROW_CURRENCY.test(row)).toBe(expected);
  });

  it.each([
    ['a per-cent sign', 'EBITDA margin 11.73%', true],
    ['the words', 'EBITDA margin 11.73 per cent', true],
    ['neither', 'EBITDA margin 11.73', false],
  ])('reads %s in a row', (_label, row, expected) => {
    expect(ROW_PERCENT.test(row)).toBe(expected);
  });
});
