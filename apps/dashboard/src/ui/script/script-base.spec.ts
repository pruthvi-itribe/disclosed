import { renderDashboardPage } from '../page';

/**
 * `postJson`, as the served document carries it.
 *
 * THE SERVED STRING IS WHAT IS ASSERTED, NEVER THE SOURCE FILE. These fragments
 * are TypeScript template literals, so the compiler consumes part of what is
 * written before a browser sees it; a source-level assertion can pass on a
 * fragment that reaches the page broken. `script-feed.spec.ts` and
 * `script-share.spec.ts` read the rendered page for the same reason.
 */
const html = renderDashboardPage(true);

describe('postJson', () => {
  it('sends a JSON content type on every mutation, body or not', () => {
    expect(html).toContain("if (method !== 'GET')");
    expect(html).toContain("init.headers['Content-Type'] = 'application/json'");
  });

  // The regression this guards: watchlist add, watchlist remove and sign out
  // all pass no body, and a content type set only alongside a body would 415
  // exactly those three against `JsonOnlyGuard`.
  it('does not make the content type conditional on a body', () => {
    const at = html.indexOf("init.headers['Content-Type']");
    const bodyCheck = html.indexOf('body !== undefined');
    expect(at).toBeGreaterThan(-1);
    expect(bodyCheck).toBeGreaterThan(-1);
    expect(at).toBeLessThan(bodyCheck);
  });
});
