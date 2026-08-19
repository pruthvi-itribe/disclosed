import type { GistAnswer, GistRequestItem } from '../logic/gist-prompt';
import type { ClaimUsage } from './claim-provider';

/**
 * The seam between "hold a batch of claims" and "call a model", for the
 * same reason `claim-extractor.ts` exists: the worker's and the tool's
 * tests must never make a network request, and `libs/filings`'s barrel is
 * imported by the read-only dashboard, which must never load an SDK.
 *
 * The contract is deliberately thin. Everything that decides whether an
 * answer may be published lives in `verifyGist`, on the caller's side of
 * this line, so no adapter can widen it.
 */

export type GistExtractionResult =
  /** The model answered. `answers` may be short or empty. */
  | {
      readonly outcome: 'ok';
      readonly answers: readonly GistAnswer[];
      readonly usage?: ClaimUsage;
    }
  /**
   * The model could not be asked, or did not answer usably. A VERDICT
   * RATHER THAN AN EXCEPTION: thrown, an API error is indistinguishable
   * from a bug in the calling loop.
   */
  | { readonly outcome: 'failed'; readonly reason: string };

export interface GistExtractor {
  proposeGists(
    items: readonly GistRequestItem[],
  ): Promise<GistExtractionResult>;
}
