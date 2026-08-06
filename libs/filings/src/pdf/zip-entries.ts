/**
 * Deciding what may be taken out of a ZIP attachment, before anything is.
 *
 * ================================================================
 * WHY THIS EXISTS
 * ================================================================
 *
 * 249 of the 17,442 filings in the recorded month carry a `.zip`, and three
 * whole categories are 100% ZIP: `Resignation of Director/KMP/SMP` (213 filings
 * a month), `Resignation of Statutory Auditor` (9) and `Public
 * Announcement-Open Offer` (3). Every one of them terminates `not-a-pdf` today,
 * so this pipeline is structurally blind to them — not refusing them on the
 * merits, simply never opening the envelope.
 *
 * ================================================================
 * THE ARCHIVE IS HOSTILE INPUT
 * ================================================================
 *
 * The URL comes from an exchange feed and the bytes come from whoever uploaded
 * them. A ZIP is the one attachment format that can lie about its own size: a
 * few kilobytes of deflate stream expands to gigabytes, and a decompressor that
 * trusts the archive is a memory exhaustion waiting for someone to notice.
 *
 * So every bound below is checked BEFORE a byte is inflated, out of the central
 * directory, and the numbers are set against what 11 real NSE archives actually
 * contain rather than against imagination:
 *
 *   - entries          measured 2 to 3      -> `MAX_ZIP_ENTRIES` 64
 *   - whole expansion  measured 1.01x-1.23x -> `MAX_ZIP_EXPANSION` 100x
 *   - one entry        measured up to 6.50x -> `MAX_ENTRY_EXPANSION` 200x
 *   - uncompressed     measured up to 9.4MB -> `MAX_ZIP_UNCOMPRESSED_BYTES` 128MB
 *
 * The measured maxima and the bounds are two orders of magnitude apart on
 * purpose. A bound set at the observed maximum refuses the next ordinary filing;
 * one set here refuses a bomb, which starts at roughly 1000:1 and goes to
 * 10,000,000:1. What is being bought is a ceiling, not a filter.
 *
 * ================================================================
 * AND THE NAMES ARE HOSTILE TOO
 * ================================================================
 *
 * Nothing here writes to disk, so `../../../etc/passwd` cannot presently escape
 * anywhere. It is refused regardless, because the reason it is safe today is
 * that no caller writes an entry out, and that is a property of a caller rather
 * than of this module. All 23 entries across the 11 measured archives are flat
 * basenames; a name that is not one is a filing that does not look like the
 * others, and this pipeline refuses those rather than reasoning about them.
 */

/** The most entries an archive may declare. Measured maximum: 3. */
export const MAX_ZIP_ENTRIES = 64;

/** Total inflated bytes across every entry taken. Measured maximum: 9.4 MB. */
export const MAX_ZIP_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;

/** Whole-archive expansion ratio. Measured maximum: 1.23x. */
export const MAX_ZIP_EXPANSION = 100;

/** Any single entry's expansion ratio. Measured maximum: 6.50x. */
export const MAX_ENTRY_EXPANSION = 200;

/** What one entry in the central directory says about itself. */
export interface ZipEntryHeader {
  readonly fileName: string;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
}

/** Why an archive, or one entry in it, will not be read. */
export type ZipRefusalReason =
  | 'too-many-entries'
  | 'uncompressed-too-large'
  | 'compression-ratio'
  | 'unsafe-entry-name'
  | 'no-pdf-entries';

export interface ZipRefusal {
  readonly outcome: 'refused';
  readonly reason: ZipRefusalReason;
  readonly detail: string;
}

export interface ZipAccepted {
  readonly outcome: 'accepted';
  /** The PDF entries, in the archive's own order. */
  readonly entries: readonly ZipEntryHeader[];
  /** Every entry name the archive declared, PDF or not, bounded. */
  readonly ignored: readonly string[];
}

export type ZipPlan = ZipAccepted | ZipRefusal;

const refuse = (reason: ZipRefusalReason, detail: string): ZipRefusal => ({
  outcome: 'refused',
  reason,
  detail,
});

/**
 * True when an entry name is a plain file name and nothing else.
 *
 * Refuses a path separator in either spelling, a `..` segment, an absolute
 * path, a Windows drive letter, and a name carrying a NUL — which is the
 * classic way a checked name and an opened name come to differ. Case is folded
 * for the extension test only; the name itself is never rewritten, because a
 * sanitiser that repairs a hostile name hands the caller something no archive
 * contained.
 */
