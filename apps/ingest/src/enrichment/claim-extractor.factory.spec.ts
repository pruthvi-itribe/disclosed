import { ClaudeClaimExtractor } from '@app/filings/llm/claude-claim-extractor';
import { OpenRouterClaimExtractor } from '@app/filings/llm/openrouter-claim-extractor';
import {
  buildClaimExtractor,
  type ClaimExtractorConfig,
} from './claim-extractor.factory';

const config = (
  overrides: Partial<ClaimExtractorConfig> = {},
): ClaimExtractorConfig => ({
  claimsEnabled: true,
  claimProvider: 'anthropic',
  anthropicApiKey: 'sk-ant-not-a-real-key',
  openrouterApiKey: 'sk-or-v1-not-a-real-key',
  claimModel: 'claude-opus-5',
  claimEffort: 'medium',
  claimMaxDocumentChars: 96_000,
  ...overrides,
});

describe('buildClaimExtractor', () => {
  it('builds one when the lane is on and a key is present', () => {
    expect(buildClaimExtractor(config())).not.toBeNull();
  });

  it.each([
    ['the lane is switched off', { claimsEnabled: false }],
    ['no key is configured', { anthropicApiKey: '' }],
    ['the key is only whitespace', { anthropicApiKey: '   ' }],
  ] as const)('returns null when %s', (_label, overrides) => {
    // A supported state, not a failure: the worker keeps reading documents and
    // every eligible filing records `extractor-unavailable` instead of a claim.
    expect(buildClaimExtractor(config(overrides))).toBeNull();
  });

  it('never builds one when the lane is off, key or no key', () => {
    expect(
      buildClaimExtractor(
        config({ claimsEnabled: false, anthropicApiKey: 'sk-ant-x' }),
      ),
    ).toBeNull();
  });
});

describe('buildClaimExtractor: which provider', () => {
  it.each([
    ['anthropic', ClaudeClaimExtractor],
    ['openrouter', OpenRouterClaimExtractor],
  ] as const)('builds the %s adapter', (claimProvider, expected) => {
    expect(buildClaimExtractor(config({ claimProvider }))).toBeInstanceOf(
      expected,
    );
  });

  it.each([
    ['anthropic', { anthropicApiKey: '' }, { openrouterApiKey: '' }],
    ['openrouter', { openrouterApiKey: '' }, { anthropicApiKey: '' }],
  ] as const)(
    'the %s provider needs its OWN key and ignores the other one',
    (claimProvider, itsKeyMissing, theOtherMissing) => {
      // The failure this pins: an operator switches provider, keeps the key
      // they already had, and the lane reports itself configured while every
      // eligible filing records an authentication error. The selected
      // provider's key is the only one that decides.
      expect(
        buildClaimExtractor(config({ claimProvider, ...itsKeyMissing })),
      ).toBeNull();
      expect(
        buildClaimExtractor(config({ claimProvider, ...theOtherMissing })),
      ).not.toBeNull();
    },
  );

  it('passes the configured model and effort to whichever it builds', () => {
    // Not a formality: the model default is per provider, so a factory that
    // dropped the configured value would send one provider the other's model.
    const built = buildClaimExtractor(
      config({
        claimProvider: 'openrouter',
        claimModel: 'deepseek/deepseek-v4-flash-0731',
        claimEffort: 'high',
      }),
    );
    expect(built).toBeInstanceOf(OpenRouterClaimExtractor);
    expect(
      (built as unknown as { options: Record<string, unknown> }).options,
    ).toEqual({
      model: 'deepseek/deepseek-v4-flash-0731',
      effort: 'high',
      maxDocumentChars: 96_000,
    });
  });
});
