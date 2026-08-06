import corpus from './__fixtures__/claim-corpus.json';
import { claimEligibility } from './claim-eligibility';
import { composeClaimLine } from './claim-line';
import { verifyClaims } from './claim-verify';
import type { ProposedClaim } from './claim.types';

/**
 * The acceptance test, against the three filings this product failed on.
 *
 * ================================================================
 * WHAT HAPPENED
 * ================================================================
 *
 * On 2026-08-06 a competitor published six wire lines. Three of them were about
 * companies whose source documents this pipeline already held — Biocon's
 * investor presentation, Swiggy's press release, and Welspun Enterprises'
 * earnings-call intimation — and this pipeline published nothing for any of
 * them, because the only extractor it had read order values and none of the six
 * lines was an order value.
 *
 * The documents in `__fixtures__/claim-corpus.json` are those three, fetched
 * from `nsearchives.nseindia.com` and parsed by the same code the worker runs.
 * Nothing has been edited: the line breaks, the address blocks and the PDF
 * extraction artefacts are exactly as the pipeline sees them.
 *
 * ================================================================
 * WHAT THIS SUITE PROVES, AND WHAT IT DOES NOT
 * ================================================================
 *
 * It proves the DETERMINISTIC half end to end: which filings are worth a model
 * call, whether a claim's quoted sentence is really in the document, whether its
 * figures are, and what line comes out. The proposed claims below stand in for
 * the model's output and are written by hand — the true ones quote the real
 * sentences, the fabricated ones are the plausible inventions a model would
 * produce and are the reason the gate exists.
 *
 * It does NOT prove what any particular model proposes. That is a live run, and
 * this suite is deliberately incapable of making one: no network reaches a
 * `.spec.ts` in this project.
 */

interface CorpusFiling {
  readonly seqId: number;
  readonly symbol: string;
  readonly category: string;
  readonly summary: string;
  readonly chars: number;
  readonly text: string;
}

const filings = corpus as readonly CorpusFiling[];
const bySymbol = (symbol: string): CorpusFiling => {
  const found = filings.find((row) => row.symbol === symbol);
  if (found === undefined)
    throw new Error(`${symbol} is missing from the corpus`);
  return found;
};

const SWIGGY = bySymbol('SWIGGY');
const BIOCON = bySymbol('BIOCON');
const WELENT = bySymbol('WELENT');

/** Runs the whole deterministic pipeline for one filing. */
const run = (filing: CorpusFiling, proposed: readonly ProposedClaim[]) => {
  const eligibility = claimEligibility(filing, filing.text);
  const verified = verifyClaims({ documentText: filing.text, proposed });
  return {
    eligibility,
    ...verified,
    line: composeClaimLine(filing.symbol, verified.claims),
  };
};

describe('the corpus is the real thing', () => {
  it.each([
    ['SWIGGY', 'Press Release', 9_821],
    ['BIOCON', 'Investor Presentation', 7_583],
    ['WELENT', 'Analysts/Institutional Investor Meet/Con. Call Updates', 1_269],
  ])('holds %s, a %s of %d characters', (symbol, category, chars) => {
    const filing = bySymbol(symbol);
    expect(filing.category).toBe(category);
    expect(filing.text.length).toBe(chars);
    expect(filing.chars).toBe(chars);
  });

  it('is unedited PDF text, line breaks and all', () => {
    expect(SWIGGY.text).toContain('\n');
    expect(BIOCON.text).toContain('Exchange Plaza');
  });
});

