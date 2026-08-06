import { readFileSync } from 'fs';
import { join } from 'path';
import {
  composeOutcome,
  MAX_OUTCOME_CHARS,
  restatesCategory,
} from './filing-outcome';

/**
 * Every fixture below is a row out of the committed corpus, copied verbatim.
 *
 * That matters more here than anywhere else in this directory, because the
 * module's whole design rests on a measurement of what NSE actually writes —
 * 72.82% of summaries say something the category does not, 27.18% restate it.
 * A hand-written summary would let this suite pass while the real feed said
 * something else, so the last describe block re-reads all 17,442 rows and
 * checks both the share and the fixtures' own provenance.
 */

const CORPUS_PATH = join(
  __dirname,
  '../../../../data/corpus/05-07-2026_05-08-2026.jsonl',
);

interface CorpusRow {
  readonly symbol: string;
  readonly category: string;
  readonly summary: string;
}

let cached: readonly CorpusRow[] | null = null;

/** The corpus, parsed once on first use — 9.8 MB, so not per test. */
const corpus = (): readonly CorpusRow[] => {
  if (cached === null) {
    cached = readFileSync(CORPUS_PATH, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as CorpusRow);
  }
  return cached;
};

/** A record date NSE spelled with a doubled space, as it does 1,814 times. */
const RECORD_DATE: CorpusRow = {
  symbol: 'ORBTEXP',
  category: 'Record Date',
  summary:
    'Orbit Exports Limited has informed the Exchange that Record date for the purpose of Buyback  is 15-Jul-2026.',
};

/** The `has submitted to the Exchange, the ...` variant of the same template. */
const RESULTS: CorpusRow = {
  symbol: 'ASAHIINDIA',
  category: 'Outcome of Board Meeting',
  summary:
    'Asahi India Glass Limited has submitted to the Exchange, the financial results for the period ended Jun 30, 2026.',
};

/** Boilerplate: all 153 `Credit Rating` summaries in the corpus read like this. */
const BOILERPLATE: CorpusRow = {
  symbol: 'AMRUTANJAN',
  category: 'Credit Rating',
  summary:
    'Amrutanjan Health Care Limited has informed the Exchange about Credit Rating',
};

/** Boilerplate for a category this pipeline has an action phrase for. */
const ORDER_BOILERPLATE: CorpusRow = {
  symbol: 'PANACEABIO',
  category: 'Bagging/Receiving of orders/contracts',
  summary:
    'Panacea Biotec Limited has informed the Exchange about Bagging/Receiving of orders/contracts',
};

/** Boilerplate for a category no action phrase exists for. The floor. */
const UNPHRASED_BOILERPLATE: CorpusRow = {
  symbol: 'BSHSL',
  category:
    'Certificate under SEBI (Depositories and Participants) Regulations, 2018',
  summary:
    'Bombay Super Hybrid Seeds Limited has informed the Exchange about Certificate under SEBI (Depositories and Participants) Regulations, 2018',
};

/** The quoted-and-full-stopped form, which is the corpus's very first row. */
const QUOTED: CorpusRow = {
  symbol: 'DIAMINESQ',
  category: 'Updates',
  summary:
    "Diamines & Chemicals Limited has informed the Exchange regarding 'Allotment of ESOP'.",
};

const FIXTURES: readonly CorpusRow[] = [
  RECORD_DATE,
  RESULTS,
  BOILERPLATE,
  ORDER_BOILERPLATE,
  UNPHRASED_BOILERPLATE,
  QUOTED,
];

describe('composeOutcome — the exchange said something its category does not', () => {
  it.each([
    [
      'ORBTEXP',
      RECORD_DATE,
      'ORBTEXP: Record date for the purpose of Buyback is 15-Jul-2026',
    ],
    [
      'ASAHIINDIA',
      RESULTS,
      'ASAHIINDIA: financial results for the period ended Jun 30, 2026',
    ],
  ])(
    'reads the exchange’s own sentence for %s',
    (_symbol, filing, expected) => {
      const outcome = composeOutcome(filing);
      expect(outcome.source).toBe('exchange-summary');
      expect(outcome.text).toBe(expected);
    },
  );

  it.each(
    [RECORD_DATE, RESULTS].map((filing) => [filing.symbol, filing] as const),
  )('strips the NSE template lead from %s', (_symbol, filing) => {
    // 89.3% of corpus summaries open with `<Company> has informed the Exchange
    // <about|regarding|that>`, which is the same words on every row and the
    // reason a raw summary column is unreadable. The company name goes with
    // it: the symbol already leads the line.
    const { text } = composeOutcome(filing);
    expect(text).not.toMatch(/has (informed|submitted|intimated)/i);
    expect(text).not.toContain('the Exchange');
    expect(text).not.toContain('Limited');
  });

  it('keeps the pattern working for a company it has never seen', () => {
    // The lead is matched up to the verb rather than against a name list,
    // which is what makes it work for a newly listed company.
    const outcome = composeOutcome({
      symbol: 'NEWCO',
      category: 'Updates',
      summary:
        'Some Company Nobody Has Listed Before Limited has informed the Exchange that its Bengaluru plant resumed operations on August 04, 2026.',
    });
    expect(outcome.source).toBe('exchange-summary');
    expect(outcome.text).toBe(
      'NEWCO: its Bengaluru plant resumed operations on August 04, 2026',
    );
  });

  it('leads with the symbol, upper-cased', () => {
    // The dashboard sorts and filters by symbol, and a line starting with a
    // ticker is scannable in a column of two thousand.
    const outcome = composeOutcome({ ...RECORD_DATE, symbol: '  orbtexp ' });
    expect(outcome.text.startsWith('ORBTEXP: ')).toBe(true);
  });
});

