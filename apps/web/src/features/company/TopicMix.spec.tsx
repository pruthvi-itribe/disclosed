import { render } from '@testing-library/react';
import { TopicMix } from './TopicMix';
import type { FilingView } from '../../shared/types/api';

/** One filing carrying one claim per named topic. */
const filingWith = (topics: readonly string[]): FilingView =>
  ({
    enrichment: {
      claims: topics.map((topic) => ({
        text: 'a claim',
        span: 'span text',
        topic,
        direction: null,
        directionEvidence: null,
        echo: false,
        commitments: [],
        planEvidence: null,
      })),
    },
  }) as unknown as FilingView;

describe('TopicMix', () => {
  // A stripe nobody can name is decoration pretending to be data. The
  // legend stopped at three and the rest relied on hover titles, which a
  // phone does not have: a reader asked what the purple stood for
  // (2026-08-19). One legend entry per segment, in the bar's own order.
  it('names every colour the bar draws', () => {
    const { container } = render(
      <TopicMix
        items={[
          filingWith([
            'financial',
            'dividend',
            'dividend',
            'orders',
            'acquisition',
            'capacity',
          ]),
        ]}
      />,
    );
    const segments = container.querySelectorAll('#co-topics .mixseg');
    const entries = container.querySelectorAll('#co-topics-legend .mixitem');
    expect(segments.length).toBe(5);
    expect(entries.length).toBe(segments.length);
    // Counted and ordered by weight, the swatch carrying the segment's hue.
    expect(entries[0]?.textContent).toBe('Dividends 2');
    expect(entries[0]?.querySelector('.mixdot')?.className).toContain(
      't-dividend',
    );
    expect(container.textContent).toContain('Capacity 1');
  });

  // The floor is the whole reason the section can be absent: four claims.
  it('draws nothing below the claim floor', () => {
    const { container } = render(
      <TopicMix items={[filingWith(['financial', 'orders'])]} />,
    );
    expect(
      (container.querySelector('[data-ui="company-topic-mix"]') as HTMLElement)
        .hidden,
    ).toBe(true);
    expect(
      container.querySelectorAll('#co-topics-legend .mixitem').length,
    ).toBe(0);
  });
});