describe('SWIGGY — the ₹10,000 Cr FY31 target', () => {
  /**
   * Redbox published: `SWIGGY: CO.TARGETS 100B RUPEES ADJ EBITDA BY FY31`
   *
   * The document says `₹10,000 Cr.`, not `100B rupees`. They are the same money
   * and they are not the same evidence, so this pipeline states the filer's own
   * unit and the number gate refuses the conversion — see the next test.
   */
  const TRUE_CLAIM: ProposedClaim = {
    // The span has to carry FY31, because the claim states it. That is the
    // number rule doing its job rather than an accident of phrasing: a claim
    // may only say `by FY31` if the sentence it quotes says `FY31`.
    span: 'outlined its FY31 vision at Capital Markets Day 2026, setting out its goal to build a ₹10,000 Cr. Adjusted EBITDA business',
    text: 'targets ₹10,000 Cr adjusted EBITDA business by FY31',
    kind: 'target',
  };

  it('is eligible', () => {
    expect(claimEligibility(SWIGGY, SWIGGY.text)).toEqual({ eligible: true });
  });

  it('emits the target, quoting the document', () => {
    const result = run(SWIGGY, [TRUE_CLAIM]);

    expect(result.discards).toEqual([]);
    expect(result.line).toBe(
      'SWIGGY: TARGETS ₹10,000 CR ADJUSTED EBITDA BUSINESS BY FY31',
    );
    // The stored evidence is the document's own bytes at the matched position.
    expect(SWIGGY.text).toContain(result.claims[0].span);
  });

  it('refuses the competitor’s unit conversion', () => {
    const result = run(SWIGGY, [
      { ...TRUE_CLAIM, text: 'targets 100B rupees adj EBITDA by FY31' },
    ]);

    expect(result.line).toBeNull();
    expect(result.discards[0].reason).toBe('number-not-in-span');
    expect(result.discards[0].detail).toContain('100');
  });

  it('carries a second claim on the same line', () => {
    const result = run(SWIGGY, [
      TRUE_CLAIM,
      {
        span: 'By FY31, Swiggy expects Food Delivery GOV to grow 2.5-3.5x',
        text: 'expects Food Delivery GOV to grow 2.5-3.5x by FY31',
        kind: 'guidance',
      },
    ]);

    expect(result.discards).toEqual([]);
    expect(result.line).toContain(' || ');
    // Guidance outranks a target, so it leads.
    expect(result.claims[0].kind).toBe('guidance');
  });

  it.each([
    [
      'a plausible sentence the filing never contained',
      'Swiggy will achieve profitability in the current financial year.',
    ],
    [
      'a real sentence with the year changed',
      'setting out its goal to build a ₹10,000 Cr. Adjusted EBITDA business by FY30',
    ],
  ])('discards a claim quoting %s', (_label, span) => {
    const result = run(SWIGGY, [{ ...TRUE_CLAIM, span }]);
    expect(result.line).toBeNull();
    expect(result.discards[0].reason).toBe('span-not-found');
  });
});

describe('BIOCON — the supply network and the EMA approval', () => {
  /**
   * Redbox published two claims for Biocon. The first is in the document we
   * hold; the second — the France/Portugal/Slovenia/Spain expansion — is not,
   * and the honest outcome is that we do not publish it. See the last test.
   */
  const SUPPLY: ProposedClaim = {
    span: 'Regional supply network strengthened through local capabilities and strategic partnerships',
    text: 'strengthened regional supply network through local capabilities and partnerships',
    kind: 'expansion',
  };

  const APPROVAL: ProposedClaim = {
    span: 'EMA approval for second insulin drug product line in Malaysia doubles capacity',
    text: 'EMA approval for second insulin line in Malaysia doubles capacity',
    kind: 'approval',
  };

  it('is eligible', () => {
    expect(claimEligibility(BIOCON, BIOCON.text)).toEqual({ eligible: true });
  });

  it('emits both claims on one wire line', () => {
    const result = run(BIOCON, [SUPPLY, APPROVAL]);

    expect(result.discards).toEqual([]);
    expect(result.line).toBe(
      'BIOCON: STRENGTHENED REGIONAL SUPPLY NETWORK THROUGH LOCAL CAPABILITIES AND PARTNERSHIPS || EMA APPROVAL FOR SECOND INSULIN LINE IN MALAYSIA DOUBLES CAPACITY',
    );
  });

  it('discards the expansion the document does not contain', () => {
    // Redbox's second Biocon claim named four European countries. This
    // document — the cover letter and the deck's opening pages — names none of
    // them, so the claim has nothing to stand on and is refused rather than
    // approximated from the Europe bullet that IS present.
    const result = run(BIOCON, [
      {
        span: 'Expanding commercial footprint in France, Portugal, Slovenia, Spain',
        text: 'expanding commercial footprint in France, Portugal, Slovenia, Spain',
        kind: 'expansion',
      },
    ]);

    expect(result.line).toBeNull();
    expect(result.discards[0].reason).toBe('span-not-found');
  });

  it('ACCEPTS a dull claim quoted out of the safe-harbour boilerplate', () => {
    // Recorded as a limit of the design rather than hidden. The gate answers
    // one question — did the document say this — and this sentence is in every
    // investor presentation ever filed, so the answer is yes and the claim
    // passes. What stops it reaching the wire is the prompt, which asks for
    // notable statements and calls boilerplate out by name; nothing
    // deterministic can tell dull from notable, and inventing a rule that tried
    // would start refusing real claims.
    const result = run(BIOCON, [
      {
        span: 'our ability to successfully implement our strategy, our research and development efforts',
        text: 'confirms its ability to implement its strategy',
        kind: 'operational',
      },
    ]);
    expect(result.discards).toEqual([]);
    expect(result.line).toBe(
      'BIOCON: CONFIRMS ITS ABILITY TO IMPLEMENT ITS STRATEGY',
    );
  });
});

