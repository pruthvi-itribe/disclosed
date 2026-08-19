import {
  GIST_MAX_CHARS,
  GIST_MIN_CHARS,
  verifyGist,
  type GistRefusal,
} from './claim-gist';
import { buildGistRequest, parseGistResponse } from './gist-prompt';

/**
 * The gate that lets a model choose a headline without letting it write
 * one. Every span below is a real filing sentence, or the shape of one.
 */

const refusalOf = (
  verdict: ReturnType<typeof verifyGist>,
): GistRefusal | null => (verdict.ok ? null : verdict.refused);

describe('verifyGist', () => {
  const span =
    'The Board of Directors has declared a final dividend of Rs. 5.00 per equity share of face value Rs. 2.00 each (250%) for the year ended 31st March 2026.';
  const claim =
    'Declared final dividend of Rs. 5.00 per equity share of face value Rs. 2.00 each (250%) for year ended 31st March 2026.';

  it('accepts a contiguous copy and stores the document’s own bytes', () => {
    const verdict = verifyGist({
      candidate: 'declared a final dividend of Rs. 5.00 per equity share',
      span,
      claimText: claim,
    });
    expect(verdict).toEqual({
      ok: true,
      gist: 'declared a final dividend of Rs. 5.00 per equity share',
    });
    expect(span).toContain(verdict.ok ? verdict.gist : '');
  });

  // The one failure the model can produce that reads perfectly.
  it('refuses a paraphrase, however fluent', () => {
    expect(
      refusalOf(
        verifyGist({
          candidate: 'Final dividend of Rs 5 per share declared for FY26',
          span,
          claimText: claim,
        }),
      ),
    ).toBe('not-found');
  });

  it('refuses a copy that drops the figure the span printed', () => {
    const rating =
      "CareEdge Ratings has reaffirmed the CARE A; Stable rating on SRM Contractors' long term bank facilities of Rs 60.90 crore.";
    expect(
      refusalOf(
        verifyGist({
          candidate:
            'CareEdge Ratings has reaffirmed the CARE A; Stable rating',
          span: rating,
          claimText: rating,
        }),
      ),
    ).toBe('figure-lost');
  });

  // Dropping "subject to" states as done something the filing did not.
  it('refuses a copy that drops the condition', () => {
    const conditional =
      'The Board approved the acquisition of the entire shareholding of the target for Rs 120 crore, subject to shareholder approval.';
    expect(
      refusalOf(
        verifyGist({
          candidate:
            'approved the acquisition of the entire shareholding of the target for Rs 120 crore',
          span: conditional,
          claimText: conditional,
        }),
      ),
    ).toBe('condition-dropped');
  });

  it('refuses a copy that ends on a word needing the next one', () => {
    expect(
      refusalOf(
        verifyGist({
          candidate:
            'declared a final dividend of Rs. 5.00 per equity share of face value Rs. 2.00 each (250%) for',
          span,
          claimText: claim,
        }),
      ),
    ).toBe('dangling-end');
  });

  it('refuses a copy that saves the reader nothing', () => {
    const short = 'Revenue for the quarter stood at Rs 320 crore, up 23%.';
    expect(
      refusalOf(
        verifyGist({
          candidate: 'Revenue for the quarter stood at Rs 320 crore',
          span: short,
          claimText: short,
        }),
      ),
    ).toBe('no-gain');
  });

  it('bounds the length at both ends', () => {
    expect(
      refusalOf(verifyGist({ candidate: 'Rs. 5.00', span, claimText: claim })),
    ).toBe('too-short');
    expect(
      refusalOf(
        verifyGist({
          candidate: 'x'.repeat(GIST_MAX_CHARS + 1),
          span,
          claimText: claim,
        }),
      ),
    ).toBe('too-long');
    expect(GIST_MIN_CHARS).toBeLessThan(GIST_MAX_CHARS);
  });
});

describe('the gist request', () => {
  it('carries the claim and its span, keyed by id', () => {
    const body = buildGistRequest([
      { id: 'a1', claim: 'Claim one', span: 'The span for claim one.' },
    ]);
    expect(JSON.parse(body)).toEqual([
      { id: 'a1', claim: 'Claim one', span: 'The span for claim one.' },
    ]);
  });

  // A gist attached to the wrong filing would be a perfect quote from
  // another company's document — the one failure the gate cannot catch.
  it('reads answers by id and drops malformed entries', () => {
    expect(
      parseGistResponse({
        gists: [
          { id: 'b2', gist: 'a copy' },
          { id: '', gist: 'no id' },
          { id: 'c3' },
          'nonsense',
        ],
      }),
    ).toEqual([{ id: 'b2', gist: 'a copy' }]);
    expect(parseGistResponse({})).toEqual([]);
    expect(parseGistResponse(null)).toEqual([]);
  });
});
