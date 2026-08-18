import { readFileSync } from 'fs';
import { join } from 'path';
import { shareText, SHARE_BRAND, SHARE_TAIL } from './share-text';
import type { FilingView } from '../../shared/types/api';

/**
 * Ported from script-share.spec.ts, which is the reference: one filing as a
 * message somebody sends. Every claim goes in as stored — a message that
 * reworded one would be publishing something no filing printed.
 */
const filing = (over: Record<string, unknown> = {}): FilingView =>
  ({
    symbol: 'SKIPPER',
    companyName: 'Skipper Limited',
    category: 'Financial Results',
    disseminatedAtIst: '2026-08-09 09:15:00',
    disseminatedAtIstHuman: '9 Aug 2026, 9:15 am',
    enrichment: {
      amountDisplay: null,
      resultsLine: null,
      claims: [
        { text: 'Revenue was 1,204 crore', echo: false },
        { text: 'Profit after tax was 61 crore', echo: true },
      ],
    },
    ...over,
  }) as unknown as FilingView;

describe('shareText — one filing as a message', () => {
  it('opens with the company, the ticker, and the readable IST line', () => {
    const lines = shareText(filing()).split('\n');
    expect(lines[0]).toBe('*Skipper Limited (SKIPPER)*');
    expect(lines[1]).toBe('Financial Results · 9 Aug 2026, 9:15 am IST');
  });

  it('uses the human timestamp, never the fixed-width sibling', () => {
    expect(shareText(filing())).not.toContain('2026-08-09 09:15:00');
  });

  // Echoes included: a repeat is a property of a response, not of this
  // document, and somebody sending one filing sends what the filing said.
  it('bullets every claim verbatim, echoes included', () => {
    const text = shareText(filing());
    expect(text).toContain('- Revenue was 1,204 crore');
    expect(text).toContain('- Profit after tax was 61 crore');
  });

  it('signs with the tail and the brand, exactly', () => {
    const lines = shareText(filing()).split('\n');
    expect(lines[lines.length - 2]).toBe(`_${SHARE_TAIL}_`);
    expect(lines[lines.length - 1]).toBe(SHARE_BRAND);
  });

  // The figure LEADS: a single order value is the event itself. Its own
  // unlabelled paragraph — the category line already says what kind of
  // event this is.
  it('the amount is its own paragraph before the claims', () => {
    const text = shareText(
      filing({
        enrichment: {
          amountDisplay: '₹476 cr',
          resultsLine: null,
          claims: [{ text: 'a claim', echo: false }],
        },
      }),
    );
    expect(text).toContain('\n\n₹476 cr\n\n- a claim');
  });

  // The results line goes LAST: on a card the numbers are the event, in a
  // chat the claims are the sentences and the figures are scrolled back to.
  it('the results line follows the claims', () => {
    const text = shareText(
      filing({
        enrichment: {
          amountDisplay: null,
          resultsLine: 'Revenue 1,204 cr · PAT 61 cr',
          claims: [{ text: 'a claim', echo: false }],
        },
      }),
    );
    expect(text).toContain('- a claim\n\nRevenue 1,204 cr · PAT 61 cr\n\n_');
  });

  it('the whole message, end to end, for a one-claim filing', () => {
    const text = shareText(
      filing({
        enrichment: {
          amountDisplay: null,
          resultsLine: null,
          claims: [{ text: 'Revenue was 1,204 crore', echo: false }],
        },
      }),
    );
    expect(text).toBe(
      [
        '*Skipper Limited (SKIPPER)*',
        'Financial Results · 9 Aug 2026, 9:15 am IST',
        '',
        '- Revenue was 1,204 crore',
        '',
        `_${SHARE_TAIL}_`,
        SHARE_BRAND,
      ].join('\n'),
    );
  });

  // The verbatim gate binds the share surface hardest: no spans, no
  // direction words, no arithmetic, nothing the filing did not print.
  it('sends no spans and computes nothing', () => {
    const source = readFileSync(join(__dirname, 'share-text.ts'), 'utf8');
    expect(source).not.toMatch(/span/);
    expect(source).not.toMatch(/direction/);
    expect(source).not.toMatch(/Math\.|Number\(|parseFloat|toFixed/);
    expect(source).not.toMatch(/new Date\(|toLocale/);
  });
});

describe('the copy that cannot drift', () => {
  const fragment = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'dashboard',
      'src',
      'ui',
      'script',
      'script-share.ts',
    ),
    'utf8',
  );

  it('SHARE_BRAND and SHARE_TAIL mirror the fragment', () => {
    expect(fragment).toContain(`var SHARE_BRAND = '${SHARE_BRAND}';`);
    expect(fragment).toContain(SHARE_TAIL);
  });
});
