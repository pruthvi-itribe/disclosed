import {
  BASIS_HEADING_REACH,
  DOCLING_BASIS_HEADING_REACH,
} from '../logic/results-basis';
import {
  carriesNoStatement,
  basisReachFor,
  DOCLING_LAYOUT_MAX_PAGES,
  DOCLING_OCR_MAX_PAGES,
  looksLikeResultsStatement,
  PARSE_ROUTES,
  routeAfterFirstRead,
  type ParseRoute,
  type ParseRouteInput,
} from './parse-route';

/**
 * A results statement as a real filing prints it: a Regulation 33 row label AND
 * a statement heading. Both are needed, which is the whole point of the gate.
 */
const RESULTS_TEXT = [
  'UNAUDITED CONSOLIDATED FINANCIAL RESULTS FOR THE QUARTER ENDED 30.06.2026',
  '(Rs. in lakhs, except per share data)',
  'Revenue from operations 54,618.69 52,369.69',
  'Profit after tax 4,191.73 3,114.25',
].join('\n');

/** A board outcome that approves an appointment and states no results. */
const PLAIN_TEXT =
  'The Board of Directors at its meeting held today approved the appointment ' +
  'of Ms. A. Sharma as Company Secretary and Compliance Officer with effect ' +
  'from the close of business hours today.';

const routeInput = (over: Partial<ParseRouteInput> = {}): ParseRouteInput => ({
  category: 'Outcome of Board Meeting',
  pages: 12,
  text: PLAIN_TEXT,
  hasTextLayer: true,
  textLayerCorrupt: false,
  doclingAvailable: true,
  ...over,
});

describe('routeAfterFirstRead — a text layer that is present and wrong', () => {
  it('re-reads the pixels of a corrupt layer, forcing OCR past it', () => {
    // MSWIL seqId 106726228: 9,226 non-space characters, 92x the bound
    // `hasUsableTextLayer` applies, and past the covering letter every one of
    // them is displaced three code points. `docling-layout` cannot help — it
    // reads the same broken layer — and `do_ocr=true` alone is a no-op on a
    // page that already has one, so this is the only route that recovers the
    // document.
    const decision = routeAfterFirstRead(
      routeInput({ textLayerCorrupt: true, pages: 3 }),
    );
    expect(decision.route).toBe('docling-ocr');
    expect(decision.forceOcr).toBe(true);
    expect(decision.maxPages).toBe(DOCLING_OCR_MAX_PAGES);
    expect(decision.reason).toContain('corrupt');
  });

  it('outranks the results escalation, which cannot repair a layer', () => {
    // A corrupt results filing is the case that would otherwise cost the most:
    // `docling-layout` runs with do_ocr=false, aligns the columns of the
    // garbage, and returns it looking authoritative.
    const decision = routeAfterFirstRead(
      routeInput({ textLayerCorrupt: true, text: RESULTS_TEXT, pages: 3 }),
    );
    expect(decision.route).toBe('docling-ocr');
    expect(decision.forceOcr).toBe(true);
  });

  it('is still bounded by the OCR page ceiling', () => {
    // Forced OCR is the MOST expensive configuration this pipeline has — it
    // re-reads every page's pixels including the ones that were fine — so the
    // ceiling that exists for scans is not optional here.
    const decision = routeAfterFirstRead(
      routeInput({ textLayerCorrupt: true, pages: DOCLING_OCR_MAX_PAGES + 1 }),
    );
    expect(decision.route).toBe('pdf-parse');
    expect(decision.forceOcr).toBe(false);
    expect(decision.reason).toContain('corrupt');
  });

  it('does not force OCR on a document that simply has no layer', () => {
    // There is nothing to force past. Forcing costs the same but says
    // something untrue about why the route was taken.
    const decision = routeAfterFirstRead(
      routeInput({ hasTextLayer: false, pages: 3 }),
    );
    expect(decision.route).toBe('docling-ocr');
    expect(decision.forceOcr).toBe(false);
  });

  it('never forces OCR on any route that is not an OCR route', () => {
    const routes: readonly Partial<ParseRouteInput>[] = [
      { doclingAvailable: false, textLayerCorrupt: true },
      { text: RESULTS_TEXT },
      {},
    ];
    for (const over of routes) {
      expect(routeAfterFirstRead(routeInput(over)).forceOcr).toBe(false);
    }
  });
});

