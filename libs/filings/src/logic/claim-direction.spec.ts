import {
  claimDirection,
  CLAIM_DIRECTIONS,
  type ClaimDirection,
} from './claim-direction';

/**
 * Every span quoted here is a real one, taken verbatim from
 * `enrichment.claims[].span` in the live collection and collapsed on
 * whitespace. A fixture invented to suit the rules would prove the rules match
 * the fixture.
 *
 * The twenty rows below are the seed set from
 * `docs/superpowers/specs/2026-08-08-update-signal-design.md` §3.4, chosen to
 * cover every failure mode the design names rather than to make the classifier
 * look good: six of them are cases a naive implementation gets wrong.
 */

describe('claimDirection — the document printed an increase', () => {
  it.each([
    [
      'ENIL — verb, magnitude and comparator, the baseline shape',
      'ENIL’s digital business continued its strong upward trajectory, reporting revenues of ₹21.1 Crores up 43.3% YoY.',
      'up 43.3%',
    ],
    [
      'PGIL — the terse wire-shaped form',
      'PAT for the quarter stood at INR 99 crore, up 51.4% Y-o-Y',
      'up 51.4%',
    ],
    [
      'RPPL — two percentages, only one of them is the change',
      'Q1 FY27 EBITDA at ₹ 16.52 Cr; up 36.75% YoY with a margin of 16.05%',
      'up 36.75% YoY with a margin of 16.05%',
    ],
    [
      'KIMS — the noun form, "growth of", with no verb at all',
      'Our consolidated revenue stood at Rs. 39,308 Mn for FY 26 compared to Rs. 30,670 Mn in FY 25, showing a growth of 28.2%.',
      'growth of 28.2%',
    ],
    [
      'BIKAJI — two magnitudes in the SAME direction is not mixed',
      'Delivered overall volume growth of 7.7% and value growth of 12.5% in Q1 YoY',
      'growth of 7.7% and value growth of 12.5%',
    ],
  ])('%s', (_why, span, evidence) => {
    expect(claimDirection(span)).toEqual({
      direction: 'expansion',
      evidence,
    });
  });
});

describe('claimDirection — the document printed a decrease', () => {
  it.each([
    [
      'GVT&D — the baseline down',
      'Order bookings were INR 11.4 billion, against INR 16.2 billion in Quarter Ended June 2025, down by 30% YoY',
      'down by 30%',
    ],
    [
      'COHANCE',
      'Q1FY27 reported revenue from operations of ₹4,223 million, down 23.1% year-on-year.',
      'down 23.1%',
    ],
    [
      'WHIRLPOOL — the magnitude precedes the direction noun',
      'Consolidated PBT: Rs. 139 Cr (29% decrease YoY)',
      '29% decrease',
    ],
    [
      'BLUESTARCO — "dropped"',
      'PBT before exceptional items dropped by 23.7% to Rs 125.62 cr in Q1FY27 as compared to Rs 164.64 cr in Q1FY26.',
      'dropped by 23.7%',
    ],
    [
      'COFFEEDAY — OCR damage (f for ₹) must not break the reading',
      'Net profit/(loss) after tax at f 1 Crs ; down 96% YoY',
      'down 96%',
    ],
  ])('%s', (_why, span, evidence) => {
    expect(claimDirection(span)).toEqual({
      direction: 'contraction',
      evidence,
    });
  });
});

