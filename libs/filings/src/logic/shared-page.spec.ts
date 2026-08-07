import {
  companyIdentitiesIn,
  isSharedPage,
  SHARED_PAGE_MIN_IDENTITIES,
} from './shared-page';

/** A well-formed CIN, differing only in the registration number at the end. */
const cin = (n: number): string =>
  `L24239MH1956PLC${String(n).padStart(6, '0')}`;

const pageNaming = (count: number): string =>
  Array.from(
    { length: count },
    (_, at) =>
      `NOTICE\nSome Company ${at} Limited\nCIN: ${cin(at)}\nRegistered office: Mumbai.\n`,
  ).join('\n');

describe('companyIdentitiesIn', () => {
  it('finds a CIN however the filing cases it', () => {
    const document = `CIN: ${cin(1)} and cin: ${cin(1).toLowerCase()}`;
    // ONE COMPANY, NOT TWO. A filing that writes its own CIN both ways would
    // otherwise carry itself over the bound and refuse its own claims.
    expect(companyIdentitiesIn(document).size).toBe(1);
  });

  it('counts distinct companies, not occurrences', () => {
    // A CIN in a page header repeats on every page of a long filing.
    const repeated = `${cin(7)} `.repeat(40);
    expect(companyIdentitiesIn(repeated).size).toBe(1);
  });

  it('reads nothing out of a document that prints none', () => {
    expect(
      companyIdentitiesIn('Revenue rose 20% to Rs 1,200 crore.').size,
    ).toBe(0);
  });

  it('does not read a CIN out of a longer alphanumeric run', () => {
    // The pattern is bounded at both ends. An order number or a hash that
    // happens to contain a CIN-shaped substring is not a company.
    expect(companyIdentitiesIn(`XX${cin(3)}XX`).size).toBe(0);
  });
});

describe('isSharedPage', () => {
  it('leaves an ordinary filing alone', () => {
    expect(isSharedPage(pageNaming(1))).toBe(false);
  });

  it('leaves a filing that names a subsidiary or a counterparty alone', () => {
    // MEASURED, NOT ASSUMED. Two is not the bound because a company's own
    // filing legitimately names a second: a subsidiary in a presentation, the
    // other party to an amalgamation. Over the live collection a two-CIN rule
    // would have refused 111 sound claims.
    expect(isSharedPage(pageNaming(2))).toBe(false);
    expect(isSharedPage(pageNaming(3))).toBe(false);
  });

  it('refuses a page addressed to four companies or more', () => {
    // SANOFI's newspaper page names four, and produced the stored claim
    // "Shareholders approved MOA alteration to include telecom and
    // communication cables business" — about a cable company, on a
    // pharmaceutical company's filing, verified against a real span.
    expect(isSharedPage(pageNaming(4))).toBe(true);
    expect(isSharedPage(pageNaming(9))).toBe(true);
  });

  it('puts the bound where the measurement put it', () => {
    // Literal as well as constant. Over 1,257 live documents, four or more
    // distinct CINs appear on 71 newspaper pages and on 3 filings from every
    // other category combined; at three the second number is 9 and at two it is
    // 57. A later edit that moves this without re-measuring should fail here.
    expect(SHARED_PAGE_MIN_IDENTITIES).toBe(4);
  });

  it('does not care what the filing is called', () => {
    // Three of the live shared pages are filed under something other than
    // `Copy of Newspaper Publication`, so a category test would miss them —
    // the same failure `claim-eligibility.ts` records at length.
    expect(isSharedPage(pageNaming(5))).toBe(true);
  });
});
