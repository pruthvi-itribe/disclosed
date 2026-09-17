import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import {
  DoclingHttpError,
  HttpDoclingConverter,
  RoutedDoclingConverter,
} from '@app/filings';
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
  doclingLayoutUrl: '',
  doclingOcrUrl: '',
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
    expect(converter?.isAvailable('layout')).toBe(true);
  });

  it('makes no request while merely being constructed', async () => {
    // Building the converter must not probe. The enrichment lane constructs it
    // at startup, and a build that reached out would make an unset service into
    // a slow boot rather than a silent absence.
    const converter = buildDoclingConverter(config());
    expect(converter).not.toBeNull();
    await Promise.resolve();
    expect(converter?.isAvailable('layout')).toBe(true);
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

/**
 * ================================================================
 * TWO URLS, AND WHY THE OLD ONE STILL DECIDES EVERYTHING
 * ================================================================
 *
 * `docling-ocr` holds 3.8-7.4 GB against `docling-layout`'s flat 2.3-2.6 GB, so
 * on the cluster they are separate Deployments and need separate addresses. But
 * `DOCLING_URL` lives in a Kubernetes Secret created BY HAND — it is not in CI,
 * and the runbook that creates that Secret did not mention it at all — so a
 * release that required two new keys would take the parser down at the moment
 * it shipped and stay down until someone noticed.
 *
 * So `DOCLING_URL` remains the answer for both routes until a more specific key
 * overrides it. Shipping this change to the running cluster is a no-op.
 */
describe('buildDoclingConverter — one service or two', () => {
  it('serves both routes from DOCLING_URL alone, as one converter', () => {
    // THE BACK-COMPAT PROOF. One address means one connection pool and one
    // latch, exactly as before the split.
    const converter = buildDoclingConverter(config());
    expect(converter).toBeInstanceOf(HttpDoclingConverter);
    expect(converter?.isAvailable('layout')).toBe(true);
    expect(converter?.isAvailable('ocr')).toBe(true);
  });

  it('stays one converter when both keys name the same address', () => {
    // Setting both to the same value is a deployment that has not split yet.
    // Two converters over one address would be two pools and two latches for
    // one pod, which is worse than the state it replaced.
    const converter = buildDoclingConverter(
      config({
        doclingLayoutUrl: 'http://docling:5001',
        doclingOcrUrl: 'http://docling:5001',
      }),
    );
    expect(converter).toBeInstanceOf(HttpDoclingConverter);
  });

  it('routes between two converters when the addresses differ', () => {
    const converter = buildDoclingConverter(
      config({
        doclingLayoutUrl: 'http://docling-layout:5001',
        doclingOcrUrl: 'http://docling-ocr:5001',
      }),
    );
    expect(converter).toBeInstanceOf(RoutedDoclingConverter);
    expect(converter?.isAvailable('layout')).toBe(true);
    expect(converter?.isAvailable('ocr')).toBe(true);
  });

  it.each([
    ['LAYOUT', 'doclingLayoutUrl'],
    ['OCR', 'doclingOcrUrl'],
  ] as const)('lets DOCLING_%s_URL override the shared address', (_l, key) => {
    const converter = buildDoclingConverter(
      config({ [key]: 'http://docling-split:5001' }),
    );
    expect(converter).toBeInstanceOf(RoutedDoclingConverter);
  });

  it('runs the cheap route alone when only the layout address is set', () => {
    // A DEPLOYMENT WORTH SUPPORTING, and the cheapest one that still helps: the
    // 8.66% of filings carrying a results table get their columns aligned for
    // 2.6 GB, and the 1.11% that are raster scans stay unread rather than
    // paying for a 5 GB pod that idles at 0.36% duty.
    const converter = buildDoclingConverter(
      config({
        doclingUrl: '',
        doclingLayoutUrl: 'http://docling-layout:5001',
      }),
    );
    expect(converter).not.toBeNull();
    expect(converter?.isAvailable('layout')).toBe(true);
    expect(converter?.isAvailable('ocr')).toBe(false);
  });

  it('runs the OCR route alone when only the OCR address is set', () => {
    const converter = buildDoclingConverter(
      config({ doclingUrl: '', doclingOcrUrl: 'http://docling-ocr:5001' }),
    );
    expect(converter).not.toBeNull();
    expect(converter?.isAvailable('ocr')).toBe(true);
    expect(converter?.isAvailable('layout')).toBe(false);
  });

  it('returns null only when no address resolves at all', () => {
    expect(
      buildDoclingConverter(
        config({ doclingUrl: '', doclingLayoutUrl: '', doclingOcrUrl: '' }),
      ),
    ).toBeNull();
  });

  it('loses only the mistyped half when one address is garbage', () => {
    // The same rule the single-URL case already had, applied per service: a
    // typo in an optional dependency's address must cost that dependency and
    // nothing else.
    const converter = buildDoclingConverter(
      config({
        doclingUrl: '',
        doclingLayoutUrl: 'http://docling-layout:5001',
        doclingOcrUrl: 'please use docling',
      }),
    );
    expect(converter?.isAvailable('layout')).toBe(true);
    expect(converter?.isAvailable('ocr')).toBe(false);
  });
});

describe('buildDoclingConverter — asking for a service that was never configured', () => {
  it('answers unavailable rather than throwing, and says which service', async () => {
    // NEVER THROWS, for the same reason every other failure in this module
    // does not: the caller is a worker loop already holding a usable
    // `pdf-parse` reading, and it must not lose that to an address an operator
    // chose not to set. The message names the service because "Docling did not
    // run" and "nobody configured the OCR half" are different remedies.
    const converter = buildDoclingConverter(
      config({
        doclingUrl: '',
        doclingLayoutUrl: 'http://docling-layout:5001',
      }),
    );
    if (converter === null) throw new Error('expected a converter');

    const result = await converter.convert({
      data: Buffer.from('%PDF-1.4 not really a pdf'),
      fileName: 'scan.pdf',
      ocr: true,
      forceOcr: false,
      maxPages: 40,
    });

    expect(result.outcome).toBe('unavailable');
    if (result.outcome !== 'unavailable') return;
    expect(result.message).toContain('ocr');
    expect(result.message).toContain('no request was made');
  });
});
