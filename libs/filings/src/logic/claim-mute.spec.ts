import {
  audibleClaims,
  composeWireClaimLine,
  isMutedOnWire,
  topicOnWire,
} from './claim-mute';
import { MAX_CLAIMS_ON_WIRE } from './claim-line';
import type { ClaimKind, VerifiedClaim } from './claim.types';

const claim = (
  text: string,
  kind: ClaimKind = 'operational',
  topic?: VerifiedClaim['topic'],
): VerifiedClaim => ({
  text,
  span: 'the source sentence, verbatim',
  kind,
  ...(topic === undefined ? {} : { topic }),
  periodSpan: null,
});

describe('isMutedOnWire', () => {
  describe('what it mutes', () => {
    // Every one of these is a real claim from the live collection, filed under
    // `other` with kind `operational`. They are true, verified, and nothing a
    // reader scanning a Telegram channel wants to spend a line on.
    it.each([
      'Exercise price of each option is INR 5.',
      'KFIL grants 2,36,000 stock options under Employee Stock Option Scheme 2021',
      'Book closure from Sept 16-22, 2026',
      'CIN changed to L65990MH1992PLC065289 consequent to listing of equity shares',
      'Company transferred Rs 17.87 million from monitoring agency account to current account',
    ])('mutes %s', (text) => {
      expect(isMutedOnWire(claim(text))).toBe(true);
    });
  });

  describe('what a named TOPIC saves', () => {
    it('keeps a claim the topic rules could name', () => {
      // `financial`, so the wire carries it whatever its kind.
      expect(
        isMutedOnWire(claim('Q1 FY27 revenue INR 8,936 Mn, up 20.7% YoY')),
      ).toBe(false);
    });

    it('keeps a dividend, which is the whole reason dividend precedes financial', () => {
      expect(isMutedOnWire(claim('dividend of ₹1.50 per equity share'))).toBe(
        false,
      );
    });
  });

  describe('what a named KIND saves', () => {
    // 292 of the 952 `other` claims in the live collection carry a kind the
    // extractor could name, and reading them they are the filings this pipeline
    // exists to catch. Muting on the topic alone would have dropped all of them.
    it.each<[string, ClaimKind]>([
      [
        'Infosys entered a ten-year strategic agreement with Crocs, Inc.',
        'partnership',
      ],
      ['FY27 capitalization guidance of ₹30,000 crore', 'guidance'],
      ['Targets 50% renewable energy usage by 2030.', 'target'],
      [
        'Adds six society redevelopment projects in MMR with combined estimated GDV of Rs. 6,000 crore',
        'expansion',
      ],
      [
        'EGM approves issuance of up to 70,00,000 fully convertible warrants to promoter group',
        'approval',
      ],
    ])('keeps %s', (text, kind) => {
      expect(topicOnWire(claim(text, kind))).toBe('other');
      expect(isMutedOnWire(claim(text, kind))).toBe(false);
    });
  });

  describe('what the taxonomy MISSED, and the wire must not', () => {
    // THE MEASUREMENT THAT INVERTED THIS RULE. Every one of these is a real
    // claim that reached `other` with kind `operational` — not because it was
    // unnameable, but because a topic pattern missed a plural or an inflection.
    // A predicate that muted `other` + `operational` outright silenced all of
    // them. Each is annotated with the rule that let it through.
    it.each([
      // `dividend` does not match the plural `dividends`.
      'Board declared two interim dividends totaling 400 rupees per equity share',
      // `won` does not match `wins`.
      'L&T wins offshore orders from ONGC classified as major',
      // The orders rule wants "order" AFTER secured/received/won/awarded.
      'Booked order of more than Rs 150 Cr for thermal power plants',
      // The ratings rule enumerates five agencies; Infomerics is not one.
      'Infomerics reaffirmed rating at AA-/Positive on Basel III AT I bonds',
      // The acquisition rule has no word for a cash tender offer.
      'Offers EUR 81.00 per Nagarro share in cash, a ~140% premium',
      // `stake` does not match `shareholding`.
      'Promoter shareholding reduced from 82.22% to 74.52%; MPS achieved',
      // `profit` does not match `loss`.
      'Standalone net loss of Rs 1,670 lakhs for quarter ended June 30, 2026',
      // `capacity` misses `capacities`, `approved` misses `approves`.
      'Board approves 90 crore capex for Advanced Materials adoption capacities',
      // And the plain quantified operating line: `financial` has no `sales`.
      'Q1 FY27 sales 82,172 mn, up 33% YoY',
    ])('keeps %s', (text) => {
      expect(topicOnWire(claim(text))).toBe('other');
      expect(isMutedOnWire(claim(text))).toBe(false);
    });

    it('keeps a claim it simply does not recognise, rather than muting it', () => {
      // THE FAIL-OPEN DIRECTION, which is the whole argument for naming the
      // noise instead of the signal. An unrecognised claim reaches the wire.
      const text = 'Company realigned portfolio as a water solutions provider';
      expect(topicOnWire(claim(text))).toBe('other');
      expect(isMutedOnWire(claim(text))).toBe(false);
    });
  });
});

