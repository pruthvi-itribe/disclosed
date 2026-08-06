/**
 * The Docling side of the hybrid parser: an HTTP call to a long-running local
 * service, and every way it is allowed to fail.
 *
 * ================================================================
 * WHY A SERVICE AND NOT A SUBPROCESS
 * ================================================================
 *
 * DISQUALIFIED BY MEASUREMENT, not by taste. The parsing spike parsed two
 * byte-identical PDFs — NSE published the same file under two `seqId`s — in one
 * warm process: the first took 84.33 s and the second 56.12 s. That is **28
 * seconds of one-time model warmup**, and a `spawn('python', ...)` per document
 * pays it on every single filing, against the 0.19 s `pdf-parse` currently
 * spends on a typical one. The same pair also showed steady-state timing
 * repeatable to ~1.6% and byte-identical output, which is what makes a warm
 * service predictable enough to put on a worker's path.
 *
 * So the deployment is `docling-serve`, held warm, and the Node side is one
 * HTTP call. Docling ships that service itself; nothing here is a parser.
 *
 * ================================================================
 * AN OPTIONAL DEPENDENCY, AND THE LATCH THAT MAKES IT ONE
 * ================================================================
 *
 * The pipeline must keep working on a machine with no Python. Every failure
 * this module can suffer therefore resolves to `unavailable`, which the caller
 * reads as "use what `pdf-parse` already gave you and write down that you did"
 * — never as a reason to fail a filing.
 *
 * The `available` latch is what stops that being expensive. Without it, a
 * service that is down but reachable — a hung process, a container starting —
 * costs the FULL timeout on every eligible filing, and at ~85 results filings a
 * day with a 300-second ceiling that is seven hours of a worker waiting on a
 * dependency it was told to treat as optional. After a transport failure the
 * latch opens for a cooldown and every route decision in that window skips
 * Docling without a request. It closes again on the next successful probe, so a
 * service that comes back is used again without a restart.
 *
 * ================================================================
 * THE TWO CONFIGURATIONS, AND THE PARAMETER THAT REJECTS
 * ================================================================
 *
 * `do_ocr` is the whole cost model. On for raster scans, where character
 * recovery is the entire point; off for text-layer results filings, where the
 * value is reading order and column alignment and OCR buys a measured <1%
 * difference in output for 2-15x the time and triple the memory.
 *
 * `page_range` is the truncation parameter and `max_num_pages` is NOT — the
 * latter aborts the whole conversion with `ConversionError: Document has 640
 * pages, exceeding the max_num_pages limit of 40`. Sending the wrong one turns
 * every long filing into a hard failure instead of a partial read, which is why
 * the range is built here rather than left to a caller.
 */

/** The one call a Docling converter answers. */
export interface DoclingRequest {
  readonly data: Buffer;
  /** Sent as the multipart filename. Docling keys its result off it. */
  readonly fileName: string;
  /** True for raster scans, false for text-layer results filings. */
  readonly ocr: boolean;
  /** 1-indexed, inclusive, and sent as `page_range` rather than a page cap. */
  readonly maxPages: number;
}

export type DoclingResult =
  /** The service read the document. */
  | { readonly outcome: 'ok'; readonly text: string }
  /**
   * The service could not be reached, timed out, or answered unusably.
   *
   * THE FALLBACK VERDICT. Every transport failure lands here and the caller
   * keeps `pdf-parse`'s text, because an optional dependency being absent is
   * not a fact about the document.
   */
  | { readonly outcome: 'unavailable'; readonly message: string }
  /**
   * The service read the bytes and said it could not convert them.
   *
   * KEPT APART from `unavailable` because the remedies are opposite: one is an
   * operator starting a service, the other is a document that will refuse
   * identically forever. Neither fails the filing — the caller still has
   * `pdf-parse`'s text — but only one of them is worth an alert.
   */
  | { readonly outcome: 'refused'; readonly message: string };

export interface DoclingConverter {
  convert(request: DoclingRequest): Promise<DoclingResult>;
  /** Whether the service is believed reachable, without making a request. */
  isAvailable(): boolean;
}

