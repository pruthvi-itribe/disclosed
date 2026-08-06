import { MIN_TEXT_LAYER_CHARS } from '../logic/enrichment-policy';
import type {
  DoclingConverter,
  DoclingRequest,
  DoclingResult,
} from './docling-client';
import { DOCLING_LAYOUT_MAX_PAGES, DOCLING_OCR_MAX_PAGES } from './parse-route';
import { readWithRouting, type RoutedReadInput } from './routed-text';

/**
 * What `pdf-parse` returns for a raster scan: page furniture and nothing else.
 * Eight characters is the median across the 21 scanned filings in the live
 * collection, which run from 2 to 97.
 */
const SCANNED_TEXT = 'Page 1/3';

/** A text-layer results filing, flattened the way `pdf-parse` flattens one. */
const RESULTS_TEXT = [
  'UNAUDITED CONSOLIDATED FINANCIAL RESULTS FOR THE QUARTER ENDED 30.06.2026',
  '(Rs. in lakhs, except per share data)',
  'Revenue from operations54,618.69 52,369.69',
  'Profit after tax4,191.73 3,114.25',
].join('\n');

/** A board outcome with a text layer and no statement in it. */
const PLAIN_TEXT =
  'The Board of Directors at its meeting held today approved the appointment ' +
  'of Ms. A. Sharma as Company Secretary and Compliance Officer with effect ' +
  'from the close of business hours today.';

/** The same statement as Docling renders it: pipes, and the heading first. */
const DOCLING_MARKDOWN = [
  '## UNAUDITED CONSOLIDATED FINANCIAL RESULTS FOR THE QUARTER ENDED 30.06.2026',
  '',
  '| # | Particulars | 30.06.2026 | 30.06.2025 |',
  '| 1 | Revenue from operations | 54,618.69 | 52,369.69 |',
  '| 2 | Profit after tax | 4,191.73 | 3,114.25 |',
].join('\n');

/** What OCR recovers from a scan `pdf-parse` could not read at all. */
const OCR_MARKDOWN = [
  '## UNAUDITED CONSOLIDATED FINANCIAL RESULTS',
  '',
  '| 1 | Revenue from operations | 1,48,388.57 | 1,32,004.11 |',
  '| 2 | Profit after tax | 3,114.25 | 2,84,706.00 |',
].join('\n');

interface StubConverter extends DoclingConverter {
  /** Every conversion actually asked for. Its length is the assertion. */
  readonly requests: DoclingRequest[];
}

/**
 * A stand-in for the Docling client.
 *
 * The point of `DoclingConverter` being an interface is that this module's
 * fallback behaviour — which is most of its behaviour — is decidable without a
 * Python service to break.
 */
const stubConverter = (
  result: DoclingResult,
  available = true,
): StubConverter => {
  const stub: StubConverter = {
    requests: [],
    isAvailable: () => available,
    convert: async (request) => {
      stub.requests.push(request);
      return result;
    },
  };
  return stub;
};

const readInput = (over: Partial<RoutedReadInput> = {}): RoutedReadInput => ({
  category: 'Outcome of Board Meeting',
  data: Buffer.from('%PDF-1.4 not really a pdf'),
  fileName: 'JKIL-outcome.pdf',
  text: PLAIN_TEXT,
  pages: 12,
  converter: null,
  ...over,
});

describe('readWithRouting — no Docling wired', () => {
  it('keeps the cheap read and records why', async () => {
    // A supported deployment: a machine with no Python at all. The filing must
    // not fail, and the record must say the fallback was used.
    const read = await readWithRouting(
      readInput({ text: RESULTS_TEXT, converter: null }),
    );

    expect(read.text).toBe(RESULTS_TEXT);
    expect(read.route).toBe('pdf-parse');
    expect(read.routeReason).toContain('no Docling service');
    expect(read.fallbackReason).toBeNull();
  });

  it('keeps the cheap read when the service is inside its cooldown', async () => {
    // `isAvailable` false is the latch talking. No request may be made, so the
    // route decision itself has to see the service as absent.
    const converter = stubConverter(
      { outcome: 'ok', text: DOCLING_MARKDOWN },
      false,
    );

    const read = await readWithRouting(
      readInput({ text: RESULTS_TEXT, converter }),
    );

    expect(converter.requests).toHaveLength(0);
    expect(read.text).toBe(RESULTS_TEXT);
    expect(read.route).toBe('pdf-parse');
    expect(read.fallbackReason).toBeNull();
  });

  it('keeps the cheap read for an ordinary document', async () => {
    // ~90% of traffic. The cheap read is not evidence of anything here; it is
    // the answer, and the expensive parser is never called.
    const converter = stubConverter({ outcome: 'ok', text: DOCLING_MARKDOWN });

    const read = await readWithRouting(readInput({ converter }));

    expect(converter.requests).toHaveLength(0);
    expect(read.text).toBe(PLAIN_TEXT);
    expect(read.route).toBe('pdf-parse');
    expect(read.routeReason).toContain('no results statement');
    expect(read.fallbackReason).toBeNull();
  });
});

