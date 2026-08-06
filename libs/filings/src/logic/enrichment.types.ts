import type { AmountAnchor, AmountRefusalReason } from './amount-extraction';
import type { CounterpartyRefusalReason } from './counterparty';

/**
 * What the background worker did with a filing's attachment, and what it found.
 *
 * TYPES ONLY. The state machine they describe is the point of this module, so
 * it is written down here rather than left implicit in the worker:
 *
 *     pending ──fetch+parse ok──▶ enriched     (terminal, the good one)
 *        │
 *        ├──not a PDF / truncated / no text──▶ unparseable  (TERMINAL, never retried)
 *        │
 *        └──timeout / 5xx / 403 / network───▶ pending (attempts+1, backoff)
 *                                                │
 *                                     attempts exhausted
 *                                                ▼
 *                                             failed      (terminal)
 *
 * THE NON-RETRYABLE STATE IS THE LOAD-BEARING ONE. 3.3% of NSE's PDFs are
 * truncated at origin — HTTP 200, a valid `%PDF-` header, a `content-length`
 * that matches the short body, and no trailer. Re-fetching returns the same
 * bytes forever. One entire category (`Resignation of Director/KMP/SMP`, 213
 * filings in the recorded month) is 100% ZIP, and 146 filings carry the string
 * `"-"` where a URL should be. Without a terminal state each of those is an
 * infinite retry loop pointed at the exchange.
 */

/** The four states a filing's enrichment can be in. */
export type EnrichmentState =
  /** Not yet attempted, or attempted and eligible to be attempted again. */
  | 'pending'
  /** The document was read and a verdict reached. Terminal. */
  | 'enriched'
  /** The document can never be read. Terminal and NEVER retried. */
  | 'unparseable'
  /** Retryable failures exhausted the attempt budget. Terminal. */
  | 'failed';

/**
 * Why a filing can never be enriched. Every one of these is a property of the
 * document or the URL, not of the network, so retrying cannot change it.
 */
export type UnparseableReason =
  /** `attachmentUrl` is null, empty, or NSE's `"-"` sentinel. */
  | 'no-attachment'
  /** A ZIP, or any extension this pipeline does not read. */
  | 'not-a-pdf'
  /** The URL does not point at an NSE archive host. */
  | 'untrusted-host'
  /**
   * Served complete by NSE's own content-length, and cut off: no `%%EOF` at
   * the end, because the bytes that carry it were never sent.
   */
  | 'truncated-at-origin'
  /**
   * Structurally complete — it ends where a PDF should — and the parser still
   * could not read it. Encryption, or a construct pdf.js does not implement.
   * Kept apart from truncation because the remedies differ: one is NSE's
   * storage tier, the other is this pipeline's parser.
   */
  | 'unreadable-pdf'
  /** Parsed, but carries no text layer — a raster scan needing OCR. */
  | 'no-text-layer'
  /** Larger than the worker's download cap. */
  | 'oversized'
  /** The exchange does not have the document (404/410). */
  | 'not-found'
  /** The exchange refused the request in a way a retry cannot fix. */
  | 'rejected';

/** The enrichment record persisted onto a filing. Every field is nullable. */
export interface FilingEnrichment {
  readonly state: EnrichmentState;
  /** Fetch attempts made, including the one that reached a terminal state. */
  readonly attempts: number;
  /** When the last attempt ran. Null before the first. */
  readonly attemptedAt: Date | null;
  /** Earliest instant the next attempt may run. Null when none is due. */
  readonly nextAttemptAt: Date | null;
  /** Set only in state `unparseable`. */
  readonly unparseableReason: UnparseableReason | null;
  /** The last transient failure's message, for state `failed` and for triage. */
  readonly lastError: string | null;

  /** Characters of text the attachment yielded. Null when never parsed. */
  readonly documentChars: number | null;

  // --- the amount, or why there is none -------------------------------------
  /** Exact rupees. Null when refused or never attempted. */
  readonly amountRupees: number | null;
  /** The verbatim substring of the source that carries the figure. */
  readonly amountEvidence: string | null;
  readonly amountAnchor: AmountAnchor | null;
  /** The Schedule III row label, verbatim, when the anchor is a label. */
  readonly amountLabel: string | null;
  readonly amountRefusalReason: AmountRefusalReason | null;
  readonly amountRefusalDetail: string | null;

  // --- the counterparty, or why there is none -------------------------------
  readonly counterparty: string | null;
  readonly counterpartyEvidence: string | null;
  readonly counterpartyRefusalReason: CounterpartyRefusalReason | null;

  /** The composed headline, stored so what was sent can be audited later. */
  readonly headline: string | null;
  /** The derived-context line, or null when none could be computed. */
  readonly contextLine: string | null;
}

/** The enrichment a never-attempted filing carries. */
export const PENDING_ENRICHMENT: FilingEnrichment = {
  state: 'pending',
  attempts: 0,
  attemptedAt: null,
  nextAttemptAt: null,
  unparseableReason: null,
  lastError: null,
  documentChars: null,
  amountRupees: null,
  amountEvidence: null,
  amountAnchor: null,
  amountLabel: null,
  amountRefusalReason: null,
  amountRefusalDetail: null,
  counterparty: null,
  counterpartyEvidence: null,
  counterpartyRefusalReason: null,
  headline: null,
  contextLine: null,
};

/**
 * The states no further attempt may be made from.
 *
 * `enriched` is terminal too: a document's text does not change, so a second
 * read would spend an NSE request to reach the same verdict.
 */
export const TERMINAL_STATES: ReadonlySet<EnrichmentState> = new Set([
  'enriched',
  'unparseable',
  'failed',
]);

export const isTerminal = (state: EnrichmentState): boolean =>
  TERMINAL_STATES.has(state);
