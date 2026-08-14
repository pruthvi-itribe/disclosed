import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageOptions } from '@nestjs/throttler/dist/throttler-storage-options.interface';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Model } from 'mongoose';
import { SESSION_MODEL, type SessionDocument } from '@app/accounts';
import type { Filing, FilingDocument } from '@app/filings';
import { DashboardModule, FILING_MODEL } from '../dashboard.module';

/**
 * THE SECURITY CHECKLIST, AS TESTS THAT RUN.
 *
 * The design's threat model is a table of ten rows. Six of them are properties
 * of the wire — a status code, a header, a cookie attribute, a body that is
 * identical to another body — and a property of the wire can be asserted rather
 * than reviewed. This suite is that assertion: real HTTP against the real
 * module, over a real mongod.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED HERE: the timing equality between the
 * unknown-address and wrong-password paths. It is real (both verify against an
 * argon2 hash — see `auth.service.ts`) and a wall-clock assertion on it would be
 * flaky in CI on a shared runner, which is worse than no assertion because a
 * flaky security test gets deleted. What IS asserted is the mechanism: the
 * bodies and statuses are byte-identical, and the dummy-hash verification has
 * its own unit test in `password-hash.spec.ts`.
 */

jest.setTimeout(180_000);

let mongo: MongoMemoryServer;
let app: INestApplication;
let origin: string;
let filings: Model<FilingDocument>;
let sessions: Model<SessionDocument>;
let throttled: { storage: Record<string, ThrottlerStorageOptions> };

/**
 * Forgets every counted request.
 *
 * EVERY REQUEST IN THIS SUITE COMES FROM 127.0.0.1, so the per-IP limiter sees
 * one very determined attacker and refuses the whole file after ten calls —
 * which is the limiter working exactly as designed and would make the other 38
 * assertions untestable. Cleared between tests, and NOT cleared inside the
 * rate-limit block below, which is the one place the counting is the subject.
 *
 * Reaching into the storage rather than lowering the limits for tests: a suite
 * that ran against different numbers from production would be proving something
 * nobody ships.
 */
const forgetRequestCounts = (): void => {
  for (const key of Object.keys(throttled.storage)) {
    delete throttled.storage[key];
  }
};

const PASSWORD = 'rhubarb tuesday lantern';

const filing = (seqId: number, symbol: string, at: string): Filing => ({
  seqId,
  symbol,
  isin: `INE00${seqId}A01018`,
  companyName: `${symbol} Limited`,
  industry: 'Refineries',
  category: 'Acquisition',
  summary: `Filing ${seqId}`,
  attachmentUrl: null,
  announcedAt: new Date(at),
  disseminatedAt: new Date(at),
  ingestedAt: new Date(new Date(at).getTime() + 5_000),
});

interface Envelope<TData = unknown, TMeta = unknown> {
  success: boolean;
  data: TData;
  error: { code: string; message: string } | null;
  meta: TMeta;
}

