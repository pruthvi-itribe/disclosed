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
import type { SummaryView } from './dashboard.types';

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
  } as unknown as FilingQueryService;

  controller = new DashboardController(service);
});

describe('DashboardController — routes', () => {
  const HANDLERS = [
    'getPage',
    'getSummary',
    'getFilings',
    'getCategories',
    'getDaily',
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
