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