describe('readWithRouting — the escalations that pay', () => {
  it('replaces a results filing with the Docling layout reading', async () => {
    // The measured reason this route exists: Docling puts the standalone
    // heading BEFORE its own table and drops the malformed-number rate on
    // results filings from 3.98% to 0.00%.
    const converter = stubConverter({ outcome: 'ok', text: DOCLING_MARKDOWN });

    const read = await readWithRouting(
      readInput({ text: RESULTS_TEXT, converter }),
    );

    expect(read.text).toBe(DOCLING_MARKDOWN);
    expect(read.route).toBe('docling-layout');
    expect(read.routeReason).toContain('results statement');
    expect(read.fallbackReason).toBeNull();
  });

  it('asks for the layout configuration and its own page ceiling', async () => {
    const converter = stubConverter({ outcome: 'ok', text: DOCLING_MARKDOWN });

    await readWithRouting(readInput({ text: RESULTS_TEXT, converter }));

    expect(converter.requests).toEqual([
      {
        data: readInput().data,
        fileName: 'JKIL-outcome.pdf',
        // OFF for a text-layer filing: the value here is reading order and
        // column alignment, and OCR buys under 1% of output for 2-15x the time.
        ocr: false,
        maxPages: DOCLING_LAYOUT_MAX_PAGES,
      },
    ]);
  });

  it('recovers a scanned document OCR can read and pdf-parse cannot', async () => {
    // Eight characters of page furniture in, a real statement out. Docling
    // recovers 20/20 of the scanned documents with 25/25 ground-truth digits.
    const converter = stubConverter({ outcome: 'ok', text: OCR_MARKDOWN });

    const read = await readWithRouting(
      readInput({ text: SCANNED_TEXT, pages: 3, converter }),
    );

    expect(SCANNED_TEXT).toHaveLength(8);
    expect(read.text).toBe(OCR_MARKDOWN);
    expect(read.route).toBe('docling-ocr');
    expect(read.fallbackReason).toBeNull();
    expect(converter.requests).toEqual([
      {
        data: readInput().data,
        fileName: 'JKIL-outcome.pdf',
        ocr: true,
        maxPages: DOCLING_OCR_MAX_PAGES,
      },
    ]);
  });

  it('sends the bytes it was given rather than re-fetching them', async () => {
    const data = Buffer.from('%PDF-1.7 the second document');
    const converter = stubConverter({ outcome: 'ok', text: DOCLING_MARKDOWN });

    await readWithRouting(readInput({ text: RESULTS_TEXT, data, converter }));

    expect(converter.requests[0].data).toBe(data);
  });

  it('returns exactly one parser output and never a splice of two', async () => {
    // A document assembled from two parsers is a document neither of them
    // produced, and the verbatim gate downstream would then match spans against
    // text that exists nowhere.
    const converter = stubConverter({ outcome: 'ok', text: DOCLING_MARKDOWN });

    const read = await readWithRouting(
      readInput({ text: RESULTS_TEXT, converter }),
    );

    expect(read.text).toBe(DOCLING_MARKDOWN);
    expect(read.text).toHaveLength(DOCLING_MARKDOWN.length);
    // The pdf-parse flattening `Revenue from operations54,618.69` survives
    // nowhere in the answer, because the replacement was wholesale.
    expect(read.text).not.toContain('Revenue from operations54,618.69');
  });
});

