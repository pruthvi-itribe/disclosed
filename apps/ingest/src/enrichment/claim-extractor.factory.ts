import type { ClaimExtractor } from '@app/filings';
// NOT from the barrel, deliberately. This module pulls in the Anthropic SDK at
// require time, and `@app/filings` is also imported by the read-only dashboard,
// which never calls a model. Same reasoning as `pdf-text.ts`'s lazy require.
import { ClaudeClaimExtractor } from '@app/filings/llm/claude-claim-extractor';
import type { ClaimEffort } from '../config/configuration';

/**
 * Deciding whether there is a claim extractor at all.
 *
 * Three lines of policy that would otherwise live inside a Nest factory, where
 * nothing can reach them. Both branches matter and both are states an operator
 * will actually be in: the switch turned off is a decision, and a switch left on
 * with no key is a misconfiguration — and each produces a DIFFERENT record on
 * every filing, which is what tells the two apart on the dashboard afterwards.
 *
 * NULL IS A SUPPORTED RETURN, not a failure. The worker keeps reading documents,
 * keeps extracting amounts, keeps composing headlines, and records
 * `extractor-unavailable` against every eligible filing. A pipeline with no key
 * degrades to exactly what it was before this feature existed.
 */
export interface ClaimExtractorConfig {
  readonly claimsEnabled: boolean;
  readonly anthropicApiKey: string;
  readonly claimModel: string;
  readonly claimEffort: ClaimEffort;
}

export function buildClaimExtractor(
  config: ClaimExtractorConfig,
): ClaimExtractor | null {
  if (!config.claimsEnabled) return null;
  return ClaudeClaimExtractor.fromApiKey(config.anthropicApiKey, {
    model: config.claimModel,
    effort: config.claimEffort,
  });
}
