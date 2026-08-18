import type { FilingView } from '../../shared/types/api';
import { SHARE_TAIL } from './share-text';

/**
 * The picture's plan — measured blocks, nothing drawn. Ported from
 * script-share-image.ts with every measured constant and its argument; the
 * planner is pure and takes a measuring context, which is what makes it
 * testable where jsdom has no canvas (the reference spec's own stub is
 * `measureText: t => ({width: t.length * 14})`).
 *
 * THE PALETTE IS LITERAL, not CSS variables: an image renders outside the
 * document. share-plan.spec.ts mirrors each hex against tokens.css. White is
 * the figures; ink the sentences; muted the chrome; accent only the ticker
 * and the discs — the two things that are not sentences.
 */
export const SHARE_BG = '#0d1117';
export const SHARE_LINE = '#2a323d';
export const SHARE_INK = '#e6edf3';
export const SHARE_MUTED = '#8b949e';
export const SHARE_ACCENT = '#a78bfa';
export const SHARE_WHITE = '#ffffff';

/** The stylesheet's sans minus "Segoe UI" — a quoted family inside a quoted
 * canvas font shorthand does not parse. */
export const SHARE_SANS =
  'system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif';
export const SHARE_MONO =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export const SHARE_W = 1080;
export const SHARE_PAD = 64;
export const SHARE_HANG = 30;
export const SHARE_DISC = 6;

/**
 * Claims the picture carries before stating the rest: 85.5% of 2,543
 * measured filings hold 8 or fewer, and the cap takes 214px off the tail
 * while changing nothing for the majority. The remainder is STATED — a
 * picture that quietly stopped at eight would look like the whole filing.
 */
export const SHARE_CLAIM_CAP = 8;

export const SHARE_IMAGE_LABEL = 'Copy as image';

/** The same sentence the message signs with — asserted equal by the spec. */
export const SHARE_FOOTER = SHARE_TAIL;

/** Header geometry: the identity starts top-left and the 64px tile sits in
 * the opposite corner adding NO height — replacing a 188px masthead band
 * saved 158px on a one-claim filing, every one of them empty. */
export const SHARE_TOP = 36;
export const SHARE_TILE = 64;
export const SHARE_GUTTER = 32;
/** The tile's top edge on the ticker's cap: first baseline is 36+34 and the
 * cap height of 600 26px system sans is about 19. */
export const SHARE_TILE_Y = 51;
export const SHARE_HEAD_TAIL = 34;
export const SHARE_FOOT = 126;
/** The artwork's antialiased edge blends into its white margin: measured
 * 0.014, inset 0.022 clears it. Radius 0.182 is 222 of 1,218px. */
export const SHARE_TILE_INSET = 0.022;
export const SHARE_TILE_RADIUS = 0.182;

/**
 * What lights up inside a claim, in this order: day-month-year, month-year
 * or month-day-year (the date branches first, or the year in "30 June 2026"
 * would be a lone lit 2026), a fiscal label, then a number with optional
 * rupee prefix and unit. From the corpus, not guesswork: 478 of 573 claims
 * (83.4%) carry at least one figure, 1,101 runs — a highlight, not a
 * highlighted sentence. Every branch requires a digit, so it never matches
 * empty. Written ONCE with single escapes; the spec collapses the
 * fragment's doubling when mirroring.
 */
