import type { VerifiedClaim } from './claim.types';
import {
  CLAIM_SEPARATOR,
  composeClaimLine,
  MAX_CLAIM_LINE_CHARS,
  MAX_CLAIMS_ON_WIRE,
} from './claim-line';
import { MAX_CLAIM_CHARS, MAX_CLAIMS_EXTRACTED } from './claim-verify';

const claim = (text: string): VerifiedClaim => ({
  text,
  span: 'the source sentence, verbatim',
  kind: 'operational',
  periodSpan: null,
});

describe('composeClaimLine', () => {
  it('writes the wire convention: SYMBOL: CLAIM IN CAPS', () => {
    expect(
      composeClaimLine('swiggy', [
        claim('targets ₹10,000 Cr adj EBITDA by FY31'),
      ]),
    ).toBe('SWIGGY: TARGETS ₹10,000 CR ADJ EBITDA BY FY31');
  });

  it('joins several claims the way the wire does', () => {
    expect(
      composeClaimLine('BIOCON', [
        claim('strengthened regional supply network'),
        claim('expanding commercial footprint in Europe'),
      ]),
    ).toBe(
      'BIOCON: STRENGTHENED REGIONAL SUPPLY NETWORK || EXPANDING COMMERCIAL FOOTPRINT IN EUROPE',
    );
  });

  it('is two pipes with a space either side', () => {
    expect(CLAIM_SEPARATOR).toBe(' || ');
  });

  it('carries at most MAX_CLAIMS_ON_WIRE, however many were verified', () => {
    // THE GUARD ON THE EXTRACTION SPLIT. Verification now keeps up to
    // MAX_CLAIMS_EXTRACTED so a 40-slide deck is read for everything it says,
    // and the wire must not silently inherit that. Without an explicit count
    // here the 400-character backstop — documented as a backstop precisely
    // because three short claims could never reach it — quietly becomes the
    // thing deciding what a reader sees.
    const many = Array.from({ length: MAX_CLAIMS_EXTRACTED }, (_u, i) =>
      claim(`fact number ${i + 1}`),
    );
    const line = composeClaimLine('X', many) ?? '';

    expect(line.split(CLAIM_SEPARATOR)).toHaveLength(MAX_CLAIMS_ON_WIRE);
    expect(line.length).toBeLessThan(MAX_CLAIM_LINE_CHARS);
  });

  it('collapses a line break inside a claim', () => {
    // A newline would split one fact across two lines in a message that also
    // carries a timestamp and a source link.
    expect(
      composeClaimLine('X', [claim('expects volume\ngrowth of 16-18%')]),
    ).toBe('X: EXPECTS VOLUME GROWTH OF 16-18%');
  });

  describe('when there is nothing to say', () => {
    it('returns null for no claims at all', () => {
      // Not an empty string and not a bare `SYMBOL:` — a colon with nothing
      // after it reads as a claim that came out blank.
      expect(composeClaimLine('SWIGGY', [])).toBeNull();
    });

    it('returns null when every claim is blank', () => {
      expect(composeClaimLine('SWIGGY', [claim('   ')])).toBeNull();
    });

    it('returns null for a filing with no symbol', () => {
      expect(
        composeClaimLine('  ', [claim('a real claim about something')]),
      ).toBeNull();
    });
  });

  describe('the length bound', () => {
    // SIZED FROM THE BOUND, not in absolute characters. These fixtures were 200
    // and 500 against a bound of 400; at 640 the 200s stopped dropping anything
    // and the 500 stopped filling the line, which would have left two tests
    // passing while asserting nothing. A third of the bound leaves two claims
    // fitting and the third overrunning, and half of it leaves one fitting and
    // the second overrunning, whatever the bound is.
    const aThirdOfTheBound = Math.floor(MAX_CLAIM_LINE_CHARS / 3);
    const halfTheBound = Math.floor(MAX_CLAIM_LINE_CHARS / 2);

    it('drops a claim that would push the line past the bound', () => {
      const line = composeClaimLine('SYM', [
        claim('a'.repeat(aThirdOfTheBound)),
        claim('b'.repeat(aThirdOfTheBound)),
        claim('c'.repeat(aThirdOfTheBound)),
      ]);
      expect(line).not.toBeNull();
      // Two of the three: the head and two separators put the third over.
      expect((line ?? '').split(CLAIM_SEPARATOR)).toHaveLength(2);
      expect((line ?? '').length).toBeLessThanOrEqual(MAX_CLAIM_LINE_CHARS);
    });

    it('drops rather than truncates, because half a claim is a different claim', () => {
      const line = composeClaimLine('SYM', [
        claim('a'.repeat(halfTheBound)),
        claim('b'.repeat(halfTheBound)),
      ]);
      expect(line).toBe(`SYM: ${'A'.repeat(halfTheBound)}`);
    });

    it('keeps the head when the FIRST claim already fills the line', () => {
      const line = composeClaimLine('SYM', [
        claim('a'.repeat(MAX_CLAIM_LINE_CHARS)),
      ]);
      // Nothing fits, so nothing is said — rather than a bare `SYM:`.
      expect(line).toBeNull();
    });

    it('never fires on claims the gate already accepted', () => {
      // Three claims at the per-claim maximum, the longest realistic symbol,
      // and the line still fits — so a verified claim is never silently lost
      // between the gate and the wire.
      const line = composeClaimLine('IL&FSTRANSPORT', [
        claim('a'.repeat(MAX_CLAIM_CHARS)),
        claim('b'.repeat(MAX_CLAIM_CHARS)),
        claim('c'.repeat(MAX_CLAIM_CHARS)),
      ]);
      expect(line).toContain('A'.repeat(MAX_CLAIM_CHARS));
      expect(line).toContain('B'.repeat(MAX_CLAIM_CHARS));
      expect(line).toContain('C'.repeat(MAX_CLAIM_CHARS));
    });
  });

  it('preserves the order it was given, which verifyClaims already ranked', () => {
    const line = composeClaimLine('SYM', [
      claim('first thing stated'),
      claim('second thing stated'),
    ]);
    expect(line).toBe('SYM: FIRST THING STATED || SECOND THING STATED');
  });
});
