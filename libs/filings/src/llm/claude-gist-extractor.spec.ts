import { ClaudeGistExtractor } from './claude-gist-extractor';
import { GIST_SYSTEM_PROMPT } from '../logic/gist-prompt';

/**
 * The adapter's contract, without a network: what it sends, and what it
 * makes of what comes back. Everything about whether an answer may be
 * PUBLISHED is `verifyGist`'s and is deliberately not tested here.
 */
describe('ClaudeGistExtractor', () => {
  const options = { model: 'test-model', effort: 'low' } as never;

  it('sends the cached rules and the batch, and reads the answers', async () => {
    const create = jest.fn().mockResolvedValue({
      content: [
        { type: 'text', text: '{"gists":[{"id":"a","gist":"a copy"}]}' },
      ],
      usage: { input_tokens: 120, output_tokens: 20 },
    });
    const extractor = new ClaudeGistExtractor({ create } as never, options);

    const result = await extractor.proposeGists([
      { id: 'a', claim: 'claim', span: 'the span' },
    ]);

    expect(result).toEqual({
      outcome: 'ok',
      answers: [{ id: 'a', gist: 'a copy' }],
      usage: {
        inputTokens: 120,
        outputTokens: 20,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
      },
    });
    const sent = create.mock.calls[0][0];
    expect(sent.system[0].text).toBe(GIST_SYSTEM_PROMPT);
    expect(sent.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(JSON.parse(sent.messages[0].content)).toEqual([
      { id: 'a', claim: 'claim', span: 'the span' },
    ]);
  });

  // A verdict rather than an exception: thrown, an API error inside the
  // backfill's loop is indistinguishable from a bug in the loop.
  it('returns a reason when the call fails', async () => {
    const create = jest.fn().mockRejectedValue(new Error('upstream is down'));
    const extractor = new ClaudeGistExtractor({ create } as never, options);
    const result = await extractor.proposeGists([
      { id: 'a', claim: 'c', span: 's' },
    ]);
    expect(result.outcome).toBe('failed');
  });

  it('reports a refusal without reading the empty content array', async () => {
    const create = jest
      .fn()
      .mockResolvedValue({ stop_reason: 'refusal', content: [] });
    const extractor = new ClaudeGistExtractor({ create } as never, options);
    const result = await extractor.proposeGists([
      { id: 'a', claim: 'c', span: 's' },
    ]);
    expect(result).toEqual({
      outcome: 'failed',
      reason: 'the model declined to answer for this batch',
    });
  });

  /** No items, no call: an empty batch is not a request. */
  it('asks nothing when there is nothing to ask about', async () => {
    const create = jest.fn();
    const extractor = new ClaudeGistExtractor({ create } as never, options);
    expect(await extractor.proposeGists([])).toEqual({
      outcome: 'ok',
      answers: [],
    });
    expect(create).not.toHaveBeenCalled();
  });
});
