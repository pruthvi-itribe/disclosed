import {
  GIST_MAX_CHARS,
  GIST_MIN_CHARS,
  verifyGist,
  type GistRefusal,
} from './claim-gist';
import { buildGistRequest, parseGistResponse } from './gist-prompt';

/**
 * The gate that lets a model choose a headline without letting it write
 * one. Every claim below is a line this product has published, and every
 * refusal is one the first build let through — see `claim-gist.ts` for
 * what the dry run over 20 production claims returned.
 */

const refusalOf = (
  verdict: ReturnType<typeof verifyGist>,
): GistRefusal | null => (verdict.ok ? null : verdict.refused);

describe('verifyGist', () => {
  const claim =
    'Indiabulls allotted 26,60,700 fully paid-up equity shares of face value Rs. 2 each on exercise of employee stock options under ESOP Scheme 2025.';

  it('accepts a contiguous slice that begins where the claim begins', () => {
    expect(
      verifyGist({
        candidate: 'Indiabulls allotted 26,60,700 fully paid-up equity shares',
        claimText: claim,
      }),
    ).toEqual({
      ok: true,
      gist: 'Indiabulls allotted 26,60,700 fully paid-up equity shares',
    });
  });

  // The one failure a model can produce that reads perfectly.
  it('refuses a paraphrase, however fluent', () => {
    expect(
      refusalOf(
        verifyGist({
          candidate: 'Indiabulls issued 26.6 lakh shares to employees',
          claimText: claim,
        }),
      ),
    ).toBe('not-found');
  });

  // "allotted 26,60,700 ... equity shares" — true, contiguous, and torn
  // out of the middle of a line. Accepted by the span-sliced build.
  it('refuses a slice torn out of the middle of the line', () => {
    expect(
      refusalOf(
        verifyGist({
          candidate: 'allotted 26,60,700 fully paid-up equity shares of face',
          claimText: claim,
        }),
      ),
    ).toBe('mid-sentence');
  });

  // Written to production by the first --write run. A comma counted as a
  // boundary, so the second item of a list read as the start of a
  // sentence — and the headline dropped the country listed first.
  it('refuses a slice that starts at a comma, mid-list', () => {
    const listed =
      'Expanding presence in Saudi Arabia, Kenya and other African markets for telecom infrastructure and BESS solutions';
    expect(
      refusalOf(
        verifyGist({
          candidate:
            'Kenya and other African markets for telecom infrastructure and BESS solutions',
          claimText: listed,
        }),
      ),
    ).toBe('mid-sentence');
  });

  it('accepts a slice that starts after a boundary the claim printed', () => {
    const twoParts =
      'The scheme was approved by the board on 12 August; Godawari Power will issue 4,00,000 equity shares to the shareholders of the merging entity.';
    const verdict = verifyGist({
      candidate: 'Godawari Power will issue 4,00,000 equity shares',
      claimText: twoParts,
    });
    expect(verdict).toEqual({
      ok: true,
      gist: 'Godawari Power will issue 4,00,000 equity shares',
    });
  });

  // "Total Total 10258326  9071840  88.43  9062559  9281  99.90" — a
  // table the extractor read as text, accepted by the first build.
  it('refuses a row of figures, which is not a sentence', () => {
    const tabular =
      'Total Total 10258326 9071840 88.43 9062559 9281 99.90 0.10 for the delisting resolution put to the shareholders.';
    expect(
      refusalOf(
        verifyGist({
          candidate: 'Total Total 10258326 9071840 88.43 9062559 9281 99.90',
          claimText: tabular,
        }),
      ),
    ).toBe('not-prose');
  });

  it('refuses a slice that drops the figure the claim printed', () => {
    const rating =
      "CareEdge Ratings reaffirmed the CARE A; Stable rating on SRM Contractors' long term bank facilities of Rs 60.90 crore.";
    expect(
      refusalOf(
        verifyGist({
          candidate: 'CareEdge Ratings reaffirmed the CARE A; Stable rating',
          claimText: rating,
        }),
      ),
    ).toBe('figure-lost');
  });

  // Dropping "subject to" states as done something the filing did not.
  it('refuses a slice that drops the condition', () => {
    const conditional =
      'Board approved the acquisition of the entire shareholding of the target for Rs 120 crore, subject to shareholder approval.';
    expect(
      refusalOf(
        verifyGist({
          candidate:
            'Board approved the acquisition of the entire shareholding of the target for Rs 120 crore',
          claimText: conditional,
        }),
      ),
    ).toBe('condition-dropped');
  });

  it('refuses a slice that ends on a word needing the next one', () => {
    expect(
      refusalOf(
        verifyGist({
          candidate:
            'Indiabulls allotted 26,60,700 fully paid-up equity shares of',
          claimText: claim,
        }),
      ),
    ).toBe('dangling-end');
  });

  it('refuses a slice that saves the reader nothing', () => {
    const short =
      'Revenue for the quarter stood at Rs 320 crore, up 23% over the same quarter.';
    expect(
      refusalOf(
        verifyGist({
          candidate:
            'Revenue for the quarter stood at Rs 320 crore, up 23% over the same quarter',
          claimText: short,
        }),
      ),
    ).toBe('no-gain');
  });

  // The prompt asks for an empty answer when nothing fits, so an empty
  // answer is the model obeying — reported as its own fact.
  it('names a decline as a decline, not as a stub', () => {
    expect(refusalOf(verifyGist({ candidate: '', claimText: claim }))).toBe(
      'declined',
    );
    expect(refusalOf(verifyGist({ candidate: '   ', claimText: claim }))).toBe(
      'declined',
    );
  });

  it('bounds the length at both ends', () => {
    expect(
      refusalOf(verifyGist({ candidate: 'Rs. 2 each', claimText: claim })),
    ).toBe('too-short');
    expect(
      refusalOf(
        verifyGist({
          candidate: 'x'.repeat(GIST_MAX_CHARS + 1),
          claimText: claim,
        }),
      ),
    ).toBe('too-long');
    expect(GIST_MIN_CHARS).toBeLessThan(GIST_MAX_CHARS);
  });

  // A claim wrapped by a PDF reader still matches: the comparison is
  // whitespace-insensitive and nothing else.
  it('matches across a line break in the claim', () => {
    const wrapped = claim.replace(' fully', '\n fully');
    expect(
      verifyGist({
        candidate: 'Indiabulls allotted 26,60,700 fully paid-up equity shares',
        claimText: wrapped,
      }).ok,
    ).toBe(true);
  });
});

