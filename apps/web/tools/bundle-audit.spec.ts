import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { auditBundle } from './bundle-audit';

/**
 * The audit is only worth having if it FAILS on the things it claims to catch,
 * so every rule below is planted deliberately. This repository has shipped two
 * guards that were green because they were broken; a clean audit over a clean
 * bundle proves nothing on its own.
 */
const bundleWith = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-'));
  mkdirSync(join(dir, 'assets'), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), body, 'utf8');
  }
  return dir;
};

const CLEAN_HTML =
  '<!doctype html><html><head><link rel="icon" href="data:image/svg+xml,x">' +
  '</head><body><script type="module" src="/assets/main.js"></script></body></html>';

describe('auditBundle', () => {
  it('passes a self-contained bundle', () => {
    const dir = bundleWith({
      'index.html': CLEAN_HTML,
      'assets/main.js': 'const ns = "http://www.w3.org/2000/svg";',
    });
    expect(auditBundle(dir)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it.each([
    ['a CDN script', 'assets/main.js', 'fetch("https://cdn.example/x.js")'],
    [
      'an absolute image',
      'assets/main.js',
      'img.src = "http://img.example/a.png"',
    ],
  ])('reports %s', (_label, file, body) => {
    const dir = bundleWith({ 'index.html': CLEAN_HTML, [file]: body });
    expect(auditBundle(dir).map((v) => v.rule)).toContain('absolute-url');
    rmSync(dir, { recursive: true, force: true });
  });

  // THE XML NAMESPACES ARE NAMES, NOT ADDRESSES. No browser fetches them, and
  // react-dom's production build carries five of them (xhtml, svg, xlink, xml,
  // MathML) that cannot be built out.
  it('allows the XML namespaces', () => {
    const dir = bundleWith({
      'index.html': CLEAN_HTML,
      'assets/main.js':
        'createElementNS("http://www.w3.org/2000/svg", "svg");' +
        '"http://www.w3.org/1999/xhtml";"http://www.w3.org/1999/xlink";' +
        '"http://www.w3.org/1998/Math/MathML";"http://www.w3.org/XML/1998/namespace"',
    });
    expect(auditBundle(dir)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  // react-dom interpolates this address into thrown Error messages so a HUMAN
  // can decode a minified error. The code never fetches it, and it cannot be
  // built out of react-dom's production bundle.
  it('allows the React error decoder address', () => {
    const dir = bundleWith({
      'index.html': CLEAN_HTML,
      'assets/main.js':
        'throw Error("https://reactjs.org/docs/error-decoder.html?invariant=" + code)',
    });
    expect(auditBundle(dir)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  // The allowance is the decoder page, not the site. Anything else on
  // reactjs.org is an ordinary absolute URL and must fail.
  it('reports any other reactjs.org address', () => {
    const dir = bundleWith({
      'index.html': CLEAN_HTML,
      'assets/main.js': 'fetch("https://reactjs.org/docs/hooks.html")',
    });
    expect(auditBundle(dir).map((v) => v.rule)).toContain('absolute-url');
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports a second link element', () => {
    const dir = bundleWith({
      'index.html': CLEAN_HTML.replace(
        '</head>',
        '<link rel="stylesheet" href="/a.css"></head>',
      ),
      'assets/main.js': '',
    });
    expect(auditBundle(dir).map((v) => v.rule)).toContain('one-link-only');
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports a remote font face', () => {
    const dir = bundleWith({
      'index.html': CLEAN_HTML,
      'assets/main.css':
        '@font-face{font-family:X;src:url(https://f.example/x.woff2)}',
    });
    const rules = auditBundle(dir).map((v) => v.rule);
    expect(rules).toContain('absolute-url');
    rmSync(dir, { recursive: true, force: true });
  });

  // A bundle that was never built must not read as a clean one.
  it('reports a missing or empty bundle rather than passing it', () => {
    const dir = bundleWith({});
    expect(auditBundle(dir).map((v) => v.rule)).toContain('no-bundle');
    rmSync(dir, { recursive: true, force: true });
  });
});
