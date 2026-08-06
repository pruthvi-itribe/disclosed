import type { ProposedClaim } from '../logic/claim.types';

/**
 * The seam between "read a document" and "call a model".
 *
 * Types only, and the reason is the same one `pdf-text.ts` gives for existing:
 * the worker's tests must never make a network request, and `libs/filings`'s
 * barrel is imported by the read-only dashboard, which must never load an SDK
 * it will never use. Both are served by making the extractor an interface the
 * worker holds and `claude-claim-extractor.ts` implements.
 */

export interface ClaimExtractionRequest {
  readonly symbol: string;
  readonly category: string;
  readonly summary: string;
  readonly documentText: string;
}

export type ClaimExtractionResult =
  /** The model answered. `claims` may be empty, which is the usual case. */
  | { readonly outcome: 'ok'; readonly claims: readonly ProposedClaim[] }
  /**
   * The model could not be asked or did not answer usably.
   *
   * A VERDICT RATHER THAN AN EXCEPTION, exactly as `extractPdfText` returns one:
   * thrown from inside the worker's loop, an API error is indistinguishable
   * from a bug in the reading path and would be logged as one. Returned, the
   * caller records "the extractor failed" as a fact about the filing.
   */
  | { readonly outcome: 'failed'; readonly message: string };

/** The one call the worker makes into a claim extractor. */
export interface ClaimExtractor {
  extract(request: ClaimExtractionRequest): Promise<ClaimExtractionResult>;
}
