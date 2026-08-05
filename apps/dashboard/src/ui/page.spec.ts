import { renderDashboardPage } from './page';

/**
 * A SMOKE suite, deliberately. The markup itself is not asserted line by line —
 * that would pin the design rather than the contract, and every visual tweak
 * would be a red build. What is asserted is the part that is a requirement:
 * the document is self-contained, it references nothing off-origin, and the
 * element ids the client script writes into actually exist.
 */

const html = renderDashboardPage();

describe('renderDashboardPage — self-containment', () => {
  it('references no external host at all', () => {
    // The moment this page is most needed is the moment the network is the
    // suspect, and a third-party script here would have read access to a view
    // of an unauthenticated database.
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('loads no external stylesheet, script or font', () => {
    expect(html).not.toContain('<link');
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toContain('@import');
    expect(html).not.toContain('@font-face');
  });

  it('embeds no remote asset through a CSS url()', () => {
    expect(html).not.toMatch(/url\s*\(/);
  });

  it('inlines its own stylesheet and script', () => {
    expect(html).toContain('<style>');
    expect(html).toContain('<script>');
  });

  it('is a complete document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
    expect(html).toContain('<title>');
  });
});

describe('renderDashboardPage — content', () => {
  const REQUIRED_IDS = [
    'alert',
    'live-dot',
    'live-text',
    'generated',
    'stat-total',
    'stat-today',
    'stat-today-note',
    'stat-lag',
    'stat-newest',
    'stat-cursor',
    'symbol',
    'category',
    'limit',
    'clear',
    'prev',
    'next',
    'page-info',
    'rows',
    'categories',
    'days',
    'day-from',
    'day-to',
  ] as const;

  it.each(REQUIRED_IDS)('carries the #%s the script writes into', (id) => {
    // The script addresses these by id and would fail silently against a
    // renamed one, leaving a panel permanently blank.
    expect(html).toContain(`id="${id}"`);
  });

  it('labels every time column as IST', () => {
    expect(html).toContain('Time (IST)');
    expect(html).toContain('per IST day');
  });

  it('states that the view is read-only', () => {
    expect(html).toContain('never writes');
  });

  it('contains no emoji', () => {
    // Project rule: no emoji anywhere, the UI included.
    expect(html).not.toMatch(
      /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u,
    );
  });

  it('is stable — two renders produce the same document', () => {
    // Nothing in the shell is time- or data-dependent; every value arrives
    // from the JSON routes at runtime.
    expect(renderDashboardPage()).toBe(html);
  });

  it('carries no filing data in the shell', () => {
    // The served document is a shell. Every value the page shows is placed by
    // the script from the JSON routes, which is what keeps exchange-supplied
    // text out of a server-side string concatenation that would have to escape
    // it by hand.
    expect(html).not.toContain('nseindia');
    expect(html).not.toContain('<td');
    expect(html).toContain('<tbody id="rows"></tbody>');
  });
});
