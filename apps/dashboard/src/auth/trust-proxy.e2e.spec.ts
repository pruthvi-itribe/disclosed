import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageOptions } from '@nestjs/throttler/dist/throttler-storage-options.interface';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { readTrustProxy } from '../config/configuration';
import { DashboardModule } from '../dashboard.module';

/**
 * WHAT `TRUST_PROXY` ACTUALLY CHANGES ON THE WIRE.
 *
 * Real HTTP against the real module, because every claim being made here is a
 * claim about express's own resolution — `req.secure` from `X-Forwarded-Proto`,
 * `req.ip` and `req.ips` from `X-Forwarded-For` and the accepted socket — and a
 * unit test that hands those values over proves the tracker's arithmetic rather
 * than the behaviour that ships. `client-key.spec.ts` does the arithmetic.
 *
 * THE SETTING IS FLIPPED PER TEST rather than by booting three applications.
 * Express reads `trust proxy` per request, and `main.ts` sets it from exactly
 * the value `readTrustProxy` returns — which is what these tests hand it, so
 * the path from an environment variable to a resolved address is the shipped
 * one end to end. What is not covered is `main.ts` itself reading the config
 * field, which is composition and has no test in this repository.
 */

jest.setTimeout(180_000);

let mongo: MongoMemoryServer;
let app: INestApplication;
let origin: string;
let express: { set: (setting: string, value: unknown) => void };
let throttled: { storage: Record<string, ThrottlerStorageOptions> };

/**
 * Above `auth.e2e.spec.ts`'s 7791 for the same reason that one is above the
 * dashboard's 7717: `PUBLIC_ORIGIN` has to be known before the module is
 * compiled, so the port cannot be whatever `listen(0)` hands back.
 */
const TEST_PORT = 7793;

/** What `AUTH_MODE` was before this suite pinned it, restored afterwards. */
let priorAuthMode: string | undefined;

/**
 * Points express at a `TRUST_PROXY` value, through the reader the process uses.
 *
 * `undefined` is the unset key, and the value it produces — `false` — is
 * express's own default, so the "no trust" tests are testing the shipped
 * loopback posture rather than an approximation of it.
 */
const trustProxy = (value: string | undefined): void => {
  express.set(
    'trust proxy',
    readTrustProxy(value === undefined ? {} : { TRUST_PROXY: value }),
  );
};

/**
 * Forgets every counted request. Every request in this suite arrives from
 * 127.0.0.1, so without this the file's own earlier tests would be the
 * attacker the limiter refuses.
 */
const forgetRequestCounts = (): void => {
  for (const key of Object.keys(throttled.storage)) {
    delete throttled.storage[key];
  }
};

/**
 * One counted request against the auth buckets.
 *
 * `POST /api/auth/login` for an account that does not exist, which answers
 * `REFUSED` — the enumeration-resistant 401 that an unknown address and a wrong
 * password share, verified against a dummy hash so the two take the same time
 * (`password-hash.ts`). Nothing in this file is about that; what matters is
 * that the request is COUNTED, and the status changing to 429 is how each test
 * reads which bucket it landed in.
 */
const counted = async (
  headers: Record<string, string> = {},
): Promise<number> => {
  const response = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Origin: origin,
      ...headers,
    },
    body: JSON.stringify({ email: 'not-an-address', password: 'irrelevant' }),
  });
  return response.status;
};

/** The auth-minute bucket's whole allowance. */
const AUTH_MINUTE_LIMIT = 10;

/** What a counted request answers while it is still inside the allowance. */
const REFUSED = 401;

/** Spends one identity's entire allowance, asserting nothing was refused early. */
const exhaust = async (headers: Record<string, string>): Promise<void> => {
  for (let attempt = 0; attempt < AUTH_MINUTE_LIMIT; attempt += 1) {
    expect(await counted(headers)).toBe(REFUSED);
  }
};

/** Registers, and reports the Set-Cookie the session was minted into. */
const registerCookie = async (
  headers: Record<string, string>,
): Promise<string> => {
  const response = await fetch(`${origin}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Origin: origin,
      ...headers,
    },
    body: JSON.stringify({
      email: freshEmail(),
      password: 'rhubarb tuesday lantern',
    }),
  });

  expect(response.status).toBe(201);
  return String(response.headers.get('set-cookie'));
};

let counter = 0;
const freshEmail = (): string => {
  counter += 1;
  return `proxy${counter}@example.com`;
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri('turret');
  origin = `http://127.0.0.1:${TEST_PORT}`;
  process.env.PUBLIC_ORIGIN = origin;

  // Pinned for the reason `auth.e2e.spec.ts` records: with `AUTH_MODE` unset,
  // a machine carrying FIREBASE_* keys resolves to firebase, where the register
  // route answers 409 on purpose.
  priorAuthMode = process.env.AUTH_MODE;
  process.env.AUTH_MODE = 'local';

  const moduleRef = await Test.createTestingModule({
    imports: [DashboardModule],
  }).compile();

  app = moduleRef.createNestApplication({ bodyParser: false });
  await app.listen(TEST_PORT, '127.0.0.1');

  express = app.getHttpAdapter().getInstance() as typeof express;
  throttled = app.get<ThrottlerStorage>(ThrottlerStorage) as unknown as {
    storage: Record<string, ThrottlerStorageOptions>;
  };
}, 180_000);

beforeEach(() => {
  forgetRequestCounts();
  // Every test states its own posture; none inherits the last one's.
  trustProxy(undefined);
});