describe('composeOutcome — the summary only restates the category', () => {
  it.each([
    ['AMRUTANJAN', BOILERPLATE, 'AMRUTANJAN CREDIT RATING'],
    // The action phrase earns its place here: "BAGS ORDER" rather than
    // "BAGGING/RECEIVING OF ORDERS/CONTRACTS".
    ['PANACEABIO', ORDER_BOILERPLATE, 'PANACEABIO BAGS ORDER'],
    // No phrase is mapped for this one, so the floor is the exchange's own
    // label — exactly as true as what the alert said before this module.
    [
      'BSHSL',
      UNPHRASED_BOILERPLATE,
      'BSHSL — CERTIFICATE UNDER SEBI (DEPOSITORIES AND PARTICIPANTS) REGULATIONS, 2018',
    ],
  ])('falls back to the category for %s', (_symbol, filing, expected) => {
    const outcome = composeOutcome(filing);
    expect(outcome.source).toBe('category');
    expect(outcome.text).toBe(expected);
  });

  it('uses the action phrase where one exists', () => {
    expect(composeOutcome(ORDER_BOILERPLATE).text).toContain('BAGS ORDER');
  });

  it('uses SYMBOL — CATEGORY where no phrase is mapped', () => {
    expect(composeOutcome(UNPHRASED_BOILERPLATE).text).toContain(' — ');
  });

  it('is not a failure, and says so in the source rather than in the text', () => {
    // `labelled` is an honest floor, not an error state: 100% of Investor
    // Presentation summaries are boilerplate and an investor presentation is
    // not a quiet filing.
    const outcome = composeOutcome({
      symbol: 'BIOCON',
      category: 'Investor Presentation',
      summary:
        'Biocon Limited has informed the Exchange about Investor Presentation',
    });
    expect(outcome.source).toBe('category');
    expect(outcome.text).not.toMatch(/unknown|none|n\/a|error/i);
  });
});

describe('composeOutcome — the text is never empty', () => {
  const SYMBOLS = ['ORBTEXP', '', '   '];
  const CATEGORIES = [
    'Record Date',
    'Certificate under SEBI (Depositories and Participants) Regulations, 2018',
    'Some Category NSE Invented Yesterday',
    '',
    '   ',
  ];
  const SUMMARIES = [
    RECORD_DATE.summary,
    BOILERPLATE.summary,
    'Some Limited has informed the Exchange that',
    '',
    '   ',
    '\n\t ',
  ];

  const COMBINATIONS = SYMBOLS.flatMap((symbol) =>
    CATEGORIES.flatMap((category) =>
      SUMMARIES.map((summary) => ({ symbol, category, summary })),
    ),
  );

  it('covers all ninety combinations of symbol, category and summary', () => {
    expect(COMBINATIONS).toHaveLength(90);
  });

  it('produces a non-empty line for every one of them', () => {
    // The universal-coverage promise, stated as the only property that can
    // enforce it: a filing whose PDF is a raster scan, whose attachment URL is
    // NSE's "-" sentinel and whose model call failed still gets a line.
    const empty = COMBINATIONS.filter(
      (filing) => composeOutcome(filing).text.trim().length === 0,
    );
    expect(empty).toEqual([]);
  });

  it('never throws for any of them', () => {
    const thrown = COMBINATIONS.filter((filing) => {
      try {
        composeOutcome(filing);
        return false;
      } catch {
        return true;
      }
    });
    expect(thrown).toEqual([]);
  });

  it('always reports a source it declares', () => {
    const sources = new Set(
      COMBINATIONS.map((filing) => composeOutcome(filing).source),
    );
    expect([...sources].sort()).toEqual(['category', 'exchange-summary']);
  });

  it('survives a stored filing with no summary field at all', () => {
    // Not reachable through the declared type, which is exactly why it is
    // worth a test: the rows come out of Mongo, and a document written before
    // the field existed arrives with `summary` absent rather than empty. The
    // `?? ''` in composeOutcome is the only thing between that and a throw on
    // the dashboard's hottest path.
    const stored = { symbol: 'ORBTEXP', category: 'Record Date' } as Parameters<
      typeof composeOutcome
    >[0];

    const outcome = composeOutcome(stored);
    expect(outcome.source).toBe('category');
    expect(outcome.text).toBe('ORBTEXP RECORD DATE');
  });

  it('gives an empty summary and an empty category the ticker and nothing invented', () => {
    const outcome = composeOutcome({
      symbol: 'ORBTEXP',
      category: '',
      summary: '',
    });
    expect(outcome.source).toBe('category');
    expect(outcome.text).toContain('ORBTEXP');
    expect(outcome.text.trim().length).toBeGreaterThan(0);
  });
});

