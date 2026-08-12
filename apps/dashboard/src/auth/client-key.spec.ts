import {
  CLIENT_IP_HEADER,
  clientKey,
  type ClientAddressed,
} from './client-key';

/**
 * The tracker in isolation. What it does inside a real express request — where
 * `ip` and `ips` are computed by proxy-addr from the socket and the forwarded
 * header rather than handed over — is proved in `trust-proxy.e2e.spec.ts`
 * against the real module over real HTTP.
 */

const request = (
  overrides: Partial<ClientAddressed> = {},
): ClientAddressed => ({
  ip: '127.0.0.1',
  ips: [],
  headers: {},
  ...overrides,
});

describe('clientKey', () => {
  it('is req.ip when no trusted chain resolved the request', () => {
    // `ips` is empty exactly when `trust proxy` is unset — the shipped loopback
    // deployment — or when nothing forwarded anything.
    expect(clientKey(request({ ip: '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('ignores CF-Connecting-IP entirely with no trusted chain', () => {
    // THE POINT OF THE GATE. A local caller must not get to name its own
    // rate-limit bucket by sending a header, and on a host that was never told
    // it sits behind a proxy, every header is just something the caller wrote.
    const key = clientKey(
      request({
        ip: '127.0.0.1',
        ips: [],
        headers: { [CLIENT_IP_HEADER]: '9.9.9.9' },
      }),
    );

    expect(key).toBe('127.0.0.1');
  });

  it('reads CF-Connecting-IP once a trusted chain resolved the request', () => {
    // Production: ingress-nginx replaced X-Forwarded-For with the load
    // balancer's address, so `req.ip` is one constant for the whole internet
    // and this header is the only thing left that names the reader.
    const key = clientKey(
      request({
        ip: '10.110.0.4',
        ips: ['10.110.0.4', '10.244.1.9'],
        headers: { [CLIENT_IP_HEADER]: '49.37.200.11' },
      }),
    );

    expect(key).toBe('49.37.200.11');
  });

  it('reads an IPv6 client', () => {
    const key = clientKey(
      request({
        ip: '10.110.0.4',
        ips: ['10.110.0.4'],
        headers: { [CLIENT_IP_HEADER]: '2405:201:e000:1::a1' },
      }),
    );

    expect(key).toBe('2405:201:e000:1::a1');
  });

  it('falls back to req.ip when the header is absent', () => {
    expect(clientKey(request({ ip: '10.110.0.4', ips: ['10.110.0.4'] }))).toBe(
      '10.110.0.4',
    );
  });

  it.each([
    ['not an address', 'nonsense'],
    [
      'a joined pair, which is how node delivers a repeated header',
      '1.2.3.4, 5.6.7.8',
    ],
    ['an address with a port', '1.2.3.4:8080'],
    ['an untrimmed address', ' 1.2.3.4'],
    ['empty', ''],
  ])('falls back to req.ip on %s', (_label, claimed) => {
    // Coarser is the safe direction, and the value would otherwise become a key
    // in the throttler's in-memory storage — an allocation an unauthenticated
    // caller would get to choose the size of.
    const key = clientKey(
      request({
        ip: '10.110.0.4',
        ips: ['10.110.0.4'],
        headers: { [CLIENT_IP_HEADER]: claimed },
      }),
    );

    expect(key).toBe('10.110.0.4');
  });

  it('falls back when the header arrived more than once', () => {
    // Node hands a repeated header over as an array for some names; either way
    // two claims are not one address.
    const key = clientKey(
      request({
        ip: '10.110.0.4',
        ips: ['10.110.0.4'],
        headers: { [CLIENT_IP_HEADER]: ['1.2.3.4', '9.9.9.9'] },
      }),
    );

    expect(key).toBe('10.110.0.4');
  });

  it('is the empty string rather than undefined when express resolved nothing', () => {
    // `req.ip` is typed as a string but is undefined on a socket that has
    // already gone away. A key of `undefined` would stringify to "undefined"
    // and pool every such request into one bucket by accident rather than on
    // purpose; the empty string does the same thing visibly.
    expect(clientKey(request({ ip: undefined }))).toBe('');
  });
});
