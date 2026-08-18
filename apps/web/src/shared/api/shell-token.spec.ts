import {
  clearShellToken,
  readShellToken,
  withBearer,
  writeShellToken,
} from './shell-token';

describe('the shell token', () => {
  afterEach(() => clearShellToken());

  it('round-trips through storage and clears clean', () => {
    expect(readShellToken()).toBeNull();
    writeShellToken('tok-1');
    expect(readShellToken()).toBe('tok-1');
    clearShellToken();
    expect(readShellToken()).toBeNull();
  });

  it('withBearer attaches the CURRENT token, not a captured one', async () => {
    const asked: Array<{ input: unknown; auth: string | null }> = [];
    const fetcher = ((input: unknown, init?: RequestInit) => {
      asked.push({
        input,
        auth: new Headers(init?.headers).get('Authorization'),
      });
      return Promise.resolve(new Response('{}'));
    }) as typeof fetch;
    const wrapped = withBearer(fetcher, readShellToken);

    await wrapped('/api/me');
    writeShellToken('tok-2');
    await wrapped('/api/me');
    clearShellToken();
    await wrapped('/api/me');

    expect(asked.map((a) => a.auth)).toEqual([null, 'Bearer tok-2', null]);
  });
});
