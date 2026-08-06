/**
 * Turns PDF bytes into text, or says the bytes are not a readable PDF.
 *
 * A thin seam over `pdf-parse`, and the thinness is deliberate. It exists for
 * three reasons that a bare `require` at the call site would not give:
 *
 *   1. **Parse failure is a VERDICT here, not an exception.** 3.3% of NSE's
 *      PDFs are truncated at origin and every one of them throws. Thrown from
 *      inside a worker loop that also has to handle timeouts and 5xx, that
 *      exception is indistinguishable from a transient failure and gets
 *      retried forever. Returning a typed result forces the caller to decide.
 *   2. **The parser is injectable**, so the worker's own tests never load
 *      pdf.js and never need a real PDF fixture.
 *   3. **The import is lazy.** `pdf-parse` pulls in the whole of pdf.js at
 *      require time. The dashboard imports `@app/filings` for the schema alone
 *      and must not pay for that.
 */

/** The one call this module makes into the parser. */
export type PdfParser = (
  data: Buffer,
) => Promise<{ readonly text: string; readonly numpages: number }>;

export interface PdfTextOk {
  readonly outcome: 'ok';
  readonly text: string;
  readonly pages: number;
}

export interface PdfTextUnreadable {
  readonly outcome: 'unreadable';
  /** The parser's own message, for triage. Never shown to a reader. */
  readonly message: string;
}

export type PdfTextResult = PdfTextOk | PdfTextUnreadable;

let cached: PdfParser | null = null;

/**
 * Loads `pdf-parse` on first use.
 *
 * `require` rather than a static import: this module is reachable from
 * `libs/filings`'s barrel, which the read-only dashboard also imports, and a
 * static import would put pdf.js in a process that never parses a PDF.
 */
export function defaultPdfParser(): PdfParser {
  if (cached === null) {
    // A deliberate `require`, and the lint rule is suppressed rather than
    // satisfied. A static `import` would put the whole of pdf.js — two
    // megabytes of parser — into every process that imports `@app/filings`,
    // and the read-only dashboard imports it for the mongoose schema alone and
    // never parses a PDF. `await import()` is not an alternative: the project
    // compiles to CommonJS, so it emits this same call while forcing every
    // caller of this function to become async.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('pdf-parse') as PdfParser;
  }
  return cached;
}

/**
 * Extracts a PDF's text layer.
 *
 * NEVER THROWS for a bad document. A malformed, truncated, encrypted or
 * password-protected PDF returns `unreadable` with the parser's message, and
 * the caller records a terminal state rather than scheduling a retry that
 * cannot succeed.
 *
 * It also never throws for an empty buffer, which is what a zero-length 200
 * response produces.
 */
export async function extractPdfText(
  data: Buffer,
  parser: PdfParser = defaultPdfParser(),
): Promise<PdfTextResult> {
  if (data.length === 0) {
    return { outcome: 'unreadable', message: 'the response body was empty' };
  }

  try {
    const parsed = await parser(data);
    // A parser that resolves with a non-string `text` has changed contract
    // underneath us; treating that as readable would push `undefined` into the
    // extractor and refuse every filing with `no-candidate` while looking
    // healthy.
    if (typeof parsed?.text !== 'string') {
      return {
        outcome: 'unreadable',
        message: 'the parser resolved without text',
      };
    }
    return {
      outcome: 'ok',
      text: parsed.text,
      pages: Number.isInteger(parsed.numpages) ? parsed.numpages : 0,
    };
  } catch (error) {
    return {
      outcome: 'unreadable',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
