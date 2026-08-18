import { render } from '@testing-library/react';
import { MarkedText } from './MarkedText';

/**
 * writeClaim as a component: exchange text reaches the DOM as React text
 * nodes with document-printed figures wrapped in span.fig. It computes,
 * converts and compares nothing — the currency mark and scale word are
 * pulled in WITH the number, never assembled.
 */
const figs = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('span.fig')].map((n) => n.textContent ?? '');

describe('MarkedText', () => {
  it('marks a figure with its currency mark and scale word', () => {
    const { container } = render(
      <MarkedText text="Declared revenue of ₹ 1,234.5 crore for the quarter" />,
    );
    expect(figs(container)).toEqual(['₹ 1,234.5 crore']);
    expect(container.textContent).toBe(
      'Declared revenue of ₹ 1,234.5 crore for the quarter',
    );
  });

  // The optional whitespace before the digit is INSIDE the capture, so a
  // figure with no currency mark carries its leading space into the span.
  // That is the fragment's exact behaviour with the same regex — the served
  // page marks ' 13.2%' today, and parity means matching it.
  it('marks a percentage and a bps figure, leading space included', () => {
    const { container } = render(<MarkedText text="margin 13.2%, up 40 bps" />);
    expect(figs(container)).toEqual([' 13.2%', ' 40 bps']);
    expect(container.textContent).toBe('margin 13.2%, up 40 bps');
  });

  it('does not mark a bare unit with no digits', () => {
    const { container } = render(<MarkedText text="crore and USD alone" />);
    expect(figs(container)).toEqual([]);
    expect(container.textContent).toBe('crore and USD alone');
  });

  // Colouring "up" green is this page taking a view; direction words are
  // deliberately not matched.
  it('does not mark direction words', () => {
    const { container } = render(<MarkedText text="up from down" />);
    expect(figs(container)).toEqual([]);
  });

  it('handles a claim that is entirely one figure', () => {
    const { container } = render(<MarkedText text="Rs. 20" />);
    expect(figs(container)).toEqual(['Rs. 20']);
  });

  it('renders empty text as nothing', () => {
    const { container } = render(<MarkedText text="" />);
    expect(container.textContent).toBe('');
  });
});