describe('routeAfterFirstRead — the degraded path', () => {
  it('falls back to pdf-parse when there is no Docling service', () => {
    const decision = routeAfterFirstRead(
      routeInput({ doclingAvailable: false }),
    );
    expect(decision.route).toBe('pdf-parse');
    expect(decision.maxPages).toBeNull();
    expect(decision.reason).toContain('no Docling service');
  });

  it.each<[string, Partial<ParseRouteInput>]>([
    ['a scanned document', { hasTextLayer: false, pages: 3 }],
    ['a results statement', { text: RESULTS_TEXT }],
    [
      'a scanned results statement',
      { hasTextLayer: false, text: RESULTS_TEXT, pages: 3 },
    ],
  ])('shadows every escalation, including %s', (_label, over) => {
    // Stated first in the function so the degraded path is the one branch
    // nothing else can shadow. A machine with no Python must never route a
    // filing to a parser it cannot run.
    const decision = routeAfterFirstRead(
      routeInput({ ...over, doclingAvailable: false }),
    );
    expect(decision.route).toBe('pdf-parse');
    expect(decision.reason).toContain('no Docling service');
  });
});

describe('routeAfterFirstRead — the scanned path', () => {
  it('sends a document with no text layer to Docling with OCR', () => {
    // pdf-parse returns between 2 and 97 characters for the 21 scanned filings
    // in the live collection, median 8, all of it page furniture. That answer
    // IS the detector, and it costs 0.04 s.
    const decision = routeAfterFirstRead(
      routeInput({ hasTextLayer: false, pages: 6, text: 'Page 1/6' }),
    );
    expect(decision.route).toBe('docling-ocr');
    expect(decision.maxPages).toBe(DOCLING_OCR_MAX_PAGES);
    expect(decision.reason).toContain('no text layer');
  });

  it('refuses OCR for a scan longer than the OCR ceiling', () => {
    const decision = routeAfterFirstRead(
      routeInput({ hasTextLayer: false, pages: 41 }),
    );
    expect(decision.route).toBe('pdf-parse');
    expect(decision.maxPages).toBeNull();
    expect(decision.reason).toContain('41 pages');
    expect(decision.reason).toContain('40-page ceiling');
  });

  it('bounds OCR at a page count a worker lease can absorb', () => {
    // Literal as well as constant: a fixture sized from the constant it pins
    // passes for any value of that constant, including one that would let a
    // 640-page document eat a whole ten-minute lease.
    expect(DOCLING_OCR_MAX_PAGES).toBe(40);
    // The largest live scanned filing is 15 pages, so every one of them is
    // inside this bound with 2.6x of headroom.
    expect(DOCLING_OCR_MAX_PAGES).toBeGreaterThan(15);

    const at = routeAfterFirstRead(
      routeInput({ hasTextLayer: false, pages: DOCLING_OCR_MAX_PAGES }),
    );
    const past = routeAfterFirstRead(
      routeInput({ hasTextLayer: false, pages: DOCLING_OCR_MAX_PAGES + 1 }),
    );
    expect(at.route).toBe('docling-ocr');
    expect(past.route).toBe('pdf-parse');
  });

  it('OCRs a document that is BOTH scanned and results-shaped', () => {
    // JKIL's board-meeting outcome is both. Without OCR there is no text for
    // the layout pass to align, so OCR is not optional there and scanned has to
    // win over results.
    const decision = routeAfterFirstRead(
      routeInput({ hasTextLayer: false, text: RESULTS_TEXT, pages: 9 }),
    );
    expect(decision.route).toBe('docling-ocr');
    expect(decision.maxPages).toBe(DOCLING_OCR_MAX_PAGES);
  });
});