describe('composeOutcome — bounded for the dashboard column', () => {
  it('is capped at 200 characters', () => {
    // The literal as well as the constant. A fixture sized from the constant
    // it pins would pass for any value of it, and the number is a measurement:
    // 200 covers 98.9% of corpus summaries whole, and the 65 longest are
    // recitals of a scheme of arrangement's parties.
    expect(MAX_OUTCOME_CHARS).toBe(200);
  });

  const RECITAL = `Long Scheme Limited has informed the Exchange that ${'the Scheme of Arrangement between Transferor Company One and Transferee Company and their respective shareholders and creditors '.repeat(
    5,
  )}`;

  it('truncates a 600-character recital to exactly 200', () => {
    const outcome = composeOutcome({
      symbol: 'LONGSCHEME',
      category: 'Scheme of Arrangement',
      summary: RECITAL,
    });
    expect(RECITAL.length).toBeGreaterThan(500);
    expect(outcome.source).toBe('exchange-summary');
    expect(outcome.text).toHaveLength(200);
    expect(outcome.text).toHaveLength(MAX_OUTCOME_CHARS);
    expect(
      outcome.text.startsWith('LONGSCHEME: the Scheme of Arrangement'),
    ).toBe(true);
  });

  it('bounds the category fallback too', () => {
    // A long category with no phrase would otherwise escape the cap on the
    // path that has no summary to trim.
    const outcome = composeOutcome({
      symbol: 'LONGCAT',
      category: `Some Category NSE Invented Yesterday ${'and kept writing '.repeat(20)}`,
      summary: '',
    });
    expect(outcome.source).toBe('category');
    expect(outcome.text).toHaveLength(200);
  });
});

describe('composeOutcome — whitespace is collapsed', () => {
  it('collapses the doubled space NSE really publishes', () => {
    // `Buyback  is 15-Jul-2026` in the feed, `Buyback is 15-Jul-2026` in the
    // column. 1,814 corpus summaries carry a doubled space.
    expect(RECORD_DATE.summary).toContain('Buyback  is');
    expect(composeOutcome(RECORD_DATE).text).toContain('Buyback is');
  });

  it.each([
    ['newlines', 'a\nb'],
    ['carriage returns', 'a\r\nb'],
    ['tabs', 'a\tb'],
    ['runs of spaces', 'a     b'],
  ])('collapses %s to a single space', (_label, fragment) => {
    // The outcome is rendered in a table cell. A newline in it breaks the row
    // rather than wrapping inside it.
    const outcome = composeOutcome({
      symbol: 'X',
      category: 'Updates',
      summary: `X Limited has informed the Exchange that ${fragment} happened`,
    });
    expect(outcome.text).toBe('X: a b happened');
  });

  it('trims the quotes and trailing punctuation NSE wraps summaries in', () => {
    const outcome = composeOutcome({
      symbol: 'DIAMINESQ',
      category: 'Updates',
      summary:
        "Diamines & Chemicals Limited has informed the Exchange regarding 'Allotment of ESOP'.",
    });
    expect(outcome.text).toBe('DIAMINESQ: Allotment of ESOP');
  });
});