describe('readWithRouting — every way the expensive parser can fail', () => {
  // Narrowed to the two FAILING variants rather than the whole union, so the
  // table can assert against `message` — which the `ok` variant does not carry.
  it.each<[string, Exclude<DoclingResult, { readonly outcome: 'ok' }>]>([
    [
      'the service could not be reached',
      {
        outcome: 'unavailable',
        message: 'the Docling service could not be reached: ECONNREFUSED',
      },
    ],
    [
      'the service refused the document',
      {
        outcome: 'refused',
        message:
          'the Docling service answered "failure" with no markdown content',
      },
    ],
  ])('keeps the cheap read and says so when %s', async (_label, result) => {
    // An optional dependency being absent is not a fact about the document, so
    // the filing keeps a perfectly usable reading and the deployment gets a
    // sentence an operator can act on.
    const converter = stubConverter(result);

    const read = await readWithRouting(
      readInput({ text: RESULTS_TEXT, converter }),
    );

    expect(read.text).toBe(RESULTS_TEXT);
    expect(read.route).toBe('pdf-parse');
    expect(read.routeReason).toContain('results statement');
    expect(read.fallbackReason).toContain('docling-layout');
    expect(read.fallbackReason).toContain(result.message);
  });

  it('names the OCR route when it was OCR that did not run', async () => {
    // "Read by pdf-parse" and "read by pdf-parse because the optional service
    // was down since Tuesday" are the same text and completely different facts.
    const converter = stubConverter({
      outcome: 'unavailable',
      message: 'in its cooldown, so no request was made',
    });

    const read = await readWithRouting(
      readInput({ text: SCANNED_TEXT, pages: 3, converter }),
    );

    expect(read.text).toBe(SCANNED_TEXT);
    expect(read.route).toBe('pdf-parse');
    expect(read.fallbackReason).toContain('docling-ocr');
    expect(read.fallbackReason).toContain('did not run');
  });

  it('REJECTS a Docling reading that is not a usable text layer', async () => {
    // `do_ocr=false` on a document whose text layer is worse than expected
    // returns a near-empty markdown skeleton. Storing that over a good
    // pdf-parse reading would turn a working filing into `no-text-layer`.
    const skeleton = '## Annexure\n\n|  |  |\n';
    const converter = stubConverter({ outcome: 'ok', text: skeleton });

    const read = await readWithRouting(
      readInput({ text: RESULTS_TEXT, converter }),
    );

    expect(read.text).toBe(RESULTS_TEXT);
    expect(read.route).toBe('pdf-parse');
    expect(read.fallbackReason).toContain(`${skeleton.length} character(s)`);
    expect(read.fallbackReason).toContain('not a usable text layer');
  });

  it('rejects an empty Docling reading the same way', async () => {
    const converter = stubConverter({ outcome: 'ok', text: '' });

    const read = await readWithRouting(
      readInput({ text: RESULTS_TEXT, converter }),
    );

    expect(read.text).toBe(RESULTS_TEXT);
    expect(read.fallbackReason).toContain('0 character(s)');
  });

  it('accepts a Docling reading exactly at the text-layer threshold', async () => {
    // One definition of "this is not really text", shared with the worker, so a
    // reading cannot be usable to one and not to the other.
    expect(MIN_TEXT_LAYER_CHARS).toBe(100);
    const just = 'x'.repeat(MIN_TEXT_LAYER_CHARS);
    const under = 'x'.repeat(MIN_TEXT_LAYER_CHARS - 1);

    const accepted = await readWithRouting(
      readInput({
        text: RESULTS_TEXT,
        converter: stubConverter({ outcome: 'ok', text: just }),
      }),
    );
    const rejected = await readWithRouting(
      readInput({
        text: RESULTS_TEXT,
        converter: stubConverter({ outcome: 'ok', text: under }),
      }),
    );

    expect(accepted.text).toBe(just);
    expect(accepted.route).toBe('docling-layout');
    expect(rejected.text).toBe(RESULTS_TEXT);
    expect(rejected.route).toBe('pdf-parse');
  });

  it('leaves a failed scan exactly where it already was', async () => {
    // The one place "never returns less than it was given" is vacuous:
    // pdf-parse's text was 8 characters of page furniture to begin with, and
    // Docling failing costs the filing nothing it had.
    const converter = stubConverter({
      outcome: 'refused',
      message:
        'the Docling service answered "failure" with no markdown content',
    });

    const read = await readWithRouting(
      readInput({ text: SCANNED_TEXT, pages: 3, converter }),
    );

    expect(read.text).toBe(SCANNED_TEXT);
    expect(read.fallbackReason).not.toBeNull();
  });

  it.each<[string, DoclingResult]>([
    ['a reading', { outcome: 'ok', text: DOCLING_MARKDOWN }],
    ['an unavailable service', { outcome: 'unavailable', message: 'down' }],
    ['a refusal', { outcome: 'refused', message: 'unconvertible' }],
    ['an unusable reading', { outcome: 'ok', text: '' }],
  ])(
    'always answers with one whole parser output, given %s',
    async (_label, result) => {
      const read = await readWithRouting(
        readInput({ text: RESULTS_TEXT, converter: stubConverter(result) }),
      );

      const candidates =
        result.outcome === 'ok' ? [RESULTS_TEXT, result.text] : [RESULTS_TEXT];
      expect(candidates).toContain(read.text);
      expect(read.routeReason.length).toBeGreaterThan(0);
    },
  );
});
