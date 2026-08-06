import {
  extractMaterialAmount,
  type AmountAnchor,
  type AmountRefusalReason,
} from './amount-extraction';
import {
  extractCounterparty,
  type CounterpartyRefusalReason,
} from './counterparty';
import { composeHeadline, type HeadlineForm } from './headline';

/**
 * Everything a filing's document text yields, in one pure function.
 *
 * The worker owns fetching, retrying and persisting; this owns READING, and it
 * does so with no clock, no network and no database. That split is what lets
 * the whole reading path — the amount, the counterparty, the headline and the
 * decision to degrade — be tested against the committed corpus without a single
 * HTTP request.
 *
 * The ORDER matters and is the one piece of policy here: the counterparty is
 * looked for only when an amount was extracted. Not because the extraction
 * would be wrong otherwise, but because a counterparty can only ever reach the
 * wire attached to an amount (see `headline.ts`), so looking for one on a
 * refused filing would store a name nothing may use and invite a later change
 * to use it.
 */

export interface DocumentVerdictInput {
  readonly symbol: string;
  readonly category: string;
  readonly summary: string;
  /** Text extracted from the attachment. */
  readonly documentText: string;
}

/** The fields of a `FilingEnrichment` that come from reading the document. */
export interface DocumentVerdict {
  readonly documentChars: number;
  readonly amountRupees: number | null;
  readonly amountEvidence: string | null;
  readonly amountAnchor: AmountAnchor | null;
  readonly amountLabel: string | null;
  readonly amountRefusalReason: AmountRefusalReason | null;
  readonly amountRefusalDetail: string | null;
  readonly counterparty: string | null;
  readonly counterpartyEvidence: string | null;
  readonly counterpartyRefusalReason: CounterpartyRefusalReason | null;
  readonly headline: string;
  readonly headlineForm: HeadlineForm;
}

/**
 * Reads one filing's document.
 *
 * NEVER THROWS and never partially fills the result: every field is set on
 * every path, so a stored enrichment can never carry an amount from the
 * extractor and a refusal reason from a previous attempt.
 */
export function readDocument(input: DocumentVerdictInput): DocumentVerdict {
  const { symbol, category, summary, documentText } = input;

  const amount = extractMaterialAmount({ documentText, category, summary });

  // Null means "not looked for", which is a different fact from "looked for and
  // refused" and is stored as a different value.
  const counterparty =
    amount.outcome === 'extracted' ? extractCounterparty(documentText) : null;

  const headline = composeHeadline({
    symbol,
    category,
    amountRupees: amount.outcome === 'extracted' ? amount.rupees : null,
    counterparty:
      counterparty?.outcome === 'extracted' ? counterparty.name : null,
  });

  return {
    documentChars: documentText.length,

    amountRupees: amount.outcome === 'extracted' ? amount.rupees : null,
    amountEvidence:
      amount.outcome === 'extracted' ? amount.provenance.evidence : null,
    amountAnchor:
      amount.outcome === 'extracted' ? amount.provenance.anchor : null,
    amountLabel:
      amount.outcome === 'extracted' ? amount.provenance.label : null,
    amountRefusalReason: amount.outcome === 'refused' ? amount.reason : null,
    amountRefusalDetail: amount.outcome === 'refused' ? amount.detail : null,

    counterparty:
      counterparty?.outcome === 'extracted' ? counterparty.name : null,
    counterpartyEvidence:
      counterparty?.outcome === 'extracted' ? counterparty.evidence : null,
    counterpartyRefusalReason:
      counterparty?.outcome === 'refused' ? counterparty.reason : null,

    headline: headline.text,
    headlineForm: headline.form,
  };
}
