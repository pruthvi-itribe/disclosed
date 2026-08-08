import { COMMITMENT_SPAN_PATTERN, datedCommitments } from './claim-commitment';

/**
 * Every span below is verbatim from the live collection on 2026-08-08,
 * whitespace collapsed, and the negatives are as much the suite as the
 * positives: each of them carries a date, and none of them is a commitment
 * still ahead.
 */

/** The IST day every case below is read against, so nothing depends on today. */
const TODAY = '2026-08-08';

describe('datedCommitments — the dated commitments a span printed', () => {
  it.each([
    [
      'IITL',
      'the Company has fixed August 18, 2026 (Tuesday), as the Record Date for the purpose of determining the entitlement and names of equity Shareholders who are eligible to participate in the Buyback.',
      '2026-08-18',
      'August 18, 2026',
      'Record Date',
    ],
    [
      'NAHARPOLY',
      'Board of Directors has fixed 04th September, 2026 as record date for the pulpose of payment of dividend of Rs. 1.50/-per equity share of Rs. 5/-each for the Financial year ended 3 let March, 2026.',
      '2026-09-04',
      '04th September, 2026',
      'record date',
    ],
    [
      'HGS',
      'Approved convening 31 st AGM of Hinduja Global Solutions Limited on Friday, September 25, 2026',
      '2026-09-25',
      'September 25, 2026',
      'AGM',
    ],
    [
      'JKIL',
      'The 27th Annual General Meeting of the Company will be held on Tuesday, 22nd September, 2026 at 11:00 A.M. (IST) at Vaishnavi Banquets, Gokul Arkade Building, Opp. Garware Chowk, Next to RBL Bank, Vile Parle (East), Mumbai – 400 057, Maharashtra.',
      '2026-09-22',
      '22nd September, 2026',
      'Annual General Meeting',
    ],
    [
      'MPSLTD',
      'the ensuing AGM of the Company has been scheduled to be held on 04 September 2026 through VC (Video Conferencing)/ OAVM (Other Audio Visual Means).',
      '2026-09-04',
      '04 September 2026',
      'AGM',
    ],
    [
      'GNFC',
      'Wednesday, September 09, 2026 For the purpose of determining the eligibility of members entitled to Dividend at ensuing AGM and vote on the resolutions set out in the Notice of the AGM',
      '2026-09-09',
      'September 09, 2026',
      'AGM',
    ],
  ])(
    'reads %s’s date and the word that made it a commitment',
    (_symbol, span, date, dateText, evidence) => {
      expect(datedCommitments(span, TODAY)).toEqual([
        { date, dateText, evidence },
      ]);
    },
  );

  it('returns every future date in a span, soonest first', () => {
    // HITECHGEAR's book-closure window is genuinely two dates: the register
    // closes on one and reopens on the other, and dropping either would state
    // a window the filing did not.
    const span =
      'Book Closure Date* From Wednesday, September 16, 2026 To Tuesday, September 22, 2026';

    expect(datedCommitments(span, TODAY)).toEqual([
      {
        date: '2026-09-16',
        dateText: 'September 16, 2026',
        evidence: 'Book Closure',
      },
      {
        date: '2026-09-22',
        dateText: 'September 22, 2026',
        evidence: 'Book Closure',
      },
    ]);
  });

  it('orders by date rather than by position in the sentence', () => {
    const span =
      'the Register of Members and Share Transfer Books of the Company will remain closed from Saturday 19th September, 2026 To Friday 25th September, 2026 (both days inclusive) for the purpose of 15 th Annual General Meeting of the Company.';

    expect(datedCommitments(span, TODAY).map((one) => one.date)).toEqual([
      '2026-09-19',
      '2026-09-25',
    ]);
  });

  it('reads an e-voting window as the three dates it prints', () => {
    const span =
      'Cut-off date for the purpose of E-voting for AGM shall be 4th September, 2026 and E-Voting facility shall be available from 09:00 a.m. on 8th September, 2026 to 05:00 pm. on 10th September, 2026;';

    expect(datedCommitments(span, TODAY).map((one) => one.date)).toEqual([
      '2026-09-04',
      '2026-09-08',
      '2026-09-10',
    ]);
  });

  it('keeps one entry per date, never one per repetition', () => {
    const span =
      'The Record Date is Friday, September 11, 2026. The Record Date of September 11, 2026 is final.';

    expect(datedCommitments(span, TODAY)).toHaveLength(1);
  });
});

describe('datedCommitments — what it refuses', () => {
  it('refuses a dated sentence that names no commitment', () => {
    // Every word true, and none of it an appointment: the date is the quarter
    // the figure belongs to.
    const span =
      'ENIL’s balance sheet remained healthy with a cash balance of ₹389.7 crore as on June 30, 2026.';

    expect(datedCommitments(span, '2026-06-01')).toEqual([]);
  });

  it('refuses a commitment whose date has already passed', () => {
    const span =
      'Approved convening 31 st AGM of Hinduja Global Solutions Limited on Friday, September 25, 2026';

    expect(datedCommitments(span, '2026-09-25')).toEqual([]);
    expect(datedCommitments(span, '2026-09-26')).toEqual([]);
  });

  it('refuses the reporting period a commitment sentence also names', () => {
    // RAIN's record date is ahead; the financial year ending December 31 is a
    // period boundary, not something a reader can turn up for. Both are future
    // dates in one sentence, and only one of them is an appointment.
    const span =
      'Fixed Friday, the August 14, 2026 as record date for the purpose of determining the shareholders eligible for receipt of Interim Dividend for the Financial Year ending December 31, 2026';

    expect(datedCommitments(span, TODAY)).toEqual([
      {
        date: '2026-08-14',
        dateText: 'August 14, 2026',
        evidence: 'record date',
      },
    ]);
  });

  it('refuses a date that no calendar has', () => {
    // A PDF that lost a digit prints dates that parse and do not exist. `31
    // September` is not a day the reader can be told to turn up on.
    const span = 'The Record Date shall be September 31, 2026.';

    expect(datedCommitments(span, TODAY)).toEqual([]);
  });

  it('refuses a span that is empty, blank or not a string', () => {
    expect(datedCommitments('', TODAY)).toEqual([]);
    expect(datedCommitments('   ', TODAY)).toEqual([]);
    expect(datedCommitments(undefined as unknown as string, TODAY)).toEqual([]);
  });

  it('throws on a day key it cannot compare against', () => {
    // NOT a silent empty list. The caller passes `istDayKey(now)`, so a value
    // of another shape is a wiring mistake — and the failure it would cause is
    // the worst one this rule has: every past date admitted as upcoming.
    expect(() =>
      datedCommitments('Record Date August 18, 2026', '8/8/2026'),
    ).toThrow(/YYYY-MM-DD/);
  });
});

describe('COMMITMENT_SPAN_PATTERN', () => {
  it('is one word-bounded alternation, assembled from the phrase list', () => {
    expect(COMMITMENT_SPAN_PATTERN.startsWith('\\b(?:')).toBe(true);
    expect(COMMITMENT_SPAN_PATTERN.endsWith(')\\b')).toBe(true);
  });

  it('matches a phrase a PDF broke across a line', () => {
    // The gaps are `\s+` for the reason `claim-plan.ts` records: a span carries
    // the line breaks of the page it was set on.
    expect(new RegExp(COMMITMENT_SPAN_PATTERN, 'i').test('Record\nDate')).toBe(
      true,
    );
  });

  it('does not match a longer word that happens to contain a phrase', () => {
    expect(new RegExp(COMMITMENT_SPAN_PATTERN, 'i').test('MAGMA')).toBe(false);
  });
});
