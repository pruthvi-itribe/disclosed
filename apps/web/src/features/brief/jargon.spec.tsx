import { fireEvent, render } from '@testing-library/react';
import { GlossedText } from './GlossedText';
import { JARGON, jargonFor } from './jargon';
import { briefLede } from './brief-model';
import type { BriefCandidate } from './brief-model';

/**
 * The plain-words layer, and the rule that keeps it honest: it explains a
 * WORD and never a filing. 40% of claims carry one of these terms
 * (measured over 3,461 claims — jargon.ts).
 */
describe('the jargon layer', () => {
  it('marks a term without touching the sentence', () => {
    const onAsk = vi.fn();
    const { container } = render(
      <GlossedText text="EBITDA up 14% YoY to Rs 327 crore." onAsk={onAsk} />,
    );
    expect(container.textContent).toBe('EBITDA up 14% YoY to Rs 327 crore.');
    const terms = [...container.querySelectorAll('[data-ui="brief-jargon"]')];
    expect(terms.map((t) => t.textContent)).toEqual(['EBITDA', 'YoY']);
  });

  // FIGURE matches any bare number, so "FY26" drew as F-Y and a marked
  // "26" — a figure the document never printed. The term is taken whole.
  it('keeps a financial year out of the figure marker', () => {
    const { container } = render(
      <GlossedText text="Revenue for FY26 was strong." onAsk={vi.fn()} />,
    );
    expect(container.querySelector('.fig')).toBeNull();
    expect(
      container.querySelector('[data-ui="brief-jargon"]')?.textContent,
    ).toBe('FY26');
  });

  it('hands the tapped term up to the card', () => {
    const onAsk = vi.fn();
    const { container } = render(
      <GlossedText text="PAT of Rs 174 crore." onAsk={onAsk} />,
    );
    fireEvent.click(
      container.querySelector('[data-ui="brief-jargon"]') as Element,
    );
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onAsk.mock.calls[0]?.[1]).toBe('PAT');
  });

  // A definition that named a company, a number or an outcome would be a
  // claim about a document arriving without a matched span.
  it('every definition is about the word alone', () => {
    for (const entry of JARGON) {
      expect(entry.plain.length).toBeGreaterThan(10);
      expect(entry.plain).not.toMatch(/\b(?:Ltd|Limited|Inc)\b/);
      expect(entry.plain).not.toMatch(/₹|\bRs\b/);
    }
    expect(jargonFor('EBITDA')?.plain).toContain('before interest');
    expect(jargonFor('nonsense')).toBeNull();
  });
});

/** A card must not lead with a table cell when it has a sentence. */
describe('the lede prefers a sentence', () => {
  const candidate = (texts: readonly string[]): BriefCandidate =>
    ({
      symbol: 'AAA',
      companyName: 'A Ltd',
      newest: '2026-08-18T04:00:00.000Z',
      hasResults: true,
      figures: texts.length,
      claims: texts.map((text) => ({
        claim: { text, echo: false },
        filing: { seqId: 1 },
      })),
    }) as unknown as BriefCandidate;

  it('skips a bare metric fragment for the sentence behind it', () => {
    const lede = briefLede(candidate(['PAT 241.02', 'Revenue rose 23% YoY']));
    expect(lede?.claim.text).toBe('Revenue rose 23% YoY');
  });

  it('keeps a bound figure, which is a sentence', () => {
    const lede = briefLede(
      candidate(['Turnover of Rs. 1057 Cr', 'Something else entirely']),
    );
    expect(lede?.claim.text).toBe('Turnover of Rs. 1057 Cr');
  });

  it('leads with the fragment rather than nothing when that is all there is', () => {
    const lede = briefLede(candidate(['AUM 267,074 Mn', 'EBITDA margin 7.4%']));
    expect(lede?.claim.text).toBe('AUM 267,074 Mn');
  });
});