describe('routeAfterFirstRead — the results path', () => {
  it('re-reads a text-layer results filing with OCR off', () => {
    const decision = routeAfterFirstRead(routeInput({ text: RESULTS_TEXT }));
    expect(decision.route).toBe('docling-layout');
    expect(decision.maxPages).toBe(DOCLING_LAYOUT_MAX_PAGES);
    expect(decision.reason).toContain('results statement');
    expect(decision.reason).toContain('OCR off');
  });

  it('refuses Docling for a results filing longer than the layout ceiling', () => {
    const decision = routeAfterFirstRead(
      routeInput({ text: RESULTS_TEXT, pages: 640 }),
    );
    expect(decision.route).toBe('pdf-parse');
    expect(decision.maxPages).toBeNull();
    expect(decision.reason).toContain('640 pages');
    expect(decision.reason).toContain('150-page ceiling');
  });

  it('clears the largest real results filing and excludes the annual report', () => {
    expect(DOCLING_LAYOUT_MAX_PAGES).toBe(150);
    // POLICYBZR at 129 pages is a real Q1 results document and must fit;
    // NHPC's 640-page annual report extrapolates to ~40 minutes and must not.
    expect(DOCLING_LAYOUT_MAX_PAGES).toBeGreaterThan(129);
    expect(DOCLING_LAYOUT_MAX_PAGES).toBeLessThan(640);

    const at = routeAfterFirstRead(
      routeInput({ text: RESULTS_TEXT, pages: DOCLING_LAYOUT_MAX_PAGES }),
    );
    const past = routeAfterFirstRead(
      routeInput({ text: RESULTS_TEXT, pages: DOCLING_LAYOUT_MAX_PAGES + 1 }),
    );
    expect(at.route).toBe('docling-layout');
    expect(past.route).toBe('pdf-parse');
  });

  it('gives the two routes different ceilings', () => {
    // OCR is an order of magnitude more expensive per page than layout-only, so
    // one shared bound would either starve the cheap route or blow the lease on
    // the expensive one. A 60-page scan is refused; a 60-page results filing is
    // not.
    const scan = routeAfterFirstRead(
      routeInput({ hasTextLayer: false, pages: 60 }),
    );
    const results = routeAfterFirstRead(
      routeInput({ text: RESULTS_TEXT, pages: 60 }),
    );
    expect(scan.route).toBe('pdf-parse');
    expect(results.route).toBe('docling-layout');
  });
});

