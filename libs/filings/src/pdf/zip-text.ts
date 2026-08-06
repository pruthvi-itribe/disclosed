import { extractPdfText, type PdfParser } from './pdf-text';
import {
  MAX_ZIP_UNCOMPRESSED_BYTES,
  planZipEntries,
  type ZipEntryHeader,
  type ZipPlanLimits,
  type ZipRefusalReason,
} from './zip-entries';

/**
 * Turning a ZIP attachment into the text of the PDFs inside it.
 *
 * ================================================================
 * THE MULTI-PDF DECISION, AND WHY IT IS CONCATENATION
 * ================================================================
 *
 * 5 of 11 measured NSE archives carry more than one PDF (up to three). The three
 * options were: take the largest, process each separately, or concatenate.
 *
 * **Taking the largest is measurably wrong.** REPL's archive holds the SAME
 * document twice — a signed scan and the text original. The scan is the larger
 * file and yields 4 characters; the original yields 4,576. A size rule picks the
 * one with no text in it, and the filing then records `no-text-layer` about a
 * document this pipeline was holding the readable version of.
 *
 * **Processing each separately** would mean one filing becoming several
 * enrichment records, and the filing is the unit everything downstream counts,
 * alerts on and de-duplicates by. That is a schema change to solve a formatting
 * question.
 *
 * **So the text is concatenated**, in the archive's own order, each part behind
 * a delimiter naming the entry it came from. Nothing is lost, which is the
 * stated goal for a category this pipeline is currently blind to, and the
 * provenance records every entry with its own character count so a reader can
 * see which part carried the content.
 *
 * THE OBJECTION TO CONCATENATION IS THE VERBATIM GATE, and it is answered rather
 * than dismissed: a claim's span is matched against this combined text, so in
 * principle a model could quote a sentence that straddles two documents and the
 * gate would find it. Two things make that acceptable. First, the same hazard
 * already exists inside every single PDF — `pdf-parse` concatenates pages, and a
 * two-column slide is interleaved before anything here runs — so a boundary
 * between archive entries is not a new class of risk. Second, this boundary is
 * the only one in the pipeline that is EXPLICIT: a span crossing it must contain
 * the delimiter line verbatim, which a claim about a company's business will not.
 * A page break offers no such marker.
 */

/** What the separator between two entries' text looks like. */
export const entryDelimiter = (fileName: string): string =>
  `\n\n===== ${fileName} =====\n\n`;

/** One PDF taken out of an archive, and what it yielded. */
export interface ZipMember {
  readonly fileName: string;
  readonly bytes: number;
  /** Characters of text, or null when the entry would not parse. */
  readonly chars: number | null;
  /** The parser's message when it would not parse. Never shown to a reader. */
  readonly message: string | null;
}

export interface ZipTextOk {
  readonly outcome: 'ok';
  /** Every PDF entry's text, in archive order, behind labelled delimiters. */
  readonly text: string;
  /** Total pages across the entries that parsed. */
  readonly pages: number;
  /** True when any entry hit the page budget. */
  readonly truncated: boolean;
  readonly members: readonly ZipMember[];
  /** Entry names that were not PDFs and were never inflated. */
  readonly ignored: readonly string[];
}

export interface ZipTextUnusable {
  readonly outcome: 'unusable';
  readonly reason: ZipRefusalReason | 'unreadable-archive' | 'no-text';
  readonly detail: string;
}

export type ZipTextResult = ZipTextOk | ZipTextUnusable;

/**
 * The subset of a ZIP reader this module needs.
 *
 * An interface rather than a direct `yauzl` call so the suite can exercise a
 * zip bomb, a traversal name and a truncated archive without committing a
 * fixture for each — the same reasoning `pdf-text.ts` gives for injecting its
 * parser.
 */
export interface ZipReader {
  /** Every entry the central directory declares. Must not inflate anything. */
  list(archive: Buffer): Promise<readonly ZipEntryHeader[]>;
  /**
   * Inflates one entry.
   *
   * MUST refuse to produce more than `maxBytes`, because a declared size is a
   * claim by whoever built the archive and this is the only place the claim can
   * be checked against the bytes.
   */
  read(
    archive: Buffer,
    fileName: string,
    maxBytes: number,
  ): Promise<Buffer | null>;
}

export interface ZipTextOptions extends ZipPlanLimits {
  readonly parser?: PdfParser;
  readonly maxPages?: number;
}

/**
 * Reads every PDF in an archive and joins their text.
 *
 * NEVER THROWS. A malformed archive, a bomb, a traversal name and an archive of
 * nothing but XML all come back as `unusable` with a reason, exactly as
 * `extractPdfText` returns a verdict rather than raising — the caller records a
 * state about the filing and moves on.
 *
 * AN ENTRY THAT WILL NOT PARSE DOES NOT SINK THE ARCHIVE. 4 of the 17 measured
 * zipped PDFs are raster scans yielding two to four characters; refusing the
 * whole filing because one member was a scan would lose the 13 that were
 * readable. Each member's own outcome is recorded instead.
 */
export async function extractZipText(
  archive: Buffer,
  reader: ZipReader,
  options: ZipTextOptions = {},
): Promise<ZipTextResult> {
  let headers: readonly ZipEntryHeader[];
  try {
    headers = await reader.list(archive);
  } catch (error) {
    return {
      outcome: 'unusable',
      reason: 'unreadable-archive',
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const plan = planZipEntries(headers, options);
  if (plan.outcome === 'refused') {
    return { outcome: 'unusable', reason: plan.reason, detail: plan.detail };
  }

  const budget = options.maxUncompressedBytes ?? MAX_ZIP_UNCOMPRESSED_BYTES;
  const members: ZipMember[] = [];
  const parts: string[] = [];
  let pages = 0;
  let truncated = false;
  // Counted across the WHOLE archive rather than per entry, so a hundred
  // entries that are each individually within budget cannot add up past it.
  let remaining = budget;

  for (const entry of plan.entries) {
    let body: Buffer | null;
    try {
      body = await reader.read(archive, entry.fileName, remaining);
    } catch (error) {
      members.push({
        fileName: entry.fileName,
        bytes: 0,
        chars: null,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (body === null) {
      members.push({
        fileName: entry.fileName,
        bytes: 0,
        chars: null,
        message: 'the entry could not be inflated within the archive budget',
      });
      continue;
    }

    remaining -= body.length;
    const parsed = await extractPdfText(body, options.parser, options.maxPages);
    if (parsed.outcome !== 'ok') {
      members.push({
        fileName: entry.fileName,
        bytes: body.length,
        chars: null,
        message: parsed.message,
      });
      continue;
    }

    pages += parsed.pages;
    truncated = truncated || parsed.truncated;
    members.push({
      fileName: entry.fileName,
      bytes: body.length,
      chars: parsed.text.length,
      message: null,
    });
    parts.push(`${entryDelimiter(entry.fileName)}${parsed.text}`);
  }

  if (parts.length === 0) {
    return {
      outcome: 'unusable',
      reason: 'no-text',
      detail: `none of the ${plan.entries.length} PDF entr(y/ies) could be read`,
    };
  }

  return {
    outcome: 'ok',
    text: parts.join(''),
    pages,
    truncated,
    members,
    ignored: plan.ignored,
  };
}
