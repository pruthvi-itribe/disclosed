import { buildClaimExtractor } from './claim-extractor.factory';

const config = (overrides: Record<string, unknown> = {}) => ({
  claimsEnabled: true,
  anthropicApiKey: 'sk-ant-not-a-real-key',
  claimModel: 'claude-opus-5',
  claimEffort: 'medium' as const,
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
  ])('returns null when %s', (_label, overrides) => {
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
