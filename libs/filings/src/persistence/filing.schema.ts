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

/**
 * Serves the type-ahead's company directory, and nothing else.
 *
 * The directory asks one question — "every distinct (symbol, companyName) and
 * how many filings each has" — and this index answers it FROM THE INDEX ALONE.
 * Measured on the live collection of 2,243 filings, with the pipeline in
 * `apps/dashboard/src/search/company-directory.ts` and the hint it pins:
 *
 *   without a hint   COLLSCAN            2,243 docs examined,     0 keys, 2ms
 *   with the hint    PROJECTION_COVERED       0 docs examined, 2,243 keys, 5ms
 *
 * ZERO DOCUMENTS EXAMINED is the whole reason this index exists. A viewer
 * building a suggestion list must not pull 2,243 documents through the page
 * cache the ingest poller is using for its own working set — the two processes
 * share this collection and the poller's job is not to be slowed down by
 * somebody typing.
 *
 * NOT REDUNDANT WITH `symbol_1_category_1_disseminatedAt_-1`, which shares its
 * `symbol` prefix. That one carries `category` second and therefore cannot cover
 * a projection of `companyName`; a `$group` against it fetches every document
 * and the measurement above is exactly what that costs. This is the only index
 * on the collection from which a company's NAME can be read without reading the
 * company's filings.
 *
 * The hint is load-bearing and is asserted by the spec: without a predicate the
 * planner has no reason to prefer an index over a scan, even one that covers the
 * projection completely.
 */
FilingSchema.index(
  { symbol: 1, companyName: 1 },
  { name: 'symbol_1_companyName_1' },
);

/**
 * Serves the search box: one weighted text index over everything a reader could
 * reasonably be searching FOR.
 *
 * ================================================================
 * WHY A TEXT INDEX AND NOT A REGEX
 * ================================================================
 *
 * The search this replaces was a prefix match on `symbol`. A reader typing
 * `britannia`, `lupin pharma`, `solar` or `stock split` got nothing, because
 * none of those is the beginning of a ticker. The obvious repair — a
 * case-insensitive regex over `companyName` and `summary` — is the wrong one
 * twice over: a regex with the `i` flag CANNOT USE AN INDEX, so every keystroke
 * becomes a collection scan against a collection a live poller is inserting
 * into; and a pattern assembled from request text is both an injection surface
 * and a ReDoS one, which `filing-query.service.ts` already refuses for `symbol`.
 *
 * A text index has neither problem. Measured on the live collection:
 *
 *   $search 'britannia'     5 returned,   5 keys,   5 docs,  3ms
 *   $search 'solar'        29 returned,  29 keys,  29 docs,  0ms
 *   $search 'lupin pharma' 26 returned,  26 keys,  26 docs,  0ms
 *   $search 'stock split' 369 returned, 376 keys, 369 docs,  1ms
 *   $search 'zzzqqq'        0 returned,   0 keys,   0 docs,  0ms
 *
 * Keys examined equals documents returned: the index is doing all of the work
 * and the FETCH is only pulling rows that are already answers. The plan is
 * `TEXT_MATCH → TEXT_OR → IXSCAN` per term, which is why a two-word query plans
 * as two index scans and why `MAX_SEARCH_TERMS` caps how many a reader can ask
 * for.
 *
 * ================================================================
 * WHAT IS IN IT, AND WHAT IS DELIBERATELY NOT
 * ================================================================
 *
 * The nine fields below are the ones that carry what a filing SAYS. The weights
 * are not a ranking on their own — the search's ordering is a three-tier rule in
 * `search-rank.ts` and the score only separates rows inside the last tier — but
 * they decide which body match beats which, so they run from identity (`symbol`)
 * through description (`companyName`, `category`) to content.
 *
 * `enrichment.claims.span` and `enrichment.results.*.span` are OUT. They are the
 * raw PDF sentences the claim text was verified against — the same content in a
 * rawer form, with the line breaks and the hyphenation a text layer leaves
 * behind. Indexing them would roughly double a 1.3MB index (measured, 2,243
 * filings) to make `britannia` match the same filings twice.
 *
 * `isin` is OUT: it has an exact-match index of its own and nobody searches for
 * an identifier by fragment.
 *
 * ONE TEXT INDEX PER COLLECTION IS A MONGODB LIMIT, so this is the only one
 * there can be. Adding a field here later is an index rebuild, not a new index.
 */
FilingSchema.index(
  {
    symbol: 'text',
    companyName: 'text',
    category: 'text',
    summary: 'text',
    'enrichment.outcome': 'text',
    'enrichment.claimLine': 'text',
    'enrichment.resultsLine': 'text',
    'enrichment.claims.text': 'text',
    'enrichment.documentSummary': 'text',
  },
  {
    name: 'filing_text',
    // The exchange publishes in English and the extractor writes in English;
    // naming it rather than defaulting means a future stored `language` field
    // cannot silently re-stem the whole index.
    default_language: 'english',
    weights: {
      // Identity beats description beats content. A filing whose SYMBOL is the
      // query is about the company the reader named; one whose claim line
      // mentions it may merely be a counterparty.
      symbol: 40,
      companyName: 20,
      category: 8,
      // The exchange's own sentence, which is mostly `<name> has informed the
      // Exchange about <category>` — it restates the two fields above it, so it
      // is weighted below both rather than counting them a second time.
      summary: 4,
      'enrichment.outcome': 4,
      'enrichment.claimLine': 2,
      'enrichment.resultsLine': 2,
      'enrichment.claims.text': 2,
      // The one line on a filing that no span was matched against. It is
      // searchable because it is often the only prose a scanned document
      // yielded, and it is last because it is the only field here that nothing
      // verified.
      'enrichment.documentSummary': 1,
    },
  },
);
