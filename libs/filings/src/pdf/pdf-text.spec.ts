import { readFileSync } from 'fs';
import { join } from 'path';
import {
  defaultPdfParser,
  extractPdfText,
  MAX_PDF_PAGES,
  type PdfParser,
} from './pdf-text';

const bytes = Buffer.from('%PDF-1.4 not really a pdf');

const parserOf =
  (result: unknown): PdfParser =>
  async () =>
    result as Awaited<ReturnType<PdfParser>>;

const throwing =
  (error: unknown): PdfParser =>
  async () => {
    throw error;
  };

describe('extractPdfText', () => {
  it('returns the text layer and the page count', async () => {
    const result = await extractPdfText(
      bytes,
      parserOf({ text: 'Rs. 18,53,66,820/-', numpages: 3 }),
    );
    expect(result).toEqual({
      outcome: 'ok',
      text: 'Rs. 18,53,66,820/-',
      pages: 3,
      truncated: false,
    });
  });

  it('accepts an empty text layer as readable', async () => {
    // A parsed document with no text is a scan needing OCR, which is a
    // different verdict from a document that would not parse — the caller
    // distinguishes them, so this must not conflate them.
    const result = await extractPdfText(
      bytes,
      parserOf({ text: '', numpages: 8 }),
    );
    expect(result).toEqual({
      outcome: 'ok',
      text: '',
      pages: 8,
      truncated: false,
    });
  });

  it.each([
    ['a truncated document', new Error('Invalid PDF structure')],
    ['a missing trailer', new Error("Couldn't find trailer dictionary")],
    ['an encrypted document', new Error('No password given')],
    ['a non-Error throw', 'stream ended early'],
    ['a thrown null', null],
  ])(
    'reports %s as unreadable rather than throwing',
    async (_label, thrown) => {
      // A throw here is indistinguishable from a timeout inside the worker loop,
      // and would be retried forever against bytes that will never change.
      const result = await extractPdfText(bytes, throwing(thrown));
      expect(result.outcome).toBe('unreadable');
      if (result.outcome !== 'unreadable') return;
      expect(result.message.length).toBeGreaterThan(0);
    },
  );

  it('reports an empty body as unreadable without calling the parser', async () => {
    const parser = jest.fn();
    const result = await extractPdfText(
      Buffer.alloc(0),
      parser as unknown as PdfParser,
    );
    expect(result.outcome).toBe('unreadable');
    expect(parser).not.toHaveBeenCalled();
  });

  it.each([
    ['no text property', { numpages: 2 }],
    ['a non-string text', { text: 42, numpages: 2 }],
    ['nothing at all', undefined],
    ['null', null],
  ])(
    'reports a parser that resolved with %s as unreadable',
    async (_label, resolved) => {
      const result = await extractPdfText(bytes, parserOf(resolved));
      expect(result.outcome).toBe('unreadable');
    },
  );

  it.each([
    ['a missing page count', { text: 'x', numpages: undefined }],
    ['a fractional page count', { text: 'x', numpages: 2.5 }],
    ['a non-numeric page count', { text: 'x', numpages: 'three' }],
  ])('normalises %s to zero pages', async (_label, resolved) => {
    const result = await extractPdfText(bytes, parserOf(resolved));
    expect(result).toEqual({
      outcome: 'ok',
      text: 'x',
      pages: 0,
      truncated: false,
    });
  });
});

