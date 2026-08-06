import type { ClaimDiscardReason, ProposedClaim } from './claim.types';
import {
  MAX_CLAIM_CHARS,
  MAX_CLAIMS_PER_FILING,
  MAX_DISCARDED_CLAIM_CHARS,
  verifyClaims,
} from './claim-verify';

/**
 * A document with the shapes that matter: a plain claim, a figure, a
 * conditional sentence, a person, and a line break inside a sentence.
 */
const DOCUMENT = [
  'Swiggy Limited Capital Markets Day 2026',
  'The company set out its goal to build a ₹10,000 Cr. Adjusted',
  'EBITDA business by FY31.',
  'Instamart expects volume growth of 16-18% through the year.',
  'The Company has joined the Microsoft Intelligent Security Association.',
  'A letter of intent has been received for a further tranche, subject to',
  'completion of due diligence.',
  'Mr. Rajesh Kumar has been appointed as Chief Financial Officer.',
  'A civil suit has been filed before the Bombay High Court against the Company.',
].join('\n');

const claim = (overrides: Partial<ProposedClaim> = {}): ProposedClaim => ({
  span: 'The Company has joined the Microsoft Intelligent Security Association.',
  text: 'joins the Microsoft Intelligent Security Association',
  kind: 'partnership',
  ...overrides,
});

const verify = (proposed: readonly ProposedClaim[], maxClaims?: number) =>
  verifyClaims({ documentText: DOCUMENT, proposed, maxClaims });

const reasons = (proposed: readonly ProposedClaim[]): ClaimDiscardReason[] =>
  verify(proposed).discards.map((row) => row.reason);

describe('verifyClaims — what it accepts', () => {
  it('accepts a claim whose span is in the document', () => {
    const { claims, discards } = verify([claim()]);
    expect(discards).toEqual([]);
    expect(claims).toHaveLength(1);
    expect(claims[0].text).toBe(
      'joins the Microsoft Intelligent Security Association',
    );
  });

  it('stores the DOCUMENT’s bytes as the span, not the extractor’s', () => {
    // The extractor normalised the line break; what is stored and shown must be
    // what the filing actually says.
    const { claims } = verify([
      claim({
        span: 'goal to build a ₹10,000 Cr. Adjusted EBITDA business by FY31',
        text: 'targets ₹10,000 Cr adjusted EBITDA by FY31',
        kind: 'target',
      }),
    ]);
    expect(claims[0].span).toContain('\n');
    expect(DOCUMENT).toContain(claims[0].span);
  });

  it('accepts a figure that appears in its own span', () => {
    const { claims } = verify([
      claim({
        span: 'Instamart expects volume growth of 16-18% through the year.',
        text: 'expects volume growth of 16-18%',
        kind: 'guidance',
      }),
    ]);
    expect(claims).toHaveLength(1);
  });
});

/**
 * The five claims the live DeepSeek run threw away, and the shape they share.
 *
 * Every one of them stated a real figure that WAS in its span and a fiscal
 * period that was not, because a slide deck states its quarter in the header and
 * its numbers in the bullet. The document below is the ANUP filing's structure,
 * reduced to the two lines that matter.
 */
