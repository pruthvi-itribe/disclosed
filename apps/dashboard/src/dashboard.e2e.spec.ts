import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Model } from 'mongoose';
import type { Filing, FilingDocument } from '@app/filings';
import { DashboardModule, FILING_MODEL } from './dashboard.module';
import type {
  CategoryCount,
  DailyCount,
  FilingView,
  PageMeta,
  SummaryView,
} from './filings/dashboard.types';

/**
 * The wiring test.
 *
 * Everything below the controller has its own suite; this one exists because
 * the module is the part nothing else exercises — the `useFactory` that
 * narrows the model to a read handle, the config load, the route prefixes, the
 * envelope on the wire and the fact that `bodyParser: false` does not break a
 * GET. It boots the REAL `DashboardModule` against an in-memory mongod, on a
 * loopback port the OS picks.
 */

interface Envelope<TData, TMeta = undefined> {
  readonly success: boolean;
  readonly data: TData;
  readonly error: null;
  readonly meta: TMeta;
}

let mongo: MongoMemoryServer;
let app: INestApplication;
let model: Model<FilingDocument>;
let origin: string;

const makeFiling = (seqId: number, at: string, category: string): Filing => ({
  seqId,
  symbol: 'RELIANCE',
  isin: 'INE002A01018',
  companyName: 'Reliance Industries Limited',
  industry: 'Refineries',
  category,
  summary: `Filing ${seqId}`,
  attachmentUrl: null,
  announcedAt: new Date(at),
  disseminatedAt: new Date(at),
  ingestedAt: new Date(new Date(at).getTime() + 5_000),
});

const get = async <T>(path: string): Promise<{ status: number; body: T }> => {
  const response = await fetch(`${origin}${path}`);
  return { status: response.status, body: (await response.json()) as T };
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();

  // The module reads MONGO_URI through its own config loader, so pointing it at
  // the in-memory server is the honest way to exercise that path rather than
  // overriding the provider and skipping it.
  process.env.MONGO_URI = mongo.getUri('turret');

  const moduleRef = await Test.createTestingModule({
    imports: [DashboardModule],
  }).compile();

  app = moduleRef.createNestApplication({ bodyParser: false });
  await app.listen(0, '127.0.0.1');
  origin = await app.getUrl();

  model = app.get<Model<FilingDocument>>(getModelToken(FILING_MODEL));

  // BUILT HERE, BY THE TEST, because the application will not build them: the
  // module sets `autoIndex: false` so a viewer can never alter the collection,
  // including its indexes. In production the ingest process owns that (see
  // `tools/search/build-search-indexes.ts`); here the test has to stand in for
  // it, and `api/filings?q=` is a MongoServerError without the text index —
  // which is exactly the failure this asserts is wired up.
  await model.syncIndexes();

  await model.insertMany([
    makeFiling(101, '2026-08-05T04:58:18.000Z', 'General Updates'),
    makeFiling(102, '2026-08-05T05:10:00.000Z', 'Board Meeting'),
    makeFiling(103, '2026-08-05T06:20:00.000Z', 'General Updates'),
  ]);
}, 90_000);

// Generously timed on purpose. Closing a listening Nest app, disconnecting
// mongoose and stopping a mongod comfortably exceed jest's 5s default when the
// full suite is running these in parallel with everything else, and a teardown
// that times out fails the suite without a single test having failed.
afterAll(async () => {
  await app.close();
  await mongo.stop();
  delete process.env.MONGO_URI;
}, 60_000);