describe('claimDirection — the document printed both', () => {
  it.each([
    [
      'GMMPFAUDLR — the clean mixed case',
      'Revenue up 16% YoY and down 2% QoQ',
      'up 16% YoY and down 2%',
    ],
    [
      'RAMCOCEM — mixed, with narrative trailing after it',
      'Total Sale volume increased by 12% YoY and down by 17% QoQ despite demand disruption due to state elections in Tamil Nadu, Kerala & West Bengal',
      'increased by 12% YoY and down by 17%',
    ],
    [
      'RSWM — two sentences, opposite directions',
      'Revenue for Q1 FY27 stood at ₹1,161 crore, reflecting a 1.7% QoQ increase, driven by stable domestic demand and improved volumes. On a YoY basis, revenue declined by 0.7% amid softer export demand, geopolitical uncertainties and raw material price volatility.',
      '1.7% QoQ increase, driven by stable domestic demand and improved volumes. On a YoY basis, revenue declined by 0.7%',
    ],
    [
      'PARAGMILK — three metrics, two directions',
      'EBITDA at ₹70 crore increased by 6% YoY; 7.4% vs 7.7% LY. PBT flat YoY; PAT declined by 20% mainly due to current tax impact',
      'increased by 6% YoY; 7.4% vs 7.7% LY. PBT flat YoY; PAT declined by 20%',
    ],
    [
      'RAMCOCEM — down then up, in one sentence',
      'Average Cement prices have dropped by 2% YoY; however, improved by 6% QoQ',
      'dropped by 2% YoY; however, improved by 6%',
    ],
  ])('%s', (_why, span, evidence) => {
    expect(claimDirection(span)).toEqual({ direction: 'mixed', evidence });
  });
});

/**
 * THE MEASUREMENT THAT MAKES THE LABELLING LOAD-BEARING.
 *
 * 45 of the 803 tagged claims are contractions and 13 of those 45 (28.9%) are
 * metrics where a fall is unambiguously GOOD NEWS: gross NPA, net debt, cost of
 * borrowing, slippages, emissions. The tag follows the FIGURE, never the
 * company, and nothing in this module or downstream of it maps `contraction` to
 * a sentiment — which is why the card's copy says so in words and why the glyph
 * carries no colour.
 */
describe('claimDirection — a fall is not bad news', () => {
  it.each([
    [
      'ESAFSFB — gross NPA down from 7.5% to 5.4%',
      'As compared to Q1 FY26, gross NPA for Q1 FY27 declined to 5.4% from 7.5% and net NPA declined to 0.8% from 3.8% while slippages reduced sharply to INR 75 crores from INR 468 crores on a Y-o-Y basis.',
    ],
    [
      'EDELWEISS — net debt down',
      'Corporate net debt declined by 10% YoY to $605 Mn',
    ],
    [
      'LEMONTREE — cost of debt down, in basis points',
      'cost of debt reduced to 7.48%, down 53 basis points versus a year ago',
    ],
  ])('%s reads as contraction and nothing more', (_why, span) => {
    const reading = claimDirection(span);
    expect(reading.direction).toBe<ClaimDirection>('contraction');
    // The vocabulary is about a figure's movement. The words `positive` and
    // `negative` appear nowhere in this feature, because on these three spans
    // they would be factually wrong rather than merely cautious.
    expect(CLAIM_DIRECTIONS).not.toContain('positive');
    expect(CLAIM_DIRECTIONS).not.toContain('negative');
  });
});

