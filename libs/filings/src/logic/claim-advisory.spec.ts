import {
  ADVISORY_PATTERNS,
  advisoryHitIn,
  individualHitIn,
  INDIVIDUAL_PATTERNS,
} from './claim-advisory';

/**
 * The six lines the competitor actually published, which this feature exists to
 * be able to match. Every one of them is a company statement about the company,
 * and every one must survive both filters — a gate that blocked these would be
 * a gate that blocked the product.
 */
const PUBLISHED_LINES: readonly string[] = [
  'lowers topline guidance from 15-20% to 10-20%',
  'co expecting volume growth in W&C of 16-18%',
  'strengthened regional supply network through global mfg footprint',
  'expanding commercial footprint in France, Portugal, Slovenia, Spain',
  'co. targets 100b rupees adj EBITDA by FY31',
  'co joins the Microsoft Intelligent Security Association (MISA)',
];

describe('advisoryHitIn', () => {
  it.each(PUBLISHED_LINES)('allows the real published line: %s', (line) => {
    expect(advisoryHitIn(line)).toBeNull();
  });

  it.each([
    [
      "a company's own forward guidance",
      'the company expects revenue to grow 18% in FY27',
    ],
    ['a stated target', 'targets 100 billion rupees adjusted EBITDA by FY31'],
    [
      'a credit rating action',
      'CRISIL has upgraded the long-term rating to AA-',
    ],
    [
      'an acquisition valuation',
      'acquired at an enterprise valuation of Rs 450 crore',
    ],
    ['a revenue move', 'consolidated revenue surged 22% year on year'],
    ['a capacity expansion', 'commissioning a new 2 GW cell line at Hosur'],
    ['a certification', 'received EU GMP certification for the Bengaluru site'],
  ])('allows %s', (_label, text) => {
    expect(advisoryHitIn(text)).toBeNull();
  });

  it.each([
    ['a buy call', 'we recommend investors buy the stock'],
    ['a bare buy', 'buy on dips'],
    ['a rating', 'maintains an overweight rating'],
    ['a target price', 'target price of Rs 1,450'],
    ['a price objective', 'raises price objective to Rs 900'],
    ['upside', 'implies 25% upside from here'],
    ['a directional judgement', 'the setup looks bullish'],
    ['a valuation judgement', 'trades at an attractive valuation'],
    ['valuation comfort', 'there is valuation comfort at these levels'],
    ['an effect on the security', 'this is positive for the stock'],
    ['an instruction to investors', 'investors should accumulate on declines'],
    ['this pipeline speaking', 'we believe the order book is understated'],
    ['a predicted price move', 'the stock could rally sharply on this news'],
    ['a narrated price move', 'shares surged 12% after the announcement'],
    ['a price move stated first', 'a sharp rally in the stock is likely'],
    ['the share price itself', 'the share price closed at Rs 342'],
    ['market capitalisation', 'adds Rs 4,000 crore to market capitalisation'],
    ['a multibagger claim', 'a potential multibagger from here'],
    ['a re-rating claim', 'deserves a re-rating'],
    ['undervaluation', 'the business remains undervalued'],
  ])('blocks %s', (_label, text) => {
    expect(advisoryHitIn(text)).not.toBeNull();
  });

  it('names the rule that fired, so a discard can be reviewed', () => {
    const hit = advisoryHitIn('target price of Rs 1,450');
    expect(hit).toContain('target price');
    expect(hit).toContain('price or rating call');
  });

  it('is case-insensitive, because the wire format is upper case', () => {
    expect(advisoryHitIn('THIS IS POSITIVE FOR THE STOCK')).not.toBeNull();
    expect(advisoryHitIn('MAINTAINS AN OVERWEIGHT RATING')).not.toBeNull();
  });

  it('has a reason on every pattern', () => {
    for (const { why } of ADVISORY_PATTERNS) {
      expect(why.length).toBeGreaterThan(10);
    }
  });
});

describe('individualHitIn', () => {
  it.each(PUBLISHED_LINES)('allows the real published line: %s', (line) => {
    expect(individualHitIn(line)).toBeNull();
  });

  it.each([
    [
      'a board resolution',
      'the Board of Directors approved a dividend of Rs 4',
    ],
    ['a subsidiary', 'incorporated a wholly-owned subsidiary in Abu Dhabi'],
    [
      'an order win',
      'received an order worth Rs 256.89 crore from the department',
    ],
    ['a plant', 'the Hosur plant has commenced commercial production'],
  ])('allows %s', (_label, text) => {
    expect(individualHitIn(text)).toBeNull();
  });

  it.each([
    ['an honorific', 'Mr. Rajesh Kumar has been named to the board'],
    [
      'an honorific without a stop',
      'Shri Anand Mahindra addressed the meeting',
    ],
    ['an appointment', 'the company has appointed a new head of sales'],
    ['a resignation', 'resignation of the chief financial officer'],
    ['a cessation', 'has ceased to be a director with effect from today'],
    ['stepping down', 'steps down after eleven years'],
    ['an officer title', 'the Managing Director confirmed the capacity plan'],
    ['an initialism', 'the CEO said the order book is at a record'],
    ['a company secretary', 'the Company Secretary has certified the filing'],
  ])('blocks %s', (_label, text) => {
    // Fails closed by design: a wire line about a person is the highest
    // exposure sentence this system could emit, and the cost of over-blocking
    // is a board-change line nobody needed.
    expect(individualHitIn(text)).not.toBeNull();
  });

  it('names the rule that fired', () => {
    const hit = individualHitIn('Mr. Rajesh Kumar has been named to the board');
    expect(hit).toContain('honorific');
  });

  it('has a reason on every pattern', () => {
    for (const { why } of INDIVIDUAL_PATTERNS) {
      expect(why.length).toBeGreaterThan(10);
    }
  });

  it('leaves the plural "directors" sayable', () => {
    // `director` is deliberately absent from every pattern, so a board
    // resolution stays sayable while a named or singular officer does not.
    expect(
      individualHitIn('the directors noted the auditor report'),
    ).toBeNull();
  });
});