describe('routeAfterFirstRead — the ordinary path', () => {
  it('keeps pdf-parse for a text-layer document with no results statement', () => {
    // ~90% of traffic, 0.19 s a document. The expensive parser buys nothing
    // here and costs 59 s and 2.3-7.7 GB resident.
    const decision = routeAfterFirstRead(routeInput());
    expect(decision.route).toBe('pdf-parse');
    expect(decision.maxPages).toBeNull();
    expect(decision.reason).toContain('no results statement');
  });

  it('routes on the document rather than on the category', () => {
    // Only 8.66% of live filings are results-bearing against 11.85% in the
    // category, so the category alone must not escalate anything.
    const decision = routeAfterFirstRead(
      routeInput({ category: 'Financial Results' }),
    );
    expect(decision.route).toBe('pdf-parse');
  });

  it.each<[string, Partial<ParseRouteInput>]>([
    ['no Docling service', { doclingAvailable: false }],
    ['a scan inside the OCR bound', { hasTextLayer: false, pages: 6 }],
    ['a scan over the OCR bound', { hasTextLayer: false, pages: 400 }],
    ['a results filing inside the layout bound', { text: RESULTS_TEXT }],
    [
      'a results filing over the layout bound',
      { text: RESULTS_TEXT, pages: 400 },
    ],
    ['an ordinary document', {}],
  ])(
    'carries a page ceiling exactly on the Docling routes, for %s',
    (_label, over) => {
      // The ceiling is ALWAYS sent on a Docling route, even though the route is
      // only chosen when the page count is already inside it: Docling's
      // `max_num_pages` rejects an over-long document rather than truncating
      // it, so an under-reported page count would become a hard failure.
      const decision = routeAfterFirstRead(routeInput(over));
      const isDocling = decision.route !== 'pdf-parse';
      expect(decision.maxPages !== null).toBe(isDocling);
      expect(decision.reason.length).toBeGreaterThan(0);
      expect(PARSE_ROUTES).toContain(decision.route);
    },
  );

  it('never throws, whatever the cheap read produced', () => {
    const odd: readonly Partial<ParseRouteInput>[] = [
      { text: '', hasTextLayer: false, pages: 0 },
      { text: '', hasTextLayer: true, pages: 0 },
      { category: '', text: RESULTS_TEXT, pages: -1 },
    ];
    for (const over of odd) {
      expect(() => routeAfterFirstRead(routeInput(over))).not.toThrow();
    }
  });
});

describe('looksLikeResultsStatement', () => {
  it.each([
    ['a consolidated statement', RESULTS_TEXT],
    [
      'a standalone statement',
      'UNAUDITED STANDALONE FINANCIAL RESULTS\nTotal income 55,102.11',
    ],
    [
      'a statement whose row label is the profit line',
      'Statement of Unaudited Consolidated Financial Results\n' +
        'Profit for the period 4,191.73',
    ],
    [
      'a statement whose row label is EPS',
      'CONSOLIDATED RESULTS\nEarnings per equity share (Rs.) 3.14',
    ],
    [
      'a statement whose row label is post-tax profit',
      'CONSOLIDATED RESULTS\nProfit after tax 4,191.73',
    ],
  ])('accepts %s', (_label, text) => {
    expect(looksLikeResultsStatement(text)).toBe(true);
  });

  it.each([
    // Both structural tests are required. A row label with no statement heading
    // is a table this pipeline cannot attribute to a basis, and a heading with
    // no row label is a covering letter announcing that results were approved.
    [
      'a row label with no statement heading',
      'Revenue from operations 54,618.69 52,369.69',
    ],
    [
      'a statement heading with no row label',
      'UNAUDITED CONSOLIDATED FINANCIAL RESULTS FOR THE QUARTER ENDED',
    ],
    [
      'a covering letter mentioning financial results',
      'We wish to inform you that the Board approved the financial results for ' +
        'the quarter ended 30th June, 2026.',
    ],
    ['an appointment announcement', PLAIN_TEXT],
    ['an empty document', ''],
  ])('refuses %s', (_label, text) => {
    expect(looksLikeResultsStatement(text)).toBe(false);
  });

  it('does not read a consolidation-policy note as a statement heading', () => {
    // `basisMarkersIn` needs the word `result` beside the basis word, so a note
    // about accounting policy is not a heading however often it says
    // "consolidated".
    expect(
      looksLikeResultsStatement(
        'Revenue from operations is recognised at a point in time. The ' +
          'consolidated entity applies the equity method to its associates.',
      ),
    ).toBe(false);
  });
});