/** A request with an explicit Origin, which every mutation requires. */
const call = async (
  method: string,
  path: string,
  options: {
    body?: unknown;
    cookie?: string;
    bearer?: string;
    origin?: string | null;
  } = {},
): Promise<{
  status: number;
  body: Envelope;
  setCookie: string | null;
}> => {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.cookie !== undefined) headers.Cookie = options.cookie;
  if (options.bearer !== undefined) {
    headers.Authorization = `Bearer ${options.bearer}`;
  }
  if (options.origin !== null) headers.Origin = options.origin ?? origin;

  const response = await fetch(`${origin}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  return {
    status: response.status,
    body: (await response.json()) as Envelope,
    setCookie: response.headers.get('set-cookie'),
  };
};

/** The `turret_sid=...` pair from a Set-Cookie header, ready to send back. */
const cookieFrom = (setCookie: string | null): string =>
  String(setCookie).split(';')[0];

/** A fresh address per test, so nothing depends on suite ordering. */
let counter = 0;
const freshEmail = (): string => {
  counter += 1;
  return `tester${counter}@example.com`;
};

const registerFresh = async (): Promise<{ email: string; cookie: string }> => {
  const email = freshEmail();
  const created = await call('POST', '/api/auth/register', {
    body: { email, password: PASSWORD },
  });
  expect(created.status).toBe(201);
  return { email, cookie: cookieFrom(created.setCookie) };
};

/**
 * A FIXED PORT, unlike the sibling suite that takes whatever the OS gives it.
 *
 * The Origin guard compares the request's `Origin` against `PUBLIC_ORIGIN`, and
 * `PUBLIC_ORIGIN` has to be known before the module is compiled — so the port
 * cannot be chosen by `listen(0)` after the fact. Well above the dashboard's
 * own 7717 and the Playwright suite's 7719, so a running dashboard does not
 * collide with the test suite.
 */
const TEST_PORT = 7791;

/** What `AUTH_MODE` was before this suite pinned it, restored afterwards. */
let priorAuthMode: string | undefined;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri('turret');
  origin = `http://127.0.0.1:${TEST_PORT}`;
  process.env.PUBLIC_ORIGIN = origin;

  /**
   * THE MODE THIS SUITE IS ABOUT, PINNED RATHER THAN INHERITED.
   *
   * `readAuthMode` follows the keys when `AUTH_MODE` is unset, so a machine
   * whose `.env` carries `FIREBASE_PROJECT_ID` and `FIREBASE_WEB_API_KEY`
   * resolves to `firebase` — where `POST api/auth/register` and
   * `POST api/auth/login` answer `409 LOCAL_AUTH_DISABLED` on purpose. Every
   * test here goes through one of those two doors, so the suite reported 31
   * failures out of 40 (measured 2026-08-08) for a server that was working
   * exactly as configured.
   *
   * IT IS NOT A RE-RUN PROBLEM AND THERE IS NOTHING TO CLEAN UP. The mongod is
   * in-memory and created in this same hook, so it holds no account before the
   * first request and outlives no run; `freshEmail`'s counter restarts with the
   * process. The failure is ambient rather than accumulated — it reproduced on
   * a first run against a fresh clone, and pinning the mode makes the suite
   * pass repeatedly on the same machine that failed it.
   *
   * Set here beside `MONGO_URI` and `PUBLIC_ORIGIN` because it is the same kind
   * of fact: what the process under test IS, decided by the suite rather than
   * by whatever the shell happens to be carrying. Restored rather than deleted,
   * so a run under an explicit `AUTH_MODE=firebase` leaves it as it found it.
   */
  priorAuthMode = process.env.AUTH_MODE;
  process.env.AUTH_MODE = 'local';

  const moduleRef = await Test.createTestingModule({
    imports: [DashboardModule],
  }).compile();

  // `bodyParser: false`, exactly as `main.ts` creates it. The auth routes read
  // a body anyway because the module mounts `express.json` on that one prefix —
  // which is the posture this suite exists partly to prove.
  app = moduleRef.createNestApplication({ bodyParser: false });
  await app.listen(TEST_PORT, '127.0.0.1');

  throttled = app.get<ThrottlerStorage>(ThrottlerStorage) as unknown as {
    storage: Record<string, ThrottlerStorageOptions>;
  };
  filings = app.get<Model<FilingDocument>>(getModelToken(FILING_MODEL));
  sessions = app.get<Model<SessionDocument>>(getModelToken(SESSION_MODEL));

  await filings.syncIndexes();
  await filings.insertMany([
    filing(201, 'RELIANCE', '2026-08-05T04:58:18.000Z'),
    filing(202, 'RELIANCE', '2026-08-05T05:10:00.000Z'),
    filing(203, 'TCS', '2026-08-05T06:20:00.000Z'),
  ]);
}, 180_000);

beforeEach(() => forgetRequestCounts());

afterAll(async () => {
  await app.close();
  await mongo.stop();
  delete process.env.MONGO_URI;
  delete process.env.PUBLIC_ORIGIN;
  if (priorAuthMode === undefined) delete process.env.AUTH_MODE;
  else process.env.AUTH_MODE = priorAuthMode;
}, 60_000);