describe('restatesCategory', () => {
  it.each([
    // The exact restatement, which is 27.18% of the corpus.
    ['Credit Rating', 'Credit Rating'],
    // Punctuation is not evidence: NSE writes the category with slashes and
    // the summary without them.
    ['ESOP ESOS ESPS', 'ESOP/ESOS/ESPS'],
    // Containment rather than equality, because NSE writes both `Copy of
    // Newspaper Publication` and the shorter `Newspaper Publication` against
    // the same category.
    ['Newspaper Publication', 'Copy of Newspaper Publication'],
    ['newspaper publication', 'Copy of Newspaper Publication'],
    // Nothing left after the template lead is stripped restates by default —
    // there is no sentence to prefer over the category.
    ['', 'Record Date'],
    ['   ', 'Record Date'],
    ['...', 'Record Date'],
  ])('treats "%s" as a restatement of "%s"', (rest, category) => {
    expect(restatesCategory(rest, category)).toBe(true);
  });

  it.each([
    ['Record date for the purpose of Buyback is 15-Jul-2026', 'Record Date'],
    [
      'financial results for the period ended Jun 30, 2026',
      'Outcome of Board Meeting',
    ],
    [
      'Copy of Newspaper Publication regarding the transfer window',
      'Copy of Newspaper Publication',
    ],
    ['Credit Rating', 'Record Date'],
  ])('treats "%s" as adding to "%s"', (rest, category) => {
    expect(restatesCategory(rest, category)).toBe(false);
  });

  it('is symmetrical only in the direction that matters', () => {
    // Containment runs one way on purpose: a summary SHORTER than its category
    // has said nothing new, while a summary that contains the category and
    // more has.
    expect(restatesCategory('Buyback', 'Closure of Buy Back')).toBe(false);
    expect(restatesCategory('Buy Back', 'Closure of Buy Back')).toBe(true);
  });
});

describe('the whole corpus, 17,442 real filings', () => {
  it('holds every fixture in this file verbatim', () => {
    // A fixture that has drifted from the feed makes every number below
    // meaningless, so the fixtures are checked against the corpus rather than
    // trusted.
    const summaries = new Set(corpus().map((row) => row.summary));
    const missing = FIXTURES.filter(
      (fixture) => !summaries.has(fixture.summary),
    ).map((fixture) => fixture.symbol);
    expect(missing).toEqual([]);
  });

  it('has 17,442 rows, every one with a non-empty summary', () => {
    expect(corpus()).toHaveLength(17_442);
    expect(
      corpus().filter((row) => row.summary.trim().length === 0),
    ).toHaveLength(0);
  });

  it('never throws on any of them', () => {
    const thrown: string[] = [];
    for (const row of corpus()) {
      try {
        composeOutcome(row);
      } catch {
        thrown.push(row.symbol);
      }
    }
    expect(thrown).toEqual([]);
  });

  it('produces a non-empty bounded line for every one of them', () => {
    // Universal coverage, measured rather than asserted: this is the promise
    // that replaced a category allowlist which produced nothing for 71% of
    // filings.
    let empty = 0;
    let overlong = 0;
    let atTheBound = 0;
    for (const row of corpus()) {
      const { text } = composeOutcome(row);
      if (text.trim().length === 0) empty += 1;
      if (text.length > MAX_OUTCOME_CHARS) overlong += 1;
      if (text.length === MAX_OUTCOME_CHARS) atTheBound += 1;
    }
    expect({ empty, overlong }).toEqual({ empty: 0, overlong: 0 });
    // And the bound is genuinely exercised by real filings rather than only by
    // the synthetic recital above.
    expect(atTheBound).toBeGreaterThan(0);
  });

  it('renders every line on one row of a table', () => {
    const withBreaks = corpus()
      .filter((row) => /[\n\r\t]|\s{2}/.test(composeOutcome(row).text))
      .map((row) => row.symbol);
    expect(withBreaks).toEqual([]);
  });

  /**
   * THE MEASUREMENT THIS MODULE'S DESIGN RESTS ON.
   *
   * 12,701 of 17,442 summaries — 72.82% — say something their category does
   * not. That split is why `source` exists at all: if the share were near 100%
   * the category fallback would be dead code, and if it were near 0% the
   * summary would be worth nothing and this module would have to be a model
   * call, which is the thing it exists to avoid.
   *
   * Banded rather than pinned to the exact figure, because the corpus is a
   * 32-day window and a refresh moves it by a fraction of a point. A move
   * outside 72-74 is not noise: it means NSE changed how filers write summaries
   * and both the fallback and the confidence tiers need re-reading.
   */
  it('says something new in 72-74% of filings', () => {
    const stated = corpus().filter(
      (row) => composeOutcome(row).source === 'exchange-summary',
    ).length;
    const share = (100 * stated) / corpus().length;

    expect(share).toBeGreaterThanOrEqual(72);
    expect(share).toBeLessThanOrEqual(74);
    expect(Number(share.toFixed(2))).toBe(72.82);
  });

  it('agrees with restatesCategory on every row', () => {
    // The exported predicate and the composed source cannot disagree: the
    // report quotes one and the dashboard shows the other.
    const disagreeing = corpus().filter((row) => {
      const outcome = composeOutcome(row);
      const restated = restatesCategory(
        outcome.text.replace(/^[^:]*: /, ''),
        row.category,
      );
      return outcome.source === 'exchange-summary' && restated;
    });
    expect(disagreeing).toEqual([]);
  });
});
