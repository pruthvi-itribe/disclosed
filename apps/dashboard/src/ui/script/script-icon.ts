/**
 * The drawings the card's controls are made of.
 *
 * WHY DRAWINGS AT ALL. The card footer is one line — a badge, the category, and
 * the things a reader DOES with a filing — and the category is the only part
 * allowed to lose width to an ellipsis. Spelled out, four controls read
 * "Watch · Copy · Copy as image · Source" and take 240px of a 326px footer on a
 * 390px phone, which leaves the category nothing. Drawn, the same four are four
 * 34px squares and the category keeps more room than it had with two of them.
 *
 * WHY SVG AND NOT A FONT OR A FILE. `page.spec.ts` rejects the emoji range
 * U+2600-U+27BF, rejects any `url()` that does not name a fragment of this
 * document, and rejects a second `<link>` — so an icon font and an icon file are
 * both out, and so is a glyph. The star has been a `clip-path` polygon for
 * exactly that reason; this is the same answer, generalised, and it puts the
 * shape in the element rather than in a pseudo-element the DOM cannot reach.
 *
 * EVERY SHAPE IS A RECT, A CIRCLE, A POLYGON OR A STRAIGHT-LINE PATH. No arcs,
 * no beziers, nothing hand-plotted: the longest thing here is a five-point star,
 * and its ten points are the centre, the two radii and the five angles, written
 * out. A path blob is a drawing nobody can edit or check.
 *
 * A FRAGMENT, NOT A MODULE. This is client-side ES5 held as a string and joined
 * into one IIFE by `page-script.ts`; it runs first among the fragments that draw
 * one, which is a filing decision rather than a dependency — the functions are
 * declarations and hoist over the whole IIFE.
 *
 * NO BACKTICK AND NO `${` MAY APPEAR BELOW — `script-fragments.spec.ts` asserts
 * it.
 */
