import { alertLine } from './alert-line';
import type { ClaimView, FilingView } from '../../shared/types/api';

const filing = (claims: readonly Partial<ClaimView>[]): FilingView =>
  ({
    outcome: 'Something was filed.',
    enrichment: { claims },
  }) as unknown as FilingView;

/**
 * A notification carries one claim in its shortest VERIFIED form. The old
 * body cut at 139 characters, which on a claim whose p90 is 162 lands
 * mid-word — and once in a while just before "subject to approval".
 */
describe('alertLine', () => {
  const long =
    'Board approved the acquisition of the entire shareholding of the target company for Rs 120 crore, subject to shareholder approval at the next general meeting.';

  it('takes the stored gist when the gate admitted one', () => {
    const claim = {
      text: long,
      gist: 'Board approved the acquisition of the entire shareholding',
    } as ClaimView;
    expect(alertLine(filing([claim]), claim)).toBe(
      'Board approved the acquisition of the entire shareholding',
    );
  });

  // The client's own cut refuses this one — a condition follows every
  // boundary — so the claim goes whole and the platform elides it.
  it('never truncates when nothing can shorten it safely', () => {
    const claim = { text: long, gist: null } as unknown as ClaimView;
    const line = alertLine(filing([claim]), claim);
    expect(line).toBe(long);
    expect(line).not.toContain('…');
    expect(line).toContain('subject to shareholder approval');
  });

  it('falls back to the client cut when there is no stored gist', () => {
    const claim = {
      text: 'Company fixed 09-Sep-2026 as record date for final dividend of Rs. 2.00 per equity share (face value Rs. 10.00) for FY26.',
      gist: null,
    } as unknown as ClaimView;
    expect(alertLine(filing([claim]), claim)).toBe(
      'Company fixed 09-Sep-2026 as record date for final dividend of Rs. 2.00 per equity share',
    );
  });

  it('leads with the matched claim, not merely the first', () => {
    const first = { text: 'A first claim about something else.' } as ClaimView;
    const matched = {
      text: 'The topic the reader subscribed to.',
    } as ClaimView;
    expect(alertLine(filing([first, matched]), matched)).toBe(
      'The topic the reader subscribed to.',
    );
  });

  // The rare verified filing carrying no claim line at all.
  it('falls back to the outcome sentence when there is no claim', () => {
    expect(alertLine(filing([]), null)).toBe('Something was filed.');
  });
});