export const SHARE_FIGURES =
  /\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s\d{4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s(?:\d{1,2},\s)?\d{4}|(?:Q[1-4]\s?)?FY\s?\d{2,4}|(?:(?:₹|Rs\.?|INR)\s?)?\d[\d,]*(?:\.\d+)?(?:\s?(?:%|crore|crores|lakh|lakhs|cr|mn|bn|million|billion|bps))?/gi;

/** The slice of a canvas context the planner needs — jsdom has no canvas,
 * and this seam is what keeps the plan testable. */
export interface MeasureContext {
  font: string;
  measureText: (text: string) => { readonly width: number };
}

export interface ShareBlock {
  readonly font: string;
  readonly fill: string;
  readonly lineHeight: number;
  readonly gap: number;
  readonly indent: number;
  readonly bullet: boolean;
  readonly figures: boolean;
  readonly lines: readonly string[];
}

export interface SharePlanned {
  readonly head: readonly ShareBlock[];
  readonly body: readonly ShareBlock[];
}

/** Splits on whitespace, never splits a word, measures the whole string in
 * one font — which is why the painter may change fill but never font. */
export const shareWrap = (
  ctx: MeasureContext,
  text: string,
  width: number,
): readonly string[] => {
  const words = String(text).split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (word === '') continue;
    const next = line === '' ? word : `${line} ${word}`;
    if (line !== '' && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
};

interface BlockSpec {
  readonly font: string;
  readonly fill: string;
  readonly text: string;
  readonly lineHeight: number;
  readonly gap: number;
  readonly indent?: number;
  readonly width?: number;
  readonly bullet?: boolean;
  readonly figures?: boolean;
}

const block = (ctx: MeasureContext, spec: BlockSpec): ShareBlock => {
  ctx.font = spec.font;
  const indent = spec.indent ?? 0;
  return {
    font: spec.font,
    fill: spec.fill,
    lineHeight: spec.lineHeight,
    gap: spec.gap,
    indent,
    bullet: spec.bullet === true,
    figures: spec.figures === true,
    lines: shareWrap(
      ctx,
      spec.text,
      spec.width ?? SHARE_W - SHARE_PAD * 2 - indent,
    ),
  };
};

/**
 * The identity, wrapped to a column narrower by the tile plus its gutter —
 * taken off ALL THREE lines, because a column whose lines have two measures
 * is not a column, and it costs 96px of a 1,080px canvas.
 */
const headBlocks = (
  ctx: MeasureContext,
  f: FilingView,
): readonly ShareBlock[] => {
  const column = SHARE_W - SHARE_PAD * 2 - SHARE_TILE - SHARE_GUTTER;
  return [
    block(ctx, {
      font: `600 26px ${SHARE_SANS}`,
      fill: SHARE_ACCENT,
      text: f.symbol,
      lineHeight: 34,
      gap: 0,
      width: column,
    }),
    block(ctx, {
      font: `700 44px ${SHARE_SANS}`,
      fill: SHARE_INK,
      text: f.companyName,
      lineHeight: 54,
      gap: 16,
      width: column,
    }),
    // The server's HUMAN spelling plus three letters, no arithmetic — the
    // fixed-width sibling is a machine's string and reads as one on a
    // picture.
    block(ctx, {
      font: `400 24px ${SHARE_SANS}`,
      fill: SHARE_MUTED,
      text: `${f.category} · ${f.disseminatedAtIstHuman} IST`,
      lineHeight: 32,
      gap: 16,
      width: column,
    }),
  ];
};

/**
 * The body, in the message's own order: the amount leads as its own block
 * (measured 2026-08-13: 33 filings had a verified amount and not one claim
 * with a digit — their pictures showed a deadline and no money), the claims
 * capped and bulleted with figures lit, the remainder stated, the results
 * line mono and muted — the labels are chrome and the figures are the
 * filing.
 */
const bodyBlocks = (
  ctx: MeasureContext,
  f: FilingView,
): readonly ShareBlock[] => {
  const e = f.enrichment;
  const claims = e.claims;
  const blocks: ShareBlock[] = [];

  if (e.amountDisplay) {
    blocks.push(
      block(ctx, {
        font: `600 36px ${SHARE_SANS}`,
        fill: SHARE_WHITE,
        text: e.amountDisplay,
        lineHeight: 48,
        gap: 44,
      }),
    );
  }

  const shown = Math.min(claims.length, SHARE_CLAIM_CAP);
  for (let i = 0; i < shown; i++) {
    blocks.push(
      block(ctx, {
        font: `400 29px ${SHARE_SANS}`,
        fill: SHARE_INK,
        text: claims[i]?.text ?? '',
        lineHeight: 42,
        gap: i === 0 ? 44 : 20,
        indent: SHARE_HANG,
        bullet: true,
        figures: true,
      }),
    );
  }
  if (claims.length > shown) {
    blocks.push(
      block(ctx, {
        font: `400 24px ${SHARE_SANS}`,
        fill: SHARE_MUTED,
        text: `+ ${claims.length - shown} more in the app`,
        lineHeight: 32,
        gap: 24,
        indent: SHARE_HANG,
      }),
    );
  }
  if (e.resultsLine) {
    blocks.push(
      block(ctx, {
        font: `400 24px ${SHARE_MONO}`,
        fill: SHARE_MUTED,
        text: e.resultsLine,
        lineHeight: 34,
        gap: 36,
        figures: true,
      }),
    );
  }
  return blocks;
};

/** The claims read the way shareText reads them — straight off the
 * enrichment, echoes included. A picture and a message that disagreed about
 * what the filing said would be worse than either being wrong alone. */
export const sharePlan = (
  ctx: MeasureContext,
  f: FilingView,
): SharePlanned => ({
  head: headBlocks(ctx, f),
  body: bodyBlocks(ctx, f),
});

export const shareStack = (
  blocks: readonly ShareBlock[],
  y: number,
): number => {
  let at = y;
  for (const b of blocks) {
    at += b.gap + b.lines.length * b.lineHeight;
  }
  return at;
};

export const shareHeadBottom = (head: readonly ShareBlock[]): number =>
  shareStack(head, SHARE_TOP) + SHARE_HEAD_TAIL;

export const shareHeight = (plan: SharePlanned): number =>
  shareStack(plan.body, shareHeadBottom(plan.head)) + SHARE_FOOT;