/**
 * A failed request, carrying whether the service ANSWERED.
 *
 * ================================================================
 * THE DISTINCTION THE LATCH TURNS ON, LEARNED FROM A LIVE RUN
 * ================================================================
 *
 * A sweep over the 21 scanned filings recovered exactly one of them. The second
 * document was a 15-page scan; `docling-serve` has its own `max_sync_wait` of
 * 120 seconds, the conversion took 131, and the service returned **504 while
 * still completing the work**. This client read that as the service being
 * unreachable, opened the availability latch for its five-minute cooldown, and
 * silently skipped Docling for all 19 remaining filings — which are 1 to 4
 * pages each and would have converted in seconds.
 *
 * A status code is proof the service is alive and answering. Only the ABSENCE
 * of a response — connection refused, DNS failure, a socket that never came
 * back — is evidence about the SERVICE rather than about one document. So the
 * latch opens on `status === null` and on nothing else, and one oversized
 * document can no longer take the dependency down for everything behind it.
 */
export class DoclingHttpError extends Error {
  constructor(
    message: string,
    /** The HTTP status, or null when no response arrived at all. */
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'DoclingHttpError';
  }
}

/** The subset of a transport this client uses, so a suite can stand in for it. */
export interface DoclingHttp {
  /**
   * Resolves with the parsed JSON body, or rejects.
   *
   * A transport that can tell a status from a dead socket should reject with a
   * `DoclingHttpError`; anything else is treated as no response at all, which
   * is the cautious direction.
   */
  post(path: string, form: FormData): Promise<unknown>;
  /** Resolves when the service answers its health endpoint. */
  health(): Promise<void>;
}

export interface DoclingOptions {
  /**
   * How long a failed probe or conversion keeps the latch open.
   *
   * Five minutes by default. Long enough that a down service is not re-probed
   * once a filing, short enough that a service coming back is picked up inside
   * one human's attention span without a worker restart.
   */
  readonly cooldownMs: number;
  /** Injected so the cooldown is testable without waiting for it. */
  readonly now: () => number;
}

export const DEFAULT_DOCLING_COOLDOWN_MS = 300_000;

/** How much of somebody else's error message is kept. */
export const MAX_DOCLING_MESSAGE_CHARS = 300;

const bounded = (value: string): string =>
  value.replace(/\s+/g, ' ').trim().slice(0, MAX_DOCLING_MESSAGE_CHARS);

const messageOf = (error: unknown): string =>
  bounded(error instanceof Error ? error.message : String(error));

/**
 * Reads the markdown out of a Docling reply, or says why there is none.
 *
 * MARKDOWN RATHER THAN `text_content`, deliberately. The whole reason this
 * engine is here is that it emits `| 1 | Revenue from operations | 54,618.69 |
 * 52,369.69 |` where `pdf-parse` emits `Revenue from operations54,618.69
 * 52,369.69`, and it puts `## UNAUDITED STANDALONE FINANCIAL RESULTS` before
 * the table rather than 2,977 characters after it. The plain-text rendering
 * discards exactly the pipes and headings that carry those two guarantees.
 *
 * Defensive about every field even though the service has a schema: a reply is
 * somebody else's output arriving over a socket, and a `status` this does not
 * recognise must refuse rather than hand back an empty string that the caller
 * would store as a successfully-read document with nothing in it.
 */
export function textFromDoclingReply(payload: unknown): DoclingResult {
  if (typeof payload !== 'object' || payload === null) {
    return {
      outcome: 'unavailable',
      message: 'the Docling service returned no object',
    };
  }

  const body = payload as Record<string, unknown>;
  const status = typeof body.status === 'string' ? body.status : 'unknown';

  const document = body.document;
  const markdown =
    typeof document === 'object' && document !== null
      ? (document as Record<string, unknown>).md_content
      : undefined;

  if (typeof markdown !== 'string' || markdown.length === 0) {
    // `partial_success` with no content, `failure`, and a shape this does not
    // know are all the same fact for the caller: Docling has nothing to add.
    return {
      outcome: 'refused',
      message: bounded(
        `the Docling service answered "${status}" with no markdown content`,
      ),
    };
  }

  return { outcome: 'ok', text: markdown };
}