describe('topicOnWire', () => {
  it('derives the topic when the claim carries none', () => {
    // THE CASE THE LIVE PATH IS ALWAYS IN. `verifyClaims` does not set `topic`
    // — only the backfill tool does — so every claim the worker composes a wire
    // line from arrives here unfiled. A predicate that read the stored field
    // alone would never mute anything in production.
    const unfiled = claim('Exercise price of each option is INR 5.');
    expect(unfiled.topic).toBeUndefined();
    expect(topicOnWire(unfiled)).toBe('other');
  });

  it('honours the stored topic when there is one', () => {
    // So the wire and the feed agree about the same claim. A reader who sees a
    // claim filed under `dividend` in the dashboard and cannot find it on the
    // wire has been told two different things by one system.
    expect(
      topicOnWire(
        claim('a claim about nothing nameable', 'operational', 'dividend'),
      ),
    ).toBe('dividend');
    expect(
      isMutedOnWire(
        claim('a claim about nothing nameable', 'operational', 'dividend'),
      ),
    ).toBe(false);
  });
});

describe('audibleClaims', () => {
  it('drops the muted and keeps the rest, in the order it was given', () => {
    const claims = [
      claim('Exercise price of each option is INR 5.'),
      claim('Q1 FY27 revenue INR 8,936 Mn, up 20.7% YoY'),
      claim('Book closure from Sept 16-22, 2026'),
      claim('dividend of ₹1.50 per equity share'),
    ];

    expect(audibleClaims(claims).map((row) => row.text)).toEqual([
      'Q1 FY27 revenue INR 8,936 Mn, up 20.7% YoY',
      'dividend of ₹1.50 per equity share',
    ]);
  });

  it('returns the claims untouched rather than a copy when nothing is muted', () => {
    const claims = [claim('Q1 FY27 revenue INR 8,936 Mn, up 20.7% YoY')];
    expect(audibleClaims(claims)).toEqual(claims);
  });

  it('never mutates what it was given', () => {
    const claims = [
      claim('Exercise price of each option is INR 5.'),
      claim('dividend of ₹1.50 per equity share'),
    ];
    audibleClaims(claims);
    expect(claims).toHaveLength(2);
  });

  it('returns empty when every claim is muted', () => {
    expect(
      audibleClaims([
        claim('Exercise price of each option is INR 5.'),
        claim('Book closure from Sept 16-22, 2026'),
      ]),
    ).toEqual([]);
  });
});

describe('composeWireClaimLine', () => {
  it('composes the same line as the stored one when nothing is muted', () => {
    expect(
      composeWireClaimLine('swiggy', [
        claim('Instamart targets ₹1.5+ Lakh Cr GOV by 2031', 'target'),
      ]),
    ).toBe('SWIGGY: INSTAMART TARGETS ₹1.5+ LAKH CR GOV BY 2031');
  });

  it('PROMOTES a claim the muted ones were keeping off the line', () => {
    // The effect that is not "the line gets shorter". `MAX_CLAIMS_ON_WIRE` is
    // three, so three ESOP lines at the head of the stored order push a real
    // dividend past the end of the wire line entirely. Filtering before the
    // composer is what recovers it — filtering after would not.
    const claims = [
      claim('Exercise price of each option is INR 5.'),
      claim('Book closure from Sept 16-22, 2026'),
      claim('KFIL grants 2,36,000 stock options under Scheme 2021'),
      claim('dividend of ₹1.50 per equity share'),
    ];

    expect(claims).toHaveLength(MAX_CLAIMS_ON_WIRE + 1);
    expect(composeWireClaimLine('SYM', claims)).toBe(
      'SYM: DIVIDEND OF ₹1.50 PER EQUITY SHARE',
    );
  });

  it('returns null when every claim is muted', () => {
    // Not a bare `SYM:`, and not the stored line. The filing said nothing a
    // wire line should spend a reader's attention on.
    expect(
      composeWireClaimLine('SYM', [
        claim('Exercise price of each option is INR 5.'),
      ]),
    ).toBeNull();
  });

  it('returns null for no claims at all, exactly as the stored composer does', () => {
    expect(composeWireClaimLine('SYM', [])).toBeNull();
  });
});

describe('the boilerplate vocabulary, where it is deliberately narrow', () => {
  it('mutes a clean audit opinion but never a qualified one', () => {
    // The pattern names the opinion, not the auditor. An auditor raising a
    // matter is among the most consequential things a filing can say.
    expect(
      isMutedOnWire(
        claim('Statutory auditors provided unmodified opinion in their report'),
      ),
    ).toBe(true);
    expect(
      isMutedOnWire(
        claim(
          'Auditor says company did not pay certain statutory dues such as professional tax',
        ),
      ),
    ).toBe(false);
  });

  it('mutes a use-of-proceeds confirmation but not a use-of-proceeds breach', () => {
    expect(
      isMutedOnWire(
        claim(
          'Confirms no deviation or variation in utilisation of IPO proceeds',
        ),
      ),
    ).toBe(true);
    expect(
      isMutedOnWire(
        claim(
          'Company utilized Rs 54.00 crore from general corporate purposes to repay promoter loan, not in line with prospectus',
        ),
      ),
    ).toBe(false);
  });

  it('mutes an ESOP allotment but not a QIP allotment', () => {
    // Both are allotments of equity. One is payroll, the other is a capital
    // raise, and only the second belongs on a wire.
    expect(
      isMutedOnWire(
        claim(
          'Allotted 24,640 equity shares to employees under the stock option scheme',
        ),
      ),
    ).toBe(true);
    expect(
      isMutedOnWire(
        claim('Allocated 99,00,990 equity shares to QIBs at ₹505.00 per share'),
      ),
    ).toBe(false);
  });
});
