import { IconSvg } from './IconSvg';
import type { IconShape } from './icons';
import './direction-mark.css';

/**
 * The movement mark, DRAWN rather than typed (direction 2026-08-19: "for
 * arrows and mixed, can we have better icons").
 *
 * WHY NOT THE TRIANGLES. ▲ and ▼ are the glyphs every broker's screen uses
 * for gain and loss, so the one mark this product refuses to colour was
 * still wearing the market's costume — and this page issues no verdict: 13
 * of the 45 marked decreases are falling bad loans, debt, borrowing costs or
 * emissions. A trend line says the FIGURE moved, which is the whole of the
 * claim. ◆ was worse than wrong, it was arbitrary: a diamond says nothing
 * about a filing that printed a rise and a fall, and a reader asked what the
 * mixed mark meant. Two opposed heads on one shaft say it without a legend.
 *
 * The two directions differ in SILHOUETTE, not only in orientation — a
 * mirrored pair at 11px is two identical blobs at a glance, which is how ▲
 * and ▼ read on a phone.
 *
 * Same set as every other icon: 24-unit box, no fill, 1.7 stroke, round
 * ends, currentColor — so the mark inherits the line's colour and CANNOT be
 * painted red or green by a later stylesheet, which is the invariant that
 * matters most here. Nothing keys off data-direction, deliberately.
 */

/** The figure the document printed rose: a trend line, arrowhead up-right. */
const MARK_RISE: readonly IconShape[] = [
  ['polyline', 'points', '2 17 8.5 10.5 13.5 15.5 22 7'],
  ['polyline', 'points', '16 7 22 7 22 13'],
];

/** It fell: the same line, reflected, arrowhead down-right. */
const MARK_FALL: readonly IconShape[] = [
  ['polyline', 'points', '2 7 8.5 13.5 13.5 8.5 22 17'],
  ['polyline', 'points', '16 17 22 17 22 11'],
];

/** Both were printed: one shaft, a head at each end. */
const MARK_BOTH: readonly IconShape[] = [
  ['line', 'x1', '12', 'y1', '3.5', 'x2', '12', 'y2', '20.5'],
  ['polyline', 'points', '7.5 8 12 3.5 16.5 8'],
  ['polyline', 'points', '7.5 16 12 20.5 16.5 16'],
];

/**
 * NO ENTRY FOR 'unrated', the same deliberate absence the glyph table
 * carried: three-quarters of claims are unrated, a badge on three-quarters
 * of a feed is noise, and a missing key draws nothing — which is already
 * the statement "the filing printed no direction beside a figure".
 */
export const DIRECTION_MARK: ReadonlyMap<string, readonly IconShape[]> =
  new Map([
    ['expansion', MARK_RISE],
    ['contraction', MARK_FALL],
    ['mixed', MARK_BOTH],
  ]);

/** 15 against 13.5px text: a drawing needs the height a glyph borrows. */
const MARK_SIZE = 15;

/** The drawing alone. The span around it carries the words and the span. */
export function DirectionMark({
  direction,
  size = MARK_SIZE,
}: {
  readonly direction: string;
  readonly size?: number;
}): JSX.Element | null {
  const shapes = DIRECTION_MARK.get(direction);
  if (shapes === undefined) return null;
  return <IconSvg shapes={shapes} size={size} />;
}
