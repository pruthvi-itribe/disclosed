import { ClaudeClaimExtractor } from '@app/filings/llm/claude-claim-extractor';
import { OpenRouterClaimExtractor } from '@app/filings/llm/openrouter-claim-extractor';
import {
  buildClaimExtractor,
  buildResultsExtractor,
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
  resultsEnabled: true,
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
      // The results lane needs more of the document than the claim lane; it is
      // its own knob so the two cannot silently share one budget.
      maxResultsDocumentChars: 96_000,
    });
  });
});

describe('buildResultsExtractor', () => {
  it('builds one when the lane is on and a key is present', () => {
    expect(buildResultsExtractor(config())).not.toBeNull();
  });

  it.each([
    ['the results lane is switched off', { resultsEnabled: false }],
    ['no key is configured', { anthropicApiKey: '' }],
  ] as const)('returns null when %s', (_label, overrides) => {
    expect(buildResultsExtractor(config(overrides))).toBeNull();
  });

  it('runs when the CLAIM lane is off, and the reverse', () => {
    // Two lanes, two switches, one client. A desk that wants quarterly numbers
    // and no narrative claims is a real configuration, and so is the reverse.
    expect(
      buildResultsExtractor(config({ claimsEnabled: false })),
    ).not.toBeNull();
    expect(
      buildClaimExtractor(config({ resultsEnabled: false })),
    ).not.toBeNull();
  });

  it.each([
    ['openrouter', OpenRouterClaimExtractor],
    ['anthropic', ClaudeClaimExtractor],
  ] as const)(
    'builds the %s adapter, which serves both lanes',
    (claimProvider, expected) => {
      const built = buildResultsExtractor(config({ claimProvider }));
      expect(built).toBeInstanceOf(expected);
      // The same object satisfies the claim seam, which is what keeps the two
      // lanes comparable rather than merely both present.
      expect(buildClaimExtractor(config({ claimProvider }))).toBeInstanceOf(
        expected,
      );
    },
  );
});
