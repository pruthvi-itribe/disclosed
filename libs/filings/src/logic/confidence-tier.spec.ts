import {
  CONFIDENCE_TIERS,
  CONFIDENCE_TIER_LABEL,
  confidenceTierFor,
  isAlertableTier,
  type ConfidenceInput,
  type ConfidenceTier,
} from './confidence-tier';
import type { OutcomeSource } from './filing-outcome';

/**
 * The tier is the mechanism that replaced the eligibility filter, so the two
 * properties worth testing are the two the filter failed at:
 *
 *   TOTAL      every combination of inputs yields a tier, because a filing
 *              without one is a filing the dashboard cannot render — and a
 *              filing that renders nothing is exactly how `Outcome of Board
 *              Meeting` stayed missing for weeks without anybody noticing.
 *
 *   NARROW     only `verified` is alertable. Widening that by one tier is a
 *              one-word change with a 388-messages-a-day consequence, and the
 *              last test in this file is what makes that change fail the build.
 */

const NOTHING_ESTABLISHED: ConfidenceInput = {
  hasVerifiedClaim: false,
  hasVerifiedResults: false,
  hasVerifiedAmount: false,
  outcomeSource: 'category',
};

const BOOLEANS = [false, true] as const;
const SOURCES: readonly OutcomeSource[] = ['exchange-summary', 'category'];

/** Every input this module can be handed. Sixteen of them, and no more. */
const EVERY_INPUT: readonly ConfidenceInput[] = BOOLEANS.flatMap(
  (hasVerifiedClaim) =>
    BOOLEANS.flatMap((hasVerifiedResults) =>
      BOOLEANS.flatMap((hasVerifiedAmount) =>
        SOURCES.map((outcomeSource) => ({
          hasVerifiedClaim,
          hasVerifiedResults,
          hasVerifiedAmount,
          outcomeSource,
        })),
      ),
    ),
);

describe('confidenceTierFor', () => {
  // The three flags are admitted by three different gates — the verbatim span
  // gate, the results basis/column/period/scale checks, and the amount
  // extractor's anchor — and each one alone is enough. Tested separately so
  // that dropping one from the condition fails here rather than silently
  // demoting a whole extractor's output to `stated`.
  it.each([
    ['hasVerifiedClaim', { hasVerifiedClaim: true }],
    ['hasVerifiedResults', { hasVerifiedResults: true }],
    ['hasVerifiedAmount', { hasVerifiedAmount: true }],
  ] as const)('is verified on %s alone', (_flag, patch) => {
    expect(confidenceTierFor({ ...NOTHING_ESTABLISHED, ...patch })).toBe(
      'verified',
    );
  });

  // A verified figure outranks whatever the outcome line was built from: the
  // document itself was checked, so where the one-liner's words came from no
  // longer decides anything.
  it.each(SOURCES)(
    'stays verified with an outcome source of %s',
    (outcomeSource) => {
      expect(
        confidenceTierFor({
          ...NOTHING_ESTABLISHED,
          hasVerifiedClaim: true,
          outcomeSource,
        }),
      ).toBe('verified');
    },
  );

  // Two gates firing together is the common case for a results filing that
  // also states an order value, and it must not be a different answer from
  // either one alone.
  it('is verified when all three gates fired at once', () => {
    expect(
      confidenceTierFor({
        hasVerifiedClaim: true,
        hasVerifiedResults: true,
        hasVerifiedAmount: true,
        outcomeSource: 'exchange-summary',
      }),
    ).toBe('verified');
  });

  // With nothing verified, the tier is entirely the outcome's provenance:
  // NSE's own sentence is `stated`, NSE's category alone is `labelled`. That
  // is the 72.82/27.18 split `filing-outcome.ts` measures, carried through.
  it.each([
    ['exchange-summary', 'stated'],
    ['category', 'labelled'],
  ] as const)(
    'falls to %s -> %s when nothing was verified',
    (outcomeSource, expected) => {
      expect(confidenceTierFor({ ...NOTHING_ESTABLISHED, outcomeSource })).toBe(
        expected,
      );
    },
  );

  it('has exactly sixteen possible inputs', () => {
    // Three booleans and a two-valued source. If a field is added to
    // ConfidenceInput this literal is the reminder that the totality test
    // below no longer covers everything.
    expect(EVERY_INPUT).toHaveLength(16);
  });

  it.each(EVERY_INPUT)(
    'is total for claim=$hasVerifiedClaim results=$hasVerifiedResults amount=$hasVerifiedAmount source=$outcomeSource',
    (input) => {
      // Nothing is dropped and nothing is undefined: the whole replacement for
      // the eligibility filter rests on every filing carrying a tier.
      const tier = confidenceTierFor(input);
      expect(CONFIDENCE_TIERS).toContain(tier);
    },
  );

  it('reaches all three tiers across those sixteen inputs', () => {
    const reached = new Set(EVERY_INPUT.map(confidenceTierFor));
    expect([...reached].sort()).toEqual(['labelled', 'stated', 'verified']);
  });

  it('does not mutate its input', () => {
    const input: ConfidenceInput = { ...NOTHING_ESTABLISHED };
    confidenceTierFor(input);
    expect(input).toEqual(NOTHING_ESTABLISHED);
  });
});

describe('isAlertableTier', () => {
  /**
   * The one test in this file with a number attached to it.
   *
   * 12,415 of the 17,442 corpus filings survive the routine-category gate,
   * which is about 388 Telegram messages a day and a peak of 106 in one hour.
   * Universal coverage on the dashboard is the feature; universal coverage on
   * the wire mutes the channel inside a day and takes every operator alert
   * (INGEST DEGRADED, BLIND, DRAIN FAILED) down with it.
   *
   * So exactly one tier may pass. A change that lets `stated` through is one
   * word wide and this assertion is what stops it.
   */
  it('admits exactly one of the three tiers', () => {
    expect(CONFIDENCE_TIERS.filter(isAlertableTier)).toEqual(['verified']);
  });

  it.each(CONFIDENCE_TIERS)('answers %s without throwing', (tier) => {
    expect(typeof isAlertableTier(tier)).toBe('boolean');
  });

  it.each([
    ['verified', true],
    ['stated', false],
    ['labelled', false],
  ] as const)('returns %s -> %s', (tier, expected) => {
    expect(isAlertableTier(tier)).toBe(expected);
  });

  it('refuses every tier a filing can hold without a verified figure', () => {
    const withoutVerification = EVERY_INPUT.filter(
      (input) =>
        !input.hasVerifiedClaim &&
        !input.hasVerifiedResults &&
        !input.hasVerifiedAmount,
    );
    expect(
      withoutVerification.map(confidenceTierFor).filter(isAlertableTier),
    ).toEqual([]);
  });
});

describe('the tier table itself', () => {
  it('holds three tiers, most trusted first', () => {
    expect(CONFIDENCE_TIERS).toEqual(['verified', 'stated', 'labelled']);
    expect(CONFIDENCE_TIERS).toHaveLength(3);
  });

  it('labels every tier and labels nothing else', () => {
    // A tier with no label renders as a blank cell; a label with no tier is a
    // dead entry that looks live in a code review.
    expect(Object.keys(CONFIDENCE_TIER_LABEL).sort()).toEqual(
      [...CONFIDENCE_TIERS].sort(),
    );
  });

  it.each(CONFIDENCE_TIERS)(
    'gives %s a non-empty reader-facing label',
    (tier: ConfidenceTier) => {
      const label = CONFIDENCE_TIER_LABEL[tier];
      expect(label.length).toBeGreaterThan(0);
      expect(label.trim()).toBe(label);
    },
  );
});