describe('verifyClaims — the fiscal period', () => {
  const DECK = [
    'INVESTOR PRESENTATION Q1 FY27',
    'OPERATIONAL HIGHLIGHTS',
    'HIGHLIGHTS FOR Q1 FY27',
    '•Anup reached Revenue & EBITDA of ₹125.2 Cr and ₹9.5 Cr respectively.',
    '•Encouraging Order inquiry pipeline of ₹1,100 Cr.',
  ].join('\n');

  const onDeck = (proposed: ProposedClaim) =>
    verifyClaims({ documentText: DECK, proposed: [proposed] });

  const BULLET =
    '•Anup reached Revenue & EBITDA of ₹125.2 Cr and ₹9.5 Cr respectively.';

  it('ACCEPTS a period stated by the heading above the quoted sentence', () => {
    const { claims, discards } = onDeck({
      span: BULLET,
      text: 'Q1 FY27 revenue of ₹125.2 Cr and EBITDA of ₹9.5 Cr',
      kind: 'operational',
    });
    expect(discards).toEqual([]);
    expect(claims).toHaveLength(1);
  });

  it('stores the heading it read the period from', () => {
    // Without this an accepted "Q1 FY27 revenue" would be evidenced by a
    // sentence mentioning neither Q1 nor FY27 — provenance that survives
    // review without meaning anything.
    const { claims } = onDeck({
      span: BULLET,
      text: 'Q1 FY27 revenue of ₹125.2 Cr and EBITDA of ₹9.5 Cr',
      kind: 'operational',
    });
    expect(claims[0].periodSpan).toContain('Q1 FY27');
  });

  it('stores no period evidence when the span states the period itself', () => {
    const { claims } = verify([
      claim({
        span: 'goal to build a ₹10,000 Cr. Adjusted EBITDA business by FY31',
        text: 'targets ₹10,000 Cr adjusted EBITDA by FY31',
        kind: 'target',
      }),
    ]);
    expect(claims[0].periodSpan).toBeNull();
  });

  it('stores no period evidence for a claim naming no period', () => {
    expect(verify([claim()]).claims[0].periodSpan).toBeNull();
  });

  it('REFUSES a period the document does not state near the sentence', () => {
    // The other half of the rule, and the reason it is not simply "drop the
    // period digits": moving a real figure into a quarter the filing never
    // mentions is a wrong number with a true-looking source.
    const { claims, discards } = onDeck({
      span: BULLET,
      text: 'Q4 FY26 revenue of ₹125.2 Cr and EBITDA of ₹9.5 Cr',
      kind: 'operational',
    });
    expect(claims).toEqual([]);
    expect(discards[0].reason).toBe<ClaimDiscardReason>(
      'period-not-in-context',
    );
    expect(discards[0].detail).toContain('Q4FY26');
  });

  it('is STRICTER than the digit rule it replaces', () => {
    // Under the old rule `Q1` was satisfied by any stray `1` in the sentence,
    // which over 60 real documents was 24.3% of them. Here the span carries a
    // `1` — in `1,100` — and the claim's quarter is still refused, because the
    // sentence and its neighbourhood state Q1 and not Q3.
    const { claims, discards } = onDeck({
      span: '•Encouraging Order inquiry pipeline of ₹1,100 Cr.',
      text: 'Q3 order inquiry pipeline of ₹1,100 Cr',
      kind: 'operational',
    });
    expect(claims).toEqual([]);
    expect(discards[0].reason).toBe<ClaimDiscardReason>(
      'period-not-in-context',
    );
  });

  it('keeps figures span-scoped even when the neighbourhood carries them', () => {
    // The line that must not move. `1,100` is in the document, one line below
    // the quoted sentence, and it is still refused — a period may be read from
    // the neighbourhood and a figure may never be.
    const { claims, discards } = onDeck({
      span: BULLET,
      text: 'Q1 FY27 order inquiry pipeline of ₹1,100 Cr',
      kind: 'operational',
    });
    expect(claims).toEqual([]);
    expect(discards[0].reason).toBe<ClaimDiscardReason>('number-not-in-span');
    expect(discards[0].detail).toContain('1100');
  });

  it('does not let a period label satisfy a figure', () => {
    // `FY27`'s `27` must not stand in for a claim asserting 27 of something.
    const { claims, discards } = onDeck({
      span: BULLET,
      text: 'booked 27 vessels in the quarter',
      kind: 'operational',
    });
    expect(claims).toEqual([]);
    expect(discards[0].reason).toBe<ClaimDiscardReason>('number-not-in-span');
    expect(discards[0].detail).toContain('27');
  });
});

describe('verifyClaims — the hallucination catch', () => {
  it.each([
    [
      'a sentence the document never contained',
      'The company plans to list its logistics arm in FY28.',
    ],
    [
      'a real sentence with one word changed',
      'Instamart expects volume growth of 16-18% through the quarter.',
    ],
    [
      'a real sentence with one digit changed',
      'Instamart expects volume growth of 16-19% through the year.',
    ],
    [
      'two real sentences joined',
      'The Company has joined the Microsoft Intelligent Security Association. Instamart expects volume growth of 16-18% through the year.',
    ],
  ])('discards a claim quoting %s', (_label, span) => {
    expect(reasons([claim({ span })])).toEqual(['span-not-found']);
  });

  it('names the span it could not find, so the discard is reviewable', () => {
    const { discards } = verify([
      claim({ span: 'a plausible invented sentence' }),
    ]);
    expect(discards[0].detail).toContain('not in the document');
  });

  it('discards a claim quoting almost nothing', () => {
    expect(reasons([claim({ span: 'Swiggy' })])).toEqual(['span-too-short']);
  });

  it('discards a claim whose figure is not in its span', () => {
    // The span is real. The number is not in it. Both facts matter.
    expect(
      reasons([
        claim({
          span: 'Instamart expects volume growth of 16-18% through the year.',
          text: 'expects volume growth of 25%',
          kind: 'guidance',
        }),
      ]),
    ).toEqual(['number-not-in-span']);
  });

  it('discards a unit conversion even though the money is the same', () => {
    expect(
      reasons([
        claim({
          span: 'goal to build a ₹10,000 Cr. Adjusted EBITDA business by FY31',
          text: 'targets 100b rupees adj EBITDA by FY31',
          kind: 'target',
        }),
      ]),
    ).toEqual(['number-not-in-span']);
  });
});

