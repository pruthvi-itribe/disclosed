import axios, { type AxiosInstance } from 'axios';
import type { Filing } from '../filing.types';
import type {
  AdapterLogger,
  FetchResult,
  SessionProvider,
  SourceAdapter,
} from '../source-adapter.interface';
import { safeEcho } from '../logic/safe-echo';
import { mapNseRecord } from './nse.mapper';
import { toNseDateParam } from './nse-date-range';
import type { NseRawRecord } from './nse.types';

const BASE_PATH = '/api/corporate-announcements';
const ORIGIN = 'https://www.nseindia.com';
const LANDING = `${ORIGIN}/companies-listing/corporate-filings-announcements`;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 15_000;

/** Statuses that mean the cookie jar is stale rather than the feed is down. */
const AUTH_FAILURE_STATUSES: ReadonlySet<number> = new Set([401, 403]);

/**
 * The sentinel the endpoint answers with when it has no records, normalised.
 *
 * Recorded as `No Record Found!`. It is matched tolerantly - case, surrounding
 * and repeated whitespace, and the trailing exclamation - but not loosely: an
 * equality check rather than a substring test, so a longer message that merely
 * contains the phrase still surfaces as a fault instead of being reported as an
 * empty day. Getting that wrong turns a contract change into silent data loss.
 */
const NO_RECORDS_MARKER = 'no record found';

const normaliseMarker = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, ' ').replace(/!+$/, '').trim();

/**
 * Distinguishes "the exchange had nothing" from "the exchange said something
 * unexpected". Both arrive as a non-array body, but only the second is a fault:
 * a market holiday or a pre-open drain is a normal empty day and must not put
 * the poller into an alarm state.
 */
const isNoRecordsMarker = (data: unknown): boolean =>
  typeof data === 'string' && normaliseMarker(data) === NO_RECORDS_MARKER;

/**
 * Identifies a record in a skip log without trusting it.
 *
 * Takes `unknown` on purpose: a page element can be null, a string or a number,
 * so reading `.seq_id` directly would throw from inside the catch block and turn
 * one bad record into a lost page. Echoed through `safeEcho` because the value
 * is NSE-supplied and lands in a log.
 */
const seqIdLabel = (raw: unknown): string => {
  const seqId =
    typeof raw === 'object' && raw !== null
      ? (raw as { seq_id?: unknown }).seq_id
      : undefined;

  return typeof seqId === 'string' && seqId.trim()
    ? `seq_id=${safeEcho(seqId.trim())}`
    : 'seq_id=unknown';
};

/**
 * `(error as Error).message` is unsound - a non-Error throw would render as
 * `undefined` and erase the only clue the log carries.
 */
const describeError = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : `non-Error throw: ${safeEcho(String(error))}`;

/**
 * Attaches `cause` with ES2022 semantics.
 *
 * The project targets ES2021, so the `new Error(message, { cause })` options bag
 * does not type-check. Defining the property is the same thing at runtime, and
 * non-enumerable is the part that matters: an enumerable `cause` would drag a
 * fully serialised AxiosError into any log line that spreads or JSON-stringifies
 * the error.
 */
const withCause = (error: Error, cause: unknown): Error => {
  Object.defineProperty(error, 'cause', {
    value: cause,
    configurable: true,
    writable: true,
    enumerable: false,
  });
  return error;
};

/**
 * Serialises a payload for an error message, defensively.
 *
 * `JSON.stringify` returns undefined for `undefined` and throws on a circular
 * structure; this is called while building an error, where a second throw would
 * replace the diagnostic with a bare TypeError.
 */
const stringify = (data: unknown): string => {
  try {
    return JSON.stringify(data) ?? String(data);
  } catch {
    return typeof data;
  }
};

/**
 * Describes a non-array payload without echoing an unbounded NSE body.
 *
 * An object body is serialised rather than rendered as `object`: when NSE
 * answers `{"error":"..."}` that content is the only record of what it actually
 * said. `safeEcho` bounds and de-fangs it either way.
 */
const describePayload = (data: unknown): string =>
  typeof data === 'string' ? `"${safeEcho(data)}"` : safeEcho(stringify(data));

export class NseAdapter implements SourceAdapter {
  private readonly http: AxiosInstance;

