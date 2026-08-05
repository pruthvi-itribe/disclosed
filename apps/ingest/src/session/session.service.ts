import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import type { SessionProvider } from '@app/filings';

const LANDING =
  'https://www.nseindia.com/companies-listing/corporate-filings-announcements';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const REQUEST_TIMEOUT_MS = 15_000;

/** Cookies live ~30 min in practice; refresh well before that. */
const TTL_MS = 10 * 60 * 1000;

/**
 * Reduces a `set-cookie` response header to the `name=value; name=value` form a
 * request header takes, discarding the attributes (path, Domain, HttpOnly).
 *
 * Reads the header as `unknown`: axios types it as a string array, but the value
 * is remote-controlled and a malformed response must not throw from inside the
 * bootstrap path.
 */
const toCookieHeader = (raw: unknown): string => {
  const cookies: readonly unknown[] = Array.isArray(raw) ? raw : [];
  return cookies
    .map((cookie) => String(cookie).split(';')[0].trim())
    .filter((pair) => pair.length > 0)
    .join('; ');
};

/**
 * Holds the NSE bot-management cookie jar for the adapter.
 *
 * NSE fronts the announcements API with Akamai: the API answers 401/403 unless
 * the request carries cookies minted by a prior landing-page visit. This service
 * owns that bootstrap, so `NseAdapter` never learns how the cookies are obtained
 * and a vendor feed can drop in without it.
 */
@Injectable()
export class SessionService implements SessionProvider {
  private readonly logger = new Logger(SessionService.name);
  private cookieHeader: string | null = null;
  private fetchedAt = 0;
  private inFlight: Promise<string> | null = null;

  async getCookieHeader(): Promise<string> {
    const cached = this.cookieHeader;
    if (cached && Date.now() - this.fetchedAt < TTL_MS) return cached;

    // Collapse concurrent refreshes so a burst of polls issues one bootstrap.
    // The assignment expression yields the shared promise, so every caller in
    // the burst awaits the same request.
    return (this.inFlight ??= this.bootstrap().finally(() => {
      this.inFlight = null;
    }));
  }

  /**
   * Drops the cached jar so the next call re-bootstraps. Called by the adapter
   * on a 401/403.
   *
   * A bootstrap already in flight is deliberately left running: it postdates the
   * request that failed, so awaiting it is cheaper than starting a third one. The
   * narrow race - an invalidate landing mid-flight - costs one more 401 and one
   * more retry, never a lost filing.
   */
  invalidate(): void {
    this.logger.warn('Session invalidated; next request will re-bootstrap');
    this.cookieHeader = null;
    this.fetchedAt = 0;
  }

  private async bootstrap(): Promise<string> {
    const response = await axios.get(LANDING, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      timeout: REQUEST_TIMEOUT_MS,
    });

    const header = toCookieHeader(response.headers['set-cookie']);
    if (!header) {
      // Failing here rather than returning '' keeps the adapter's 401 retry from
      // burning its one attempt on a request that cannot possibly authenticate.
      throw new Error('NSE landing page returned no cookies');
    }

    this.cookieHeader = header;
    this.fetchedAt = Date.now();
    this.logger.log('NSE session bootstrapped');
    return header;
  }
}
