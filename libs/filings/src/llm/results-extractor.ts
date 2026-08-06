import type { ProposedResults } from '../logic/results.types';
import type { ClaimExtractionRequest } from './claim-extractor';
import type { ClaimUsage } from './claim-provider';

/**
 * The seam between "read a document" and "ask a model for its results table".
 *
 * TYPES ONLY, and a SEPARATE INTERFACE from `ClaimExtractor` rather than a
 * second method bolted onto it. The two are implemented by the same adapter
 * classes, but a worker holding one of them should not be able to call the
 * other by accident, and — more importantly — a deployment can have a claim
 * extractor and no results extractor, or the reverse, without either lane
 * pretending the other is configured.
 *
 * The REQUEST shape is shared deliberately: both lanes are given the same
 * symbol, category, exchange summary and document text, so a difference in what
 * they produce is a difference in what was asked, never in what was sent.
 */

export type ResultsExtractionResult =
  /**
   * The model answered. `results` is null when the document carries no
   * statement, which is the ordinary answer for most filings in the eligible
   * categories — a board-meeting outcome about a dividend has no table in it.
   */
  | {
      readonly outcome: 'ok';
      readonly results: ProposedResults | null;
      readonly usage?: ClaimUsage;
    }
  /**
   * The model could not be asked or did not answer usably.
   *
   * A VERDICT RATHER THAN AN EXCEPTION, for the reason `ClaimExtractionResult`
   * gives: thrown from inside the worker's loop, an API error is
   * indistinguishable from a bug in the reading path.
   */
  | { readonly outcome: 'failed'; readonly message: string };

/** The one call the worker makes into a results extractor. */
export interface ResultsExtractor {
  extractResults(
    request: ClaimExtractionRequest,
  ): Promise<ResultsExtractionResult>;
}
