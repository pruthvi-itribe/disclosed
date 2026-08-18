import { insightLines } from './insight-lines';
import type { EnrichmentView } from '../../shared/types/api';

const enrichment = (over: Partial<EnrichmentView>): EnrichmentView =>
  ({ resultsLine: null, claims: [], ...over }) as EnrichmentView;

const claim = (over: Record<string, unknown>) =>
  ({
    text: 'a claim',
    echo: false,
    direction: null,
    directionEvidence: null,
    ...over,
  }) as never;

describe('insightLines', () => {
  // A results line has no direction of its own and never will — it is a row
  // of figures, not a sentence about movement.
  it('puts the results line first, directionless', () => {
    const lines = insightLines(
      enrichment({
        resultsLine: 'Q1 FY27: revenue ₹100 cr',
        claims: [claim({ text: 'second' })],
      }),
    );
    expect(lines[0]).toEqual({
      text: 'Q1 FY27: revenue ₹100 cr',
      direction: '',
      evidence: '',
    });
    expect(lines[1]?.text).toBe('second');
  });

  // Echoes are skipped AS HEADLINES ONLY — they stay in the payload and in
  // the focus view, because a repeat is still real evidence for its filing.
  it('skips echo claims', () => {
    const lines = insightLines(
      enrichment({
        claims: [
          claim({ text: 'fresh' }),
          claim({ text: 'repeat', echo: true }),
        ],
      }),
    );
    expect(lines.map((l) => l.text)).toEqual(['fresh']);
  });

  it('carries direction and evidence, defaulting to empty', () => {
    const lines = insightLines(
      enrichment({
        claims: [
          claim({
            text: 'NPA down',
            direction: 'contraction',
            directionEvidence: 'declined to 5.4%',
          }),
          claim({ text: 'plain' }),
        ],
      }),
    );
    expect(lines[0]).toEqual({
      text: 'NPA down',
      direction: 'contraction',
      evidence: 'declined to 5.4%',
    });
    expect(lines[1]).toEqual({ text: 'plain', direction: '', evidence: '' });
  });

  it('returns nothing for a filing that said nothing', () => {
    expect(insightLines(enrichment({}))).toEqual([]);
  });
});
