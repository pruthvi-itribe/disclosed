import { claimTopic, CLAIM_TOPICS, type ClaimTopic } from './claim-topic';

/**
 * Every claim quoted here is a real one, taken from the live collection. A
 * fixture invented to suit the rules would prove the rules match the fixture.
 */
describe('claimTopic — real claims from the collection', () => {
  it.each([
    ['Q1 FY27 revenue INR 8,936 Mn, up 20.7% YoY', 'financial'],
    ['Q1 FY2027 EBITDA margin at 17.9%', 'financial'],
    ['Consolidated Q1 PAT up 120% YoY to ₹740 million', 'financial'],
    [
      'Proposes dividend of ₹1.50 per equity share of ₹10 each for FY ended March 31, 2026.',
      'dividend',
    ],
    [
      'Company fixed August 18, 2026 as record date for buyback of equity shares',
      'dividend',
    ],
    ['Q1 order bookings INR 11.4 billion, down 30% YoY', 'orders'],
    [
      'Secured HPCL order for 1,40,000 units of 10 kg composite LPG cylinders',
      'orders',
    ],
    ['Acquired Kalinga Hospital Ltd with 58.28% stake', 'acquisition'],
    [
      'Company to invest up to INR 15,00,00,000 in Saudi subsidiary for Middle East expansion.',
      'acquisition',
    ],
    [
      'Commissioned 10.4 MW ground-mounted solar plant; total solar capacity 11.6 MW.',
      'capacity',
    ],
    ['India Ratings upgraded credit rating to IND AA-/Stable', 'ratings'],
    [
      'Received EMA approval to extend NaMuscla for children aged 6-17 years',
      'product',
    ],
  ] as const)('reads %s as %s', (text, topic) => {
    expect(claimTopic(text)).toBe<ClaimTopic>(topic);
  });
});

describe('claimTopic — the order of the rules is the policy', () => {
  it('files a quantified payout as dividend, not financial', () => {
    // A dividend line carries figures like any other. Were `financial` first, a
    // reader hunting payouts would lose 146 claims among 748 revenue
    // statements — which is the entire reason `dividend` is worth having.
    expect(claimTopic('Declared interim dividend; PAT up 12%')).toBe(
      'dividend',
    );
  });

  it('files a quantified order as orders, not financial', () => {
    // The real claim: "Q1 order bookings INR 11.4 billion, down 30% YoY" is an
    // order statement that happens to be quantified.
    expect(claimTopic('Q1 order bookings INR 11.4 billion, down 30% YoY')).toBe(
      'orders',
    );
  });

  it('files a rating action as ratings, even when it names a subsidiary', () => {
    expect(
      claimTopic('CRISIL upgraded the rating of the subsidiary to AA'),
    ).toBe('ratings');
  });
});

describe('claimTopic — what it refuses to classify', () => {
  it.each([
    'Securities transferred to IEPF not considered under this window for processing.',
    'Granted 1,02,726 employee stock options under Lenskart ESOP Plan 2021',
    'Exercise price of INR 404 per share',
  ])('leaves %s as other', (text) => {
    // `other` IS NOT A FAILURE AND MUST NOT BE TUNED AWAY. 39.4% of the live
    // collection lands here, and reading it — stock option grants, IEPF
    // transfers, exercise prices — most of it is true, verified and close to
    // worthless on a wire. That makes `other` the most useful topic on the
    // list, because it is the one an alert path can mute.
    expect(claimTopic(text)).toBe('other');
  });

  it.each([[''], ['   '], [null], [undefined], [42]])(
    'answers other for %p rather than throwing',
    (input) => {
      expect(claimTopic(input as unknown as string)).toBe('other');
    },
  );
});

describe('claimTopic — the contract', () => {
  it('always returns a listed topic', () => {
    const samples = [
      'Q1 revenue up 20%',
      'dividend declared',
      'nothing in particular happened',
      '',
    ];
    for (const text of samples) {
      expect(CLAIM_TOPICS).toContain(claimTopic(text));
    }
  });

  it('is a pure function of the text', () => {
    const text = 'Q1 FY27 revenue INR 8,936 Mn, up 20.7% YoY';
    expect(claimTopic(text)).toBe(claimTopic(text));
  });

  it('does not depend on case', () => {
    expect(claimTopic('DECLARED INTERIM DIVIDEND OF RS 5')).toBe('dividend');
    expect(claimTopic('q1 revenue up 20%')).toBe('financial');
  });

  it('matches on whole words, so a substring cannot masquerade', () => {
    // `MW` inside a word is not megawatts, and `EPS` inside one is not earnings
    // per share. Without word boundaries a claim about a "SUBMWAY" or a
    // "STEPSON" would be filed as capacity or financial.
    expect(claimTopic('The company opened a shop on Stepson Road')).toBe(
      'other',
    );
  });
});
