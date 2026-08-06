import type { VerifiedClaim } from './claim.types';
import {
  CLAIM_SEPARATOR,
  composeClaimLine,
  MAX_CLAIM_LINE_CHARS,
} from './claim-line';
import { MAX_CLAIM_CHARS } from './claim-verify';

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
    it('drops a claim that would push the line past the bound', () => {
      const line = composeClaimLine('SYM', [
        claim('a'.repeat(200)),
        claim('b'.repeat(200)),
        claim('c'.repeat(200)),
      ]);
      expect(line).not.toBeNull();
      expect((line ?? '').length).toBeLessThanOrEqual(MAX_CLAIM_LINE_CHARS);
    });

    it('drops rather than truncates, because half a claim is a different claim', () => {
      const line = composeClaimLine('SYM', [
        claim('a'.repeat(200)),
        claim('b'.repeat(200)),
      ]);
      expect(line).toBe(`SYM: ${'A'.repeat(200)}`);
    });

    it('keeps the head when the FIRST claim already fills the line', () => {
      const line = composeClaimLine('SYM', [claim('a'.repeat(500))]);
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
