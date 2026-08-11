import type { AmountAnchor, AmountRefusalReason } from './amount-extraction';
import type { CategoryGroup } from './category-group';
import type { CoverageSkipReason } from './claim-eligibility';
import type { OutcomeSource } from './filing-outcome';
import type { CounterpartyRefusalReason } from './counterparty';
import type { ParseRoute } from '../pdf/parse-route';
import type {
  ClaimDiscard,
  ClaimRefusalReason,
  VerifiedClaim,
} from './claim.types';
import type { SummaryRefusalReason } from './claim-summary';
import type {
  ResultsFigureDiscard,
  ResultsRefusalReason,
  VerifiedResults,
} from './results.types';

/**
 * What the background worker did with a filing's attachment, and what it found.
 *
 * TYPES ONLY. The state machine they describe is the point of this module, so
 * it is written down here rather than left implicit in the worker:
 *
 *     pending ──fetch+parse ok──▶ enriched     (terminal, the good one)
 *        │
 *        ├──not a PDF / no text / oversized─▶ unparseable  (TERMINAL, never retried)
 *        │
 *        ├──truncated / unreadable bytes────▶ unparseable, but only once the
 *        │                                    filing is too old for the failure
 *        │                                    to be NSE's upload still running.
 *        │                                    While it is young: pending, with a
 *        │                                    parse-attempt budget of its own.
 *        │                                    See `parse-retry.ts`.
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
 *
 * IT IS ALSO WHERE THIS PIPELINE LOST A FILING. `LICHSGFIN` seqId 106727908 was
 * fetched minutes after publication, arrived without a `%%EOF`, was recorded
 * `truncated-at-origin` — and parsed cleanly on a later re-fetch of the same
 * URL, yielding 75,528 characters. The bytes were not truncated; this pipeline
 * had raced NSE's own upload and written the loss down as permanent. So the
 * two states that describe BYTES IN FLIGHT are terminal only once the filing is
 * old enough that a half-finished upload is no longer a possible explanation.
 * `parse-retry.ts` owns that decision and argues the window and the budget.
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
  /**
   * Times reading this filing's attachment ended without usable text.
   *
   * A SEPARATE BUDGET from `attempts`, not a subset of it. A timeout and a
   * half-written PDF are different failures with different remedies, and
   * sharing one counter would let three timeouts silently spend the allowance
   * that exists to survive NSE's upload race. See `parse-retry.ts`.
   */
  readonly parseAttempts: number;
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
  /**
   * Where the text came from, when it was not simply one PDF.
   *
   * Null for the ordinary case. For a ZIP it names every PDF entry that was
   * taken, its character count, and the entries that were ignored — because a
   * filing whose text is the concatenation of three documents is a different
   * object from one whose text is a document, and a reviewer reading a span
   * needs to know which file it came out of.
   *
   * A BOUNDED STRING rather than a sub-document array, deliberately. It is read
   * by a person and never queried; a nested schema would buy filtering nobody
   * has asked for and cost a migration on a collection this project rewrites
   * whole enrichment blocks into.
   */
  readonly documentSource: string | null;

  /**
   * Which parser produced the text this verdict was read from.
   *
   * STORED RATHER THAN DERIVED, and it is load-bearing rather than
   * informational: `results-verify.ts` takes a different heading-reach bound
   * depending on it — 400 characters for `pdf-parse` output and 2,400 for
   * Docling's, both measured — so a stored verdict cannot be re-checked without
   * knowing which parser wrote the text. Null on every filing enriched before
   * the hybrid existed, which reads as `pdf-parse` because that is what read
   * them.
   */
  readonly parseRoute: ParseRoute | null;
  /**
   * Why a chosen Docling route did not run. Null on the ordinary path.
   *
   * THE FIELD THAT MAKES AN OPTIONAL DEPENDENCY HONEST. Docling is allowed to be
   * absent and the pipeline is required to keep working without it — but a
   * results filing read by `pdf-parse` because a Python service has been down
   * since Tuesday must not look identical to one `pdf-parse` was the right
   * answer for. A rising count here is how that is noticed.
   */
  readonly parseFallbackReason: string | null;
  /**
   * Why the router picked the route it picked, verbatim. Always written on an
   * enriched filing; null only on blocks older than the field.
   *
   * `parseFallbackReason` above covers a Docling that was CHOSEN and failed —
   * but a Docling that is absent is never chosen, so an unconfigured service
   * produced blocks indistinguishable from healthy ones. That is how it ran
   * unreachable for three days (2026-08-08 to -11) at a measured cost of
   * halved results-table yield before anyone noticed: the router computed the
   * sentence "no Docling service is available" on every filing and threw it
   * away (2026-08-11 processing audit, finding 2).
   */
  readonly parseRouteReason: string | null;

  /**
   * Why no model read this document. Null when one did.
   *
   * COUNTED, NOT MERELY RECORDED. The results gap existed because a skipped
   * filing and an empty filing rendered identically; the remedy is that every
   * skip carries a machine-readable code the dashboard groups by, so "we chose
   * not to read 400 documents today" is a number somebody can see rather than an
   * absence.
   */
  readonly coverageSkip: CoverageSkipReason | null;

  // --- what the filing SAYS, which never depends on a model call -------------
  /**
   * One line saying what happened, composed from the exchange's own summary and
   * category by `composeOutcome`. Never null on a record this build wrote.
   *
   * ================================================================
   * MATERIALISED, AND THE DASHBOARD STILL DERIVES ITS OWN
   * ================================================================
   *
   * `filing-query.service.ts` computes this on READ and will keep doing so —
   * that is what let the whole existing collection gain an outcome the moment the
   * viewer restarted, with no migration, and it is what keeps a filing the worker
   * has never reached from rendering as a blank row.
   *
   * This copy exists for the question the derived one cannot answer: **how many
   * filings have an outcome?** A field computed in the render path is invisible to
   * `countDocuments`, so "every filing states an outcome" was a claim nobody could
   * check against the database, and the coverage gap this whole change set exists
   * to close was one that hid for weeks precisely because it was uncountable.
   *
   * The two cannot disagree. Both are `composeOutcome` over `symbol`, `category`
   * and `summary` — three fields the poller writes once on the hot path and
   * nothing ever updates — so the stored copy is a cache of a pure function over
   * immutable input rather than a second source of truth.
   *
   * It is ALSO the backfill's resume marker: a record carrying an outcome was
   * written by this build, and one that is not was not. See
   * `tools/enrichment/backfill-enrichment.ts`.
   */
  readonly outcome: string | null;
  /** Whether the outcome is the exchange's own sentence or merely its category. */
  readonly outcomeSource: OutcomeSource | null;
  /**
   * NSE's 111 categories folded to the readable set, stored for the same reason
   * the outcome is: so the distribution is a query rather than a render.
   */
  readonly categoryGroup: CategoryGroup | null;

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

  // --- the notable claims, or why there are none ----------------------------
  /**
   * Claims that survived the verbatim gate, each carrying the document's own
   * sentence. Empty is the ordinary case.
   */
  readonly claims: readonly VerifiedClaim[];
  /** The composed wire line, `SYMBOL: CLAIM || CLAIM`, or null. */
  readonly claimLine: string | null;
  /**
   * Claims the gate refused, with the reason.
   *
   * STORED RATHER THAN COUNTED. A model that starts inventing shows up here as
   * a rising `span-not-found` count against specific text somebody can read; a
   * bare number would say the rate moved and nothing about what moved it.
   */
  readonly claimDiscards: readonly ClaimDiscard[];
  /** How many the extractor proposed. Null when it was never called. */
  readonly claimsProposed: number | null;
  readonly claimRefusalReason: ClaimRefusalReason | null;
  readonly claimRefusalDetail: string | null;

  // --- the results table, or why there is none -------------------------------
  /**
   * The one results table this filing carries, every figure of which is
   * traceable to a quoted row of a statement whose basis, columns and scale the
   * document itself states.
   *
   * A SEPARATE FIELD FROM `claims`, and the separation is not cosmetic. A claim
   * is a sentence and is verified by finding that sentence. A results figure is
   * a cell, and what makes it publishable is that the table's own header block
   * says which statement it belongs to, which period its column is, and what
   * scale it is denominated in. Two different gates, two different records.
   */
  readonly results: VerifiedResults | null;
  /** The composed wire line, or null. */
  readonly resultsLine: string | null;
  /** Figures the gate refused, with the reason. */
  readonly resultsDiscards: readonly ResultsFigureDiscard[];
  /** How many figures the extractor proposed. Null when it was never called. */
  readonly resultsProposed: number | null;
  readonly resultsRefusalReason: ResultsRefusalReason | null;
  readonly resultsRefusalDetail: string | null;

  // --- the model's own summary, which is NOT a claim -------------------------
  /**
   * One or two sentences of MODEL PROSE about the document. Unverified.
   *
   * DELIBERATELY NOT IN `claims`, and the separation is the point. Every claim
   * carries the sentence it was read from and was matched against the document
   * before it was stored; this cannot be, because a summary compresses a whole
   * document and there is no single sentence to match. It exists for the
   * dashboard and the later human-reviewed teardown lane, and it must NEVER
   * reach the Telegram path or any other outward-facing surface as fact.
   * `claim-summary.ts` argues it in full.
   */
  readonly documentSummary: string | null;
  /** Why there is no summary. Null when there is one, or none was attempted. */
  readonly documentSummaryRefusalReason: SummaryRefusalReason | null;

  /** The composed headline, stored so what was sent can be audited later. */
  readonly headline: string | null;
  /** The derived-context line, or null when none could be computed. */
  readonly contextLine: string | null;
}

/** The enrichment a never-attempted filing carries. */
export const PENDING_ENRICHMENT: FilingEnrichment = {
  state: 'pending',
  attempts: 0,
  parseAttempts: 0,
  attemptedAt: null,
  nextAttemptAt: null,
  unparseableReason: null,
  lastError: null,
  documentChars: null,
  documentSource: null,
  parseRoute: null,
  parseFallbackReason: null,
  parseRouteReason: null,
  coverageSkip: null,
  outcome: null,
  outcomeSource: null,
  categoryGroup: null,
  amountRupees: null,
  amountEvidence: null,
  amountAnchor: null,
  amountLabel: null,
  amountRefusalReason: null,
  amountRefusalDetail: null,
  counterparty: null,
  counterpartyEvidence: null,
  counterpartyRefusalReason: null,
  claims: [],
  claimLine: null,
  claimDiscards: [],
  claimsProposed: null,
  claimRefusalReason: null,
  claimRefusalDetail: null,
  results: null,
  resultsLine: null,
  resultsDiscards: [],
  resultsProposed: null,
  resultsRefusalReason: null,
  resultsRefusalDetail: null,
  documentSummary: null,
  documentSummaryRefusalReason: null,
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