export function isSafeEntryName(name: string): boolean {
  if (name.length === 0 || name.length > 255) return false;
  // A NUL is the classic way a checked name and an opened name come to differ,
  // and any control character forges a log line. Spaces are NOT refused: real
  // NSE entries carry them, and a bound that refuses the ordinary case is a
  // bound that gets deleted rather than one that protects anything.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name === '.' || name === '..') return false;
  // A drive-relative name has no separator and is still not a basename.
  if (/^[A-Za-z]:/.test(name)) return false;
  return true;
}

/** True when an entry name ends in `.pdf`, whatever its case. */
export const isPdfEntry = (name: string): boolean =>
  name.toLowerCase().endsWith('.pdf');

/** How many entry names are kept on the record when they are not PDFs. */
export const MAX_IGNORED_NAMES = 16;

export interface ZipPlanLimits {
  readonly maxEntries?: number;
  readonly maxUncompressedBytes?: number;
  readonly maxExpansion?: number;
  readonly maxEntryExpansion?: number;
}

/**
 * Decides, from the central directory alone, what may be inflated.
 *
 * NEVER THROWS and never inflates. Every input is a declared size, which is why
 * the caller must still count what it actually reads — a header is a claim by
 * whoever built the archive, and this function's whole job is to stop believing
 * one before it costs anything.
 *
 * THE RATIO IS CHECKED PER ENTRY AS WELL AS OVERALL. A bomb hidden as one entry
 * beside a genuine 9 MB PDF has a mild whole-archive ratio and a lethal
 * per-entry one, and only the second test sees it.
 */
export function planZipEntries(
  headers: readonly ZipEntryHeader[],
  limits: ZipPlanLimits = {},
): ZipPlan {
  const maxEntries = limits.maxEntries ?? MAX_ZIP_ENTRIES;
  const maxBytes = limits.maxUncompressedBytes ?? MAX_ZIP_UNCOMPRESSED_BYTES;
  const maxExpansion = limits.maxExpansion ?? MAX_ZIP_EXPANSION;
  const maxEntryExpansion = limits.maxEntryExpansion ?? MAX_ENTRY_EXPANSION;

  if (headers.length > maxEntries) {
    return refuse(
      'too-many-entries',
      `the archive declares ${headers.length} entries, above the ${maxEntries} allowed`,
    );
  }

  let compressed = 0;
  let uncompressed = 0;
  const pdfs: ZipEntryHeader[] = [];
  const ignored: string[] = [];

  for (const entry of headers) {
    if (!isSafeEntryName(entry.fileName)) {
      // FAIL CLOSED ON THE WHOLE ARCHIVE, not on the entry. An archive
      // containing a traversal name is not an archive with one bad file in it;
      // it is an archive nobody should be reading, and skipping the entry would
      // quietly process the rest of an attack.
      return refuse(
        'unsafe-entry-name',
        `an entry name is not a plain file name: ${JSON.stringify(
          entry.fileName.slice(0, 80),
        )}`,
      );
    }

    compressed += entry.compressedSize;
    uncompressed += entry.uncompressedSize;

    // A zero-byte compressed entry with content is division by zero, and it is
    // also the shape a stored (uncompressed) entry never has. Treated as an
    // infinite ratio rather than skipped.
    const ratio =
      entry.compressedSize === 0
        ? entry.uncompressedSize === 0
          ? 0
          : Number.POSITIVE_INFINITY
        : entry.uncompressedSize / entry.compressedSize;
    if (ratio > maxEntryExpansion) {
      return refuse(
        'compression-ratio',
        `entry ${JSON.stringify(entry.fileName.slice(0, 60))} expands ` +
          `${Number.isFinite(ratio) ? ratio.toFixed(1) : 'unboundedly'}x, ` +
          `above the ${maxEntryExpansion}x allowed`,
      );
    }

    if (isPdfEntry(entry.fileName)) pdfs.push(entry);
    else if (ignored.length < MAX_IGNORED_NAMES) ignored.push(entry.fileName);
  }

  if (uncompressed > maxBytes) {
    return refuse(
      'uncompressed-too-large',
      `the archive declares ${uncompressed} uncompressed bytes, above the ${maxBytes} allowed`,
    );
  }

  const expansion = compressed === 0 ? 0 : uncompressed / compressed;
  if (expansion > maxExpansion) {
    return refuse(
      'compression-ratio',
      `the archive expands ${expansion.toFixed(1)}x, above the ${maxExpansion}x allowed`,
    );
  }

  if (pdfs.length === 0) {
    return refuse(
      'no-pdf-entries',
      headers.length === 0
        ? 'the archive is empty'
        : `none of the ${headers.length} entries is a PDF`,
    );
  }

  return { outcome: 'accepted', entries: pdfs, ignored };
}
