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

// A DATE IS NOT A FIGURE: "Agreement dated August 13, 2026" came back with
// "13," and "2026" wearing a rupee amount's emphasis, mid-headline.
describe('dates are not marked', () => {
  const marked = (text: string): string[] => {
    const { container } = render(<MarkedText text={text} />);
    // Trimmed: the regex keeps a leading space on some matches and this
    // suite is about WHICH tokens are marked, not their whitespace.
    return [...container.querySelectorAll('.fig')].map((n) =>
      (n.textContent ?? '').trim(),
    );
  };

  it('leaves a printed date alone', () => {
    expect(
      marked('Share Acquisition Agreement dated August 13, 2026.'),
    ).toEqual([]);
  });

  it('still marks the quantities in the same sentence', () => {
    expect(
      marked('Acquisition of 100% stake approved on 13 August 2026.'),
    ).toEqual(['100%']);
  });

  it('marks a number that carries a unit even when it looks like a year', () => {
    expect(marked('Order of Rs. 2026 crore received.')).toEqual([
      'Rs. 2026 crore',
    ]);
  });
});
