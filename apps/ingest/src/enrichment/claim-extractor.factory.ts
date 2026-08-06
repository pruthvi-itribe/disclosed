import type { ClaimExtractor, ResultsExtractor } from '@app/filings';
// NOT from the barrel, deliberately. These modules pull in a provider's client
// at require time, and `@app/filings` is also imported by the read-only
// dashboard, which never calls a model. Same reasoning as `pdf-text.ts`'s lazy
// require. Both are named here rather than resolved dynamically so the
// dependency is visible to a reader and to the build.
import { ClaudeClaimExtractor } from '@app/filings/llm/claude-claim-extractor';
import { OpenRouterClaimExtractor } from '@app/filings/llm/openrouter-claim-extractor';
import {
  claimApiKeyOf,
  type ClaimEffort,
  type ClaimProvider,
} from '../config/configuration';

/**
 * Deciding whether there is a claim extractor at all, and which one.
 *
 * A few lines of policy that would otherwise live inside a Nest factory, where
 * nothing can reach them. Every branch matters and every one is a state an
 * operator will actually be in: the switch turned off is a decision, a switch
 * left on with no key is a misconfiguration, and each produces a DIFFERENT
 * record on every filing — which is what tells them apart on the dashboard
 * afterwards.
 *
 * THE PROVIDER IS THE ONLY THING THAT VARIES. Both adapters satisfy
 * `ClaimExtractor`, so nothing downstream of this function — not the worker, not
 * the verbatim gate, not the line composer, not the alert — can tell which one
 * it was given. That is what makes an A/B comparison a comparison rather than
 * two different pipelines.
 *
 * NULL IS A SUPPORTED RETURN, not a failure. The worker keeps reading documents,
 * keeps extracting amounts, keeps composing headlines, and records
 * `extractor-unavailable` against every eligible filing. A pipeline with no key
 * degrades to exactly what it was before this feature existed.
 */
export interface ClaimExtractorConfig {
  readonly claimsEnabled: boolean;
  readonly claimProvider: ClaimProvider;
  readonly anthropicApiKey: string;
  readonly openrouterApiKey: string;
  readonly claimModel: string;
  readonly claimEffort: ClaimEffort;
  readonly claimMaxDocumentChars: number;
  readonly resultsEnabled: boolean;
}

/**
 * One object, both lanes.
 *
 * Both adapters implement `ClaimExtractor` AND `ResultsExtractor`, so the two
 * lanes share one client, one key and one set of provider options. What they do
 * NOT share is a switch: `buildResultsExtractor` reads its own flag, so an
 * operator can run either lane alone.
 */
export type FilingExtractor = ClaimExtractor & ResultsExtractor;

/**
 * The client, or null when the operator configured none.
 *
 * Built once whatever the two lane switches say, because a client is a key and a
 * timeout and nothing else; the switches decide which lanes are handed it.
 */
function buildExtractor(config: ClaimExtractorConfig): FilingExtractor | null {
  const options = {
    model: config.claimModel,
    effort: config.claimEffort,
    maxDocumentChars: config.claimMaxDocumentChars,
    // The results lane needs more of the document than the claim lane: a
    // statutory statement is not at the front. See `ClaimProviderOptions`.
    maxResultsDocumentChars: config.claimMaxDocumentChars,
  };
  const apiKey = claimApiKeyOf(config);

  // An exhaustive switch rather than a lookup, so adding a provider without
  // wiring it here fails to compile instead of silently returning null.
  switch (config.claimProvider) {
    case 'openrouter':
      return OpenRouterClaimExtractor.fromApiKey(apiKey, options);
    case 'anthropic':
      return ClaudeClaimExtractor.fromApiKey(apiKey, options);
  }
}

export function buildClaimExtractor(
  config: ClaimExtractorConfig,
): ClaimExtractor | null {
  if (!config.claimsEnabled) return null;
  return buildExtractor(config);
}

/**
 * The results extractor, or null.
 *
 * A SEPARATE FUNCTION rather than a cast of the claim one, so that
 * `CLAIM_ENABLED=false RESULTS_ENABLED=true` is a configuration that works
 * instead of one that silently reads nothing.
 */
export function buildResultsExtractor(
  config: ClaimExtractorConfig,
): ResultsExtractor | null {
  if (!config.resultsEnabled) return null;
  return buildExtractor(config);
}
