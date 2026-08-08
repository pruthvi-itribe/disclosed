import { PLAN_SPAN_PATTERN, planEvidence } from './claim-plan';

/**
 * Every span below is verbatim from the live collection on 2026-08-08, stored
 * under `kind: 'guidance'` or `kind: 'target'`, whitespace collapsed. The
 * negatives are the point of the suite: all of them carry one of those two
 * kinds, and none of them is a plan.
 */

describe('planEvidence — the sentences that are about a period still ahead', () => {
  it.each([
    [
      'INDGN',
      'we expect our organic growth in FY27 to be better than FY26',
      'expect',
    ],
    [
      'HINDALCO',
      'Aditya Smelter Phase 2 on track to begin metal production in FY28',
      'on track',
    ],
    [
      'KALPATARU',
      'Looking ahead to FY27, we target closing the year with pre-sales of approximately Rs. 6,500 crores which would be a growth of ~23% over FY26.',
      'Looking ahead',
    ],
    [
      'BEL',
      'BEL has set a target to achieve Net Zero Carbon Emissions by 2035, considering the GHG emissions in the FY 2024-25 as baseline',
      'target',
    ],
    [
      'STERTOOLS',
      'we have increased our planned capital expenditure to nearly INR 80 crore during FY27, higher than our earlier estimate.',
      'planned',
    ],
    [
      'DHANUKA',
      'We are pleased to inform you that in the upcoming months, we are planning to launch five new products consisting of one Liquid Fertilizer, three Fungicides, and one Herbicide.',
      'upcoming',
    ],
    ['MOTHERSON', 'Capex guidance for FY27 is Rs 6,000Cr (+/-10%)', 'guidance'],
    [
      'SUMEETINDS',
      '30,000 TPA capacity expansion planned over the next 3 years',
      'planned',
    ],
    [
      'HINDALCO',
      'Bay Minette plant commissioning is underway; expect to commence commercial shipments in Q1 FY28',
      'expect',
    ],
    [
      'SWIGGY',
      'Instamart is targeting a ₹1.5+ Lakh Cr. GOV business by FY31, a 4-5x jump from ₹28,000 Cr. in FY26.',
      'targeting',
    ],
  ])('quotes %s’s own forward-looking words', (_symbol, span, evidence) => {
    expect(planEvidence('guidance', span)).toBe(evidence);
  });

  it.each([
    ['SWIGGY', 'a ₹1.5+ Lakh Cr. GOV business by FY31', 'by FY31'],
    ['HINDALCO', 'total savings by FY 28 exit', 'by FY 28'],
    ['JSWINFRA', 'ports capacity, growing to 400 MTPA by 2030', 'by 2030'],
  ])(
    'reads %s’s deadline whether or not FY carries a space',
    (_symbol, span, evidence) => {
      // The first version of this rule rewrote every space in the pattern to
      // `\s+`, which turned the optional space in `FY ?27` into a required one:
      // "by FY 31" was a plan and "by FY31" was not.
      expect(planEvidence('target', span)).toBe(evidence);
    },
  );

  it('reads a phrase the PDF broke across a line', () => {
    // A span is stored with the line breaks of the page it was set on, and
    // "on track" arrives split by one of them often enough to matter.
    expect(
      planEvidence(
        'guidance',
        'The Company remains on\ntrack to commission the facility',
      ),
    ).toBe('on track');
  });

  it.each([
    [
      'INDUSINDBK',
      'To declare dividend at the rate of ₹1.50 per equity share of ₹10 each of the Bank, fully paid, for the Financial Year ended March 31, 2026.',
    ],
    [
      'BEL',
      'The Board of Directors has declared an interim dividend of ` 1.95 (195%) per equity share of ` 1/- each fully paid-up which was paid for the financial year',
    ],
    [
      'ALLCARGO',
      'Express Distribution: Registered increased Revenue growth of 13.5% year-on-year for Q1FY27',
    ],
    [
      'GOLDIAM',
      'Cash and Cash Equivalents (including investments) were at ₹ 4566.70 million as at June 30, 2026.',
    ],
    [
      'GOLDIAM',
      'Consolidated Revenue for Q1 FY2027 at ₹ 3637 million - up 54% Y-o-Y',
    ],
    [
      'HGS',
      'Approved convening 31 st AGM of Hinduja Global Solutions Limited on Friday, September 25, 2026 for the financial year ended March 31, 2026',
    ],
    [
      'PPAP',
      'During the quarter, the Holding Company has allotted 37,917 shares upon exercise of stock options by ESOP holders under PPAP Employee Stock Option Plan',
    ],
    [
      'TATASTEEL',
      'In 1QFY27, India EBITDA was higher by 32% YoY to about Rs. 9,900 crores.',
    ],
  ])(
    'refuses %s’s sentence, which the extractor filed as a plan anyway',
    (_symbol, span) => {
      // THE WHOLE REASON THIS MODULE EXISTS. Measured over the 813 claims stored
      // under the two plan kinds on 2026-08-08, only 179 (22.0%) print a word
      // about a period still ahead; the rest are last quarter's figures, a
      // declared dividend or an AGM notice. A section headed "plans" that showed
      // all 813 would be wrong about two lines in three.
      expect(planEvidence('guidance', span)).toBeNull();
    },
  );

  it('refuses a forward-looking sentence that is not filed as a plan', () => {
    // The kind is the extractor's reading and the words are the document's, and
    // this asks for both. Neither alone is the set the page publishes.
    expect(
      planEvidence('operational', 'we expect to commission the plant in FY28'),
    ).toBeNull();
    expect(planEvidence('approval', 'on track to begin production')).toBeNull();
  });

  it.each([
    ['an empty span', ''],
    ['whitespace only', '   \n  '],
  ])('answers null for %s rather than throwing', (_case, span) => {
    expect(planEvidence('guidance', span)).toBeNull();
  });

  it('quotes the document rather than composing a phrase', () => {
    // The evidence is a slice of the span, which is what makes it checkable
    // against the PDF by a reader who never leaves the page.
    const span = 'we continue to target domestic growth of 30-35%';
    const evidence = planEvidence('target', span);
    expect(evidence).not.toBeNull();
    expect(span).toContain(evidence);
  });
});

describe('PLAN_SPAN_PATTERN — the same rule, as a database predicate', () => {
  it('matches exactly what planEvidence accepts, so the two surfaces agree', () => {
    // The feed's chip filters in Mongo with this pattern and the company page
    // reads `planEvidence` off the response. Two rules would be two answers to
    // one question, and a chip that promised plans and led to a page with none.
    const pattern = new RegExp(PLAN_SPAN_PATTERN, 'i');
    const spans = [
      ['we expect our organic growth in FY27 to be better than FY26', true],
      ['Capex guidance for FY27 is Rs 6,000Cr (+/-10%)', true],
      [
        'Consolidated Revenue for Q1 FY2027 at ₹ 3637 million - up 54% Y-o-Y',
        false,
      ],
      ['under PPAP Employee Stock Option Plan', false],
    ] as const;

    for (const [span, expected] of spans) {
      expect([span, pattern.test(span)]).toEqual([span, expected]);
      expect([span, planEvidence('guidance', span) !== null]).toEqual([
        span,
        expected,
      ]);
    }
  });

  it('is a whole-word rule, so a plan is never read out of a longer word', () => {
    const pattern = new RegExp(PLAN_SPAN_PATTERN, 'i');
    expect(pattern.test('the retargeting of the campaign')).toBe(false);
    expect(pattern.test('unexpectedly')).toBe(false);
  });
});