describe('basisReachFor', () => {
  it.each<[ParseRoute, number]>([
    ['pdf-parse', 400],
    ['docling-ocr', 2400],
    ['docling-layout', 2400],
  ])('gives %s a reach of %i characters', (route, expected) => {
    // Literals as well as constants. A wrong answer here is the most dangerous
    // thing in the module: reading Docling markdown with the pdf-parse bound
    // refuses 74 of 77 measured tables, and reading pdf-parse output with the
    // Docling bound admits pairings measured as false at 936 and up.
    expect(basisReachFor(route)).toBe(expected);
  });

  it('takes the bounds from the module that measured them', () => {
    expect(basisReachFor('pdf-parse')).toBe(BASIS_HEADING_REACH);
    expect(basisReachFor('docling-layout')).toBe(DOCLING_BASIS_HEADING_REACH);
    // The two are genuinely different numbers, which is the reason the route is
    // stored beside the text rather than inferred from it.
    expect(BASIS_HEADING_REACH).not.toBe(DOCLING_BASIS_HEADING_REACH);
  });

  it('answers for every route the pipeline can record', () => {
    expect(PARSE_ROUTES).toEqual([
      'pdf-parse',
      'docling-ocr',
      'docling-layout',
    ]);
    for (const route of PARSE_ROUTES) {
      expect(basisReachFor(route)).toBeGreaterThan(0);
    }
  });
});

describe('routeAfterFirstRead — prose about results is not a results statement', () => {
  // A real transcript's shape: it quotes the figures, so the structural test
  // for "carries a statement" fires on it.
  const TRANSCRIPT = [
    'ESAF Small Finance Bank Q1 FY27 Earnings Conference Call',
    'Moderator: Ladies and gentlemen, welcome to the earnings call.',
    'Management: Turning to our consolidated results, total income for the',
    'quarter grew to INR 50,140 crores, against INR 40,923 crores last year.',
    'On the standalone results the picture is similar.',
    'Profit after tax improved through the quarter, and revenue from operations',
    'was up 23% year on year.',
  ].join('\n');

  it('still reads the transcript as carrying a statement, structurally', () => {
    // The premise. The detector is not wrong about the text — a person reading
    // a table aloud produces the same row labels and basis markers a table
    // does. It simply cannot tell the two apart, which is why the category has
    // to rule it out.
    expect(looksLikeResultsStatement(TRANSCRIPT)).toBe(true);
  });

  it('does NOT escalate an earnings call to Docling', () => {
    // ESAFSFB's call was escalated, which inflated the text from 31,923
    // characters to 51,180 and produced NOTHING — the claims call returned
    // empty content on a document that answered fine from the cheap parser.
    // There is no column alignment to fix in dialogue.
    const decision = routeAfterFirstRead({
      category: 'Analysts/Institutional Investor Meet/Con. Call Updates',
      pages: 12,
      text: TRANSCRIPT,
      hasTextLayer: true,
      textLayerCorrupt: false,
      doclingAvailable: true,
    });
    expect(decision.route).toBe('pdf-parse');
  });

  it.each([
    'Analysts/Institutional Investor Meet/Con. Call Updates',
    'Earnings Call Transcript',
    'Investor Meet',
  ])('rules out %s before reading', (category) => {
    expect(carriesNoStatement(category)).toBe(true);
  });

  it.each([
    'Outcome of Board Meeting',
    'Integrated Filing- Financial',
    'Financial Results',
    'Copy of Newspaper Publication',
  ])('leaves %s free to escalate', (category) => {
    // The rule-out set must stay small. A newspaper publication REPRINTS the
    // statutory statement, table and all, so it is exactly the case Docling
    // exists for — excluding it would trade one false positive for a real loss.
    expect(carriesNoStatement(category)).toBe(false);
  });

  it('still sends a SCANNED transcript to OCR', () => {
    // The rule-out removes a table-alignment escalation, not character
    // recovery. A transcript delivered as a raster scan has no text at all,
    // and there is nothing for the cheap parser to hand back.
    const decision = routeAfterFirstRead({
      category: 'Analysts/Institutional Investor Meet/Con. Call Updates',
      pages: 12,
      text: '',
      hasTextLayer: false,
      textLayerCorrupt: false,
      doclingAvailable: true,
    });
    expect(decision.route).toBe('docling-ocr');
  });
});
