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
 *   - **The size cap, which is a DENIAL-OF-SERVICE BOUND AND NOTHING ELSE.**
 *     It used to be justified as a throughput control and that justification
 *     was measured and found false. The 8 filings the old 25 MB cap refused
 *     were re-fetched at their true sizes (25.05 MB to 41.52 MB) and every one
 *     of them parsed, in 0.185 s to 1.400 s — they are big because they are
 *     image scans, and image scans carry almost no text to extract. The
 *     document that actually costs 39.7 seconds and 501 MB of RSS is a
 *     640-page annual report of 19.6 MB, which passed the cap comfortably. So
 *     bytes do not predict parse cost, the parse budget lives in
 *     `pdf-text.ts` where it can see pages, and what remains here is the one
 *     thing a byte cap is genuinely for: an unbounded download is a
 *     denial-of-service on our own worker.
 *   - **The transfer is streamed and counted.** The old `arraybuffer` mode let
 *     axios abort the stream on the cap, which left no response to read a
 *     `content-length` from — so every one of the 8 refusals recorded
 *     `bytes: null` and the collection could not say how far over the cap
 *     anything was. Counting chunks as they arrive means the refusal carries
 *     the real number, and it also means a response that lies about its
 *     `content-length` is stopped at the same byte as one that tells the truth.
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
 * 64 MiB, and it is a denial-of-service bound rather than a throughput one.
 *
 * The previous 25 MiB was set from a corpus whose largest attachment was
 * 22.2 MB, and it then refused 8 live filings — including Swiggy's actual
 * Capital Markets Day deck. Their true sizes, measured by HEAD against the
 * archive host: 25.05, 25.05, 25.28, 26.10, 26.10, 27.71, 27.94 and 41.52 MB.
 * Five of the six distinct documents cleared the old cap by 4-12%, which is a
 * cap sitting exactly where the distribution is, not beyond it.
 *
 * 64 MiB is roughly 1.6x the largest document this pipeline has ever seen, so
 * it bounds a runaway response while leaving real filings alone. The parse cost
 * a cap like this used to be blamed for is bounded separately and properly by
 * `MAX_PDF_PAGES`, because bytes were measured not to predict it.
 */
export const MAX_ATTACHMENT_BYTES = 64 * 1024 * 1024;

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
  /**
   * How big the document really is, or how much of it had arrived before the
   * transfer was cut.
   *
   * Null ONLY when the response advertised nothing and the failure happened
   * before a byte was counted, which no observed response has done. Every one
   * of the 8 filings the old cap refused recorded null here, because aborting
   * an `arraybuffer` request destroys the response object the size would have
   * come from — so a stored refusal could not say whether it had missed by a
   * kilobyte or by a gigabyte.
   */
  readonly bytes: number | null;
  /** True when `bytes` is the whole document, false when it is what arrived. */
  readonly advertised: boolean;
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
 *
 * Still matched even though this class now enforces its own cap while reading
 * the stream: `maxContentLength` remains set as a second line, and a future
 * axios that started applying it to streams must not be read as a timeout.
 */
const MAX_CONTENT_LENGTH_CODE = 'ERR_FR_MAX_CONTENT_LENGTH_EXCEEDED';
const MAX_CONTENT_LENGTH_MESSAGE = /maxContentLength size of \d+ exceeded/i;

/** The marker this class throws to unwind out of a stream it is cutting off. */
const OVERSIZED = Symbol('oversized');

interface OversizedSignal {
  readonly [OVERSIZED]: true;
  readonly bytes: number;
  readonly advertised: boolean;
}

const isOversizedSignal = (value: unknown): value is OversizedSignal =>
  typeof value === 'object' && value !== null && OVERSIZED in value;

const headerString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

/**
 * The advertised body size, or null when the header is absent or unusable.
 *
 * A negative or non-integer `content-length` is treated as absent rather than
 * trusted: the counter below is the authority, and a header this cannot read is
 * a header it must not act on.
 */
