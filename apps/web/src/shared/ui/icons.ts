/**
 * The drawings every control is made of, ported verbatim from
 * `script-icon.ts` — `icons.spec.tsx` compares every attribute value against
 * that fragment, so a redrawn icon there fails here.
 *
 * Why drawings at all, measured on a 390px phone: spelled out, the four foot
 * controls read "Watch · Copy · Copy as image · Source" and take 240px of a
 * 326px footer, leaving the category nothing; drawn, they are four 34px
 * squares. One stroke style for all of them, set on the root and inherited:
 * 24-unit box, no fill, 1.7 units of stroke with round ends — four drawings
 * in four weights read as four sources, these read as one set.
 */

/** One shape: its tag, then its attributes in name/value pairs. */
export type IconShape = readonly string[];

export const ICON_BOX = 24;
export const ICON_SIZE = 17;
export const ICON_STROKE = '1.7';

// A five-point star on centre (12, 12), outer radius 9, inner 3.9, from -90°.
export const ICON_STAR: readonly IconShape[] = [
  [
    'polygon',
    'points',
    '12 3 14.3 8.8 20.6 9.2 15.7 13.2 17.3 19.3 12 15.9 6.7 19.3 8.3 13.2 3.4 9.2 9.7 8.8',
  ],
];

// One sheet over another. The sheet behind is an open five-point line rather
// than a second rectangle, because two outlined rectangles cross inside the
// overlap and read as a window, not as a copy.
export const ICON_COPY: readonly IconShape[] = [
  ['rect', 'x', '9', 'y', '9', 'width', '11.5', 'height', '11.5', 'rx', '2.5'],
  ['polyline', 'points', '14.5 9 14.5 3.5 3.5 3.5 3.5 14.5 9 14.5'],
];

// A picture: the frame, the sun, the hills.
export const ICON_IMAGE: readonly IconShape[] = [
  ['rect', 'x', '3', 'y', '4.5', 'width', '18', 'height', '15', 'rx', '2.5'],
  ['circle', 'cx', '8.5', 'cy', '9.5', 'r', '1.6'],
  ['polyline', 'points', '4 17 9 12 13 16 16 13 20 17'],
];

// A document with its top-right corner open and an arrow leaving through it:
// the browser's own idiom for a link that opens elsewhere.
export const ICON_SOURCE: readonly IconShape[] = [
  ['path', 'd', 'M13.5 4.5H4.5v15h15v-9'],
  ['path', 'd', 'M11 13L19.5 4.5'],
  ['polyline', 'points', '14.5 4.5 19.5 4.5 19.5 9.5'],
];

// What a control that has just done something turns into for a second and a
// half. The visible half of the report.
export const ICON_DONE: readonly IconShape[] = [
  ['polyline', 'points', '5 12.5 10 17 19 6.5'],
];

// And what it turns into when it did not. TWO MARKS RATHER THAN ONE, because
// a check drawn after a clipboard that refused the write is a control
// reporting success for a failure.
export const ICON_FAIL: readonly IconShape[] = [
  ['path', 'd', 'M6.5 6.5L17.5 17.5'],
  ['path', 'd', 'M17.5 6.5L6.5 17.5'],
];

// The document a filing came from, named for a reader rather than labelled.
// It lives beside its drawing because two surfaces build that link and a
// second literal is a second wording waiting to happen.
export const SOURCE_LABEL = 'Open the source document';