  /**
   * `logger` is required, not optional with a framework default. This library
   * holds pure logic and owns no dependency on a DI container, and a defaulted
   * logger would let a caller drop skip visibility by forgetting an argument -
   * the one signal that says filings are being discarded.
   */
  constructor(
    private readonly session: SessionProvider,
    private readonly logger: AdapterLogger,
    http?: AxiosInstance,
  ) {
    this.http =
      http ??
      axios.create({
        baseURL: ORIGIN,
        timeout: REQUEST_TIMEOUT_MS,
        headers: { 'User-Agent': UA, Referer: LANDING, Accept: '*/*' },
        // Non-2xx must reject so the retry path and circuit breaker can see it.
        validateStatus: (status) => status >= 200 && status < 300,
      });
  }

  async fetchLatest(): Promise<FetchResult> {
    return this.fetch({ index: 'equities' });
  }

  async fetchDay(date: Date): Promise<FetchResult> {
    const day = toNseDateParam(date);
    return this.fetch({ index: 'equities', from_date: day, to_date: day });
  }

  /** Issues the request, retrying exactly once after a session refresh on 401/403. */
  private async fetch(params: Record<string, string>): Promise<FetchResult> {
    try {
      return await this.request(params);
    } catch (error) {
      if (!this.isAuthFailure(error)) throw error;
      this.session.invalidate();
      try {
        return await this.request(params);
      } catch (retryError) {
        // The cause carries the AxiosError through, so a breaker can read the
        // status off it rather than pattern-matching this message.
        throw withCause(
          new Error(
            `NSE request failed after session refresh: ${describeError(retryError)}`,
          ),
          retryError,
        );
      }
    }
  }

  private async request(params: Record<string, string>): Promise<FetchResult> {
    const cookie = await this.session.getCookieHeader();
    const response = await this.http.get<unknown>(BASE_PATH, {
      params,
      headers: { Cookie: cookie },
    });
    const data: unknown = response.data;

    // The endpoint answers with a bare JSON string instead of an error status
    // when it has nothing to give. An empty day is not a fault, so it returns
    // the same shape an empty array would: received 0, skipped 0, no filings.
    if (isNoRecordsMarker(data)) {
      return this.mapPage([]);
    }

    // Anything else non-array is a genuine fault - a block page, an error
    // object, or a changed contract - and must reach the caller as a throw.
    if (!Array.isArray(data)) {
      throw new Error(`Unexpected NSE payload: ${describePayload(data)}`);
    }

    return this.mapPage(data as readonly unknown[]);
  }

  /**
   * Maps a page, dropping the records that cannot become Filings.
   *
   * A single malformed record must not discard the whole batch, but a silently
   * dropped one is the exact loss this pipeline exists to prevent. So every skip
   * is logged individually, a summary line makes a wholly rejected page visible
   * without reading them all, and the counts are returned so the caller can
   * alarm on the condition instead of only reading it in a log.
   */
  private mapPage(records: readonly unknown[]): FetchResult {
    const filings: Filing[] = [];
    for (const raw of records) {
      const filing = this.mapOrSkip(raw);
      if (filing) filings.push(filing);
    }

    const skipped = records.length - filings.length;
    if (skipped > 0) {
      this.warn(
        `Skipped ${skipped} of ${records.length} NSE records as unmappable`,
      );
    }

    return {
      filings: filings.sort((a, b) => b.seqId - a.seqId),
      received: records.length,
      skipped,
    };
  }

  private mapOrSkip(raw: unknown): Filing | null {
    try {
      // The cast is the untrusted boundary: NseRawRecord is a compile-time
      // shape only and mapNseRecord is the runtime validator behind it.
      return mapNseRecord(raw as NseRawRecord);
    } catch (error) {
      // Deliberately unconditional. mapNseRecord does not guard against a null
      // or non-object `raw`, which escapes as a bare TypeError rather than a
      // "Malformed NSE record" error, so matching on the message shape here
      // would let that one element crash the page.
      this.warn(
        `Skipped unmappable NSE record (${seqIdLabel(raw)}): ${describeError(error)}`,
      );
      return null;
    }
  }

  /** A failing log sink must not turn a recoverable skip into a lost page. */
  private warn(message: string): void {
    try {
      this.logger.warn(message);
    } catch {
      // Nothing left to report it to.
    }
  }

  private isAuthFailure(error: unknown): boolean {
    const status = axios.isAxiosError(error)
      ? error.response?.status
      : undefined;
    return status !== undefined && AUTH_FAILURE_STATUSES.has(status);
  }
}