describe('verifyClaims — the categorical refusals', () => {
  it.each([
    ['advisory framing', 'this is positive for the stock', 'advisory-language'],
    ['a price call', 'target price raised to Rs 1,450', 'advisory-language'],
    [
      'a person',
      'appoints a new chief financial officer',
      'names-an-individual',
    ],
  ] as const)('discards %s', (_label, text, reason) => {
    expect(reasons([claim({ text })])).toEqual([reason]);
  });

  it('discards a claim about a person even when the CLAIM text hides it', () => {
    // The claim says nothing incriminating; the sentence it was read from does.
    expect(
      reasons([
        claim({
          span: 'Mr. Rajesh Kumar has been appointed as Chief Financial Officer.',
          text: 'strengthens the senior leadership team',
          kind: 'operational',
        }),
      ]),
    ).toEqual(['names-an-individual']);
  });

  it('discards a claim drawn from a litigation sentence', () => {
    expect(
      reasons([
        claim({
          span: 'A civil suit has been filed before the Bombay High Court against the Company.',
          text: 'confirms a matter is before the Bombay High Court',
          kind: 'operational',
        }),
      ]),
    ).toEqual(['legally-blocked']);
  });

  it('discards a claim read out of a conditional sentence', () => {
    // The amount extractor's own discipline, scoped to the sentence rather than
    // the document — "subject to" is in the boilerplate of nearly every filing.
    expect(
      reasons([
        claim({
          span: 'A letter of intent has been received for a further tranche, subject to',
          text: 'has received a further tranche',
          kind: 'operational',
        }),
      ]),
    ).toEqual(['conditional-language']);
  });

  it('settles the categorical refusals BEFORE searching the document', () => {
    // A claim that is advisory is refused whether or not its span is real, and
    // the recorded reason must be the one a reviewer needs.
    expect(
      reasons([
        claim({
          span: 'an entirely invented sentence that is also nowhere',
          text: 'this is positive for the stock',
        }),
      ]),
    ).toEqual(['advisory-language']);
  });

  it.each([
    ['an empty claim', ''],
    ['a fragment', 'grew'],
  ])('discards %s', (_label, text) => {
    expect(reasons([claim({ text })])).toEqual(['empty-claim']);
  });

  it('discards a claim longer than a wire line may carry', () => {
    expect(reasons([claim({ text: 'x'.repeat(MAX_CLAIM_CHARS + 1) })])).toEqual(
      ['too-long'],
    );
  });
});

describe('verifyClaims — the bookkeeping', () => {
  it('discards the second copy of the same claim', () => {
    const { claims, discards } = verify([claim(), claim()]);
    expect(claims).toHaveLength(1);
    expect(discards.map((row) => row.reason)).toEqual(['duplicate']);
  });

  it('treats a whitespace or case respelling as the same claim', () => {
    const { claims } = verify([
      claim(),
      claim({
        text: '  Joins   the Microsoft Intelligent Security ASSOCIATION ',
      }),
    ]);
    expect(claims).toHaveLength(1);
  });

  it('caps the line and records what it dropped', () => {
    // Distinct texts with NO digits in them: a numeric suffix would be a
    // figure the span does not carry, and every claim would be refused for that
    // instead of reaching the limit.
    const four = ['alpha', 'beta', 'gamma', 'delta'].map((word) =>
      claim({ text: `joins the Microsoft Intelligent Security ${word}` }),
    );
    const { claims, discards } = verify(four);

    expect(claims).toHaveLength(MAX_CLAIMS_PER_FILING);
    expect(discards.map((row) => row.reason)).toEqual(['over-limit']);
  });

  it('leads with guidance when the document offered some', () => {
    const { claims } = verify([
      claim({ kind: 'operational', text: 'an operational fact worth stating' }),
      claim({
        span: 'Instamart expects volume growth of 16-18% through the year.',
        text: 'expects volume growth of 16-18%',
        kind: 'guidance',
      }),
    ]);
    expect(claims[0].kind).toBe('guidance');
  });

  it('ranks only the SURVIVING claims', () => {
    // A discarded guidance claim must not push a real expansion claim off the
    // end of the line.
    const { claims } = verify(
      [
        claim({
          span: 'invented, and also guidance',
          text: 'expects 40% growth',
          kind: 'guidance',
        }),
        claim({ kind: 'partnership' }),
      ],
      1,
    );
    expect(claims).toHaveLength(1);
    expect(claims[0].kind).toBe('partnership');
  });

  it('bounds and de-fangs everything it echoes into a discard', () => {
    const { discards } = verify([
      claim({ text: `${'x'.repeat(400)}\nFAKE LOG LINE` }),
    ]);
    expect(discards[0].claim).not.toContain('\n');
    expect(discards[0].claim.length).toBe(MAX_DISCARDED_CLAIM_CHARS);
  });

  it('returns nothing at all for nothing at all', () => {
    expect(verify([])).toEqual({ claims: [], discards: [] });
  });

  it('emits nothing rather than something unverifiable', () => {
    // The governing rule, stated as a test: a batch of entirely invented claims
    // produces an empty result and a full accounting of why.
    const invented = Array.from({ length: 3 }, (_unused, index) =>
      claim({
        span: `a fluent sentence number ${index} that is not in the filing`,
      }),
    );
    const { claims, discards } = verify(invented);
    expect(claims).toEqual([]);
    expect(discards).toHaveLength(3);
  });
});
