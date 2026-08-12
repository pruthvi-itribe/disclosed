import { isIP } from 'node:net';

/**
 * WHO THE RATE LIMITER IS COUNTING.
 *
 * ================================================================
 * THE PROBLEM THIS SOLVES, AND WHY req.ip IS NOT ENOUGH
 * ================================================================
 *
 * `@nestjs/throttler`'s own tracker is `req.ip`, which is express's rightmost-
 * untrusted resolution and is exactly the right answer for a chain that
 * forwards `X-Forwarded-For` intact. The production chain does not.
 *
 * Measured against the deployed configuration rather than assumed:
 * tralk-infra's `prod/platform.tf` installs ingress-nginx 4.11.3 with NO
 * `controller.config` block, so every ConfigMap setting is at its chart
 * default — including `use-forwarded-headers: false`. The controller-v1.11.3
 * template then emits
 *
 *     proxy_set_header X-Forwarded-For $remote_addr;
 *
 * which REPLACES the header rather than appending to it. Whatever Cloudflare
 * wrote is discarded one hop before this process could read it, and what
 * arrives is the address that connected to nginx: the DigitalOcean load
 * balancer. So `req.ip` in production is one constant, shared by every reader
 * on the internet, and an auth bucket keyed on it is a global limit — one
 * person fumbling a password rate-limits everyone, which is the open item
 * `docs/deploy-kubernetes.md` has been carrying.
 *
 * That setting is a cluster-wide ConfigMap SHARED WITH TRALKSERVER, and there
 * is no per-Ingress annotation for it. Changing it is a decision about another
 * product; reading a header this one already receives is not.
 *
 * ================================================================
 * SO: CF-CONNECTING-IP, AND NEVER BARE
 * ================================================================
 *
 * Cloudflare sets `CF-Connecting-IP` to the connecting client on every proxied
 * request, overwriting anything the caller sent, and nginx passes it through
 * untouched because it is not an `X-Forwarded-*` header. It survives where the
 * forwarded chain does not.
 *
 * It is read ONLY when `req.ips` is non-empty, which is true exactly when
 * `trust proxy` is configured AND the request carried a forwarded chain — that
 * is, when this process has been told it sits behind proxies and proxies
 * actually wrote to it. With `TRUST_PROXY` unset, `req.ips` is `[]` on every
 * request and this header is not consulted at all, so the loopback deployment
 * and the e2e suite are unchanged and no local caller can name its own bucket.
 *
 * ================================================================
 * WHAT THIS DOES NOT CLOSE, STATED PLAINLY
 * ================================================================
 *
 * A caller who reaches the load balancer's public address DIRECTLY, bypassing
 * Cloudflare, traverses the same trusted hops and can therefore send any
 * `CF-Connecting-IP` it likes. There is no signal left at this process that
 * distinguishes that request from a proxied one: nginx replaced the forwarded
 * chain, so the Cloudflare edge address never arrives either. The fix is a
 * network control — restricting the load balancer to Cloudflare's ranges — and
 * not a line of application code; it is recorded in
 * `docs/deploy-kubernetes.md` rather than papered over here.
 *
 * What that caller gains is evasion of a per-IP bucket, not entry. The
 * defence that actually stops credential stuffing against one account is the
 * per-account backoff in `libs/accounts/login-backoff.ts`, which is persisted,
 * keyed on the account and reads no address at all.
 */

/** The header Cloudflare sets to the connecting client, lowercased as node delivers it. */
export const CLIENT_IP_HEADER = 'cf-connecting-ip';

/** The parts of a request this reads. Express's `Request` satisfies it. */
export interface ClientAddressed {
  /** Express's rightmost-untrusted resolution. */
  readonly ip?: string;
  /** The trusted forwarded chain. Empty unless `trust proxy` is set. */
  readonly ips: readonly string[];
  readonly headers: Record<string, string | string[] | undefined>;
}

/**
 * The address the rate limiter counts this request against.
 *
 * Falls back to `req.ip` on anything unexpected — a missing header, a repeated
 * one (node joins duplicates into `a, b`, which is not an IP), a value that is
 * not an address at all. Falling back is the safe direction twice over: the
 * bucket becomes coarser rather than absent, and an unvalidated value would
 * become a key in the throttler's in-memory storage, which is an allocation an
 * unauthenticated caller would otherwise get to choose the size of.
 */
export const clientKey = (request: ClientAddressed): string => {
  const resolved = request.ip ?? '';

  // No trusted chain resolved this request, so there is no proxy whose word
  // could be worth taking. Nothing below is consulted.
  if (request.ips.length === 0) return resolved;

  const claimed = request.headers[CLIENT_IP_HEADER];
  if (typeof claimed === 'string' && isIP(claimed) !== 0) return claimed;

  return resolved;
};
