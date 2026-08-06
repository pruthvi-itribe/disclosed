import {
  containsVerbatimSpan,
  findVerbatimSpan,
  MAX_SPAN_CHARS,
  MIN_SPAN_CHARS,
} from './claim-span';

/** A PDF text layer, with the line breaks `pdf-parse` actually produces. */
const DOCUMENT =
  'Swiggy Limited \nCapital Markets Day\n\n' +
  'The Company targets 100 billion rupees \nadjusted EBITDA by FY31.\n' +
  'Instamart is expected to turn contribution positive in FY27.\n';

describe('findVerbatimSpan', () => {
  it('finds a span that spans a line break in the source', () => {
    // The only reason this module exists: the sentence a reader sees on the
    // page arrives from the parser with a newline in the middle of it.
    const match = findVerbatimSpan(
      DOCUMENT,
      'targets 100 billion rupees adjusted EBITDA by FY31',
    );

    expect(match).not.toBeNull();
    expect(match?.evidence).toBe(
      'targets 100 billion rupees \nadjusted EBITDA by FY31',
    );
  });

  it('returns the ORIGINAL bytes, not the tidied version', () => {
    const match = findVerbatimSpan(
      DOCUMENT,
      'targets 100 billion rupees adjusted EBITDA by FY31',
    );
    // A human reviewing this has to see what the document says, not what this
    // module made of it.
    expect(match?.evidence).toContain('\n');
  });

  it('reslices the source exactly at the offset it reports', () => {
    const match = findVerbatimSpan(
      DOCUMENT,
      'Instamart is expected to turn contribution positive in FY27',
    );
    expect(match).not.toBeNull();
    if (match === null) throw new Error('expected a match');
    expect(
      DOCUMENT.slice(match.offset, match.offset + match.evidence.length),
    ).toBe(match.evidence);
  });

  it.each([
    ['tabs for spaces', 'a\tb\tc value stated here'],
    ['newlines for spaces', 'a\nb\nc value stated here'],
    ['runs of spaces', 'a    b     c value stated here'],
    ['a form feed', 'a\fb c value stated here'],
    ['carriage returns', 'a\r\nb c value stated here'],
  ])('matches across %s', (_label, source) => {
    expect(containsVerbatimSpan(source, 'a b c value stated here')).toBe(true);
  });

  describe('what it refuses', () => {
    it.each([
      [
        'a sentence the document never contains',
        'the Company targets a moon base by FY31',
      ],
      [
        'one changed digit',
        'targets 100 billion rupees adjusted EBITDA by FY30',
      ],
      [
        'one changed word',
        'targets 100 billion dollars adjusted EBITDA by FY31',
      ],
      [
        'an inserted word',
        'targets over 100 billion rupees adjusted EBITDA by FY31',
      ],
      ['a dropped word', 'targets 100 rupees adjusted EBITDA by FY31'],
      [
        'a dropped negation',
        'Instamart is to turn contribution positive in FY27',
      ],
      ['different case', 'TARGETS 100 BILLION RUPEES ADJUSTED EBITDA BY FY31'],
    ])('rejects %s', (_label, span) => {
      // Every one of these is a sentence a model could plausibly produce, and
      // every one of them says something the filing does not.
      expect(containsVerbatimSpan(DOCUMENT, span)).toBe(false);
    });

    it('rejects a span shorter than the evidence bar', () => {
      expect(MIN_SPAN_CHARS).toBe(12);
      // "Swiggy" is in the document and proves nothing about any claim.
      expect(containsVerbatimSpan(DOCUMENT, 'Swiggy')).toBe(false);
    });

    it('rejects a span longer than what may be stored and shown', () => {
      const long = 'x'.repeat(MAX_SPAN_CHARS + 1);
      expect(containsVerbatimSpan(long, long)).toBe(false);
    });

    it.each([[''], ['   '], ['\n\n']])(
      'rejects the empty span "%s"',
      (span) => {
        expect(findVerbatimSpan(DOCUMENT, span)).toBeNull();
      },
    );

    it('rejects any span against an empty document', () => {
      expect(
        findVerbatimSpan('', 'targets 100 billion rupees adjusted'),
      ).toBeNull();
    });
  });

  describe('the offset map', () => {
    it('points at the first occurrence when a sentence repeats', () => {
      const repeated = `${DOCUMENT}\ntargets 100 billion rupees adjusted EBITDA by FY31.`;
      const match = findVerbatimSpan(
        repeated,
        'targets 100 billion rupees adjusted EBITDA by FY31',
      );
      expect(match?.offset).toBe(
        findVerbatimSpan(
          DOCUMENT,
          'targets 100 billion rupees adjusted EBITDA by FY31',
        )?.offset,
      );
    });

    it('handles a span that runs to the very end of the document', () => {
      const source = 'A stated commitment to expand into France';
      const match = findVerbatimSpan(source, source);
      expect(match?.evidence).toBe(source);
      expect(match?.offset).toBe(0);
    });

    it('handles a document that ends in whitespace', () => {
      const source = 'A stated commitment to expand into France   \n\n';
      const match = findVerbatimSpan(
        source,
        'A stated commitment to expand into France',
      );
      expect(match?.evidence).toBe('A stated commitment to expand into France');
    });

    it('does not run past the end of the source', () => {
      const source = 'A stated commitment to expand into France';
      const match = findVerbatimSpan(source, source);
      if (match === null) throw new Error('expected a match');
      expect(match.offset + match.evidence.length).toBeLessThanOrEqual(
        source.length,
      );
    });

    it('reslices correctly when the span starts after leading whitespace', () => {
      const source = '\n\n   A stated commitment to expand into France';
      const match = findVerbatimSpan(
        source,
        'A stated commitment to expand into France',
      );
      if (match === null) throw new Error('expected a match');
      expect(source.slice(match.offset)).toBe(
        'A stated commitment to expand into France',
      );
    });
  });
});