/**
 * Builds the multipart body for one conversion.
 *
 * Exported because it is where the two hazards from the spike are ENCODED
 * rather than commented: `do_ocr` picks the configuration, and the page bound
 * goes out as `page_range` — a 1-indexed inclusive pair — so an over-long
 * document is truncated instead of rejected outright.
 *
 * `to_formats=md` is fixed rather than configurable. It is the only rendering
 * that carries the table pipes and the heading order this engine was chosen
 * for, so making it a setting would make the guarantee optional.
 */
export function buildDoclingForm(request: DoclingRequest): FormData {
  const form = new FormData();
  form.append(
    'files',
    new Blob([new Uint8Array(request.data)], { type: 'application/pdf' }),
    request.fileName,
  );
  form.append('to_formats', 'md');
  form.append('do_ocr', request.ocr ? 'true' : 'false');
  // 1-INDEXED AND INCLUSIVE, and `page_range` rather than `max_num_pages`. See
  // the module comment: the other parameter rejects the document instead of
  // truncating it.
  form.append('page_range', '1');
  form.append('page_range', String(Math.max(1, request.maxPages)));
  // A document that cannot be converted must come back as a status this client
  // can read, not as a 500 that looks like the service being down.
  form.append('abort_on_error', 'false');
  return form;
}

/** The endpoint. Synchronous conversion; the worker is already off the hot path. */
export const DOCLING_CONVERT_PATH = '/v1/convert/file';

/**
 * A converter over an injected transport.
 *
 * NEVER THROWS. Every path returns a verdict, because the caller is a worker
 * loop that already holds a perfectly usable `pdf-parse` reading of the same
 * document and must not lose it to an optional dependency's bad day.
 */
export class HttpDoclingConverter implements DoclingConverter {
  /** Null when the service is believed up. A timestamp when it is not. */
  private openedAt: number | null = null;

  constructor(
    private readonly http: DoclingHttp,
    private readonly options: DoclingOptions = {
      cooldownMs: DEFAULT_DOCLING_COOLDOWN_MS,
      now: () => Date.now(),
    },
  ) {}

  isAvailable(): boolean {
    if (this.openedAt === null) return true;
    if (this.options.now() - this.openedAt >= this.options.cooldownMs) {
      // The cooldown has run out, so the next call is allowed to try. Cleared
      // here rather than on success so a caller asking twice inside one tick
      // gets one answer.
      this.openedAt = null;
      return true;
    }
    return false;
  }

  /** Probes the service, so a deployment can report the dependency at startup. */
  async probe(): Promise<boolean> {
    try {
      await this.http.health();
      this.openedAt = null;
      return true;
    } catch {
      this.openedAt = this.options.now();
      return false;
    }
  }

  async convert(request: DoclingRequest): Promise<DoclingResult> {
    if (!this.isAvailable()) {
      return {
        outcome: 'unavailable',
        message:
          'the Docling service failed recently and is in its cooldown, so no ' +
          'request was made',
      };
    }

    let payload: unknown;
    try {
      payload = await this.http.post(
        DOCLING_CONVERT_PATH,
        buildDoclingForm(request),
      );
    } catch (error) {
      // THE LATCH OPENS ONLY WHEN NOTHING ANSWERED. A status code — a 504 on an
      // oversized document, a 422 on a file the service will not take — is
      // proof the service is up, and treating it as an outage skipped 19
      // convertible filings behind one slow one in a live run. A reply this
      // client cannot READ does not open it either: that is a statement about
      // one document, handled by `textFromDoclingReply` below.
      const status = error instanceof DoclingHttpError ? error.status : null;
      if (status === null) this.openedAt = this.options.now();
      return {
        outcome: 'unavailable',
        message:
          status === null
            ? `the Docling service could not be reached: ${messageOf(error)}`
            : `the Docling service answered ${status}: ${messageOf(error)}`,
      };
    }

    return textFromDoclingReply(payload);
  }
}
