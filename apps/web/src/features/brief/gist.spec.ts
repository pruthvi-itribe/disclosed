import { briefGist, MAX_GIST_CHARS } from './gist';

/**
 * Every case below is a claim this product actually published, taken from
 * the 2,000 most recent verified filings on 2026-08-19. The rule cut 33%
 * of the over-length ledes in that sample; what it refuses matters more
 * than what it cuts, so most of these are refusals.
 */
describe('briefGist', () => {
  it('leaves a claim that is already a headline alone', () => {
    const short = 'EBITDA up 14% YoY to Rs 327 crore; margin expanded 50 bps.';
    expect(briefGist(short)).toEqual({ line: short, cut: false });
  });

  it('cuts at a boundary the claim printed, keeping the figure', () => {
    const g = briefGist(
      'Company fixed 09-Sep-2026 as record date for final dividend of Rs. 2.00 per equity share (face value Rs. 10.00, @20%) for FY ended 31-Mar-2026.',
    );
    expect(g.cut).toBe(true);
    expect(g.line).toBe(
      'Company fixed 09-Sep-2026 as record date for final dividend of Rs. 2.00 per equity share',
    );
    expect(g.line.length).toBeLessThanOrEqual(MAX_GIST_CHARS);
  });

  it('is always a prefix of the claim, character for character', () => {
    const claim =
      'Declared final dividend of Rs. 5.00 per equity share of face value Rs. 2.00 each (250%) for year ended 31st March 2026.';
    const g = briefGist(claim);
    expect(claim.startsWith(g.line)).toBe(true);
  });

  // "…of Rs 10 each for FY ended March 31" — a date sliced from its year.
  it('refuses a cut that leaves the sentence hanging', () => {
    const claim =
      'Board recommended final dividend of Rs 0.30 per equity share of Rs 10 each for FY ended March 31, 2026.';
    expect(briefGist(claim).cut).toBe(false);
  });

  // The rating survives and the money does not: a real production line.
  it('refuses a cut that throws away the figure', () => {
    const claim =
      "CareEdge Ratings reaffirmed CARE A; Stable rating on SRM Contractors' long term bank facilities of Rs 60.90 crore, enhanced from Rs 20.90 crore.";
    expect(briefGist(claim).cut).toBe(false);
  });

  // Cutting at the comma would say the thing is done.
  it('refuses when a condition follows the cut', () => {
    const claim =
      'Board approved the acquisition of the entire shareholding of the target company for Rs 120 crore, subject to shareholder approval at the next meeting.';
    expect(briefGist(claim).cut).toBe(false);
  });

  it('refuses when the claim prints no boundary to cut at', () => {
    const claim =
      'Onida reached an understanding with the permanent workers union representing the majority of workers at its Wada Palghar factory for a mutual settlement.';
    const g = briefGist(claim);
    expect(g).toEqual({ line: claim, cut: false });
  });
});

/**
 * The card's order of preference. The server's gist is a slice of the
 * document verified by the same matcher that admits a claim; the client's
 * cutter is a prefix of the claim; the claim itself is the floor.
 */
describe('what the card leads with', () => {
  const claim =
    'Company fixed 09-Sep-2026 as record date for final dividend of Rs. 2.00 per equity share (face value Rs. 10.00, @20%) for FY ended 31-Mar-2026.';

  const lead = (stored: string | null) =>
    stored === null || stored === ''
      ? briefGist(claim)
      : { line: stored, cut: stored.length < claim.length };

  it('takes the server’s headline when there is one', () => {
    const stored =
      'fixed 09-Sep-2026 as record date for final dividend of Rs. 2.00 per equity share';
    expect(lead(stored)).toEqual({ line: stored, cut: true });
  });

  it('falls back to its own cut when the gate refused or never ran', () => {
    expect(lead(null).line).toBe(
      'Company fixed 09-Sep-2026 as record date for final dividend of Rs. 2.00 per equity share',
    );
    expect(lead('').cut).toBe(true);
  });
});
