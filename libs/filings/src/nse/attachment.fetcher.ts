import axios, { type AxiosInstance } from 'axios';

/**
 * Downloads a filing's attachment from NSE's archive host, politely and with a
 * hard ceiling on how much of it will be read.
 *
 * SEPARATE FROM `NseAdapter` ON PURPOSE. That class talks to the JSON API on
 * `www.nseindia.com`, which needs a landing-page cookie handshake and answers
 * with a page of records. The archive host is a different service with
 * different behaviour: it served all 60 sampled requests cold, unauthenticated
 * and first try, with no cookie and no Akamai challenge. Sharing the session
 * machinery would couple a working path to one that can go stale, and would
 * spend a session refresh on a 403 that is really rate limiting.
 *
 * WHAT IS LOAD-BEARING HERE:
 *
 *   - **The size cap.** File sizes are median 619 KB but reach 22.2 MB. One
 *     22 MB document on a slow link is a worker doing nothing else for its
 *     duration, and the cap is enforced twice — on the advertised
 *     `content-length` before a byte of body is read, and by axios during the
 *     transfer for a response that lies or omits it.
 *   - **The browser identity.** A Chrome `User-Agent` and
 *     `Referer: https://www.nseindia.com/`. Measured across 60 requests at
 *     ~2.5 req/s with zero 403s — but 60 requests prove nothing about
 *     thousands, so the politeness is treated as load-bearing rather than
 *     decorative. The PACING lives in the worker, which is the thing that
 *     knows how many documents are queued.
 *   - **Failures are values.** Every failure comes back as a result carrying
 *     the HTTP status, because the status is what decides retry-versus-terminal
 *     and an exception would lose it inside a message string.
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** The exchange's own filings page. NSE's archive host expects to see it. */
export const ATTACHMENT_REFERER = 'https://www.nseindia.com/';

/**
 * Bytes beyond which a document is refused unread.
 *
 * 25 MB clears the largest observed attachment (22.2 MB) with headroom. The
 * point is not the exact number but that one exists: without it the worker's
 * throughput is set by the largest document NSE ever publishes.
 */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/**
 * Per-request ceiling. The measured p99 for download alone is 3.4s and the
 * worst observed is 7.2s, so 30s is a stall detector rather than a deadline.
 */
export const ATTACHMENT_TIMEOUT_MS = 30_000;

export interface AttachmentOk {
  readonly outcome: 'ok';
  readonly body: Buffer;
  readonly bytes: number;
  readonly contentType: string | null;
}

export interface AttachmentOversized {
  readonly outcome: 'oversized';
  /** The advertised size when the header carried one; null when it did not. */
  readonly bytes: number | null;
}

export interface AttachmentFailed {
  readonly outcome: 'failed';
  /** Null when the request never got a response: timeout, DNS, reset socket. */
  readonly status: number | null;
  readonly message: string;
}

export type AttachmentResult =
  AttachmentOk | AttachmentOversized | AttachmentFailed;

/**
 * How axios reports a body that outgrew `maxContentLength` mid-transfer.
 *
 * BOTH forms are matched because axios has used both. Older releases raise
 * `ERR_FR_MAX_CONTENT_LENGTH_EXCEEDED`; the version in this tree raises the
 * generic `ERR_BAD_RESPONSE` and puts the fact in the message. Matching only
 * the code would silently reclassify every oversized document as a retryable
 * transport failure — five wasted fetches of a 22 MB file, then `failed`
 * instead of `unparseable`.
 */
const MAX_CONTENT_LENGTH_CODE = 'ERR_FR_MAX_CONTENT_LENGTH_EXCEEDED';
const MAX_CONTENT_LENGTH_MESSAGE = /maxContentLength size of \d+ exceeded/i;

const headerString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

export class AttachmentFetcher {
  private readonly http: AxiosInstance;

  constructor(
    private readonly maxBytes: number = MAX_ATTACHMENT_BYTES,
    http?: AxiosInstance,
  ) {
    this.http =
      http ??
      axios.create({
        timeout: ATTACHMENT_TIMEOUT_MS,
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': UA,
          Referer: ATTACHMENT_REFERER,
          Accept: 'application/pdf,application/octet-stream,*/*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        // The second half of the size cap: enforced by axios during the
        // transfer, for a response whose content-length is absent or lying.
        maxContentLength: this.maxBytes,
        maxBodyLength: this.maxBytes,
        // Never follow a redirect off the archive host. `decideAttachment`
        // checked the host of the URL we were GIVEN; a 302 would move the fetch
        // to a host nothing checked, which is the whole point of having an
        // allowlist. A redirect therefore arrives here as a 3xx status and is
        // classified like any other unusable response.
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 300,
      });
  }

  /**
   * Fetches one attachment.
   *
   * PRECONDITION: `url` has already been through `decideAttachment`, which is
   * what confirms the scheme and the host. This method does not re-check —
   * putting the allowlist in two places would let them disagree — so it must
   * never be called with a URL from anywhere else.
   */
  async fetch(url: string): Promise<AttachmentResult> {
    try {
      const response = await this.http.get<ArrayBuffer>(url);
      const body = Buffer.from(response.data);

      // Belt and braces against a stream that slipped past axios: the buffer
      // itself is measured, not the header.
      if (body.length > this.maxBytes) {
        return { outcome: 'oversized', bytes: body.length };
      }

      return {
        outcome: 'ok',
        body,
        bytes: body.length,
        contentType: headerString(response.headers['content-type']),
      };
    } catch (error) {
      return this.describeFailure(error);
    }
  }

  private describeFailure(error: unknown): AttachmentResult {
    if (!axios.isAxiosError(error)) {
      return {
        outcome: 'failed',
        status: null,
        message: error instanceof Error ? error.message : String(error),
      };
    }

    if (
      error.code === MAX_CONTENT_LENGTH_CODE ||
      MAX_CONTENT_LENGTH_MESSAGE.test(error.message ?? '')
    ) {
      // Axios aborts the stream, so there is no response object to read a
      // content-length from. Null means "bigger than the cap, exact size
      // unknown", which is the honest answer and is all the caller needs: the
      // verdict is terminal either way.
      const advertised = Number(error.response?.headers?.['content-length']);
      return {
        outcome: 'oversized',
        bytes: Number.isFinite(advertised) ? advertised : null,
      };
    }

    return {
      outcome: 'failed',
      status: error.response?.status ?? null,
      message: error.message,
    };
  }
}
