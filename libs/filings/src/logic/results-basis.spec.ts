import {
  BASIS_AMBIGUITY_CHARS,
  BASIS_HEADING_CONTEXT,
  BASIS_HEADING_REACH,
  basisMarkersIn,
  governingBasis,
} from './results-basis';

describe('basisMarkersIn', () => {
  it.each([
    ['a statutory title', 'UNAUDITED CONSOLIDATED FINANCIAL RESULTS', 1],
    ['a short title', 'CONSOLIDATED RESULTS', 1],
    ['a title with the word after', 'Financial Results (Standalone', 1],
    [
      'a covering letter naming both',
      'Financial Results (Standalone and Consolidated)',
      2,
    ],
    ['both spellings joined', 'results (consolidated & standalone)', 2],
  ])('reads %s as a heading', (_label, text, expected) => {
    expect(basisMarkersIn(text)).toHaveLength(expected);
  });

  it.each([
    [
      'a note about consolidation policy',
      'The consolidated entity applies the equity method to its associates.',
    ],
    ['a standalone adjective', 'The standalone unit was commissioned in May.'],
    ['no basis word at all', 'Revenue from operations 73,977.90'],
  ])('does not read %s as a heading', (_label, text) => {
    expect(basisMarkersIn(text)).toEqual([]);
  });

  it('locates each heading so its own bytes can be resliced', () => {
    const text = `${'page footer '.repeat(4)}CONSOLIDATED RESULTS`;
    const [marker] = basisMarkersIn(text);
    expect(marker.offset).toBe(48);
    expect(text.slice(marker.offset, marker.offset + marker.raw.length)).toBe(
      'CONSOLIDATED',
    );
    expect(marker.basis).toBe('consolidated');
  });

  it('needs the word `result` within a bounded distance', () => {
    // Pinned against a LITERAL as well as against the constant, so widening the
    // context to the whole document is a change this test reports.
    expect(BASIS_HEADING_CONTEXT).toBe(40);
    const near = `CONSOLIDATED ${'.'.repeat(30)} results`;
    const far = `CONSOLIDATED ${'.'.repeat(60)} results`;
    expect(basisMarkersIn(near)).toHaveLength(1);
    expect(basisMarkersIn(far)).toEqual([]);
  });
});

describe('governingBasis', () => {
  /** A document with a statement title `gap` characters above its columns. */
  const statement = (
    title: string,
    gap: number,
  ): { readonly text: string; readonly offset: number } => {
    const before = `${title}${' '.repeat(gap)}`;
    return { text: `${before}30.06.202630.06.2025`, offset: before.length };
  };

  it('reads the title immediately above the column header', () => {
    const { text, offset } = statement(
      'UNAUDITED CONSOLIDATED FINANCIAL RESULTS FOR THE QUARTER ENDED',
      60,
    );
    const verdict = governingBasis(text, offset);
    expect(verdict).toMatchObject({ outcome: 'ok', basis: 'consolidated' });
  });

  it('reads a standalone title as standalone', () => {
    const { text, offset } = statement(
      'UNAUDITED STANDALONE FINANCIAL RESULTS',
      40,
    );
    expect(governingBasis(text, offset)).toMatchObject({
      outcome: 'ok',
      basis: 'standalone',
    });
  });

  it('takes the NEAREST title when a document holds two statements', () => {
    // The real shape: a consolidated statement, then a standalone one. Each
    // table's own header must resolve to its own title.
    const first = 'UNAUDITED CONSOLIDATED FINANCIAL RESULTS  ';
    const firstHeader = `${first}30.06.202630.06.2025`;
    const middle = `${'row 1,234.00 '.repeat(60)}`;
    const second = 'UNAUDITED STANDALONE FINANCIAL RESULTS  ';
    const text = `${firstHeader}${middle}${second}30.06.202630.06.2025`;

    expect(governingBasis(text, first.length)).toMatchObject({
      basis: 'consolidated',
    });
    expect(
      governingBasis(text, firstHeader.length + middle.length + second.length),
    ).toMatchObject({ basis: 'standalone' });
  });

  it('REFUSES when the nearest heading names both statements', () => {
    // The covering-letter shape. A heading that names both governs neither, and
    // a nearest-preceding rule would silently pick whichever came second.
    const { text, offset } = statement(
      'Un-audited Financial Results (Standalone and Consolidated) of the Company',
      50,
    );
    expect(governingBasis(text, offset)).toEqual({
      outcome: 'none',
      detail: expect.stringContaining('names both statements'),
    });
  });

  it('REFUSES when no heading is close enough to say', () => {
    // The measured failure this bound exists for: `pdf-parse` emits the Apollo
    // standalone statement's rows before its own title, so the nearest marker
    // above that table's header is a consolidated NOTE three thousand
    // characters away. Nothing close enough means nothing published.
    const { text, offset } = statement(
      'These unaudited consolidated financial results have been prepared',
      BASIS_HEADING_REACH + 100,
    );
    expect(governingBasis(text, offset)).toEqual({
      outcome: 'none',
      detail: expect.stringContaining('above the table'),
    });
  });

  it('REFUSES a document with no statement heading at all', () => {
    expect(governingBasis('30.06.202630.06.2025', 0)).toMatchObject({
      outcome: 'none',
    });
  });

  it('never reads a heading BELOW the column header', () => {
    // A title after the table is the NEXT statement's title, and reading it
    // would label every table with its successor's basis.
    const text = `30.06.202630.06.2025 UNAUDITED STANDALONE FINANCIAL RESULTS`;
    expect(governingBasis(text, 0)).toMatchObject({ outcome: 'none' });
  });

  it('bounds the reach at a measured distance', () => {
    // Literal as well as measurement: a reach of Infinity would pass a fixture
    // sized from the constant.
    expect(BASIS_HEADING_REACH).toBe(400);
    expect(BASIS_AMBIGUITY_CHARS).toBe(120);

    const title = 'CONSOLIDATED FINANCIAL RESULTS';
    const just = statement(title, BASIS_HEADING_REACH - title.length);
    const past = statement(title, BASIS_HEADING_REACH - title.length + 2);
    expect(governingBasis(just.text, just.offset)).toMatchObject({
      outcome: 'ok',
    });
    expect(governingBasis(past.text, past.offset)).toMatchObject({
      outcome: 'none',
    });
  });

  it('keeps the document own bytes as the evidence', () => {
    const { text, offset } = statement('UNAUDITED CONSOLIDATED RESULTS', 20);
    const verdict = governingBasis(text, offset);
    if (verdict.outcome !== 'ok') throw new Error('expected a basis');
    expect(verdict.evidence).toContain('UNAUDITED CONSOLIDATED RESULTS');
  });
});
