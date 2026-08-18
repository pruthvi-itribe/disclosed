import { createElement } from 'react';
import { ICON_BOX, ICON_SIZE, ICON_STROKE, type IconShape } from './icons';

const shapeAttrs = (shape: IconShape): Record<string, string> => {
  const attrs: Record<string, string> = {};
  for (let i = 1; i < shape.length; i += 2) {
    attrs[shape[i] ?? ''] = shape[i + 1] ?? '';
  }
  return attrs;
};

/**
 * One icon, drawn.
 *
 * aria-hidden BECAUSE THE CONTROL AROUND IT CARRIES THE WORDS. A drawing has
 * no accessible name of its own, and the control's aria-label is the whole of
 * what a screen reader should hear — an unhidden graphic would add a second,
 * empty node beside it. focusable="false" for one browser family that put
 * every SVG in the tab order.
 */
export function IconSvg({
  shapes,
}: {
  readonly shapes: readonly IconShape[];
}): JSX.Element {
  return (
    <svg
      viewBox={`0 0 ${ICON_BOX} ${ICON_BOX}`}
      width={ICON_SIZE}
      height={ICON_SIZE}
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {shapes.map((shape, i) =>
        createElement(shape[0] ?? 'g', { key: i, ...shapeAttrs(shape) }),
      )}
    </svg>
  );
}
