import { Schema, type Document } from 'mongoose';
import type { Filing } from '../filing.types';
import type { FilingEnrichment } from '../logic/enrichment.types';

export type FilingDocument = Filing &
  Document & {
    enrichment?: FilingEnrichment;
    /** When a backfill sweep last re-read this filing. See below. */
    backfilledAt?: Date | null;
  };

/**
 * What the background worker learned from a filing's attachment.
 *
 * `_id: false` because this is a value, not an entity — it has no identity
 * apart from the filing it hangs off, and a generated ObjectId on every one
 * would be 12 bytes per filing bought for nothing.
 *
 * EVERY FIELD DEFAULTS TO NULL AND NOTHING IS REQUIRED. The document is written
 * by one process and read by another, and a required field would mean a
 * mongoose validation error inside the worker's write path for a shape a future
 * version of this code produces — which is exactly the class of failure that
 * loses a filing quietly.
 */
/**
 * One verified claim: the wire text, the document's own sentence, and what kind
 * of thing it is. `_id: false` for the same reason the enrichment block has it —
 * these are values hanging off a filing, not entities.
 */
const ClaimSchema = new Schema(
  {
    text: { type: String, default: '' },
    span: { type: String, default: '' },
    kind: { type: String, default: 'operational' },
    // Null on every claim stored before the period rule existed, and null on
    // every claim whose own sentence states its quarter. Defaulted rather than
    // required so a filing written by the previous build reads back cleanly.
    periodSpan: { type: String, default: null },
  },
  { _id: false },
);

/** One refused claim, kept so a refusal can be read rather than counted. */
const ClaimDiscardSchema = new Schema(
  {
    reason: { type: String, default: '' },
    claim: { type: String, default: '' },
    detail: { type: String, default: '' },
  },
  { _id: false },
);

/** One verified results figure: the metric, both values, the unit, the row. */
const ResultsFigureSchema = new Schema(
  {
    metric: { type: String, default: '' },
    current: { type: String, default: '' },
    prior: { type: String, default: '' },
    // The wire token for the scale the document declared: CR, MN, %, or empty
    // for a per-share figure. Stored as the document's scale abbreviated, never
    // as a rescaling of the value beside it.
    unit: { type: String, default: '' },
    span: { type: String, default: '' },
  },
  { _id: false },
);

/**
 * The one results table a filing carries.
 *
 * `basisSpan` and `columnsSpan` are stored beside the figures rather than
 * derived on read, because they are the EVIDENCE: the heading that fixed
 * consolidated against standalone, and the column dates that made the
 * comparison year-on-year. A reviewer who cannot see those two cannot check the
 * line, and re-deriving them later would be reading a document that may since
 * have been re-parsed by different code.
 */
const ResultsSchema = new Schema(
  {
    basis: { type: String, default: '' },
    basisSpan: { type: String, default: '' },
    columnsSpan: { type: String, default: '' },
    period: { type: String, default: '' },
    priorPeriod: { type: String, default: '' },
    figures: { type: [ResultsFigureSchema], default: [] },
  },
  { _id: false },
);

/** One refused figure, kept so a refusal can be read rather than counted. */
const ResultsDiscardSchema = new Schema(
  {
    reason: { type: String, default: '' },
    metric: { type: String, default: '' },
    figure: { type: String, default: '' },
    detail: { type: String, default: '' },
  },
  { _id: false },
);

