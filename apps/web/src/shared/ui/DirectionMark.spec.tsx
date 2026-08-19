import { render } from '@testing-library/react';
import { DIRECTION_MARK, DirectionMark } from './DirectionMark';

describe('DirectionMark', () => {
  // Three states, three SILHOUETTES. A mirrored pair is two identical blobs
  // at 11px, which is how the triangles read on a phone; rise and fall are
  // reflections of one line, and 'mixed' is a different shape entirely.
  it('draws a distinct shape for each direction', () => {
    const drawn = new Set<string>();
    for (const direction of DIRECTION_MARK.keys()) {
      const { container } = render(<DirectionMark direction={direction} />);
      const svg = container.querySelector('svg') as SVGElement;
      const shape = [...svg.children]
        .map((node) => node.outerHTML)
        .join('|')
        .replace(/\s+/g, ' ');
      expect(shape).not.toBe('');
      drawn.add(shape);
    }
    expect(drawn.size).toBe(3);
  });

  // NO COLOUR, ever: the drawing takes the line's own colour, so a later
  // stylesheet cannot paint a fall red without painting the sentence red.
  it('is stroked in currentColor and never filled', () => {
    const { container } = render(<DirectionMark direction="contraction" />);
    const svg = container.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('fill')).toBe('none');
  });

  // Three-quarters of claims are unrated: a missing key draws NOTHING, which
  // is already the statement "the filing printed no direction beside a
  // figure" — never a placeholder that would claim one was looked for.
  it('draws nothing for a direction it has no mark for', () => {
    const { container } = render(<DirectionMark direction="unrated" />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
