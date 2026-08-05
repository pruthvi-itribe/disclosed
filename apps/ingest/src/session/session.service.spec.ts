import { Logger } from '@nestjs/common';
import nock from 'nock';
import { SessionService } from './session.service';

const HOST = 'https://www.nseindia.com';
const PATH = '/companies-listing/corporate-filings-announcements';

const TTL_MS = 10 * 60 * 1000;

describe('SessionService', () => {
  let service: SessionService;
  let now: number;
  let clock: jest.SpyInstance<number, []>;

  beforeAll(() => {
    // Any request this suite forgets to mock must fail loudly rather than reach
    // the exchange.
    nock.disableNetConnect();
    Logger.overrideLogger(false);
  });

  beforeEach(() => {
    nock.cleanAll();
    now = Date.UTC(2026, 7, 5, 6, 0, 0);
    clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
    service = new SessionService();
  });

  afterEach(() => clock.mockRestore());

  afterAll(() => {
    nock.enableNetConnect();
    nock.restore();
  });

  const replyWithCookies = (cookies: string[]) =>
    nock(HOST).get(PATH).reply(200, '<html></html>', { 'set-cookie': cookies });

  it('bootstraps from the landing page and keeps only the cookie pairs', async () => {
    replyWithCookies([
      'nsit=abc123; path=/; HttpOnly',
      'bm_sv=xyz789; Domain=.nseindia.com; Secure',
    ]);

    await expect(service.getCookieHeader()).resolves.toBe(
      'nsit=abc123; bm_sv=xyz789',
    );
  });

  it('reuses the cached header inside the TTL without a second request', async () => {
    const scope = replyWithCookies(['nsit=abc123; path=/']);

    const first = await service.getCookieHeader();
    now += TTL_MS - 1;
    const second = await service.getCookieHeader();

    expect(second).toBe(first);
    expect(scope.isDone()).toBe(true);
    expect(nock.pendingMocks()).toHaveLength(0);
  });

  it('re-bootstraps once the TTL has elapsed', async () => {
    replyWithCookies(['nsit=first; path=/']);
    replyWithCookies(['nsit=second; path=/']);

    await expect(service.getCookieHeader()).resolves.toBe('nsit=first');
    now += TTL_MS;
    await expect(service.getCookieHeader()).resolves.toBe('nsit=second');
  });

  it('re-bootstraps after invalidate even inside the TTL', async () => {
    replyWithCookies(['nsit=first; path=/']);
    replyWithCookies(['nsit=second; path=/']);

    await expect(service.getCookieHeader()).resolves.toBe('nsit=first');
    service.invalidate();
    await expect(service.getCookieHeader()).resolves.toBe('nsit=second');
  });

  it('collapses concurrent refreshes into a single bootstrap', async () => {
    // Only one interceptor is registered: with net connect disabled, a second
    // real request would reject rather than silently succeed.
    replyWithCookies(['nsit=abc123; path=/']);

    const [a, b, c] = await Promise.all([
      service.getCookieHeader(),
      service.getCookieHeader(),
      service.getCookieHeader(),
    ]);

    expect([a, b, c]).toEqual(['nsit=abc123', 'nsit=abc123', 'nsit=abc123']);
    expect(nock.pendingMocks()).toHaveLength(0);
  });

  it('throws when the landing page returns no cookies', async () => {
    nock(HOST).get(PATH).reply(200, '<html></html>');

    await expect(service.getCookieHeader()).rejects.toThrow(
      /returned no cookies/,
    );
  });

  it('does not cache a failed bootstrap', async () => {
    nock(HOST).get(PATH).reply(403, 'Access Denied');
    replyWithCookies(['nsit=recovered; path=/']);

    await expect(service.getCookieHeader()).rejects.toThrow();
    await expect(service.getCookieHeader()).resolves.toBe('nsit=recovered');
  });
});
