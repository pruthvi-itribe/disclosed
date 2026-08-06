import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { DoclingHttpError } from '@app/filings';
import {
  buildDoclingConverter,
  doclingHttp,
  HEALTH_TIMEOUT_MS,
  type DoclingConfig,
} from './docling.factory';

/**
 * NO NETWORK ANYWHERE IN THIS FILE. `doclingHttp` takes the client, so the one
 * mapping that decides whether the availability latch opens is reachable with a
 * hand-written stub and no socket.
 */

const config = (over: Partial<DoclingConfig> = {}): DoclingConfig => ({
  doclingUrl: 'http://127.0.0.1:5001',
  doclingTimeoutMs: 300_000,
  doclingCooldownMs: 300_000,
  ...over,
});

/** An axios rejection carrying a response, i.e. the service ANSWERED. */
const axiosErrorWithStatus = (status: number): AxiosError => {
  const headers = new AxiosHeaders();
  const response = {
    status,
    statusText: 'error',
    data: {},
    headers,
    config: { headers },
  } as unknown as AxiosResponse;
  return new AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_RESPONSE',
    undefined,
    undefined,
    response,
  );
};

/** An axios rejection with no response at all, i.e. a dead socket. */
const axiosErrorWithoutResponse = (code: string): AxiosError =>
  new AxiosError(code, code);

interface StubClient {
  post: jest.Mock;
  get: jest.Mock;
}

const stubClient = (): StubClient => ({
  post: jest.fn().mockResolvedValue({ data: { status: 'success' } }),
  get: jest.fn().mockResolvedValue({ data: { status: 'ok' } }),
});

describe('doclingHttp', () => {
  it('hands back the response body rather than the envelope', async () => {
    const client = stubClient();
    const form = new FormData();

    await expect(
      doclingHttp(client).post('/v1/convert/file', form),
    ).resolves.toEqual({ status: 'success' });
    expect(client.post).toHaveBeenCalledWith('/v1/convert/file', form);
  });

  it.each([
    ['a gateway timeout on one oversized document', 504],
    ['a rejected upload', 422],
    ['an internal error', 500],
  ])('carries the status out of axios for %s', async (_label, status) => {
    // THE MAPPING THE LATCH TURNS ON. docling-serve answers 504 past its own
    // max_sync_wait while still finishing the conversion; a live sweep that
    // read that as an outage recovered 1 filing of 21. The status has to
    // survive the transport boundary for the client to tell the difference.
    const client = stubClient();
    client.post.mockRejectedValue(axiosErrorWithStatus(status));

    const thrown = await doclingHttp(client)
      .post('/v1/convert/file', new FormData())
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(DoclingHttpError);
    expect((thrown as DoclingHttpError).status).toBe(status);
  });

  it.each([
    ['a refused connection', 'ECONNREFUSED'],
    ['a name that does not resolve', 'ENOTFOUND'],
    ['a socket that hung up', 'ECONNABORTED'],
  ])('reports a null status for %s', async (_label, code) => {
    // No response means the evidence is about the SERVICE, and null is what
    // opens the cooldown.
    const client = stubClient();
    client.post.mockRejectedValue(axiosErrorWithoutResponse(code));

    const thrown = await doclingHttp(client)
      .post('/v1/convert/file', new FormData())
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(DoclingHttpError);
    expect((thrown as DoclingHttpError).status).toBeNull();
  });

  it('rethrows a non-axios failure untouched', async () => {
    // A programming error inside the transport is not a statement about the
    // service, and dressing it as one would hide it behind a cooldown.
    const boom = new TypeError('form is not iterable');
    const client = stubClient();
    client.post.mockRejectedValue(boom);

    await expect(
      doclingHttp(client).post('/v1/convert/file', new FormData()),
    ).rejects.toBe(boom);
  });

  it('probes health on its own short timeout', async () => {
    // Literal as well as constant: giving the probe the conversion timeout
    // would make a startup check against a dead host hang for five minutes.
    expect(HEALTH_TIMEOUT_MS).toBe(5_000);
    const client = stubClient();

    await doclingHttp(client).health();

    expect(client.get).toHaveBeenCalledWith('/health', { timeout: 5_000 });
  });

  it('rejects health when the service does not answer', async () => {
    const client = stubClient();
    client.get.mockRejectedValue(axiosErrorWithoutResponse('ECONNREFUSED'));

    await expect(doclingHttp(client).health()).rejects.toBeDefined();
  });
});

describe('buildDoclingConverter', () => {
  it.each([
    ['unset', ''],
    ['blank', '   '],
  ])('returns null when DOCLING_URL is %s', (_label, doclingUrl) => {
    // THE SHIPPED DEFAULT AND A FULLY SUPPORTED DEPLOYMENT. The pipeline must
    // keep working on a machine with no Python on it, so this is a default
    // rather than a fallback path.
    expect(buildDoclingConverter(config({ doclingUrl }))).toBeNull();
  });

  it.each([
    ['a bare host with no scheme', '127.0.0.1:5001'],
    ['a sentence', 'please use docling'],
    ['a lone slash', '/'],
  ])('returns null for %s rather than throwing', (_label, doclingUrl) => {
    // A typo in an OPTIONAL dependency's address must not stop a process whose
    // primary job has nothing to do with it. axios would accept the garbage and
    // fail per request, spending the timeout on every filing.
    expect(() => buildDoclingConverter(config({ doclingUrl }))).not.toThrow();
    expect(buildDoclingConverter(config({ doclingUrl }))).toBeNull();
  });

  it.each([
    ['a loopback http url', 'http://127.0.0.1:5001'],
    ['a trailing slash', 'http://127.0.0.1:5001/'],
    ['surrounding whitespace', '  http://127.0.0.1:5001  '],
    ['an https host', 'https://docling.internal'],
  ])('builds a converter for %s', (_label, doclingUrl) => {
    const converter = buildDoclingConverter(config({ doclingUrl }));
    expect(converter).not.toBeNull();
    // Believed available before anything has failed, so the first filing tries.
    expect(converter?.isAvailable()).toBe(true);
  });

  it('makes no request while merely being constructed', async () => {
    // Building the converter must not probe. The enrichment lane constructs it
    // at startup, and a build that reached out would make an unset service into
    // a slow boot rather than a silent absence.
    const converter = buildDoclingConverter(config());
    expect(converter).not.toBeNull();
    await Promise.resolve();
    expect(converter?.isAvailable()).toBe(true);
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
  ])('falls back to the default cooldown when it is %s', (_label, ms) => {
    // A zero cooldown would re-probe a dead service on every filing, which is
    // the cost the latch exists to avoid.
    const converter = buildDoclingConverter(config({ doclingCooldownMs: ms }));
    expect(converter).not.toBeNull();
  });
});