describe('dashboard over HTTP — the page', () => {
  it('serves HTML at the root', async () => {
    const response = await fetch(`${origin}/`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('<!doctype html>');
  });

  it('sends the page uncached, so a redeploy is not served stale client code', async () => {
    const response = await fetch(`${origin}/`);

    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('serves a page that references no external host', async () => {
    expect(await (await fetch(`${origin}/`)).text()).not.toMatch(/https?:\/\//);
  });
});

describe('dashboard over HTTP — summary', () => {
  it('returns the real counts in a success envelope', async () => {
    const { status, body } = await get<Envelope<SummaryView>>('/api/summary');

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.error).toBeNull();
    expect(body.data.totalFilings).toBe(3);
    expect(body.data.maxSeqId).toBe(103);
    expect(body.data.newestDisseminatedAt).toBe('2026-08-05T06:20:00.000Z');
    expect(body.data.newestDisseminatedAtIst).toBe('2026-08-05 11:50:00');
  });
});

describe('dashboard over HTTP — filings', () => {
  it('returns rows newest first with pagination metadata', async () => {
    const { body } = await get<Envelope<FilingView[], PageMeta>>(
      '/api/filings?limit=2',
    );

    expect(body.data.map((f) => f.seqId)).toEqual([103, 102]);
    expect(body.meta).toEqual({
      total: 3,
      limit: 2,
      offset: 0,
      returned: 2,
      hasMore: true,
    });
  });

  it('applies the category filter', async () => {
    const { body } = await get<Envelope<FilingView[], PageMeta>>(
      `/api/filings?category=${encodeURIComponent('Board Meeting')}`,
    );

    expect(body.data.map((f) => f.seqId)).toEqual([102]);
  });

  it('applies the symbol filter case-insensitively', async () => {
    const { body } = await get<Envelope<FilingView[], PageMeta>>(
      '/api/filings?symbol=reliance',
    );

    expect(body.meta.total).toBe(3);
  });

  it('answers a bad query with 400 rather than a silently defaulted page', async () => {
    const { status } = await get<unknown>('/api/filings?limit=abc');

    expect(status).toBe(400);
  });

  it('rejects a bracketed key instead of letting it become a Mongo operator', async () => {
    const { status } = await get<unknown>('/api/filings?symbol[$ne]=x');

    expect(status).toBe(400);
  });
});

describe('dashboard over HTTP — breakdowns', () => {
  it('returns the category counts largest first', async () => {
    const { body } = await get<Envelope<CategoryCount[]>>('/api/categories');

    expect(body.data).toEqual([
      { category: 'General Updates', count: 2 },
      { category: 'Board Meeting', count: 1 },
    ]);
  });

  it('returns a zero-filled per-day series of the requested length', async () => {
    const { body } = await get<Envelope<DailyCount[]>>('/api/daily?days=5');

    expect(body.data).toHaveLength(5);
    expect(
      body.data.every((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.istDay)),
    ).toBe(true);
  });
});

describe('dashboard over HTTP — read-only', () => {
  it('refuses every write verb on every route', async () => {
    // No write handler is registered anywhere, so express answers 404. The
    // point of asserting it is that adding one would turn these green-by-
    // absence checks red.
    const attempts = [
      ['POST', '/api/filings'],
      ['PUT', '/api/filings'],
      ['PATCH', '/api/summary'],
      ['DELETE', '/api/filings'],
      ['POST', '/'],
    ] as const;

    for (const [method, path] of attempts) {
      const response = await fetch(`${origin}${path}`, {
        method,
        body: method === 'DELETE' ? undefined : '{}',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(response.status).toBe(404);
    }
  });

  it('leaves the collection exactly as it found it', async () => {
    const before = await model.find({}, { _id: 0 }).lean().exec();

    await get<unknown>('/api/summary');
    await get<unknown>('/api/filings?limit=50');
    await get<unknown>('/api/categories');
    await get<unknown>('/api/daily?days=30');

    expect(await model.find({}, { _id: 0 }).lean().exec()).toEqual(before);
  });

  it('binds loopback only', async () => {
    // The dashboard is an unauthenticated view of an unauthenticated database.
    expect(origin.startsWith('http://127.0.0.1:')).toBe(true);
  });
});

/**
 * The search and the type-ahead, over real HTTP against a real mongod.
 *
 * This is the only place the whole path is exercised end to end: the text index
 * the schema declares, the `$text` filter, the ranked aggregation, the directory
 * singleton the module wires, and the envelope on the wire. Every one of those
 * has its own unit suite; none of them proves that the module put them together.
 */
describe('dashboard over HTTP — search', () => {
  it('finds a filing by the company NAME, which is the whole point', async () => {
    const { status, body } = await get<Envelope<FilingView[], PageMeta>>(
      '/api/filings?q=reliance',
    );

    expect(status).toBe(200);
    expect(body.data).toHaveLength(3);
    expect(body.meta.total).toBe(3);
  });

  it('finds a filing by its category', async () => {
    const { body } = await get<Envelope<FilingView[], PageMeta>>(
      '/api/filings?q=board%20meeting',
    );

    expect(body.data.map((row) => row.category)).toContain('Board Meeting');
  });

  it('resolves a PREFIX through the directory the module wired in', async () => {
    // `reli` is not a word in any filing, so the text index cannot match it.
    // That it works at all is the proof that the module handed the query
    // service a resolver backed by the company directory.
    const { body } = await get<Envelope<FilingView[], PageMeta>>(
      '/api/filings?q=reli',
    );

    expect(body.meta.total).toBe(3);
  });

  it('returns an empty page for a query nothing matches, not a 500', async () => {
    const { status, body } = await get<Envelope<FilingView[], PageMeta>>(
      '/api/filings?q=zzzqqq',
    );

    expect(status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(0);
  });

  it('cannot be turned into a Mongo operator by the query string', async () => {
    // `readSingle` refuses the object a bracketed key parses to, and the
    // tokeniser cannot emit an operator character even for a value that passes.
    expect((await get<Envelope<unknown>>('/api/filings?q[$ne]=x')).status).toBe(
      400,
    );
    expect(
      (await get<Envelope<FilingView[], PageMeta>>('/api/filings?q=%24where'))
        .status,
    ).toBe(200);
  });
});

describe('dashboard over HTTP — type-ahead', () => {
  it('suggests the company a reader is part-way through typing', async () => {
    const { status, body } = await get<
      Envelope<{
        companies: { symbol: string; companyName: string; filings: number }[];
        companiesKnown: number;
      }>
    >('/api/suggest?q=reli');

    expect(status).toBe(200);
    expect(body.data.companies).toEqual([
      {
        symbol: 'RELIANCE',
        companyName: 'Reliance Industries Limited',
        filings: 3,
      },
    ]);
    expect(body.data.companiesKnown).toBe(1);
  });

  it('serves the same answer repeatedly without asking the database again', async () => {
    // The directory is a module singleton; if it were per-request this would
    // rebuild the snapshot on every keystroke, which is the behaviour the whole
    // design exists to avoid. Asserted here as a stable `builtAtIst`, which
    // only changes when a rebuild actually happened.
    const first =
      await get<Envelope<{ builtAtIst: string }>>('/api/suggest?q=rel');
    const second = await get<Envelope<{ builtAtIst: string }>>(
      '/api/suggest?q=reli',
    );

    expect(second.body.data.builtAtIst).toBe(first.body.data.builtAtIst);
  });

  it('sends the type-ahead uncached, like every other route here', async () => {
    const response = await fetch(`${origin}/api/suggest?q=rel`);

    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
