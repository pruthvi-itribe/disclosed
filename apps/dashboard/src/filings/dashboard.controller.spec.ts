import { BadRequestException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import {
  DEFAULT_CATEGORY_LIMIT,
  DEFAULT_DAYS,
  DEFAULT_LIMIT,
  DashboardController,
  MAX_DAYS,
  MAX_LIMIT,
} from './dashboard.controller';
import type { FilingQueryService, RecentQuery } from './filing-query.service';
import type { CompanyDirectory } from '../search/company-directory';
import type { DirectorySnapshot } from '../search/directory.types';
import { companyTerms, searchTerms } from '../search/search-terms';
import type { EnrichmentSummaryView, SummaryView } from './dashboard.types';

const SUMMARY: SummaryView = {
  totalFilings: 1005,
  todayCount: 402,
  todayIstDay: '2026-08-05',
  newestDisseminatedAt: '2026-08-05T18:02:13.000Z',
  newestDisseminatedAtIst: '2026-08-05 23:32:13',
  maxSeqId: 106_727_715,
  feedLagMs: 41_000,
  generatedAt: '2026-08-05T18:02:54.000Z',
  generatedAtIst: '2026-08-05 23:32:54',
};

const ENRICHMENT_SUMMARY: EnrichmentSummaryView = {
  total: 1005,
  byState: [
    { key: 'enriched', count: 800 },
    { key: 'pending', count: 150 },
    { key: 'unparseable', count: 55 },
  ],
  withAmount: 121,
  byRefusal: [{ key: 'no-candidate', count: 500 }],
  byUnparseable: [{ key: 'not-a-pdf', count: 40 }],
  withCounterparty: 9,
  withEnrichedHeadline: 121,
  withClaims: 34,
  byClaimDiscard: [{ key: 'span-not-found', count: 7 }],
  byClaimRefusal: [{ key: 'not-eligible', count: 600 }],
  withResults: 12,
  byResultsDiscard: [{ key: 'label-mismatch', count: 4 }],
  byResultsRefusal: [{ key: 'no-results', count: 21 }],
  // Equal to `total`, which is the point: every filing produces an outcome.
  withOutcome: 1005,
  byCategoryGroup: [
    { key: 'routine', count: 290 },
    { key: 'governance', count: 281 },
    { key: 'results', count: 89 },
  ],
  byConfidenceTier: [
    { key: 'verified', count: 155 },
    { key: 'stated or labelled', count: 850 },
  ],
  byParseRoute: [
    { key: 'pdf-parse', count: 720 },
    { key: 'docling-layout', count: 67 },
    { key: 'docling-ocr', count: 13 },
  ],
  byCoverageSkip: [{ key: 'covering-letter', count: 96 }],
  parseFallbacks: 4,
  generatedAtIst: '2026-08-05 23:32:54',
};

/**
 * A directory the type-ahead can be asked about without a database.
 *
 * The directory's own suite proves what its two reads cost against a real
 * mongod; this file is about the HTTP layer, so here it is a value.
 */
const SNAPSHOT: DirectorySnapshot = {
  companies: [
    {
      symbol: 'BRITANNIA',
      companyName: 'Britannia Industries Limited',
      filings: 9,
      terms: companyTerms('BRITANNIA', 'Britannia Industries Limited'),
    },
  ],
  categories: [
    { category: 'Stock split', filings: 12, terms: searchTerms('Stock split') },
  ],
  groups: [
    {
      group: 'results',
      label: 'Results',
      filings: 89,
      terms: searchTerms('Results'),
    },
  ],
  builtAt: new Date('2026-08-07T06:00:00.000Z'),
};

/** What each stub method was last called with, so argument mapping is assertable. */
interface Calls {
  recent: RecentQuery[];
  categories: number[];
  days: number[];
}

let calls: Calls;
let controller: DashboardController;

beforeEach(() => {
  calls = { recent: [], categories: [], days: [] };

  // A hand-written stub rather than a real service: this file is about the
  // HTTP layer's argument handling, and the query layer has its own suite
  // against a real mongod. The cast goes through `unknown` because the service
  // has private fields, which structural typing cannot satisfy — it is not a
  // stand-in for `any`.
  const service = {
    getSummary: async () => SUMMARY,
    getRecent: async (query: RecentQuery) => {
      calls.recent.push(query);
      return {
        items: [],
        meta: {
          total: 0,
          limit: query.limit,
          offset: query.offset,
          returned: 0,
          hasMore: false,
        },
      };
    },
    getCategories: async (limit: number) => {
      calls.categories.push(limit);
      return [];
    },
    getDaily: async (days: number) => {
      calls.days.push(days);
      return [];
    },
    getEnrichmentSummary: async () => ENRICHMENT_SUMMARY,
  } as unknown as FilingQueryService;

  const directory = {
    snapshot: async () => SNAPSHOT,
  } as unknown as CompanyDirectory;

  controller = new DashboardController(service, directory);
});

describe('DashboardController — routes', () => {
  const HANDLERS = [
    'getPage',
    'getSummary',
    'getFilings',
    'getCategories',
    'getDaily',
    'getEnrichment',
    'getSuggestions',
  ] as const;

  it.each(HANDLERS)('exposes %s as a GET, never a write verb', (name) => {
    // The read-only guarantee is enforced by the narrowed model the service
    // holds, but this is the file where someone would add a POST, so the
    // absence is pinned here too.
    const method = Reflect.getMetadata(
      METHOD_METADATA,
      DashboardController.prototype[name],
    );

    expect(method).toBe(RequestMethod.GET);
  });

  it('serves the page at the root and the data under /api', () => {
    const pathOf = (name: (typeof HANDLERS)[number]): string =>
      Reflect.getMetadata(PATH_METADATA, DashboardController.prototype[name]);

    expect(pathOf('getPage')).toBe('/');
    expect(pathOf('getSummary')).toBe('api/summary');
    expect(pathOf('getFilings')).toBe('api/filings');
    expect(pathOf('getCategories')).toBe('api/categories');
    expect(pathOf('getDaily')).toBe('api/daily');
    expect(pathOf('getEnrichment')).toBe('api/enrichment');
    expect(pathOf('getSuggestions')).toBe('api/suggest');
  });
});

describe('DashboardController — suggestions', () => {
  it('answers a query from the directory, in an envelope like everything else', async () => {
    const { data } = await controller.getSuggestions({ q: 'brit' });

    expect(data.companies).toEqual([
      {
        symbol: 'BRITANNIA',
        companyName: 'Britannia Industries Limited',
        filings: 9,
      },
    ]);
  });

  it('offers a category and a group too, so one box serves all three filters', async () => {
    const { data } = await controller.getSuggestions({ q: 'stock split' });

    expect(data.categories).toEqual([{ category: 'Stock split', filings: 12 }]);
    expect(
      (await controller.getSuggestions({ q: 'results' })).data.groups,
    ).toEqual([{ group: 'results', label: 'Results', filings: 89 }]);
  });

  it('answers an absent query with an empty list rather than a 400', async () => {
    // The page debounces, so a cleared box can race its own timer. A red error
    // banner because a reader pressed backspace would be the dashboard
    // reporting its own timing as a fault.
    const { data } = await controller.getSuggestions({});

    expect(data.companies).toEqual([]);
    expect(data.builtAtIst).toContain('2026-08-07');
  });

  it('still refuses a query given twice or as an object', async () => {
    // The one thing it does NOT forgive. A bracketed key arrives as an object
    // and is the shape a NoSQL-injection attempt takes; see `readSingle`.
    await expect(
      controller.getSuggestions({ q: ['a', 'b'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.getSuggestions({ q: { $ne: null } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a query longer than a company name could be', async () => {
    await expect(
      controller.getSuggestions({ q: 'x'.repeat(129) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('DashboardController — page', () => {
  it('returns the self-contained HTML document', () => {
    const html = controller.getPage();

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<table>');
  });
});

describe('DashboardController — summary', () => {
  it('wraps the summary in a success envelope', async () => {
    expect(await controller.getSummary()).toEqual({
      success: true,
      data: SUMMARY,
      error: null,
      meta: null,
    });
  });
});

describe('DashboardController — filings', () => {
  it('applies the documented defaults when nothing is asked for', async () => {
    await controller.getFilings({});

    expect(calls.recent).toEqual([
      {
        limit: DEFAULT_LIMIT,
        offset: 0,
        symbol: undefined,
        category: undefined,
      },
    ]);
  });

  it('passes the validated filters through untouched', async () => {
    await controller.getFilings({
      limit: '50',
      offset: '100',
      symbol: 'reliance',
      category: 'Board Meeting',
    });

    expect(calls.recent[0]).toEqual({
      limit: 50,
      offset: 100,
      symbol: 'reliance',
      category: 'Board Meeting',
    });
  });

  it('returns the page metadata beside the rows', async () => {
    const response = await controller.getFilings({ limit: '10' });

    expect(response.success).toBe(true);
    expect(response.meta).toMatchObject({ limit: 10, offset: 0 });
  });

  it.each([
    ['limit', 'abc'],
    ['limit', '0'],
    ['offset', '-1'],
    ['limit', String(MAX_LIMIT + 1)],
  ])('rejects %s=%s rather than quietly defaulting it', async (key, value) => {
    await expect(controller.getFilings({ [key]: value })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a filter given as an object', async () => {
    await expect(
      controller.getFilings({ symbol: { $ne: null } }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('DashboardController — categories', () => {
  it('applies the default limit', async () => {
    await controller.getCategories({});

    expect(calls.categories).toEqual([DEFAULT_CATEGORY_LIMIT]);
  });

  it('honours an explicit limit', async () => {
    await controller.getCategories({ limit: '5' });

    expect(calls.categories).toEqual([5]);
  });

  it('rejects a limit above the ceiling', async () => {
    await expect(
      controller.getCategories({ limit: String(MAX_LIMIT + 1) }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('DashboardController — daily', () => {
  it('applies the default window', async () => {
    await controller.getDaily({});

    expect(calls.days).toEqual([DEFAULT_DAYS]);
  });

  it('honours an explicit window', async () => {
    await controller.getDaily({ days: '30' });

    expect(calls.days).toEqual([30]);
  });

  it('rejects a window beyond a year rather than drawing 10,000 buckets', async () => {
    await expect(
      controller.getDaily({ days: String(MAX_DAYS + 1) }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects days=NaN, which would otherwise render as an empty series', async () => {
    await expect(controller.getDaily({ days: 'NaN' })).rejects.toThrow(
      /finite number/,
    );
  });
});

describe('DashboardController — enrichment filters', () => {
  it.each([
    ['state', 'enriched'],
    ['state', 'pending'],
    ['state', 'unparseable'],
    ['state', 'failed'],
    ['amount', 'extracted'],
    ['amount', 'refused'],
  ])('passes %s=%s through to the query layer', async (key, value) => {
    await controller.getFilings({ [key]: value });

    expect(calls.recent[0]).toMatchObject({ [key]: value });
  });

  it('passes a refusal reason through', async () => {
    await controller.getFilings({ refusal: 'unit-scaled-header' });

    expect(calls.recent[0].refusal).toBe('unit-scaled-header');
  });

  it.each([
    ['state', 'ENRICHED'],
    ['state', 'done'],
    ['state', 'enrich'],
    ['amount', 'yes'],
    ['amount', 'extracted!'],
  ])(
    'rejects an unknown %s value "%s" rather than matching nothing',
    async (key, value) => {
      // A filter that silently matched nothing would be indistinguishable from
      // "nothing was refused", on the one page whose job is showing refusals.
      await expect(controller.getFilings({ [key]: value })).rejects.toThrow(
        BadRequestException,
      );
    },
  );

  it('trims surrounding whitespace before checking the allowlist', async () => {
    await controller.getFilings({ state: ' enriched ' });

    expect(calls.recent[0].state).toBe('enriched');
  });

  it('names the accepted values when it rejects one', async () => {
    await expect(controller.getFilings({ state: 'done' })).rejects.toThrow(
      /enriched/,
    );
  });

  it('rejects a repeated enrichment filter', async () => {
    // Express parses `?state=a&state=b` into an array, which must never reach
    // a Mongo filter as a value the caller chose.
    await expect(
      controller.getFilings({ state: ['enriched', 'pending'] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a bracketed operator smuggled into a filter', async () => {
    await expect(
      controller.getFilings({ refusal: { $ne: null } }),
    ).rejects.toThrow(BadRequestException);
  });

  it('leaves every enrichment filter undefined when none is given', async () => {
    await controller.getFilings({});

    expect(calls.recent[0].state).toBeUndefined();
    expect(calls.recent[0].amount).toBeUndefined();
    expect(calls.recent[0].refusal).toBeUndefined();
  });
});

describe('DashboardController — enrichment summary', () => {
  it('returns the tally in a success envelope', async () => {
    const body = await controller.getEnrichment();

    expect(body.success).toBe(true);
    expect(body.data).toBe(ENRICHMENT_SUMMARY);
  });

  it('carries the refusal breakdown, which is what makes refusals auditable', async () => {
    const body = await controller.getEnrichment();

    expect(body.data.byRefusal).toEqual([{ key: 'no-candidate', count: 500 }]);
    expect(body.data.byUnparseable).toEqual([{ key: 'not-a-pdf', count: 40 }]);
  });
});