describe('the gist request', () => {
  it('carries the claim, keyed by id', () => {
    const body = buildGistRequest([{ id: 'a1', claim: 'Claim one.' }]);
    expect(JSON.parse(body)).toEqual([{ id: 'a1', claim: 'Claim one.' }]);
  });

  // A gist attached to the wrong filing would be a perfect quote from
  // another company's line — the one failure this gate cannot catch.
  it('reads answers by id and drops malformed entries', () => {
    expect(
      parseGistResponse({
        gists: [
          { id: 'b2', gist: 'a copy' },
          { id: '', gist: 'no id' },
          { id: 'c3' },
          'nonsense',
        ],
      }),
    ).toEqual([{ id: 'b2', gist: 'a copy' }]);
    expect(parseGistResponse({})).toEqual([]);
    expect(parseGistResponse(null)).toEqual([]);
  });
});

/**
 * The narrowest rule in the gate, and the one that needed two attempts:
 * a slice ending on a figure whose object is in the tail.
 */
describe('an amount whose object is in the tail', () => {
  it('refuses "redemption of ₹423 crore" when the claim says of what', () => {
    const claim =
      'Became standalone net debt free as of 31 March 2026, after early redemption of ₹423 crore of Non-Convertible Debentures.';
    expect(
      verifyGist({
        candidate:
          'Became standalone net debt free as of 31 March 2026, after early redemption of ₹423 crore',
        claimText: claim,
      }),
    ).toEqual({ ok: false, refused: 'dangling-end' });
  });

  // The first version of the rule refused any tail beginning "of" and
  // took this with it: the dropped clause is a qualifier, not an object.
  it('keeps a slice ending on a noun the tail only qualifies', () => {
    const claim =
      'Indiabulls allotted 26,60,700 fully paid-up equity shares of face value Rs. 2 each on exercise of employee stock options.';
    expect(
      verifyGist({
        candidate: 'Indiabulls allotted 26,60,700 fully paid-up equity shares',
        claimText: claim,
      }).ok,
    ).toBe(true);
  });
});