afterAll(async () => {
  await app.close();
  await mongo.stop();
  delete process.env.MONGO_URI;
  delete process.env.PUBLIC_ORIGIN;
  if (priorAuthMode === undefined) delete process.env.AUTH_MODE;
  else process.env.AUTH_MODE = priorAuthMode;
}, 60_000);

describe('the session cookie, with no TRUST_PROXY', () => {
  it('ships without Secure even when the request claims https', async () => {
    // THE SHIPPED LOOPBACK POSTURE. The header is not read at all, so a caller
    // cannot talk this process into an attribute that would make the browser
    // discard the cookie it just set — after which the login presents as
    // succeeding and immediately forgetting you.
    const cookie = await registerCookie({ 'X-Forwarded-Proto': 'https' });

    expect(cookie).toContain('turret_sid=');
    expect(cookie).not.toContain('Secure');
  });
});

describe('the session cookie, with TRUST_PROXY set', () => {
  it('carries Secure when the trusted chain says https', async () => {
    trustProxy('1');

    expect(await registerCookie({ 'X-Forwarded-Proto': 'https' })).toContain(
      'Secure',
    );
  });

  it('still omits Secure when the trusted chain says http', async () => {
    // Trusting a proxy is not asserting TLS. In production the value comes from
    // ingress-nginx's own `$scheme` and the client's copy was overwritten a hop
    // earlier, so this is the branch that says the attribute follows the chain
    // rather than the setting.
    trustProxy('1');

    expect(await registerCookie({ 'X-Forwarded-Proto': 'http' })).not.toContain(
      'Secure',
    );
  });

  it('omits Secure when the chain forwarded no scheme at all', async () => {
    trustProxy('1');

    expect(await registerCookie({})).not.toContain('Secure');
  });
});

describe('the rate-limit identity: a spoofed X-Forwarded-For', () => {
  /**
   * ONE HOP TRUSTED, which in this suite is the socket 127.0.0.1 came in on.
   * Express then stops its right-to-left walk at the last entry of the
   * forwarded header, and everything the caller prepended is to the left of
   * that and is read past.
   */
  const TRUSTED_HOPS = '1';

  it('counts the resolved hop, not the address the caller prepended', async () => {
    trustProxy(TRUSTED_HOPS);

    await exhaust({ 'X-Forwarded-For': '9.9.9.9, 203.0.113.7' });
    expect(await counted({ 'X-Forwarded-For': '9.9.9.9, 203.0.113.7' })).toBe(
      429,
    );

    // A DIFFERENT SPOOF, THE SAME BUCKET. If the prepended value were reaching
    // the tracker this would be a fresh identity with a full allowance, which
    // is precisely the evasion the resolution order exists to prevent.
    expect(await counted({ 'X-Forwarded-For': '8.8.8.8, 203.0.113.7' })).toBe(
      429,
    );
    expect(await counted({ 'X-Forwarded-For': '203.0.113.7' })).toBe(429);
  });

  it('gives a genuinely different resolved hop its own allowance', async () => {
    trustProxy(TRUSTED_HOPS);

    await exhaust({ 'X-Forwarded-For': '9.9.9.9, 203.0.113.7' });
    expect(await counted({ 'X-Forwarded-For': '9.9.9.9, 203.0.113.7' })).toBe(
      429,
    );

    // The half that makes the assertion above mean something: the limiter is
    // keyed on something, and that something is the entry at the trust
    // boundary.
    expect(await counted({ 'X-Forwarded-For': '9.9.9.9, 198.51.100.5' })).toBe(
      REFUSED,
    );
  });
});

describe('the rate-limit identity: CF-Connecting-IP', () => {
  it('is ignored with no TRUST_PROXY, however the request is dressed', async () => {
    // Loopback and the AUTH_MODE=local e2e suite both live here. A caller that
    // could name its own bucket would have no rate limit at all.
    await exhaust({ 'CF-Connecting-IP': '49.37.200.11' });
    expect(await counted({ 'CF-Connecting-IP': '49.37.200.11' })).toBe(429);

    // A different claimed client, and still the same bucket: 127.0.0.1.
    expect(await counted({ 'CF-Connecting-IP': '49.37.200.12' })).toBe(429);
  });

  it('separates two readers once a trusted chain resolved the request', async () => {
    // PRODUCTION'S RATE-LIMIT KEY. ingress-nginx replaces X-Forwarded-For with
    // the load balancer's address, so without this header every reader shares
    // one bucket and one fumbled password locks out everyone.
    trustProxy('2');

    const chain = { 'X-Forwarded-For': '10.110.0.4, 10.244.1.9' };

    await exhaust({ ...chain, 'CF-Connecting-IP': '49.37.200.11' });
    expect(
      await counted({ ...chain, 'CF-Connecting-IP': '49.37.200.11' }),
    ).toBe(429);

    expect(
      await counted({ ...chain, 'CF-Connecting-IP': '49.37.200.12' }),
    ).toBe(REFUSED);
  });

  it('falls back to the resolved hop when the header is not an address', async () => {
    trustProxy('2');

    const chain = { 'X-Forwarded-For': '10.110.0.4, 10.244.1.9' };

    // Exhausted under the fallback identity, which is the resolved hop.
    await exhaust({ ...chain, 'CF-Connecting-IP': 'nonsense' });
    expect(await counted({ ...chain })).toBe(429);
  });
});