describe('WELENT — the filing that contains no claim', () => {
  /**
   * Redbox published `WELSPUN ENTERPRISES LOWERS TOPLINE GUIDANCE FROM 15-20%
   * TO 10-20%   TV INTERVIEWS`, and the source tag is the answer: the guidance
   * came from a television interview, not from an exchange filing. What this
   * pipeline holds for Welspun that evening is a 1,269-character intimation
   * saying an audio recording is on the company's website.
   *
   * Emitting nothing here is the system working, not the system failing. There
   * is no wire line to be had from this document by any means.
   */
  it('is refused before any model is called', () => {
    const verdict = claimEligibility(WELENT, WELENT.text);

    expect(verdict.eligible).toBe(false);
    if (verdict.eligible) throw new Error('expected a refusal');
    expect(verdict.reason).toContain('covering letter');
  });

  it('contains no guidance to find', () => {
    expect(WELENT.text).not.toMatch(/guidance/i);
    expect(WELENT.text).not.toContain('15-20');
    expect(WELENT.text).not.toContain('10-20');
  });

  it('refuses the competitor’s line if one were proposed anyway', () => {
    // The belt to the eligibility gate's braces: even if the filing were sent,
    // the guidance sentence is not in the document and the claim dies here.
    const result = run(WELENT, [
      {
        span: 'The Company lowers its topline guidance from 15-20% to 10-20%',
        text: 'lowers topline guidance from 15-20% to 10-20%',
        kind: 'guidance',
      },
    ]);

    expect(result.line).toBeNull();
    expect(result.discards[0].reason).toBe('span-not-found');
  });
});

describe('the gate, measured over the whole corpus', () => {
  it('accepts every true claim and refuses every fabricated one', () => {
    const TRUE_CLAIMS: readonly (readonly [string, ProposedClaim])[] = [
      [
        'SWIGGY',
        {
          span: 'setting out its goal to build a ₹10,000 Cr. Adjusted EBITDA business',
          text: 'targets ₹10,000 Cr adjusted EBITDA business',
          kind: 'target',
        },
      ],
      [
        'BIOCON',
        {
          span: 'Regional supply network strengthened through local capabilities and strategic partnerships',
          text: 'strengthened regional supply network',
          kind: 'expansion',
        },
      ],
      [
        'BIOCON',
        {
          span: 'Combined portfolio of 11 biosimilars and eight generic medicines',
          text: 'combined portfolio of 11 biosimilars and eight generic medicines',
          kind: 'operational',
        },
      ],
    ];

    const FABRICATED: readonly (readonly [string, ProposedClaim])[] = [
      [
        'SWIGGY',
        {
          span: 'Swiggy will be EBITDA positive across all segments by FY28.',
          text: 'expects all segments EBITDA positive by FY28',
          kind: 'guidance',
        },
      ],
      [
        'BIOCON',
        {
          span: 'Biocon plans to double its manufacturing capacity in Bengaluru.',
          text: 'plans to double Bengaluru manufacturing capacity',
          kind: 'expansion',
        },
      ],
      [
        'WELENT',
        {
          span: 'The Company lowers its topline guidance from 15-20% to 10-20%',
          text: 'lowers topline guidance from 15-20% to 10-20%',
          kind: 'guidance',
        },
      ],
    ];

    for (const [symbol, claim] of TRUE_CLAIMS) {
      const result = run(bySymbol(symbol), [claim]);
      expect({ symbol, claims: result.claims.length }).toEqual({
        symbol,
        claims: 1,
      });
    }

    for (const [symbol, claim] of FABRICATED) {
      const result = run(bySymbol(symbol), [claim]);
      expect({ symbol, claims: result.claims.length }).toEqual({
        symbol,
        claims: 0,
      });
    }
  });
});
