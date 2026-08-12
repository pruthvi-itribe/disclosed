import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Model } from 'mongoose';
import {
  mintSessionToken,
  SESSION_COOKIE,
  SessionRepository,
  sessionExpiry,
  UserRepository,
} from '@app/accounts';
import type { Filing, FilingDocument } from '@app/filings';
import { DashboardModule, FILING_MODEL } from './dashboard.module';
import { BRAND_RASTER } from './ui/brand-raster';
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

/**
 * The session cookie the suite signs in with, set once in `beforeAll`.
 *
 * EVERY FILING ROUTE IS BEHIND THE SESSION NOW, so a suite about what those
 * routes return has to be signed in to ask. It registers a real user through
 * the real route rather than forging a cookie or stubbing the guard: the guard,
 * the session lookup and the cookie parser are all part of the wiring this file
 * exists to exercise, and a bypass would exercise the bypass.
 *
 * `AUTH_MODE` is unset here, and unset follows the keys — no Firebase keys in a
 * Jest environment, so this boots in `local` mode and the register route is
 * live. That is the same arrangement the browser suite uses, and it is the ONLY
 * way in either of them has.
 */
let cookie = '';

const signedInHeaders = (): Record<string, string> =>
  cookie === '' ? {} : { Cookie: cookie };

const get = async <T>(path: string): Promise<{ status: number; body: T }> => {
  const response = await fetch(`${origin}${path}`, {
    headers: signedInHeaders(),
  });
  return { status: response.status, body: (await response.json()) as T };
};

/** The same request with no cookie at all, for the tests about the gate. */
const getAnonymously = async (
  path: string,
): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(`${origin}${path}`);
  return { status: response.status, body: await response.json() };
};

const getPage = (path = '/'): Promise<Response> =>
  fetch(`${origin}${path}`, { headers: signedInHeaders() });

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

  // THE WAY IN, MINTED THROUGH THE CONTAINER RATHER THAN OVER HTTP.
  //
  // Not because a bypass is convenient — because `POST api/auth/register` is
  // Origin-guarded against `PUBLIC_ORIGIN`, which has to be known before the
  // module compiles, and this suite deliberately takes whatever port
  // `listen(0)` gives it. The sibling `auth.e2e.spec.ts` pins a port precisely
  // so it can exercise that guard, and it does.
  //
  // WHAT IS STILL EXERCISED HERE IS EVERYTHING THIS SUITE IS ABOUT: a real user
  // row, a real session row, the real cookie, and on every request below the
  // real `SessionGuard` doing a real indexed lookup. Nothing about the gate is
  // stubbed; only the registration round trip another suite owns is skipped.
  const users = app.get(UserRepository);
  const sessions = app.get(SessionRepository);
  const user = await users.create(
    'wiring@turret.test',
    // Never verified: this suite never signs in, it arrives holding a session.
    // A real argon2 hash here would cost 19 MiB and ~50 ms for nothing.
    '$argon2id$never-verified',
    new Date(),
  );
  const minted = mintSessionToken();
  const at = new Date();
  await sessions.create(minted.tokenHash, user!.id, at, sessionExpiry(at, 30));
  cookie = `${SESSION_COOKIE}=${minted.token}`;
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
    const response = await getPage();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('<!doctype html>');
  });

  it('sends the page uncached, so a redeploy is not served stale client code', async () => {
    expect((await getPage()).headers.get('cache-control')).toBe('no-store');
  });

  it('serves a page that references no external host', async () => {
    // THE XML NAMESPACE IS THE ONE EXEMPTION, and it is a name rather than an
    // address: `createElementNS` is how the card's four icons are put in the
    // SVG namespace, and no browser has ever fetched it. `page.spec.ts` holds
    // the argument and bounds it — one occurrence, as that call's argument.
    const served = (await (await getPage()).text()).split(
      'http://www.w3.org/2000/svg',
    );

    expect(served).toHaveLength(2);
    expect(served.join('')).not.toMatch(/https?:\/\//);
  });
});

/**
 * THE GATE, over real HTTP.
 *
 * The founder's decision is that there is no access without sign-in, and this
 * is the only place it can be checked as a property of the SERVER rather than
 * of the client. `dashboard.controller.spec.ts` reads the guard off the route
 * metadata, which proves the decorator is present; this proves the process
 * actually refuses.
 */