const advertisedBytes = (value: unknown): number | null => {
  const header = headerString(value);
  // The empty-string check is load-bearing and not defensive noise:
  // `Number(null)` and `Number('')` are both 0, so a missing header would
  // otherwise advertise a zero-byte body — which passes the cap, reports
  // `advertised: true`, and tells an operator a refused document was 0 bytes.
  if (header === null || header.trim().length === 0) return null;
  const raw = Number(header);
  return Number.isInteger(raw) && raw >= 0 ? raw : null;
};

/**
 * The minimal stream shape this class consumes.
 *
 * Declared rather than imported from `node:stream` so a test can hand over a
 * plain async iterable and never construct a real socket.
 */
type BodyStream = AsyncIterable<Buffer | Uint8Array> & {
  destroy?: (error?: Error) => void;
};

const isBodyStream = (value: unknown): value is BodyStream =>
  typeof value === 'object' &&
  value !== null &&
  Symbol.asyncIterator in (value as object);

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
        // STREAM, not `arraybuffer`. The cap is enforced against a running
        // count below, which is what makes an oversized refusal able to state
        // a size — and what stops a 400 MB response being fully materialised
        // in memory before anybody looks at how big it is.
        responseType: 'stream',
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
      const response = await this.http.get<unknown>(url);
      const contentType = headerString(response.headers['content-type']);
      const advertised = advertisedBytes(response.headers['content-length']);

      // THE CHEAP REFUSAL, kept because it costs nothing and saves everything:
      // a truthful header lets the whole body go unread. The counter below is
      // what handles a header that is absent, or lying.
      if (advertised !== null && advertised > this.maxBytes) {
        this.discard(response.data);
        return { outcome: 'oversized', bytes: advertised, advertised: true };
      }

      if (!isBodyStream(response.data)) {
        // A transport that answered with something this cannot iterate has
        // changed contract underneath us. Refusing beats guessing: reading a
        // non-stream as bytes here is how an empty document becomes a filing
        // recorded as unreadable rather than as a bug.
        return {
          outcome: 'failed',
          status: response.status,
          message: 'the response body was not a readable stream',
        };
      }

      const body = await this.readCapped(response.data, advertised);
      return {
        outcome: 'ok',
        body,
        bytes: body.length,
        contentType,
      };
    } catch (error) {
      return this.describeFailure(error);
    }
  }

  /**
   * Reads a stream into one buffer, refusing the moment it passes the cap.
   *
   * The chunks are held and concatenated once rather than appended to a growing
   * buffer, because repeated concatenation is quadratic and the whole point of
   * the change is that this path now sees documents of tens of megabytes.
   *
   * The stream is DESTROYED on refusal rather than left to drain. Without it the
   * socket keeps receiving a document nobody will read, which is the same
   * denial of service the cap exists to prevent, merely quieter.
   */
  private async readCapped(
    stream: BodyStream,
    advertised: number | null,
  ): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > this.maxBytes) {
        stream.destroy?.();
        // Thrown rather than returned so the `for await` unwinds; caught by
        // `describeFailure`, which is the one place a result is composed.
        const signal: OversizedSignal = {
          [OVERSIZED]: true,
          bytes: advertised ?? bytes,
          advertised: advertised !== null,
        };
        throw signal;
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, bytes);
  }

  /** Lets a refused body go, without waiting for it. */
  private discard(body: unknown): void {
    if (isBodyStream(body)) body.destroy?.();
  }

  private describeFailure(error: unknown): AttachmentResult {
    if (isOversizedSignal(error)) {
      return {
        outcome: 'oversized',
        bytes: error.bytes,
        advertised: error.advertised,
      };
    }

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
      const advertised = advertisedBytes(
        error.response?.headers?.['content-length'],
      );
      return {
        outcome: 'oversized',
        bytes: advertised,
        advertised: advertised !== null,
      };
    }

    return {
      outcome: 'failed',
      status: error.response?.status ?? null,
      message: error.message,
    };
  }
}
