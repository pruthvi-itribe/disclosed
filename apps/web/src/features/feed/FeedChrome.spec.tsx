import { fireEvent, render } from '@testing-library/react';
import { Hero } from './Hero';
import { LiveIndicator } from './LiveIndicator';
import { FeedControls } from './FeedControls';
import { INITIAL_FILTERS } from '../../app/filter-state';
import type { SummaryView } from '../../shared/types/api';

const summary = {
  todayCount: 42,
  todayVerified: 7,
  feedLagMs: 90_000,
  generatedAtIst: '2026-08-18 14:00:11',
} as unknown as SummaryView;

describe('Hero', () => {
  it('draws the three numbers from the server', () => {
    const { container } = render(<Hero summary={summary} />);
    expect(container.querySelector('[data-ui="feed-hero"]')).not.toBeNull();
    expect(container.querySelector('#hero-today')?.textContent).toBe('42');
    // Server-computed: the browser-counted version once showed "8 filings
    // today" beside "22 verified insights".
    const insights = container.querySelector('#hero-insights');
    expect(insights?.textContent).toBe('7');
    expect(insights?.className).toBe('herovalue accent');
    const lag = container.querySelector('#hero-lag');
    expect(lag?.textContent).toBe('1m 30s');
    expect(lag?.className).toBe('herovalue ok');
  });

  it('draws em dashes before the first summary', () => {
    const { container } = render(<Hero summary={null} />);
    expect(container.querySelector('#hero-today')?.textContent).toBe('—');
    expect(container.querySelector('#hero-lag')?.className).toBe('herovalue ');
  });
});

describe('LiveIndicator', () => {
  it('shows live with the server-formatted refresh time', () => {
    const { container } = render(
      <LiveIndicator live="live" generatedAtIst="2026-08-18 14:00:11" />,
    );
    expect(container.querySelector('#live-dot')?.className).toBe('dot live');
    expect(container.querySelector('#live-text')?.textContent).toBe('live');
    // Printed as sent — the browser never formats a timestamp.
    expect(container.querySelector('#generated')?.textContent).toBe(
      'updated 2026-08-18 14:00:11 IST',
    );
  });

  it.each([
    ['connecting', 'dot', 'connecting'],
    ['stale', 'dot stale', 'refresh failed'],
    ['down', 'dot down', 'refresh failed'],
  ] as const)('%s', (live, dotClass, label) => {
    const { container } = render(
      <LiveIndicator live={live} generatedAtIst={null} />,
    );
    expect(container.querySelector('#live-dot')?.className).toBe(dotClass);
    expect(container.querySelector('#live-text')?.textContent).toBe(label);
    expect(container.querySelector('#generated')?.textContent).toBe('');
  });
});

describe('FeedControls', () => {
  const chips = (container: HTMLElement) => [
    ...container.querySelectorAll('#topics .chip'),
  ];

  it('draws the eight topic chips and the Plans chip', () => {
    const { container } = render(
      <FeedControls
        filters={INITIAL_FILTERS}
        onChip={vi.fn()}
        onOnlyInsights={vi.fn()}
      />,
    );
    const all = chips(container);
    expect(all.map((c) => c.textContent)).toEqual([
      'Everything',
      'Financials',
      'Dividends',
      'Order wins',
      'Deals',
      'Capacity',
      'Product',
      'Ratings',
      'Plans',
    ]);
    // Exactly one chip is ever lit; with no topic and no plans that is
    // Everything.
    expect(all.filter((c) => c.className === 'chip active')).toHaveLength(1);
    expect(all[0]?.className).toBe('chip active');
  });

  it('lights the picked topic alone', () => {
    const { container } = render(
      <FeedControls
        filters={{ ...INITIAL_FILTERS, topic: 'dividend' }}
        onChip={vi.fn()}
        onOnlyInsights={vi.fn()}
      />,
    );
    const lit = chips(container).filter((c) => c.className === 'chip active');
    expect(lit).toHaveLength(1);
    expect(lit[0]?.textContent).toBe('Dividends');
  });

  it('lights Plans alone when the plans axis is on', () => {
    const { container } = render(
      <FeedControls
        filters={{ ...INITIAL_FILTERS, plans: true }}
        onChip={vi.fn()}
        onOnlyInsights={vi.fn()}
      />,
    );
    const lit = chips(container).filter((c) => c.className === 'chip active');
    expect(lit).toHaveLength(1);
    expect(lit[0]?.textContent).toBe('Plans');
  });

  // Every click writes BOTH axes — picking either clears the other.
  it('a topic click reports both axes; the Plans click likewise', () => {
    const onChip = vi.fn();
    const { container } = render(
      <FeedControls
        filters={INITIAL_FILTERS}
        onChip={onChip}
        onOnlyInsights={vi.fn()}
      />,
    );
    fireEvent.click(chips(container)[2] as Element);
    expect(onChip).toHaveBeenCalledWith('dividend', false);
    fireEvent.click(chips(container)[8] as Element);
    expect(onChip).toHaveBeenCalledWith('', true);
  });

  it('the insights toggle starts checked and reports changes', () => {
    const onOnlyInsights = vi.fn();
    const { container } = render(
      <FeedControls
        filters={INITIAL_FILTERS}
        onChip={vi.fn()}
        onOnlyInsights={onOnlyInsights}
      />,
    );
    const box = container.querySelector('#only-insights') as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(onOnlyInsights).toHaveBeenCalledWith(false);
  });
});
