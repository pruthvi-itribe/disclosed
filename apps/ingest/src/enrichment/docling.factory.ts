import axios from 'axios';
import {
  DEFAULT_DOCLING_COOLDOWN_MS,
  HttpDoclingConverter,
  type DoclingConverter,
  type DoclingHttp,
} from '@app/filings';

/**
 * Deciding whether there is a Docling service at all, and how to reach it.
 *
 * ================================================================
 * NULL IS THE DEFAULT, AND IT IS A SUPPORTED DEPLOYMENT
 * ================================================================
 *
 * `DOCLING_URL` ships unset, so an operator who does nothing gets exactly the
 * pipeline that existed before the hybrid: every document read by `pdf-parse`,
 * scanned filings reaching `no-text-layer`, nothing failing. That is the whole
 * requirement — **the pipeline must keep working on a machine with no Python on
 * it** — and it is expressed as a default rather than as a fallback path,
 * because a fallback path that is never the default is a fallback path nobody
 * runs.
 *
 * What an operator gets by setting it is the recovery of the 1.11% of filings
 * that are raster scans and correct reading order on the 8.66% that carry
 * results tables. What they take on is a Python service holding 2.3-7.7 GB
 * resident. The README says how to run it.
 *
 * ================================================================
 * THE TIMEOUT IS THE ONE NUMBER THAT MUST NOT BE TOO SMALL
 * ================================================================
 *
 * Docling is not fast and is not meant to be. Measured on real filings by the
 * parsing spike: 2.5-4 s a page with OCR, and 129-page POLICYBZR took 414
 * seconds. A timeout tuned to a web request would abandon every large results
 * filing at the moment it was about to succeed, open the availability latch, and
 * present as a service that is down.
 *
 * So the default is 300 seconds — long, deliberately. It is affordable because
 * the enrichment worker is already off the poller's two-second hot path, runs in
 * its own OS process, and holds a ten-minute lease on the filing it is working
 * on. A request that genuinely hangs is bounded by this; a request that is
 * merely slow is allowed to finish.
 */

export interface DoclingConfig {
  /** Empty means no service is configured, which is the shipped default. */
  readonly doclingUrl: string;
  readonly doclingTimeoutMs: number;
  readonly doclingCooldownMs: number;
}

/**
 * Wraps axios in the tiny port the converter holds.
 *
 * Exported so the one line that names each endpoint is reachable by a test, and
 * so `libs/filings` never learns what transport carries it — the same separation
 * `httpChat` keeps for the model providers.
 *
 * `maxBodyLength`/`maxContentLength` are lifted because a 640-page conversion
 * returns megabytes of markdown and axios's default 10 MB ceiling would reject
 * the largest documents as a transport error, which the latch would then read as
 * the service being down.
 */
export const axiosDoclingHttp = (
  baseURL: string,
  timeoutMs: number,
): DoclingHttp => {
  const http = axios.create({
    baseURL,
    timeout: timeoutMs,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
  return {
    post: async (path, form) => (await http.post(path, form)).data,
    // A SEPARATE, SHORT TIMEOUT. The health probe exists to answer "is anything
    // listening" quickly; giving it the conversion timeout would make a startup
    // check against a dead host hang for five minutes.
    health: async () => {
      await http.get('/health', { timeout: 5_000 });
    },
  };
};

/**
 * The converter, or null when the operator configured none.
 *
 * NEVER THROWS on a malformed URL. An unusable `DOCLING_URL` returns null and
 * the pipeline runs on `pdf-parse`, which is the same state as not setting it —
 * because the alternative is a typo in an OPTIONAL dependency's address stopping
 * a process whose primary job has nothing to do with it.
 */
export function buildDoclingConverter(
  config: DoclingConfig,
): DoclingConverter | null {
  const url = config.doclingUrl.trim();
  if (url.length === 0) return null;

  try {
    // Parsed rather than trusted: axios accepts a garbage baseURL and fails
    // later, per request, which would spend the timeout on every filing.
    new URL(url);
  } catch {
    return null;
  }

  return new HttpDoclingConverter(
    axiosDoclingHttp(url, config.doclingTimeoutMs),
    {
      cooldownMs:
        config.doclingCooldownMs > 0
          ? config.doclingCooldownMs
          : DEFAULT_DOCLING_COOLDOWN_MS,
      now: () => Date.now(),
    },
  );
}
