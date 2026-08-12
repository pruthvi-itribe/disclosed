import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { readTrustProxy } from '../config/configuration';
import { DashboardModule } from '../dashboard.module';

/**
 * WHAT `TRUST_PROXY` ACTUALLY CHANGES ON THE WIRE.
 *
 * Real HTTP against the real module, because every claim being made here is a
 * claim about express's own resolution — `req.secure` from `X-Forwarded-Proto`,
 * `req.ip` and `req.ips` from `X-Forwarded-For` and the accepted socket — and a
 * unit test that hands those values over proves arithmetic rather than the
 * behaviour that ships.
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
}, 180_000);

// Every test states its own posture; none inherits the last one's.
beforeEach(() => trustProxy(undefined));

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
