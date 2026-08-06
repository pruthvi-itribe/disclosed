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

/**
 * A document the way a real one arrives: a markdown table from Docling, a
 * typographic apostrophe, a ligature the type-setter emitted, and a word a page
 * break hyphenated.
 */
const TYPESET =
  '| Revenue | 1,234.00 |\n' +
  'the Company\u2019s declared \ufb01nancial position \u2014 stable\n' +
  'the inter-\nnational trade\n';

describe('findVerbatimSpan', () => {
  describe('what canonicalisation recovers, and it is a paraphrase of PUNCTUATION', () => {
    it.each([
      ['a table row quoted without its pipes', 'Revenue 1,234.00'],
      ['a table row quoted with them', '| Revenue | 1,234.00 |'],
      ['a straight apostrophe for a typographic one', "the Company's declared"],
      ['plain letters for a ligature', 'declared financial position'],
      ['a hyphen for an em dash', 'financial position - stable'],
      ['a word a line break hyphenated', 'the international trade'],
    ])('finds %s', (_label, span) => {
      expect(containsVerbatimSpan(TYPESET, span)).toBe(true);
    });

    it('still returns the DOCUMENT bytes, not the model\u2019s tidied ones', () => {
      const match = findVerbatimSpan(TYPESET, "the Company's declared");
      // What a reviewer reads has to be what the document says, curly
      // apostrophe and all.
      expect(match?.evidence).toBe('the Company\u2019s declared');
    });

    it('reslices the source exactly at the offset it reports', () => {
      const match = findVerbatimSpan(TYPESET, 'Revenue 1,234.00');
      if (match === null) throw new Error('expected a match');
      expect(
        TYPESET.slice(match.offset, match.offset + match.evidence.length),
      ).toBe(match.evidence);
    });
  });

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

  /**
   * The largest measured cause of a refused span, and the one repair whose cost
   * is an argument rather than an inspection.
   *
   * Both documents here are the real shapes `pdf-parse` produces on the live
   * collection: a welded word and a word broken into pieces, in the same
   * collection. The pairs matter more than the singles — each recovery is stated
   * beside the one-character perturbation that must still be refused, because
   * the whole question about this rule is whether it widens what counts as the
   * same WORD.
   */
  describe('word spacing, which the text layer gets wrong in both directions', () => {
    const WELDED =
      'Instamartwill be a Rs 1.5+ Lakh Cr GOV business serving 40 mn users';
    const SPLIT = 'Re venue fr om Operat ions grew 21% YoY t o Rs 1,890 crore';

    it('finds a sentence the parser welded', () => {
      expect(
        containsVerbatimSpan(
          WELDED,
          'Instamart will be a Rs 1.5+ Lakh Cr GOV business',
        ),
      ).toBe(true);
    });

    it('finds a sentence the parser broke into pieces', () => {
      expect(
        containsVerbatimSpan(SPLIT, 'Revenue from Operations grew 21% YoY'),
      ).toBe(true);
    });

    it.each([
      [
        'a changed digit in a welded sentence',
        WELDED,
        'Instamart will be a Rs 1.6+ Lakh Cr GOV business',
      ],
      [
        'a changed word in a welded sentence',
        WELDED,
        'Instamart will be a Rs 1.5+ Lakh Cr NET business',
      ],
      [
        'a changed digit in a broken sentence',
        SPLIT,
        'Revenue from Operations grew 22% YoY',
      ],
      [
        'a changed word in a broken sentence',
        SPLIT,
        'Revenue from Divisions grew 21% YoY',
      ],
      [
        'an inserted word',
        SPLIT,
        'Revenue from Operations nearly grew 21% YoY',
      ],
    ])('still refuses %s', (_label, source, span) => {
      expect(containsVerbatimSpan(source, span)).toBe(false);
    });

    it('returns the document\u2019s own spacing as the evidence', () => {
      // What a reviewer reads is the source's segmentation, never the model's —
      // which is the first of the three things that bound what this rule can
      // cost. See `span-canon.ts`.
      const match = findVerbatimSpan(
        WELDED,
        'Instamart will be a Rs 1.5+ Lakh Cr GOV business',
      );
      expect(match?.evidence).toBe(
        'Instamartwill be a Rs 1.5+ Lakh Cr GOV business',
      );
    });
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

    it.each([
      ['a table row with one digit changed', '| Revenue | 1,235.00 |'],
      ['a table row with one word changed', '| Turnover | 1,234.00 |'],
      ['a rejoined word with one letter changed', 'the internationol trade'],
      [
        'a curly-quoted sentence with one word changed',
        "the Company's declared board",
      ],
    ])('rejects %s even after canonicalisation', (_label, span) => {
      // THE INVARIANT UNDER THE REPAIRS. `span-canon.ts` widens what counts as
      // the same CHARACTER and must never widen what counts as the same WORD,
      // so every one of these — each a single letter or digit away from a
      // sentence the document really carries — must still be refused.
      expect(containsVerbatimSpan(TYPESET, span)).toBe(false);
    });

    it('rejects a span shorter than the evidence bar', () => {
      expect(MIN_SPAN_CHARS).toBe(12);
      // "Swiggy" is in the document and proves nothing about any claim.
      expect(containsVerbatimSpan(DOCUMENT, 'Swiggy')).toBe(false);
    });

    it('rejects a span longer than what may be stored and shown', () => {
      // Pinned against a LITERAL as well as the constant. A test written only
      // against `MAX_SPAN_CHARS` moves with the constant, so widening the bound
      // to a hundred thousand characters would pass it — which is exactly the
      // mutation that lets a whole document be quoted into a Telegram message.
      expect(MAX_SPAN_CHARS).toBe(400);
      const long = 'x'.repeat(401);
      expect(containsVerbatimSpan(long, long)).toBe(false);
      expect(containsVerbatimSpan('y'.repeat(400), 'y'.repeat(400))).toBe(true);
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
