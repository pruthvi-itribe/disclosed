import { installPdfLogFilter } from './pdf-log-noise';

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

/**
 * Pages beyond which a document is read no further.
 *
 * THE BUDGET THE BYTE CAP WAS PRETENDING TO BE. `attachment.fetcher.ts` used to
 * justify a 25 MB download cap as a throughput control; measured against eleven
 * real documents, that was false. The four documents the cap refused — 26.1,
 * 27.7, 27.9 and 41.5 MB — parsed in 0.304, 1.400, 0.195 and 0.185 seconds,
 * because they are image scans and image scans carry almost no text to extract.
 * The document that actually cost 39.690 seconds and 501 MB of resident memory
 * was NHPC's 640-page annual report at 19.6 MB, which passed the byte cap
 * comfortably. Bytes do not predict parse cost; pages of extractable text do.
 *
 * 400 is a BOUND on the pathological case rather than a trim on the ordinary
 * one. The largest page count among the ten non-pathological documents measured
 * was 143 (Swiggy's Capital Markets Day deck, 0.195 s), so 400 leaves every one
 * of them untouched with 2.8x of headroom, and caps the 640-page case at about
 * five eighths of a cost that blocks this process for forty seconds.
 *
 * FORTY SECONDS IS NOT A FIGURE OF SPEECH. `pdf-parse` is CPU work inside
 * pdf.js with no `await` for the event loop to escape through: an interval timer
 * armed at 100 ms recorded ZERO ticks across the whole of that parse. There is
 * no timeout that can interrupt it, which is why the bound has to be applied
 * before the work starts.
 */
export const MAX_PDF_PAGES = 400;

/** The one call this module makes into the parser. */
export type PdfParser = (
  data: Buffer,
  options?: { readonly max?: number },
) => Promise<{ readonly text: string; readonly numpages: number }>;

export interface PdfTextOk {
  readonly outcome: 'ok';
  readonly text: string;
  /** Pages the document has, whether or not all of them were read. */
  readonly pages: number;
  /**
   * True when the page budget stopped the read before the last page.
   *
   * Reported rather than silent: a truncated read is a document this pipeline
   * holds only part of, and a downstream refusal to find an amount in it means
   * something different from the same refusal on a complete one.
   */
  readonly truncated: boolean;
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
    // INSTALLED HERE because this is the only place that decides a process is
    // going to parse PDFs at all. A process that never calls this — the
    // dashboard, which imports this barrel for the mongoose schema — never has
    // its console touched. pdf.js cannot be asked to be quieter; the argument
    // and the measurement are in `pdf-log-noise.ts`.
    installPdfLogFilter();

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
  maxPages: number = MAX_PDF_PAGES,
): Promise<PdfTextResult> {
  if (data.length === 0) {
    return { outcome: 'unreadable', message: 'the response body was empty' };
  }

  try {
    const parsed = await parser(data, { max: maxPages });
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
    // `numpages` is the document's OWN page count, not the number read, so it
    // is what says whether the budget bit. A parser that reports a non-integer
    // has changed contract; 0 pages then reports `truncated: false`, which is
    // the safe direction — claiming a complete read we did not make would be
    // worse than under-reporting a truncation.
    const pages = Number.isInteger(parsed.numpages) ? parsed.numpages : 0;
    return {
      outcome: 'ok',
      text: parsed.text,
      pages,
      truncated: maxPages > 0 && pages > maxPages,
    };
  } catch (error) {
    return {
      outcome: 'unreadable',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