describe('claimDirection — what it refuses to rate', () => {
  it.each([
    [
      'SUNDROP — the second derivative: the RATE of decline is what moved',
      'the overall rate of decline is moderating sequentially from -10% in Q4 FY26 to -3% in Q1 FY 27.',
    ],
    [
      'ARVIND — "paid-up" is not a movement, and "increased" carries no percentage',
      'Pursuant to the allotment of Equity Shares under the QIP, the paid-up Equity Share capital of the Company stands increased from ₹ 2,62,13,96,400 consisting of 26,21,39,640 Equity Shares to ₹ 2,72,04,06,300 consisting of 27,20,40,630 Equity Shares.',
    ],
    [
      'ASTERDM — "up to" beside a bare 12%, the nastiest false positive in the corpus',
      "Acquisition of up to an additional 12% equity stake in United CIIGMA Institute of Medical Sciences Private Limited (UCIMSPL) through exercise of the put option by the Promoter/Promoter Group of UCIMSPL, in accordance with the Shareholders' Agreement dated June 10, 2022.",
    ],
    [
      'NHPC — "Subansiri Lower" is the name of a hydro project, not a direction',
      'Progress on track with total 1550 MW (800 MW of Parbati-II and 750 MW of Subansiri Lower) hydro capacity and 300 MW Solar capacity added during the year; 9,454 MW of 16 no. RE projects (10 no. hydro projects and 6 no. Solar Projects) under construction towards long-term capacity targets.',
    ],
    [
      'PGIL — a step-down subsidiary is a corporate structure, not a fall',
      'During the quarter ended June 30, 2026, the Company through its Step-Down Subsidiary, DSSP Global Limited, Hong Kong, has acquired an additional .9% stake from the Minority Shareholder(s) in PT Pinnacle Apparels.',
    ],
    [
      'WAAREEINDO — "not lower than" is a floor on a rate, not a movement of one',
      'The Company expects to receive loan from WEL at the rate of interest not lower than Government Security rate at the time of giving loan as per section 186 of Companies Act 2013',
    ],
    [
      'SYSTMTXC — "Growth Fund" is the name of a fund',
      'The India SME Growth Fund (Category I AIF) remained fully subscribed at ₹125 crore, with nearly 40% of capital deployed',
    ],
  ])('%s', (_why, span) => {
    expect(claimDirection(span)).toEqual({
      direction: 'unrated',
      evidence: '',
    });
  });

  it('refuses a direction the document printed no magnitude for', () => {
    // The rule that takes coverage from 30.2% of claims to 23.3% and buys the
    // whole defensibility argument: it is the difference between BIOCON's
    // aspirational "supports future growth" and CLEDUCATE's printed "grew
    // 34.7%".
    expect(
      claimDirection(
        'Regional supply network strengthened, supporting future growth',
      ).direction,
    ).toBe<ClaimDirection>('unrated');
  });

  it.each([[''], ['   '], [null], [undefined], [42]])(
    'answers unrated for %p rather than throwing',
    (input) => {
      expect(claimDirection(input as unknown as string)).toEqual({
        direction: 'unrated',
        evidence: '',
      });
    },
  );
});

describe('claimDirection — the contract', () => {
  it('always returns a listed direction', () => {
    const samples = [
      'Revenue up 16% YoY and down 2% QoQ',
      'nothing in particular happened',
      '',
    ];
    for (const span of samples) {
      expect(CLAIM_DIRECTIONS).toContain(claimDirection(span).direction);
    }
  });

  it('is a pure function of the span', () => {
    const span = 'PAT for the quarter stood at INR 99 crore, up 51.4% Y-o-Y';
    expect(claimDirection(span)).toEqual(claimDirection(span));
  });

  it('reads a span carrying the PDF line breaks it was stored with', () => {
    // KIRLOSENG and COHANCE spans are multi-line. The whitespace is collapsed
    // before matching, and the evidence is quoted from the collapsed form.
    expect(
      claimDirection(
        'Q1FY27 reported revenue\n  from operations of ₹4,223\nmillion, down 23.1% year-on-year.',
      ),
    ).toEqual({ direction: 'contraction', evidence: 'down 23.1%' });
  });

  it('quotes evidence that is verbatim in the collapsed span', () => {
    const span =
      'Total Sale volume increased by 12% YoY and down by 17% QoQ despite demand disruption due to state elections in Tamil Nadu, Kerala & West Bengal';
    const { evidence } = claimDirection(span);
    // NOT A SENTENCE THIS MODULE COMPOSED. The card shows it under "Printed in
    // the document", so it has to be the document's own contiguous characters.
    expect(span.replace(/\s+/g, ' ').trim()).toContain(evidence);
  });

  it('matches on whole words, so a substring cannot masquerade', () => {
    // `up` inside `group` and `down` inside `downstream` are the two that would
    // fire on nearly every filing.
    expect(
      claimDirection('The group holds 12% of the downstream joint venture')
        .direction,
    ).toBe<ClaimDirection>('unrated');
  });
});
