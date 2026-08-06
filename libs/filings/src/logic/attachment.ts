import type { UnparseableReason } from './enrichment.types';

/**
 * Decides whether a filing's `attachmentUrl` may be fetched at all.
 *
 * Three separate hazards, all measured on the real corpus rather than imagined:
 *
 *   1. **`"-"` is a URL in the feed's own type.** 146 of 17,442 filings carry
 *      the single-character string `-` where a URL belongs. It is a sentinel,
 *      not null, so a null check misses it and `new URL('-')` throws.
 *   2. **One whole category is ZIP.** `Resignation of Director/KMP/SMP` (213
 *      filings) has zero PDFs; 249 ZIPs exist corpus-wide. A pipeline that
 *      assumes `.pdf` hands a ZIP to a PDF parser and gets an exception it will
 *      then retry forever.
 *   3. **The URL is exchange-supplied and this process makes outbound
 *      requests.** That is a server-side request forgery surface: whatever NSE
 *      puts in that field, this worker fetches. A host allowlist is the control,
 *      and it belongs here rather than in the fetcher because "we will not
 *      fetch this" is a terminal verdict about the filing, not a network event.
 */

/** Hosts whose documents this pipeline will fetch. Suffix-matched on labels. */
export const TRUSTED_ATTACHMENT_HOSTS: readonly string[] = [
  'nseindia.com',
  'nsearchives.nseindia.com',
];

/** NSE's own sentinel for "no attachment". Not null, and not a URL. */
export const NO_ATTACHMENT_SENTINEL = '-';

/**
 * What the bytes at the far end are expected to be.
 *
 * The URL's extension is the only evidence available before the fetch, and it
 * decides which reader is used — not whether the bytes are trusted. A `.zip`
 * that turns out not to be one fails inside `extractZipText` and is recorded
 * `not-a-pdf`, exactly as a `.pdf` that is really an HTML error page does.
 */
export type AttachmentKind = 'pdf' | 'zip';

export type AttachmentDecision =
  /** Safe to fetch. `url` is the parsed, normalised absolute URL. */
  | {
      readonly outcome: 'fetch';
      readonly url: string;
      readonly kind: AttachmentKind;
    }
  /** Never fetchable. The reason is terminal and machine-readable. */
  | { readonly outcome: 'skip'; readonly reason: UnparseableReason };

const skip = (reason: UnparseableReason): AttachmentDecision => ({
  outcome: 'skip',
  reason,
});

/**
 * True when `hostname` is one of the trusted hosts or a subdomain of one.
 *
 * Compared LABEL-WISE, never with `endsWith`. `'evil-nseindia.com'.endsWith(
 * 'nseindia.com')` is true, and that is the entire attack: an allowlist written
 * with a bare suffix test admits any domain whose name ends in the trusted one.
 */
export function isTrustedAttachmentHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return TRUSTED_ATTACHMENT_HOSTS.some(
    (trusted) => host === trusted || host.endsWith(`.${trusted}`),
  );
}

/** The lower-cased extension of a URL's path, without the dot. */
function extensionOf(pathname: string): string {
  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1);
  const dot = lastSegment.lastIndexOf('.');
  return dot === -1 ? '' : lastSegment.slice(dot + 1).toLowerCase();
}

/**
 * Classifies an attachment URL into "fetch this" or "never fetch this, because".
 *
 * @param attachmentUrl the value stored on the filing, exactly as NSE sent it.
 */
export function decideAttachment(
  attachmentUrl: string | null,
): AttachmentDecision {
  const raw = (attachmentUrl ?? '').trim();
  if (raw.length === 0 || raw === NO_ATTACHMENT_SENTINEL) {
    return skip('no-attachment');
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    // A value that is not a URL is not a network failure to retry; it is a
    // filing whose attachment field this pipeline cannot use.
    return skip('no-attachment');
  }

  // http is refused as well as the exotic schemes. The archive host serves
  // https, and a plaintext fetch of a document that becomes a public claim
  // about a listed company is a downgrade nobody asked for.
  if (parsed.protocol !== 'https:') return skip('untrusted-host');
  if (!isTrustedAttachmentHost(parsed.hostname)) return skip('untrusted-host');

  const extension = extensionOf(parsed.pathname);
  if (extension === 'pdf') {
    return { outcome: 'fetch', url: parsed.toString(), kind: 'pdf' };
  }

  // ZIP IS NOW FETCHED, and it is the second-largest thing this pipeline was
  // missing. 249 of 17,442 filings carry one and three whole categories are
  // 100% ZIP — `Resignation of Director/KMP/SMP` alone is 213 filings a month.
  // Refusing them was never a judgement about the filings; it was never opening
  // the envelope. The archive is treated as hostile input throughout: see
  // `zip-entries.ts` for every bound and the measurements behind them.
  if (extension === 'zip') {
    return { outcome: 'fetch', url: parsed.toString(), kind: 'zip' };
  }

  // Everything else — xlsx, xml, or no extension at all — is terminal. Fail
  // CLOSED: an unknown extension is refused rather than fetched and handed to a
  // parser, because a parser's failure mode for the wrong format is an
  // exception that looks exactly like a transient one.
  return skip('not-a-pdf');
}