describe('register', () => {
  it('creates an account and signs the browser straight in', async () => {
    const email = freshEmail();
    const response = await call('POST', '/api/auth/register', {
      body: { email, password: PASSWORD },
    });

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual({ signedIn: true, email });
  });

  it('normalises the address, so one person cannot become two accounts', async () => {
    const email = freshEmail();
    await call('POST', '/api/auth/register', {
      body: { email, password: PASSWORD },
    });

    const again = await call('POST', '/api/auth/register', {
      body: { email: `  ${email.toUpperCase()} `, password: PASSWORD },
    });

    expect(again.status).toBe(409);
    expect(again.body.error?.code).toBe('EMAIL_IN_USE');
  });

  it('refuses a password under the floor, and says which floor', async () => {
    const response = await call('POST', '/api/auth/register', {
      body: { email: freshEmail(), password: 'short' },
    });

    expect(response.status).toBe(422);
    expect(response.body.error?.code).toBe('WEAK_PASSWORD');
    expect(response.body.error?.message).toContain('12');
  });

  it('refuses a long password that is on the deny-list', async () => {
    const response = await call('POST', '/api/auth/register', {
      body: { email: freshEmail(), password: 'passwordpassword' },
    });

    expect(response.body.error?.code).toBe('WEAK_PASSWORD');
  });

  it('refuses something that is not an address', async () => {
    const response = await call('POST', '/api/auth/register', {
      body: { email: 'not-an-address', password: PASSWORD },
    });

    expect(response.status).toBe(422);
    expect(response.body.error?.code).toBe('INVALID_EMAIL');
  });
});

describe('the session cookie', () => {
  it('is HttpOnly, Path=/ and SameSite=Lax', async () => {
    const created = await call('POST', '/api/auth/register', {
      body: { email: freshEmail(), password: PASSWORD },
    });

    expect(created.setCookie).toContain('turret_sid=');
    expect(created.setCookie).toContain('HttpOnly');
    expect(created.setCookie).toContain('Path=/');
    expect(created.setCookie).toContain('SameSite=Lax');
  });

  it('is not Secure over plain http, or the browser would drop it silently', async () => {
    // This suite runs on loopback http, which is exactly the shipped MVP-day
    // deployment. A `Secure` cookie here is discarded by the browser without a
    // word, and the login then presents as succeeding and immediately
    // forgetting you.
    const created = await call('POST', '/api/auth/register', {
      body: { email: freshEmail(), password: PASSWORD },
    });

    expect(created.setCookie).not.toContain('Secure');
  });

  it('never puts the raw token in the database', async () => {
    const created = await call('POST', '/api/auth/register', {
      body: { email: freshEmail(), password: PASSWORD },
    });
    const token = cookieFrom(created.setCookie).split('=')[1];

    expect(token.length).toBeGreaterThan(20);
    expect(await sessions.countDocuments({ tokenHash: token }).exec()).toBe(0);
  });

  it('is a FRESH token on every login, never the one presented', async () => {
    const { email, cookie } = await registerFresh();

    const again = await call('POST', '/api/auth/login', {
      body: { email, password: PASSWORD },
      cookie,
    });

    expect(cookieFrom(again.setCookie)).not.toBe(cookie);
  });
});

