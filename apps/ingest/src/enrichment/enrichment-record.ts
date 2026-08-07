import {
  categoryGroupFor,
  composeOutcome,
  type Filing,
  type FilingEnrichment,
  type ZipTextOk,
} from '@app/filings';

/**
 * The parts of a stored enrichment that do not depend on having read anything.
 *
 * SPLIT OUT OF THE WORKER for the reason the coverage work exists at all: these
 * are what a filing says when every other field is null, and they are easiest to
 * keep honest when they are not buried in the middle of the code that fails to
 * read documents.
 */

/**
 * What the filing SAYS, on every write path without exception.
 *
 * DERIVED FROM FIELDS THE POLLER ALWAYS WROTE — `symbol`, `category` and
 * `summary` — so it costs no fetch, no model call and no branch, and it is
 * therefore present on a filing whose PDF is a raster scan, whose attachment URL
 * is NSE's `"-"` sentinel and whose extractor returned a 429. Those three
 * populations produced a completely blank row before the coverage work, and a
 * blank row is what hid quarterly results for weeks.
 *
 * Spread into `blankVerdict` as well as into the enriched record, which is the
 * whole point: the states that mean "this document could not be read" are
 * exactly the ones that most need to still say what the filing was.
 */
export const outcomeFieldsFor = (
  filing: Filing,
): Pick<FilingEnrichment, 'outcome' | 'outcomeSource' | 'categoryGroup'> => {
  const outcome = composeOutcome(filing);
  return {
    outcome: outcome.text,
    outcomeSource: outcome.source,
    categoryGroup: categoryGroupFor(filing.category),
  };
};

/**
 * An enrichment carrying no verdict: the counters, the clock, and eighteen
 * nulls.
 *
 * Exists because `recordEnrichment` `$set`s the WHOLE block rather than the
 * fields that changed, which is what stops a filing ending up with an amount
 * from one attempt and a refusal reason from another. Three call sites need
 * that same wall of nulls, and three hand-written copies is three chances for
 * one of them to forget a field and silently carry a stale value forward.
 */
export const blankVerdict = (
  filing: Filing,
  attempts: number,
  parseAttempts: number,
  now: Date,
): Omit<FilingEnrichment, 'state'> => ({
  attempts,
  parseAttempts,
  attemptedAt: now,
  nextAttemptAt: null,
  unparseableReason: null,
  lastError: null,
  documentChars: null,
  documentSource: null,
  parseRoute: null,
  parseFallbackReason: null,
  coverageSkip: null,
  ...outcomeFieldsFor(filing),
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
});

/**
 * The one-line provenance a ZIP-sourced document carries.
 *
 * Names every PDF entry with its own character count, because the text stored
 * on the filing is the concatenation of several documents and a reviewer
 * reading a span needs to know which of them it came out of. The ignored names
 * are listed too: an archive whose MP3 was skipped and one that contained only
 * the PDF are different facts about the filing.
 */
export const describeZipSource = (opened: ZipTextOk): string => {
  const members = opened.members
    .map(
      (member) =>
        `${member.fileName} (${member.chars === null ? `unreadable: ${member.message ?? 'no reason given'}` : `${member.chars} chars`})`,
    )
    .join(', ');
  const ignored =
    opened.ignored.length === 0 ? '' : `; ignored ${opened.ignored.join(', ')}`;
  return `zip: ${members}${ignored}`.slice(0, MAX_DOCUMENT_SOURCE_CHARS);
};

/** How much provenance is kept. Long enough for three entries and their names. */
export const MAX_DOCUMENT_SOURCE_CHARS = 500;
