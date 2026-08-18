import { fireEvent, render } from '@testing-library/react';
import { FocusDialog } from './FocusDialog';
import { focusLines } from './focus-lines';
import type { EnrichmentView, FilingView } from '../../shared/types/api';

const filing = (over: Record<string, unknown> = {}): FilingView =>
  ({
    seqId: 42,
    symbol: 'HGS',
    companyName: 'Hinduja Global',
    category: 'Updates',
    confidenceTier: 'verified',
    confidenceTierLabel: 'Verified',
    disseminatedAt: '2026-08-18T04:00:00.000Z',
    disseminatedAtIst: '2026-08-18 09:30:00',
    outcome: 'An update was filed.',
    attachmentUrl: 'https://example.invalid/doc.pdf',
    enrichment: {
      resultsLine: 'Q1 FY27: revenue ₹100 cr',
      claims: [
        {
          text: 'fresh claim',
          echo: false,
          direction: 'expansion',
          directionEvidence: 'up 20%',
          span: 'revenue  grew   20% over the quarter',
          periodSpan: 'quarter ended 30 June 2026',
        },
        {
          text: 'repeated claim',
          echo: true,
          direction: null,
          directionEvidence: null,
          span: '',
          periodSpan: null,
        },
      ],
    },
    ...over,
  }) as unknown as FilingView;

describe('focusLines', () => {
  // One filing opened on purpose cannot quietly omit a sentence — echoes
  // included, uncapped, unlike the feed's headline lines.
  it('returns every claim including echoes', () => {
    const lines = focusLines(filing().enrichment as unknown as EnrichmentView);
    expect(lines.map((l) => l.text)).toEqual(['fresh claim', 'repeated claim']);
    expect(lines[0]?.span).toBe('revenue  grew   20% over the quarter');
    expect(lines[1]?.periodSpan).toBe('');
  });
});

describe('FocusDialog', () => {
  it('is a modal dialog named by the symbol', () => {
    const { container } = render(
      <FocusDialog filing={filing()} onClose={vi.fn()} />,
    );
    const dialog = container.querySelector('[data-ui="focus-card"]');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-labelledby')).toBe('focus-symbol');
    expect(container.querySelector('#focus-symbol')?.textContent).toBe('HGS');
    expect(container.querySelector('#focus-name')?.textContent).toBe(
      'Hinduja Global',
    );
    expect(container.querySelector('#focus-when')?.getAttribute('title')).toBe(
      '2026-08-18 09:30:00 IST',
    );
  });

  it('leads with the results line and lists every claim', () => {
    const { container } = render(
      <FocusDialog filing={filing()} onClose={vi.fn()} />,
    );
    expect(
      container.querySelector('[data-ui="focus-results"]')?.textContent,
    ).toBe('Q1 FY27: revenue ₹100 cr');
    expect(
      container.querySelectorAll('[data-ui="focus-claims"] > li'),
    ).toHaveLength(2);
  });

  it('states the outcome when the filing said nothing verifiable', () => {
    const quiet = filing({
      enrichment: { resultsLine: null, claims: [] },
    });
    const { container } = render(
      <FocusDialog filing={quiet} onClose={vi.fn()} />,
    );
    expect(
      container.querySelector('[data-ui="focus-stated"]')?.textContent,
    ).toBe('An update was filed.');
    expect(container.querySelector('[data-ui="focus-claims"]')).toBeNull();
  });

  // Two quotes from two places, never merged — merging would forge a
  // sentence the document did not print. Both behind ONE control, closed by
  // default: a filing with eight claims otherwise opens as sixteen blocks.
  it('hides the source quotes behind one toggle, closed by default', () => {
    const { container } = render(
      <FocusDialog filing={filing()} onClose={vi.fn()} />,
    );
    const box = container.querySelector(
      '[data-ui="focus-spans"]',
    ) as HTMLElement;
    expect(box.hidden).toBe(true);
    const toggle = container.querySelector(
      '[data-ui="focus-span-toggle"]',
    ) as HTMLElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toBe('Show source line');
    // The toggle precedes the box, so a keyboard reader reaches the control
    // before the text it reveals.
    expect(
      toggle.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(toggle);
    expect(box.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('Hide');
    // Whitespace collapsed, quotation marks as TEXT, the two spans separate.
    const spans = [...box.querySelectorAll('[data-ui="focus-span"]')];
    expect(spans[0]?.textContent).toContain(
      '"revenue grew 20% over the quarter"',
    );
    expect(spans[1]?.textContent).toContain('"quarter ended 30 June 2026"');
  });

  it('says so when no source sentence is stored', () => {
    const { container } = render(
      <FocusDialog filing={filing()} onClose={vi.fn()} />,
    );
    const items = container.querySelectorAll('[data-ui="focus-claims"] > li');
    expect(items[1]?.querySelector('.focusnospan')?.textContent).toBe(
      'No source sentence is stored for this line.',
    );
    expect(items[1]?.querySelector('[data-ui="focus-span-toggle"]')).toBeNull();
  });

  it('foots with tier, category and the source link', () => {
    const { container } = render(
      <FocusDialog filing={filing()} onClose={vi.fn()} />,
    );
    const foot = container.querySelector('#focus-foot');
    expect(foot?.querySelector('[data-ui="focus-tier"]')?.textContent).toBe(
      'Verified',
    );
    expect(foot?.querySelector('[data-ui="focus-category"]')?.textContent).toBe(
      'Updates',
    );
    expect(
      foot?.querySelector('[data-ui="focus-source"]')?.getAttribute('href'),
    ).toBe('https://example.invalid/doc.pdf');
  });

  it('takes focus on open and returns it on close', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    const { unmount, container } = render(
      <FocusDialog filing={filing()} onClose={vi.fn()} />,
    );
    expect(document.activeElement).toBe(
      container.querySelector('#focus-close'),
    );
    unmount();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('closes on Escape, on the close button, and on the backdrop only', () => {
    const onClose = vi.fn();
    const { container } = render(
      <FocusDialog filing={filing()} onClose={onClose} />,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(container.querySelector('#focus-close') as Element);
    expect(onClose).toHaveBeenCalledTimes(2);

    // A click that started inside the panel must not close it — that is what
    // selecting a span to copy looks like.
    fireEvent.click(container.querySelector('#focus') as Element);
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(container.querySelector('#focus-back') as Element);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  // aria-modal is a claim the page must honour: Tab wraps inside the dialog.
  it('traps Tab at both ends', () => {
    const { container } = render(
      <FocusDialog filing={filing()} onClose={vi.fn()} />,
    );
    const focusables = container.querySelectorAll(
      'button, a[href], input, [tabindex]:not([tabindex="-1"])',
    );
    const last = focusables[focusables.length - 1] as HTMLElement;
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(focusables[0]);

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
