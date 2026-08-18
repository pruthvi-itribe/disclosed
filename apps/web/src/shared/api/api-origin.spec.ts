import { createOriginFetcher } from './api-origin';

describe('createOriginFetcher', () => {
  const record = () => {
    const asked: unknown[] = [];
    const fetcher = ((input: unknown, init?: unknown) => {
      asked.push(input);
      void init;
      return Promise.resolve(new Response('{}'));
    }) as typeof fetch;
    return { asked, fetcher };
  };

  it('leaves the browser build alone: an empty origin changes nothing', async () => {
    const { asked, fetcher } = record();
    await createOriginFetcher('', fetcher)('/api/summary');
    expect(asked).toEqual(['/api/summary']);
  });

  it('prefixes a root-relative path with the injected origin', async () => {
    const { asked, fetcher } = record();
    await createOriginFetcher(
      'https://example.invalid',
      fetcher,
    )('/api/summary');
    expect(asked).toEqual(['https://example.invalid/api/summary']);
  });

  // An absolute URL reaching this seam would be a bug worth seeing, not one
  // worth silently rewriting into a doubled origin.
  it('passes anything that is not root-relative through untouched', async () => {
    const { asked, fetcher } = record();
    await createOriginFetcher(
      'https://example.invalid',
      fetcher,
    )('https://elsewhere.invalid/x');
    expect(asked).toEqual(['https://elsewhere.invalid/x']);
  });
});