describe('dashboard over HTTP — no access without sign-in', () => {
  const GATED = [
    '/api/summary',
    '/api/filings?limit=1',
    '/api/suggest?q=rel',
    '/api/enrichment',
    '/api/categories',
    '/api/daily?days=3',
  ];

  it.each(GATED)('refuses %s with a 401 when signed out', async (path) => {
    const { status, body } = await getAnonymously(path);

    expect(status).toBe(401);
    // An envelope, like every other refusal on this origin — otherwise the
    // page reports "a body that is not a success envelope" for an expired
    // session, which reads as a broken deploy.
    expect(body).toMatchObject({
      success: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });

  it.each(GATED)('answers %s once signed in', async (path) => {
    expect((await get<unknown>(path)).status).toBe(200);
  });

  it('serves the landing page, not the dashboard, to a signed-out visitor', async () => {
    const html = await (await fetch(`${origin}/`)).text();

    expect(html).toContain('These are examples, not filings.');
    // The tell: the dashboard's admin table. A landing page that shipped the
    // app's markup with the data blanked would pass a weaker assertion.
    expect(html).not.toContain('<table>');
    // THE APP'S CLIENT CODE, NOT "A SCRIPT ELEMENT". Like the `/auth` test
    // below, this suite boots the real config loader, so a host whose
    // environment carries Firebase keys serves the landing page's sign-in
    // popup — two script elements that name one write route and no read route.
    // `landing.spec.ts` owns that boundary; what must never appear here is the
    // 100 KB that reads the collection.
    expect(html).not.toContain('ADMIN_ENABLED');
    expect(html).not.toContain('id="view-feed"');
  });

  it('leaks no filing to a signed-out visitor, anywhere in the document', async () => {
    // The collection holds exactly one company. If any part of the landing path
    // ever reads it, this is where it shows up.
    const html = await (await fetch(`${origin}/`)).text();

    expect(html).not.toContain('RELIANCE');
    expect(html).not.toContain('Reliance Industries');
  });

  it('gates the brand mark too, and hands back the bytes on the shelf', async () => {
    // THE ONE ASSET THIS APPLICATION SERVES, drawn into the share card because
    // the page's inline SVG is a redrawing of the founder's file rather than the
    // file. It is not one of the three exceptions: a caller who cannot see a
    // filing has no card to put a mark on.
    const refused = await getAnonymously('/brand/logo.png');

    expect(refused.status).toBe(401);
    expect(refused.body).toMatchObject({
      success: false,
      error: { code: 'UNAUTHENTICATED' },
    });

    const response = await fetch(`${origin}/brand/logo.png`, {
      headers: signedInHeaders(),
    });
    const bytes = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    // The bytes on disk, not merely 200 and something. The first eight are
    // PNG's own signature, and the length is the committed file's — a route
    // that answered with an empty body or with the JSON serialisation of a
    // Buffer would pass a weaker assertion and draw nothing on the card.
    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(bytes.length).toBe(BRAND_RASTER.length);
  });

  it('leaves health open, because a monitor has no credential', async () => {
    const { status, body } = await getAnonymously('/api/health');

    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true, data: { status: 'ok' } });
  });

  it('leaves the sign-in page open, because gating it is a lockout', async () => {
    const response = await fetch(`${origin}/auth`, { redirect: 'manual' });

    // THE PANEL, NOT THE DOOR INSIDE IT. This suite boots the real config
    // loader, so which body `/auth` renders follows whatever Firebase keys the
    // environment happens to carry — the Google button with keys, the in-house
    // form without them. What this test is about is that a browser with no
    // cookie is served the page at all, and `auth-page.spec.ts` owns the three
    // bodies.
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('class="authpanel"');
  });

  it('sends a signed-in browser away from the sign-in page', async () => {
    const response = await fetch(`${origin}/auth`, {
      headers: signedInHeaders(),
      redirect: 'manual',
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/');
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
    const response = await fetch(`${origin}/api/suggest?q=rel`, {
      headers: signedInHeaders(),
    });

    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