export const SCRIPT_ICON = `
  // ------------------------------------------------------------- icons ----

  // 'createElement' makes an HTML element whatever name it is given, so an
  // 'svg' built that way is an unknown HTML element that renders nothing. The
  // namespace is the whole difference between a drawing and a blank square.
  var ICON_NS = 'http://www.w3.org/2000/svg';

  // ONE STROKE STYLE FOR ALL OF THEM, set on the root and inherited: 24-unit
  // box, no fill, 1.7 units of stroke with round ends. Four drawings in four
  // weights read as four sources; these read as one set.
  var ICON_BOX = 24;
  var ICON_SIZE = 17;
  var ICON_STROKE = '1.7';

  // A SHAPE IS ITS TAG AND THEN ITS ATTRIBUTES IN PAIRS. An object literal
  // would need a for-in with a hasOwnProperty guard for four attributes; this
  // is a loop with a step of two.
  //
  // The star's ten points are a five-point star on centre (12, 12) with an
  // outer radius of 9 and an inner of 3.9, at the five angles from -90 degrees.
  // It is the shape the footer already carried as a clip-path polygon, re-cut
  // to this box.
  var ICON_STAR = [
    ['polygon', 'points', '12 3 14.3 8.8 20.6 9.2 15.7 13.2 17.3 19.3 12 15.9 6.7 19.3 8.3 13.2 3.4 9.2 9.7 8.8']
  ];
  // One sheet over another. The sheet behind is an open five-point line rather
  // than a second rectangle, because two outlined rectangles cross inside the
  // overlap and read as a window, not as a copy.
  var ICON_COPY = [
    ['rect', 'x', '9', 'y', '9', 'width', '11.5', 'height', '11.5', 'rx', '2.5'],
    ['polyline', 'points', '14.5 9 14.5 3.5 3.5 3.5 3.5 14.5 9 14.5']
  ];
  // A picture: the frame, the sun, the hills.
  var ICON_IMAGE = [
    ['rect', 'x', '3', 'y', '4.5', 'width', '18', 'height', '15', 'rx', '2.5'],
    ['circle', 'cx', '8.5', 'cy', '9.5', 'r', '1.6'],
    ['polyline', 'points', '4 17 9 12 13 16 16 13 20 17']
  ];
  // A document with its top-right corner open and an arrow leaving through it:
  // the browser's own idiom for a link that opens elsewhere.
  var ICON_SOURCE = [
    ['path', 'd', 'M13.5 4.5H4.5v15h15v-9'],
    ['path', 'd', 'M11 13L19.5 4.5'],
    ['polyline', 'points', '14.5 4.5 19.5 4.5 19.5 9.5']
  ];
  // What a control that has just done something turns into for a second and a
  // half. The visible half of the report; 'iconSaid' carries the audible half.
  var ICON_DONE = [
    ['polyline', 'points', '5 12.5 10 17 19 6.5']
  ];
  // And what it turns into when it did not. TWO MARKS RATHER THAN ONE,
  // because a check drawn after a clipboard that refused the write is a
  // control reporting success for a failure — the exact thing the three
  // outcomes of the picture button were separated to avoid.
  var ICON_FAIL = [
    ['path', 'd', 'M6.5 6.5L17.5 17.5'],
    ['path', 'd', 'M17.5 6.5L6.5 17.5']
  ];

  // The document a filing came from, named for a reader rather than labelled.
  // It lives here beside its drawing because two surfaces build that link and a
  // second literal is a second wording waiting to happen.
  var SOURCE_LABEL = 'Open the source document';

  /** One shape: its tag, then its attributes in name/value pairs. */
  function iconShape(shape) {
    var node = document.createElementNS(ICON_NS, shape[0]);
    for (var i = 1; i < shape.length; i += 2) {
      node.setAttribute(shape[i], shape[i + 1]);
    }
    return node;
  }

  /**
   * One icon, drawn.
   *
   * 'aria-hidden' BECAUSE THE CONTROL AROUND IT CARRIES THE WORDS. A drawing
   * has no accessible name of its own, and the button's aria-label is the whole
   * of what a screen reader should hear here — an unhidden graphic would add a
   * second, empty node beside it.
   *
   * 'focusable="false"' for the same reason and one browser: IE and old Edge
   * put every SVG in the tab order, which would double the stops in a footer
   * that just gained four controls.
   */
  function iconSvg(shapes) {
    var svg = document.createElementNS(ICON_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + ICON_BOX + ' ' + ICON_BOX);
    svg.setAttribute('width', String(ICON_SIZE));
    svg.setAttribute('height', String(ICON_SIZE));
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', ICON_STROKE);
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    for (var i = 0; i < shapes.length; i++) svg.appendChild(iconShape(shapes[i]));
    return svg;
  }

  /**
   * A control that is a drawing and the words that stand in for it.
   *
   * BOTH LABELS, AND THEY ARE ONE STRING. 'aria-label' is the name a screen
   * reader reads; 'title' is the name a pointer discovers by resting on it.
   * Dropping the visible word is what buys the one-line footer, and carrying
   * both is the price of dropping it — a drawing whose meaning is only in the
   * designer's head is not a control.
   */
  function iconButton(shapes, label, ui) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'iconbtn';
    button.setAttribute('data-ui', ui);
    button.setAttribute('aria-label', label);
    button.title = label;
    button.appendChild(iconSvg(shapes));
    return button;
  }

  /** Swaps the drawing a control is wearing, leaving everything else alone. */
  function iconSet(button, shapes) {
    var old = button.getElementsByTagName('svg')[0];
    if (old) button.replaceChild(iconSvg(shapes), old);
    else button.appendChild(iconSvg(shapes));
  }

  /**
   * What a wordless control says when it has done something.
   *
   * THE PATTERN IS 'shareImageButton'S, GENERALISED. That button has always
   * carried 'aria-live' and reported by swapping its own label, because it has
   * three outcomes and "the image is in your downloads" is not something
   * anybody guesses. A control with no label to swap needs somewhere for the
   * word to go, so it gets a clipped span inside the live region: the check
   * mark is the visible report and this is the audible one, from one call, so
   * the two cannot disagree.
   *
   * THE SPAN IS MADE ON FIRST USE rather than at construction. A live region
   * announces what is added to it, and a control that has never been pressed
   * has nothing to say — the same reason the star builds its own label lazily.
   */
  function iconSaid(button, shapes, word) {
    iconSet(button, shapes);
    var said = button.getElementsByClassName('iconsaid')[0];
    if (!said) {
      said = document.createElement('span');
      said.className = 'iconsaid';
      button.appendChild(said);
    }
    said.textContent = word;
  }
`;
