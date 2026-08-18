import { readFileSync } from 'fs';
import { join } from 'path';
import {
  sharePlan,
  shareWrap,
  shareHeight,
  shareHeadBottom,
  SHARE_FIGURES,
  SHARE_CLAIM_CAP,
  SHARE_W,
  SHARE_BG,
  SHARE_LINE,
  SHARE_INK,
  SHARE_MUTED,
  SHARE_ACCENT,
  SHARE_WHITE,
  SHARE_FOOTER,
  type MeasureContext,
} from './share-plan';
import { SHARE_TAIL } from './share-text';
import type { FilingView } from '../../shared/types/api';

/** The reference spec's own stub: fourteen units a character. */
const ctx: MeasureContext = {
  font: '',
  measureText: (t: string) => ({ width: t.length * 14 }),
};

const filing = (over: Record<string, unknown> = {}): FilingView =>
  ({
    symbol: 'SKIPPER',
    companyName: 'Skipper Limited',
    category: 'Financial Results',
    disseminatedAtIstHuman: '9 Aug 2026, 9:15 am',
    enrichment: {
      amountDisplay: null,
      resultsLine: null,
      claims: [{ text: 'Revenue was 1,204 crore', echo: false }],
    },
    ...over,
  }) as unknown as FilingView;

describe('shareWrap', () => {
  it('wraps on spaces and never splits a word', () => {
    const lines = shareWrap(ctx, 'alpha beta gamma delta', 10 * 14);
    expect(lines).toEqual(['alpha beta', 'gamma', 'delta']);
    expect(shareWrap(ctx, 'unbreakablelongword', 5 * 14)).toEqual([
      'unbreakablelongword',
    ]);
  });
});

describe('sharePlan — the same filing as a picture', () => {
  it('heads with ticker, company and the readable IST line', () => {
    const plan = sharePlan(ctx, filing());
    expect(plan.head.map((b) => b.lines.join(' '))).toEqual([
      'SKIPPER',
      'Skipper Limited',
      'Financial Results · 9 Aug 2026, 9:15 am IST',
    ]);
    expect(plan.head[0]?.fill).toBe(SHARE_ACCENT);
  });

  // The amount block first, white, unbulleted; claims capped at 8 with the
  // remainder STATED; results mono and last.
  it('orders the body amount, claims, remainder, results', () => {
    const claims = Array.from({ length: 10 }, (_, i) => ({
      text: `claim ${i + 1}`,
      echo: false,
    }));
    const plan = sharePlan(
      ctx,
      filing({
        enrichment: {
          amountDisplay: '₹476 cr',
          resultsLine: 'Revenue 1,204 cr',
          claims,
        },
      }),
    );
    expect(plan.body[0]?.lines).toEqual(['₹476 cr']);
    expect(plan.body[0]?.fill).toBe(SHARE_WHITE);
    expect(plan.body[0]?.bullet).toBe(false);

    const bullets = plan.body.filter((b) => b.bullet);
    expect(bullets).toHaveLength(SHARE_CLAIM_CAP);

    const remainder = plan.body[1 + SHARE_CLAIM_CAP];
    expect(remainder?.lines.join(' ')).toBe('+ 2 more in the app');

    const results = plan.body[plan.body.length - 1];
    expect(results?.font).toContain('ui-monospace');
    expect(results?.figures).toBe(true);
  });

  it('a filing with one claim and no amount is one block', () => {
    const plan = sharePlan(ctx, filing());
    expect(plan.body).toHaveLength(1);
  });

  // The header adds no height for the tile: three blocks and the rule.
  // Shortest possible bottom: 36 + 34 + (16 + 54) + (16 + 32) + 34 = 222.
  it('measures the header and the whole picture by stacking', () => {
    const plan = sharePlan(ctx, filing());
    expect(shareHeadBottom(plan.head)).toBe(222);
    // body: one claim block (gap 44, one line of 42) = 86; foot 126.
    expect(shareHeight(plan)).toBe(222 + 86 + 126);
  });
});

describe('SHARE_FIGURES', () => {
  it.each([
    ['30 June 2026'],
    ['July 21, 2026'],
    ['Q1 FY27'],
    ['₹1,204.35 crore'],
    ['INR 8,044.51 mn'],
    ['40 bps'],
  ])('lights %s', (text) => {
    SHARE_FIGURES.lastIndex = 0;
    expect(SHARE_FIGURES.exec(`before ${text} after`)?.[0]).toBe(text);
  });

  // Every branch requires a digit, which is what makes the run loop safe.
  it('never matches empty', () => {
    SHARE_FIGURES.lastIndex = 0;
    expect(SHARE_FIGURES.exec('no numbers here at all')).toBeNull();
  });

  it('mirrors the fragment with the doubling collapsed', () => {
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
        'script-share-image.ts',
      ),
      'utf8',
    );
    const inFragment = fragment.match(/var SHARE_FIGURES = \/(.+)\/gi;/);
    expect(SHARE_FIGURES.source).toBe(
      (inFragment?.[1] ?? '').replace(/\\\\/g, '\\'),
    );
  });
});

describe('the palette that cannot drift', () => {
  // An image renders outside the document, so the palette is literal — and
  // mirrored against tokens.css, where Plan 1 moved the :root values.
  it('is the page palette, hex for hex', () => {
    const tokens = readFileSync(
      join(__dirname, '..', '..', 'shared', 'ui', 'tokens.css'),
      'utf8',
    );
    expect(tokens).toContain(`--bg: ${SHARE_BG};`);
    expect(tokens).toContain(`--line: ${SHARE_LINE};`);
    expect(tokens).toContain(`--text: ${SHARE_INK};`);
    expect(tokens).toContain(`--muted: ${SHARE_MUTED};`);
    expect(tokens).toContain(`--accent: ${SHARE_ACCENT};`);
    expect(tokens).toContain(`--brand-ink: ${SHARE_WHITE};`);
  });

  it('the picture and the message sign the same sentence', () => {
    expect(SHARE_FOOTER).toBe(SHARE_TAIL);
  });

  it('the canvas is 1080 wide', () => {
    expect(SHARE_W).toBe(1080);
  });
});
