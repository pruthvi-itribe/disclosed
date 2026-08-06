import {
  ALL_REPAIRS,
  canonicalise,
  canonicalSpan,
  NO_REPAIRS,
} from './span-canon';

/**
 * The projection every claim's evidence is compared in.
 *
 * THE FIRST DESCRIBE BLOCK IS THE SAFETY PROPERTY and the rest are examples of
 * it. If `canonicalise` ever stops preserving the sequence of letters and
 * digits, the verbatim gate stops being a gate — a one-word-changed span could
 * project onto a real sentence — and that is the failure this whole module is
 * built to make impossible rather than unlikely.
 */
describe('canonicalise', () => {
  /** Letters and digits only, in order. What the projection may never alter. */
  const alnum = (value: string): string => value.replace(/[^0-9A-Za-z]+/g, '');

  /**
   * Every repair EXCEPT word spacing.
   *
   * The punctuation rules are examined with spaces still significant, because
   * that is the only way to show what each of them does: under `wordSpacing`
   * every one of these assertions would pass whether the rule fired or not.
   */
  const TYPESET_ONLY = { ...ALL_REPAIRS, wordSpacing: false };

  describe('the invariant: letters and digits survive exactly', () => {
    it.each([
      ['a plain sentence', 'The Board approved a 40% dividend on 12 Aug 2026.'],
      ['typographic quotes', 'the Company’s “scheme” was filed'],
      ['dashes of every kind', 'FY25–FY27 — up 12–14% − net'],
      ['a hyphen at a line break', 'inter-\nnational revenue of 40 crore'],
      ['invisible characters', 'net­pro​fit rose﻿ by 12%'],
      ['a markdown table row', '| Revenue | 1,234.56 | 987.65 |'],
      ['runs of whitespace', 'Rs.   \n\n 42,00,000  paid\tin  full'],
      ['an ellipsis', 'the Company stated… and then 12 more'],
      ['nothing at all', ''],
    ])('%s keeps its letters and digits', (_label, source) => {
      expect(alnum(canonicalise(source).text)).toBe(alnum(source));
    });

    it('keeps them under every combination of repairs', () => {
      const source = '| ﬁnancial | inter-\nnational ’ growth — 12.5% |';
      for (const typography of [true, false]) {
        for (const tableCells of [true, false]) {
          for (const lineBreakHyphens of [true, false]) {
            for (const wordSpacing of [true, false]) {
              const projected = canonicalise(source, {
                typography,
                tableCells,
                lineBreakHyphens,
                wordSpacing,
              });
              // The ligature is the one entry that changes the COUNT of letters,
              // and it changes it into the very letters it is a ligature of — so
              // the comparison is against the expansion rather than the source.
              const expected = typography
                ? alnum(source.replace('ﬁ', 'fi'))
                : alnum(source);
              expect(alnum(projected.text)).toBe(expected);
            }
          }
        }
      }
    });

    it('expands a ligature into exactly its own letters and nothing more', () => {
      // Split out from the table above because a ligature is the one rule that
      // changes the COUNT of letters: `alnum` of the source drops `ﬁ` entirely,
      // so the comparison has to be against the expansion the rule promises.
      expect(alnum(canonicalise('ﬁnancial ﬂows and oﬀer staﬆ').text)).toBe(
        alnum('financial flows and offer stast'),
      );
    });

    it('never maps a letter or a digit to anything else', () => {
      // Read off the projection rather than off the table, so an entry added to
      // `EQUIVALENT` that folds a letter is caught here rather than in a live
      // run. Every ASCII alphanumeric must project to itself.
      const alphabet =
        '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
      expect(canonicalise(alphabet).text).toBe(alphabet);
    });
  });

  describe('what it repairs', () => {
    it('drops word spacing, which the text layer gets wrong both ways', () => {
      // The largest measured cause. `pdf-parse` welds `Instamartwill` and splits
      // `Re venue fr om Operat ions` in the same collection.
      expect(canonicalSpan('Instamartwill be a business')).toBe(
        canonicalSpan('Instamart will be a business'),
      );
      expect(canonicalSpan('Re venue fr om Operat ions')).toBe(
        canonicalSpan('Revenue from Operations'),
      );
    });

    it('reads a typographic apostrophe as a straight one', () => {
      expect(canonicalSpan('the Company’s board')).toBe(
        canonicalSpan("the Company's board"),
      );
    });

    it('reads an en dash, an em dash and a minus as a hyphen', () => {
      const hyphen = canonicalSpan('growth of 12-14 per cent');
      for (const dash of ['–', '—', '−', '‐']) {
        expect(canonicalSpan(`growth of 12${dash}14 per cent`)).toBe(hyphen);
      }
    });

    it('expands a ligature into its own letters', () => {
      expect(canonicalSpan('ﬁnancial results', TYPESET_ONLY)).toBe(
        'financial results',
      );
    });

    it('drops a soft hyphen and a zero-width space', () => {
      expect(canonicalSpan('re­ven​ue rose', TYPESET_ONLY)).toBe(
        'revenue rose',
      );
    });

    it('reads a markdown cell boundary as a separator', () => {
      expect(canonicalSpan('| Revenue | 1,234 |', TYPESET_ONLY)).toBe(
        'Revenue 1,234',
      );
    });

    it('does not weld two cells into one word', () => {
      // A DELETED pipe would produce `growthdecline`, which is an adjacency the
      // document does not have and a string a model could then be believed
      // about.
      expect(canonicalSpan('|growth|decline|', TYPESET_ONLY)).toBe(
        'growth decline',
      );
    });

    it('rejoins a word a line break hyphenated', () => {
      expect(canonicalSpan('inter-\nnational trade', TYPESET_ONLY)).toBe(
        'international trade',
      );
    });

    it('leaves a dash between spaces alone', () => {
      // `revenue - 500` is a sentence, not a broken word, and welding it would
      // invent the token `revenue500`.
      expect(canonicalSpan('revenue - 500 crore', TYPESET_ONLY)).toBe(
        'revenue - 500 crore',
      );
      // The DASH is what survives, and it is what stops `revenue-500` reading
      // the same as `revenue 500` once spacing is immaterial.
      expect(canonicalSpan('revenue - 500 crore')).toBe('revenue-500crore');
    });

    it('leaves a hyphen that no line break interrupted alone', () => {
      expect(canonicalSpan('pre-tax profit', TYPESET_ONLY)).toBe(
        'pre-tax profit',
      );
    });

    it('leaves a hyphen after a non-alphanumeric alone', () => {
      expect(canonicalSpan(') -\n500 crore', TYPESET_ONLY)).toBe(
        ') - 500 crore',
      );
    });
  });

  describe('what it deliberately does not do', () => {
    it('does not fold case', () => {
      expect(canonicalSpan('No dividend')).not.toBe(
        canonicalSpan('no dividend'),
      );
    });

    it('does not touch the digits inside a grouped number', () => {
      // `1,48,388.57` and `1,48,388,57` are the OCR hazard `grouped-number.ts`
      // exists for. They must stay different strings here.
      expect(canonicalSpan('Rs 1,48,388.57 lakh')).not.toBe(
        canonicalSpan('Rs 1,48,388,57 lakh'),
      );
    });

    it('does not convert a rupee sign into the letters Rs', () => {
      expect(canonicalSpan('₹ 500 crore')).not.toBe(
        canonicalSpan('Rs 500 crore'),
      );
    });
  });

  describe('the origin map', () => {
    it('has one entry per projected character', () => {
      const projected = canonicalise('| ﬁne  work |', TYPESET_ONLY);
      expect(projected.origin).toHaveLength(projected.text.length);
    });

    it('points every projected character back inside the source', () => {
      const source = 'Rs.  \n42,00,000 — paid​in full';
      const projected = canonicalise(source);
      for (const at of projected.origin) {
        expect(at).toBeGreaterThanOrEqual(0);
        expect(at).toBeLessThan(source.length);
      }
    });

    it('rises monotonically, so a match can be resliced', () => {
      const projected = canonicalise('a’b | c-\nd  e', TYPESET_ONLY);
      for (let index = 1; index < projected.origin.length; index += 1) {
        expect(projected.origin[index]).toBeGreaterThanOrEqual(
          projected.origin[index - 1],
        );
      }
    });

    it('gives both halves of an expanded ligature the same source index', () => {
      const projected = canonicalise('ﬁx');
      expect(projected.text).toBe('fix');
      expect(projected.origin).toEqual([0, 0, 1]);
    });

    it('maps a collapsed run to the first character of the run', () => {
      const projected = canonicalise('a \n\t b', TYPESET_ONLY);
      expect(projected.text).toBe('a b');
      expect(projected.origin).toEqual([0, 1, 5]);
    });

    it('drops the run entirely once word spacing is immaterial', () => {
      const projected = canonicalise('a \n\t b');
      expect(projected.text).toBe('ab');
      expect(projected.origin).toEqual([0, 5]);
    });
  });

  describe('the repair switches', () => {
    it('NO_REPAIRS is whitespace collapse and nothing else', () => {
      expect(canonicalSpan('| a’b ﬁn |', NO_REPAIRS)).toBe('| a’b ﬁn |');
    });

    it('ALL_REPAIRS turns every one of them on', () => {
      expect(ALL_REPAIRS).toEqual({
        typography: true,
        tableCells: true,
        lineBreakHyphens: true,
        wordSpacing: true,
      });
    });

    it.each([
      ['typography', { ...NO_REPAIRS, typography: true }, 'a’b', "a'b"],
      ['tableCells', { ...NO_REPAIRS, tableCells: true }, '|a|b|', 'a b'],
      [
        'lineBreakHyphens',
        { ...NO_REPAIRS, lineBreakHyphens: true },
        'a-\nb',
        'ab',
      ],
      [
        'wordSpacing',
        { ...NO_REPAIRS, wordSpacing: true },
        'Re venue fr om Operat ions',
        'RevenuefromOperations',
      ],
    ])('%s can be turned on alone', (_label, repairs, source, expected) => {
      expect(canonicalSpan(source, repairs)).toBe(expected);
    });

    it('a hyphen look-ahead that runs off the end does not dehyphenate', () => {
      // The whitespace run has to CONTAIN a newline. A trailing space does not.
      expect(canonicalSpan('total-  ', TYPESET_ONLY)).toBe('total-');
    });

    it('gives up on a line break buried under a page of blank space', () => {
      // Bounded look-ahead: without it, one hyphen would scan the rest of the
      // document. Beyond the bound the hyphen simply survives.
      expect(canonicalSpan(`a-${' '.repeat(60)}\nb`, TYPESET_ONLY)).toBe(
        'a- b',
      );
    });
  });
});