describe('extractPdfText — the page budget', () => {
  /** Records what the parser was asked for, so the budget can be pinned. */
  const recording = (): { seen: unknown[]; parser: PdfParser } => {
    const seen: unknown[] = [];
    return {
      seen,
      parser: async (_data, options) => {
        seen.push(options);
        return { text: 'x', numpages: 1 };
      },
    };
  };

  it('asks the parser for at most the budget', async () => {
    // The bound has to be applied BEFORE the work starts. `pdf-parse` is CPU
    // work inside pdf.js with no `await`: an interval armed at 100 ms recorded
    // zero ticks across a measured 39.69-second parse, so there is no timeout
    // that can interrupt one.
    const { seen, parser } = recording();
    await extractPdfText(bytes, parser);
    expect(seen).toEqual([{ max: MAX_PDF_PAGES }]);
  });

  it('honours a caller-supplied budget', async () => {
    const { seen, parser } = recording();
    await extractPdfText(bytes, parser, 5);
    expect(seen).toEqual([{ max: 5 }]);
  });

  it('reports a document longer than the budget as truncated', async () => {
    // NHPC's 640-page annual report: 39.690 seconds and 501 MB of RSS, and it
    // passed the byte cap at 19.6 MB. A truncated read is a document this
    // pipeline holds only part of, and saying so is the difference between a
    // refusal that means "the filing does not say" and one that means
    // "we did not read that far".
    const result = await extractPdfText(
      bytes,
      parserOf({ text: 'x', numpages: 640 }),
      400,
    );
    expect(result).toMatchObject({
      outcome: 'ok',
      pages: 640,
      truncated: true,
    });
  });

  it('reports a document exactly at the budget as complete', async () => {
    const result = await extractPdfText(
      bytes,
      parserOf({ text: 'x', numpages: 400 }),
      400,
    );
    expect(result).toMatchObject({ truncated: false });
  });

  it('treats a zero budget as no budget, which is pdf-parse’s own meaning', async () => {
    const result = await extractPdfText(
      bytes,
      parserOf({ text: 'x', numpages: 5000 }),
      0,
    );
    expect(result).toMatchObject({ truncated: false });
  });

  it('clears every page count the live collection has produced', () => {
    // The largest non-pathological document measured is a 143-page investor
    // deck that parses in 0.195 s. The budget is a bound on the 640-page case,
    // not a trim on the ordinary one.
    expect(MAX_PDF_PAGES).toBeGreaterThan(143);
    expect(MAX_PDF_PAGES).toBe(400);
  });
});

/**
 * A real, valid, one-page PDF carrying a text layer.
 *
 * Generated locally with macOS `cupsfilter` from a one-line text file, and
 * committed rather than assembled in code: PDF is a format with a
 * cross-reference table, an object graph and a trailer, and a hand-rolled
 * approximation of one proves that the approximation parses, not that the
 * dependency does. The point of this suite is the latter — everything else in
 * this file injects a stub parser and would keep passing if `pdf-parse` were
 * removed from the tree entirely.
 */
const REAL_PDF = join(__dirname, '../../../../test/fixtures/text-layer.pdf');

describe('extractPdfText against the real parser', () => {
  it('reads the text layer out of a genuine PDF', async () => {
    const result = await extractPdfText(readFileSync(REAL_PDF));

    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.pages).toBe(1);
    expect(result.text).toContain('TURRET ORDER');
    // The figure survives the text layer intact, which is the property every
    // amount this pipeline publishes depends on.
    expect(result.text).toContain('Rs. 18,53,66,820/-');
  });

  it('reports a document truncated at origin as unreadable', async () => {
    // Exactly what NSE serves for 3.3% of its PDFs: HTTP 200, a valid `%PDF-`
    // header, a content-length that matches the short body, and no trailer.
    // Both sampled cases were cut at power-of-two boundaries.
    const whole = readFileSync(REAL_PDF);
    const truncated = whole.subarray(0, 4096);

    const result = await extractPdfText(truncated);
    expect(result.outcome).toBe('unreadable');
    if (result.outcome !== 'unreadable') return;
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('reports bytes that are not a PDF at all as unreadable', async () => {
    const result = await extractPdfText(Buffer.from('PK a zip'));
    expect(result.outcome).toBe('unreadable');
  });

  it('memoises the parser rather than re-requiring pdf.js per document', () => {
    expect(defaultPdfParser()).toBe(defaultPdfParser());
    expect(typeof defaultPdfParser()).toBe('function');
  });
});
