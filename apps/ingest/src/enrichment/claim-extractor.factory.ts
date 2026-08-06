import type { ClaimExtractor } from '@app/filings';
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
}

export function buildClaimExtractor(
  config: ClaimExtractorConfig,
): ClaimExtractor | null {
  if (!config.claimsEnabled) return null;

  const options = {
    model: config.claimModel,
    effort: config.claimEffort,
    maxDocumentChars: config.claimMaxDocumentChars,
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