/**
 * The join rule, which is what finally caught the failures no word list
 * could. All four claims are production lines; the first three were
 * ACCEPTED by earlier builds of this gate.
 */
describe('a cut has to land where the claim printed a join', () => {
  const refuse = (candidate: string, claimText: string): GistRefusal | null =>
    refusalOf(verifyGist({ candidate, claimText }));

  it('refuses an adjective whose noun is in the tail', () => {
    expect(
      refuse(
        'Interim dividend of Rs. 7.50 per equity share confirmed as final',
        'Interim dividend of Rs. 7.50 per equity share confirmed as final dividend for the financial year ended 31st March, 2026.',
      ),
    ).toBe('mid-phrase');
  });

  it('refuses a unit whose subject is in the tail', () => {
    expect(
      refuse(
        'FY26 was the first full year of operations at enhanced MPAP limits of 0.599 MTPA',
        'FY26 was the first full year of operations at enhanced MPAP limits of 0.599 MTPA manganese ore and 4.45 MTPA iron ore.',
      ),
    ).toBe('mid-phrase');
  });

  it('refuses a comparison whose object is in the tail', () => {
    expect(
      refuse(
        'Company to maintain security cover of at least 1.10 times',
        'Company to maintain security cover of at least 1.10 times the entire secured obligations throughout the tenure of the NCDs.',
      ),
    ).toBe('mid-phrase');
  });

  // The other half of the rule: a preposition opens a phrase the
  // sentence can do without, so cutting before one is allowed.
  it('keeps a cut before a droppable prepositional phrase', () => {
    expect(
      verifyGist({
        candidate:
          'Borrowings raised to finance the Arjas Steel acquisition were substantially repaid',
        claimText:
          'Borrowings raised to finance the Arjas Steel acquisition were substantially repaid during the year through internal accruals.',
      }).ok,
    ).toBe(true);
  });

  it('keeps a cut before a coordinating conjunction', () => {
    expect(
      verifyGist({
        candidate:
          'Operationalized BESS manufacturing facilities with 5 GWh installed capacity',
        claimText:
          'Operationalized BESS manufacturing facilities with 5 GWh installed capacity and delivered over 300 grid-scale BESS containers.',
      }).ok,
    ).toBe(true);
  });
});

/**
 * The rule a live run forced, and the one whose absence would have put a
 * wrong NUMBER on a card rather than merely a clumsy sentence.
 */
describe('an "and" that joins objects, not clauses', () => {
  it('refuses a cut that takes half of a compound object', () => {
    expect(
      verifyGist({
        candidate:
          'Buyback size is 7.20% and 6.63% of aggregate paid-up equity share capital',
        claimText:
          'Buyback size is 7.20% and 6.63% of aggregate paid-up equity share capital and free reserves as at March 31, 2026 on standalone basis',
      }),
    ).toEqual({ ok: false, refused: 'splits-a-list' });
  });

  it('refuses dropping the second of two dividends the claim announced', () => {
    expect(
      refusalOf(
        verifyGist({
          candidate:
            'Shareholders confirmed payment of First Interim Dividend of ₹4.00',
          claimText:
            'Shareholders confirmed payment of First Interim Dividend of ₹4.00 and Second Interim Dividend of ₹1.00 per equity share for FY ended March 31, 2026',
        }),
      ),
    ).toBe('splits-a-list');
  });

  // Outside a prepositional phrase the conjunction joins statements, and
  // cutting before it is exactly what this feature is for.
  it('keeps a cut at an "and" that joins two statements', () => {
    expect(
      verifyGist({
        candidate:
          'Operationalized BESS manufacturing facilities with 5 GWh installed capacity',
        claimText:
          'Operationalized BESS manufacturing facilities with 5 GWh installed capacity and delivered over 300 grid-scale BESS containers.',
      }).ok,
    ).toBe(true);
  });
});