describe('login — one answer for every failure', () => {
  it('signs in with the right password', async () => {
    const { email } = await registerFresh();

    const response = await call('POST', '/api/auth/login', {
      body: { email, password: PASSWORD },
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ signedIn: true, email });
  });

  it('answers an unknown address and a wrong password identically', async () => {
    // THE NO-ENUMERATION RULE, asserted rather than described. Same status,
    // same code, same message — so the response cannot be used to test whether
    // an address is registered.
    const { email } = await registerFresh();

    const wrongPassword = await call('POST', '/api/auth/login', {
      body: { email, password: 'definitely not the password' },
    });
    const noSuchUser = await call('POST', '/api/auth/login', {
      body: { email: 'nobody-at-all@example.com', password: PASSWORD },
    });

    expect(wrongPassword.status).toBe(noSuchUser.status);
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body).toEqual(noSuchUser.body);
    expect(wrongPassword.body.error?.code).toBe('INVALID_CREDENTIALS');
    expect(wrongPassword.body.error?.message).toBe(
      'Email or password is incorrect.',
    );
  });

  it('answers a backed-off account the same way, so the lockout is not an oracle', async () => {
    const { email } = await registerFresh();

    // Five wrong guesses puts the account on the backoff ladder.
    for (let i = 0; i < 5; i += 1) {
      await call('POST', '/api/auth/login', {
        body: { email, password: `wrong ${i} guess here` },
      });
    }

    // The RIGHT password now, while the account is backed off. Same 401.
    const during = await call('POST', '/api/auth/login', {
      body: { email, password: PASSWORD },
    });

    expect(during.status).toBe(401);
    expect(during.body.error?.code).toBe('INVALID_CREDENTIALS');
  });

  it('cannot be bypassed by a Mongo operator in the body', async () => {
    // `{"email": {"$gt": ""}}` reaching `findOne` matches the FIRST user in the
    // collection. `@IsString()` plus the ValidationPipe is what stops it, and
    // this is the assertion that says so.
    const response = await call('POST', '/api/auth/login', {
      body: { email: { $gt: '' }, password: { $gt: '' } },
    });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('strips a field no DTO declares rather than letting it through', async () => {
    const response = await call('POST', '/api/auth/login', {
      body: { email: 'a@b.co', password: PASSWORD, failedLoginCount: -999 },
    });

    // `forbidNonWhitelisted` makes the smuggled field a refusal rather than a
    // silent strip, which is the audible version of the same control.
    expect(response.status).toBe(400);
  });
});

describe('the Origin guard', () => {
  it('refuses a mutation from another site', async () => {
    const { email } = await registerFresh();

    const response = await call('POST', '/api/auth/login', {
      body: { email, password: PASSWORD },
      origin: 'http://evil.example',
    });

    expect(response.status).toBe(403);
    expect(response.body.error?.code).toBe('BAD_ORIGIN');
  });

  it('refuses a mutation with no Origin header at all', async () => {
    const response = await call('POST', '/api/auth/login', {
      body: { email: 'a@b.co', password: PASSWORD },
      origin: null,
    });

    expect(response.status).toBe(403);
  });

  it('does not stand in front of a read', async () => {
    const response = await call('GET', '/api/me', { origin: null });

    expect(response.status).toBe(200);
  });
});

describe('logout', () => {
  it('makes the session invalid immediately', async () => {
    const { cookie } = await registerFresh();

    expect((await call('GET', '/api/me', { cookie })).body.data).toMatchObject({
      signedIn: true,
    });

    await call('POST', '/api/auth/logout', { cookie });

    expect((await call('GET', '/api/me', { cookie })).body.data).toEqual({
      signedIn: false,
    });
  });

  it('deletes the session rather than merely clearing the cookie', async () => {
    const { cookie } = await registerFresh();
    const before = await sessions.countDocuments({}).exec();

    await call('POST', '/api/auth/logout', { cookie });

    expect(await sessions.countDocuments({}).exec()).toBe(before - 1);
  });

  it('clears the cookie with every attribute it was set with', async () => {
    const { cookie } = await registerFresh();

    const response = await call('POST', '/api/auth/logout', { cookie });

    expect(response.setCookie).toContain('turret_sid=;');
    expect(response.setCookie).toContain('Max-Age=0');
    // A browser matches a replacement on name AND path. Without this the
    // original cookie survives and the user stays signed in.
    expect(response.setCookie).toContain('Path=/');
  });

  it('refuses the watchlist afterwards', async () => {
    const { cookie } = await registerFresh();
    await call('POST', '/api/auth/logout', { cookie });

    const response = await call('GET', '/api/watchlist', { cookie });

    expect(response.status).toBe(401);
    expect(response.body.error?.code).toBe('UNAUTHENTICATED');
  });
});

describe('api/me', () => {
  it('answers 200 with signedIn false when nobody is signed in', async () => {
    // NOT a 401. The page asks this on every load, and a 401 on the ordinary
    // anonymous path is console noise that trains people to ignore real ones.
    const response = await call('GET', '/api/me');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ signedIn: false });
  });

  it('reports the watch count, the cap and the channels', async () => {
    const { cookie } = await registerFresh();

    const response = await call('GET', '/api/me', { cookie });

    expect(response.body.data).toMatchObject({
      signedIn: true,
      watchCount: 0,
      watchCap: 50,
      channels: [{ kind: 'inapp', enabled: true }],
    });
  });

  it('survives far more page loads than the auth burst allows', async () => {
    // THE BUG THIS PINS SHIPPED. Every throttler here is NAMED, and a bare
    // `@SkipThrottle()` opts out of a bucket called `default` — which does not
    // exist — so it skips nothing and the route stays limited at 10/min. One
    // read per page load then started answering 429 after ten loads from one
    // address. The browser suite caught it; no unit test could have.
    const statuses: number[] = [];
    for (let i = 0; i < 15; i += 1) {
      statuses.push((await call('GET', '/api/me')).status);
    }

    expect(statuses.every((status) => status === 200)).toBe(true);
  });

  it('ignores a session token that was never issued', async () => {
    const response = await call('GET', '/api/me', {
      cookie: 'turret_sid=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });

    expect(response.body.data).toEqual({ signedIn: false });
  });
});

describe('the watchlist', () => {
  it('is behind the session guard on every route', async () => {
    for (const [method, path] of [
      ['GET', '/api/watchlist'],
      ['GET', '/api/watchlist/feed'],
      ['POST', '/api/watchlist?symbol=RELIANCE'],
      ['DELETE', '/api/watchlist/RELIANCE'],
    ] as const) {
      expect((await call(method, path)).status).toBe(401);
    }
  });

  it('adds a company that has filed', async () => {
    const { cookie } = await registerFresh();

    const response = await call('POST', '/api/watchlist?symbol=RELIANCE', {
      cookie,
    });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ symbol: 'RELIANCE' });
    expect(response.body.meta).toEqual({ used: 1, cap: 50 });
  });

  it('takes the ticker in the query string, so no body is parsed here', async () => {
    const { cookie } = await registerFresh();

    const response = await call('POST', '/api/watchlist?symbol=reliance', {
      cookie,
    });

    expect(response.body.data).toMatchObject({ symbol: 'RELIANCE' });
  });

  it('is idempotent, because a double-click is not an error', async () => {
    const { cookie } = await registerFresh();
    await call('POST', '/api/watchlist?symbol=RELIANCE', { cookie });

    const again = await call('POST', '/api/watchlist?symbol=RELIANCE', {
      cookie,
    });

    // Same body, and a 200 rather than a 201: the entry was not created this
    // time, and the status is the one place that difference is visible.
    expect(again.status).toBe(200);
    expect(again.body.meta).toEqual({ used: 1, cap: 50 });
  });

  it('refuses a symbol no filing was ever held for, rather than storing a typo', async () => {
    const { cookie } = await registerFresh();

    const response = await call('POST', '/api/watchlist?symbol=NOTREAL', {
      cookie,
    });

    expect(response.status).toBe(422);
    expect(response.body.error?.code).toBe('UNKNOWN_SYMBOL');
    expect(response.body.error?.message).toContain('NOTREAL');
  });

  it('refuses a bracketed query key instead of letting it become an operator', async () => {
    const { cookie } = await registerFresh();

    const response = await call('POST', '/api/watchlist?symbol[$ne]=x', {
      cookie,
    });

    expect(response.status).toBe(400);
  });

  it('lists what the directory knows about each entry', async () => {
    const { cookie } = await registerFresh();
    await call('POST', '/api/watchlist?symbol=RELIANCE', { cookie });

    const response = await call('GET', '/api/watchlist', { cookie });

    expect(response.body.data).toEqual([
      expect.objectContaining({
        symbol: 'RELIANCE',
        companyName: 'RELIANCE Limited',
        filingsHeld: 2,
        // The newest of the two seeded RELIANCE filings, in both forms: the
        // instant for the page's "how long ago", the IST text for the title.
        lastFiledAt: '2026-08-05T05:10:00.000Z',
        lastFiledAtIst: '2026-08-05 10:40:00',
      }),
    ]);
  });

  it('removes a symbol, and says so even when it was not there', async () => {
    const { cookie } = await registerFresh();
    await call('POST', '/api/watchlist?symbol=RELIANCE', { cookie });

    expect(
      (await call('DELETE', '/api/watchlist/RELIANCE', { cookie })).body.meta,
    ).toEqual({ used: 0, cap: 50 });
    expect(
      (await call('DELETE', '/api/watchlist/RELIANCE', { cookie })).status,
    ).toBe(200);
  });

  it('is origin-guarded on both mutations', async () => {
    const { cookie } = await registerFresh();

    expect(
      (
        await call('POST', '/api/watchlist?symbol=RELIANCE', {
          cookie,
          origin: 'http://evil.example',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('DELETE', '/api/watchlist/RELIANCE', {
          cookie,
          origin: 'http://evil.example',
        })
      ).status,
    ).toBe(403);
  });

  it('scopes every watchlist to its own session, with no way to name another', async () => {
    const asha = await registerFresh();
    const bala = await registerFresh();
    await call('POST', '/api/watchlist?symbol=RELIANCE', {
      cookie: asha.cookie,
    });

    const other = await call('GET', '/api/watchlist', { cookie: bala.cookie });

    expect(other.body.data).toEqual([]);
  });
});

describe('the Watching feed', () => {
  it('returns only the watched company filings, in the feed shape', async () => {
    const { cookie } = await registerFresh();
    await call('POST', '/api/watchlist?symbol=RELIANCE', { cookie });

    const response = await call('GET', '/api/watchlist/feed', { cookie });

    expect(
      (response.body.data as Array<{ symbol: string }>).map((f) => f.symbol),
    ).toEqual(['RELIANCE', 'RELIANCE']);
    expect(response.body.meta).toMatchObject({ total: 2, returned: 2 });
  });

  it('is empty rather than everything when nothing is watched', async () => {
    // A `$in: []` that fell back to "no filter" would show a reader the whole
    // market and call it their watchlist.
    const { cookie } = await registerFresh();

    const response = await call('GET', '/api/watchlist/feed', { cookie });

    expect(response.body.data).toEqual([]);
    expect(response.body.meta).toMatchObject({ total: 0 });
  });

  it('counts the unread on the first look and clears it afterwards', async () => {
    const { cookie } = await registerFresh();
    await call('POST', '/api/watchlist?symbol=RELIANCE', { cookie });

    const first = await call('GET', '/api/watchlist/feed', { cookie });
    const second = await call('GET', '/api/watchlist/feed', { cookie });

    // Never looked before means the whole set is unread — a badge reading 0
    // over a watchlist full of filings would be the page lying.
    expect((first.body.meta as { unread: number }).unread).toBe(2);
    expect((second.body.meta as { unread: number }).unread).toBe(0);
  });

  it('refuses a bad limit rather than silently defaulting the page', async () => {
    const { cookie } = await registerFresh();

    expect(
      (await call('GET', '/api/watchlist/feed?limit=abc', { cookie })).status,
    ).toBe(400);
  });

  it('carries every watched company, including one the page of filings left out', async () => {
    // THE REPORTED BUG, as a test. The feed is the newest `limit` filings
    // ACROSS the whole watchlist, so a company whose filings fall past that
    // cut had no row anywhere on the view and the reader could not tell
    // whether watching it had worked. TCS filed last of the three seeded
    // documents, so `limit=1` returns TCS and nothing of RELIANCE.
    const { cookie } = await registerFresh();
    await call('POST', '/api/watchlist?symbol=RELIANCE', { cookie });
    await call('POST', '/api/watchlist?symbol=TCS', { cookie });

    const response = await call('GET', '/api/watchlist/feed?limit=1', {
      cookie,
    });

    expect(
      (response.body.data as Array<{ symbol: string }>).map((f) => f.symbol),
    ).toEqual(['TCS']);
    const meta = response.body.meta as {
      watching: Array<{ symbol: string; lastFiledAt: string | null }>;
    };
    expect(meta.watching.map((row) => row.symbol)).toEqual(['RELIANCE', 'TCS']);
    expect(meta.watching[0].lastFiledAt).toBe('2026-08-05T05:10:00.000Z');
  });

  it('states the narrowing in numbers, so a short page is never silent', async () => {
    // `total` against `returned` is what the page turns into "the newest 1 of
    // 2". Without it the view narrows and says nothing, which is the bug.
    const { cookie } = await registerFresh();
    await call('POST', '/api/watchlist?symbol=RELIANCE', { cookie });

    const response = await call('GET', '/api/watchlist/feed?limit=1', {
      cookie,
    });

    expect(response.body.meta).toMatchObject({
      total: 2,
      returned: 1,
      hasMore: true,
    });
  });

  it('carries an empty roster rather than omitting it when nothing is watched', async () => {
    const { cookie } = await registerFresh();

    const response = await call('GET', '/api/watchlist/feed', { cookie });

    expect((response.body.meta as { watching: unknown[] }).watching).toEqual(
      [],
    );
  });
});

describe('the Bearer transport', () => {
  it('resolves the same session the cookie does', async () => {
    // ONE CREDENTIAL, TWO ENVELOPES. A script has no cookie jar, so the only
    // way it can present a session is a header — and if the two doors resolved
    // differently there would be two answers to "who is this request", which is
    // the thing `SessionService` exists to prevent.
    const { email, cookie } = await registerFresh();
    const token = cookie.split('=')[1];

    const viaCookie = await call('GET', '/api/me', { cookie });
    const viaBearer = await call('GET', '/api/me', { bearer: token });

    expect(viaBearer.status).toBe(200);
    expect((viaBearer.body.data as { email: string }).email).toBe(email);
    expect(viaBearer.body.data).toEqual(viaCookie.body.data);
  });

  it('refuses a Bearer token that was never minted', async () => {
    // Token-shaped and the right length, so it gets as far as the indexed read
    // and is refused for not being there rather than for not parsing.
    const response = await call('GET', '/api/watchlist', {
      bearer: 'Z'.repeat(43),
    });

    expect(response.status).toBe(401);
    expect(response.body.error?.code).toBe('UNAUTHENTICATED');
  });
});

describe('the rate limit', () => {
  it('fires on the auth routes after the per-minute burst', async () => {
    // THE LIMITER IS NOT DEFERRED TO THE EXPOSURE GATE. Credential stuffing
    // begins the hour a login endpoint exists.
    //
    // Runs last in the file and uses one address, because the throttler is
    // per-IP and every request in this suite comes from the same one.
    const email = freshEmail();
    const statuses: number[] = [];

    for (let i = 0; i < 14; i += 1) {
      statuses.push(
        (
          await call('POST', '/api/auth/login', {
            body: { email, password: `guess number ${i} here` },
          })
        ).status,
      );
    }

    expect(statuses).toContain(429);
    expect(statuses.filter((status) => status === 401).length).toBeLessThan(14);

    // AND IT ANSWERS IN THE SAME ENVELOPE AS EVERYTHING ELSE. Asserted in this
    // test rather than its own, because the counter is reset between tests —
    // and a second test that depended on the first one's leftovers would be a
    // test that passes for the wrong reason.
    const refused = await call('POST', '/api/auth/login', {
      body: { email, password: 'one more guess here' },
    });

    expect(refused.status).toBe(429);
    expect(refused.body.success).toBe(false);
    expect(refused.body.error?.code).toBe('RATE_LIMITED');
  });
});