const EnrichmentSchema = new Schema<FilingEnrichment>(
  {
    state: { type: String, default: 'pending' },
    attempts: { type: Number, default: 0 },
    parseAttempts: { type: Number, default: 0 },
    attemptedAt: { type: Date, default: null },
    nextAttemptAt: { type: Date, default: null },
    unparseableReason: { type: String, default: null },
    lastError: { type: String, default: null },
    documentChars: { type: Number, default: null },
    documentSource: { type: String, default: null },
    // Which parser read the document, and why an expensive one did not. Null on
    // every filing written before the hybrid existed, which reads as
    // `pdf-parse` because that is what read them.
    parseRoute: { type: String, default: null },
    parseFallbackReason: { type: String, default: null },
    coverageSkip: { type: String, default: null },
    // What the filing SAYS, materialised from the exchange's own words so that
    // "every filing states an outcome" is a `countDocuments` rather than a claim
    // only the render path could support. See `enrichment.types.ts`.
    outcome: { type: String, default: null },
    outcomeSource: { type: String, default: null },
    categoryGroup: { type: String, default: null },
    amountRupees: { type: Number, default: null },
    amountEvidence: { type: String, default: null },
    amountAnchor: { type: String, default: null },
    amountLabel: { type: String, default: null },
    amountRefusalReason: { type: String, default: null },
    amountRefusalDetail: { type: String, default: null },
    counterparty: { type: String, default: null },
    counterpartyEvidence: { type: String, default: null },
    counterpartyRefusalReason: { type: String, default: null },
    claims: { type: [ClaimSchema], default: [] },
    claimLine: { type: String, default: null },
    claimDiscards: { type: [ClaimDiscardSchema], default: [] },
    claimsProposed: { type: Number, default: null },
    claimRefusalReason: { type: String, default: null },
    claimRefusalDetail: { type: String, default: null },
    // A SEPARATE FIELD from `claims`, and a separate gate: a claim is a
    // sentence and a results figure is a cell. See `results.types.ts`.
    results: { type: ResultsSchema, default: null },
    resultsLine: { type: String, default: null },
    resultsDiscards: { type: [ResultsDiscardSchema], default: [] },
    resultsProposed: { type: Number, default: null },
    resultsRefusalReason: { type: String, default: null },
    resultsRefusalDetail: { type: String, default: null },
    // A SEPARATE FIELD from `claims`, and never merged into it: this is model
    // prose that no span verifies. See `claim-summary.ts`.
    documentSummary: { type: String, default: null },
    documentSummaryRefusalReason: { type: String, default: null },
    headline: { type: String, default: null },
    contextLine: { type: String, default: null },
  },
  { _id: false },
);

export const FilingSchema = new Schema<FilingDocument>(
  {
    seqId: { type: Number, required: true, unique: true, index: true },
    symbol: { type: String, required: true, index: true },
    isin: { type: String, required: true, index: true },
    companyName: { type: String, required: true },
    industry: { type: String, default: null },
    category: { type: String, required: true, index: true },
    summary: { type: String, default: '' },
    attachmentUrl: { type: String, default: null },
    announcedAt: { type: Date, required: true },
    disseminatedAt: { type: Date, required: true, index: true },
    ingestedAt: { type: Date, required: true },
    /**
     * DELIBERATELY WITHOUT A DEFAULT.
     *
     * A default would make `insertNew` write eighteen null fields on every
     * filing, on the 2-second hot path whose whole job is to store and alert
     * before anything else happens. Absence means "never attempted" and is read
     * that way everywhere: the claim query matches a missing `enrichment.state`
     * alongside an explicit `'pending'`, and the dashboard projects a missing
     * block to the same pending view. The worker is the only writer.
     */
    enrichment: { type: EnrichmentSchema, required: false },
    /**
     * When a backfill sweep last re-read this filing's document. Null on the
     * ordinary path, which is every filing the poller has ever stored.
     *
     * OUTSIDE THE ENRICHMENT BLOCK, deliberately, and that is the whole reason
     * it is a separate field rather than one more nullable column in there.
     * `recordEnrichment` `$set`s the enrichment block WHOLE — that is what stops
     * a filing carrying an amount from one attempt and a refusal from another —
     * so a marker living inside it would be erased by the very write it is
     * supposed to mark, and the sweep would restart from the beginning after
     * every interruption.
     *
     * It is what makes `enrich:backfill` resumable and idempotent: the sweep
     * claims filings this is null on, sets it in the same atomic write as the
     * verdict, and therefore finds nothing on a second run. See
     * `tools/enrichment/backfill-enrichment.ts`.
     */
    backfilledAt: { type: Date, default: null },
  },
  { collection: 'filings', versionKey: false },
);

/**
 * Serves the worker's claim query: the non-terminal states, newest first.
 *
 * Without it, draining the queue is a collection scan per tick against the same
 * collection the poller is inserting into. Partial rather than full — the
 * terminal states are the overwhelming majority once the backlog is drained,
 * and they are never the answer to this query.
 */
FilingSchema.index(
  { 'enrichment.state': 1, disseminatedAt: -1 },
  { name: 'enrichment_state_1_disseminatedAt_-1' },
);

/**
 * Serves the derived-context queries, which ask "how many filings of this
 * category has this symbol made lately" on the alert path.
 *
 * `symbol_1` alone would work and would scan every filing the symbol has ever
 * made; a symbol filing daily accumulates those without bound. This index
 * answers the count from the index alone.
 */
FilingSchema.index(
  { symbol: 1, category: 1, disseminatedAt: -1 },
  { name: 'symbol_1_category_1_disseminatedAt_-1' },
);
