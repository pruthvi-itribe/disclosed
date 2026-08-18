import { SHARE_BRAND } from './share-text';
import {
  sharePlan,
  shareHeight,
  shareHeadBottom,
  SHARE_FIGURES,
  SHARE_W,
  SHARE_PAD,
  SHARE_DISC,
  SHARE_TOP,
  SHARE_TILE,
  SHARE_TILE_Y,
  SHARE_TILE_INSET,
  SHARE_TILE_RADIUS,
  SHARE_FOOTER,
  SHARE_BG,
  SHARE_LINE,
  SHARE_INK,
  SHARE_MUTED,
  SHARE_ACCENT,
  SHARE_WHITE,
  SHARE_SANS,
  type ShareBlock,
  type SharePlanned,
} from './share-plan';
import type { ShareMarks } from './share-marks';
import type { FilingView } from '../../shared/types/api';

/** One run in one colour; returns where the next run starts. */
const run = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fill: string,
): number => {
  if (text === '') return x;
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  return x + ctx.measureText(text).width;
};

/**
 * One line, in two colours where the block asks. THE FONT NEVER CHANGES
 * BETWEEN RUNS: the line was wrapped by measuring the whole string in one
 * font, and a bold figure would overhang the column by whatever the
 * emphasis added. Colour costs no width.
 */
const line = (
  ctx: CanvasRenderingContext2D,
  block: ShareBlock,
  text: string,
  x: number,
  y: number,
): void => {
  if (!block.figures) {
    run(ctx, text, x, y, block.fill);
    return;
  }
  let at = 0;
  let cursor = x;
  SHARE_FIGURES.lastIndex = 0;
  let found = SHARE_FIGURES.exec(text);
  while (found !== null) {
    cursor = run(ctx, text.slice(at, found.index), cursor, y, block.fill);
    cursor = run(ctx, found[0], cursor, y, SHARE_WHITE);
    at = found.index + found[0].length;
    found = SHARE_FIGURES.exec(text);
  }
  run(ctx, text.slice(at), cursor, y, block.fill);
};

/** The accent disc beside a claim's FIRST line — a hanging indent is one
 * mark with the sentence lined up under the text, not under the mark.
 * Placed 8px above the baseline by eye at the claim's own size (29px sans
 * has an x-height of about 15). */
const disc = (ctx: CanvasRenderingContext2D, baseline: number): void => {
  ctx.fillStyle = SHARE_ACCENT;
  ctx.beginPath();
  ctx.arc(SHARE_PAD + SHARE_DISC, baseline - 8, SHARE_DISC, 0, Math.PI * 2);
  ctx.fill();
};

const rule = (ctx: CanvasRenderingContext2D, y: number): void => {
  ctx.fillStyle = SHARE_LINE;
  ctx.fillRect(SHARE_PAD, y, SHARE_W - SHARE_PAD * 2, 1);
};

const draw = (
  ctx: CanvasRenderingContext2D,
  blocks: readonly ShareBlock[],
  from: number,
): number => {
  let y = from;
  for (const b of blocks) {
    ctx.font = b.font;
    y += b.gap;
    b.lines.forEach((text, index) => {
      y += b.lineHeight;
      if (b.bullet && index === 0) disc(ctx, y);
      line(ctx, b, text, SHARE_PAD + b.indent, y);
    });
  }
  return y;
};

/**
 * The mark in the corner: the raster artwork clipped through roundRect, or
 * the favicon — and the WORD is canvas text in both branches, because no
 * 64px tile carries a readable name (the raster's own wordmark is ~10px of
 * artwork at this size). roundRect is part of the test, not an
 * afterthought: it clips the artwork's white margin, and a browser without
 * it gets the favicon branch — a complete picture rather than a broken one.
 */
const watermark = (ctx: CanvasRenderingContext2D, marks: ShareMarks): void => {
  const x = SHARE_W - SHARE_PAD - SHARE_TILE;

  ctx.font = `600 28px ${SHARE_SANS}`;
  // Centred on the tile: the baseline sits half a cap height below its
  // middle, and the cap height of 600 28px system sans is about 20.
  const baseline = SHARE_TILE_Y + SHARE_TILE / 2 + 10;
  const word = x - 12 - ctx.measureText(`${SHARE_BRAND}.`).width;
  ctx.fillStyle = SHARE_INK;
  ctx.fillText(SHARE_BRAND, word, baseline);
  // The accent full stop, measured into the same place brand.ts puts it.
  ctx.fillStyle = SHARE_ACCENT;
  ctx.fillText('.', word + ctx.measureText(SHARE_BRAND).width, baseline);

  if (marks.logo !== null && typeof ctx.roundRect === 'function') {
    const inset = SHARE_TILE * SHARE_TILE_INSET;
    const side = SHARE_TILE - inset * 2;
    ctx.save();
    // 'high' names the better kernel: the asset is 256px in a 64px box, and
    // the default bilinear filter at a 4x reduction is what blurred the
    // mark. A browser without it loses only sharpness, not the picture.
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
    ctx.beginPath();
    ctx.roundRect(
      x + inset,
      SHARE_TILE_Y + inset,
      side,
      side,
      side * SHARE_TILE_RADIUS,
    );
    ctx.clip();
    ctx.drawImage(marks.logo, x, SHARE_TILE_Y, SHARE_TILE, SHARE_TILE);
    ctx.restore();
    return;
  }

  if (marks.favicon !== null) {
    ctx.drawImage(marks.favicon, x, SHARE_TILE_Y, SHARE_TILE, SHARE_TILE);
  }
};

/**
 * The plan onto a canvas of the right size, DRAWN AT 2X: shared images land
 * at 2-3 device pixels per CSS pixel, and a 1080px render arrives soft
 * everywhere — softest on the 64px tile, which at 2x is 128 physical pixels
 * from a 256px source, a clean 2:1. textBaseline stays alphabetic, so every
 * y is a baseline and the blocks stack by adding.
 */
export const sharePaint = (
  plan: SharePlanned,
  height: number,
  marks: ShareMarks,
): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = SHARE_W * 2;
  canvas.height = height * 2;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('the canvas gave no context');
  ctx.scale(2, 2);

  ctx.fillStyle = SHARE_BG;
  ctx.fillRect(0, 0, SHARE_W, height);

  draw(ctx, plan.head, SHARE_TOP);
  watermark(ctx, marks);
  rule(ctx, shareHeadBottom(plan.head));

  const y = draw(ctx, plan.body, shareHeadBottom(plan.head));

  rule(ctx, y + 46);
  ctx.font = `400 22px ${SHARE_SANS}`;
  ctx.fillStyle = SHARE_MUTED;
  ctx.fillText(SHARE_FOOTER, SHARE_PAD, y + 86);

  return canvas;
};

/** One filing, drawn: plan on a throwaway context, size, paint. */
export const shareCard = (
  f: FilingView,
  marks: ShareMarks,
): HTMLCanvasElement => {
  const measure = document.createElement('canvas').getContext('2d');
  if (measure === null) throw new Error('the canvas gave no context');
  const plan = sharePlan(measure, f);
  return sharePaint(plan, shareHeight(plan), marks);
};
