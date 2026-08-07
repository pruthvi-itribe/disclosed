import { PAGE_SCRIPT } from '../page-script';
import { SCRIPT_ADMIN } from './script-admin';
import { SCRIPT_BASE } from './script-base';
import { SCRIPT_BRIEF } from './script-brief';
import { SCRIPT_CELLS } from './script-cells';
import { SCRIPT_COMPANY } from './script-company';
import { SCRIPT_FEED } from './script-feed';
import { SCRIPT_POLL } from './script-poll';
import { SCRIPT_SUGGEST } from './script-suggest';
import { SCRIPT_VIEWS } from './script-views';

/**
 * The client script is nine strings joined into one function, and these are
 * the properties that make that safe to keep doing.
 *
 * `page.spec.ts` already proves the JOINED result parses as JavaScript, which
 * is the failure that historically shipped. What it cannot say is WHICH
 * fragment broke it, and a syntax error inside a 106 KB string is not a fun
 * thing to bisect. These tests fail on the fragment.
 */

const FRAGMENTS: ReadonlyArray<readonly [string, string]> = [
  ['script-base', SCRIPT_BASE],
  ['script-cells', SCRIPT_CELLS],
  ['script-feed', SCRIPT_FEED],
  // After `script-feed`, because the deck's every string reaches the DOM
  // through `writeClaim` and `safeHref` and nothing else.
  ['script-brief', SCRIPT_BRIEF],
  ['script-company', SCRIPT_COMPANY],
  ['script-admin', SCRIPT_ADMIN],
  ['script-poll', SCRIPT_POLL],
  ['script-suggest', SCRIPT_SUGGEST],
  ['script-views', SCRIPT_VIEWS],
];

describe('the client script fragments', () => {
  it.each(FRAGMENTS)('%s carries no backtick of its own', (_name, source) => {
    // The one that ends the fragment's own template literal early, taking the
    // rest of the file into TypeScript and out of the browser.
    expect(source).not.toContain('`');
  });

  it.each(FRAGMENTS)('%s carries no ${ interpolation', (_name, source) => {
    // Evaluated by the compiler and gone before a browser sees it, so a
    // fragment that reaches for one is asking for a value that will not exist.
    expect(source).not.toContain('${');
  });

  it('joins every fragment, in the order they execute', () => {
    // ORDER, NOT MERELY PRESENCE. The fragments share one function scope, so a
    // `var` read at load time by a later fragment is read before it is assigned
    // if the two are swapped — a failure that produces `undefined` rather than
    // an error, at a place nowhere near the swap.
    let at = 0;
    for (const [name, source] of FRAGMENTS) {
      const found = PAGE_SCRIPT.indexOf(source.trim());
      expect([name, found >= 0]).toEqual([name, true]);
      expect([name, found >= at]).toEqual([name, true]);
      at = found;
    }
  });

  it('wraps them in one IIFE under strict mode', () => {
    // The fragments declare bare functions and `var`s; they are only private to
    // the page because something encloses them.
    expect(PAGE_SCRIPT).toContain("(function () {\n  'use strict';");
    expect(PAGE_SCRIPT.trimEnd().endsWith('})();')).toBe(true);
  });

  it('adds nothing to the fragments but the wrapper', () => {
    // The split was a filing change and this is what says so: every byte the
    // page serves is either a fragment or the four lines of shell around them.
    const joined = FRAGMENTS.map(([, source]) =>
      source.replace(/^\n/, '').replace(/\n$/, ''),
    ).join('\n');
    expect(PAGE_SCRIPT).toBe(
      `\n(function () {\n  'use strict';\n${joined}\n})();\n`,
    );
  });
});
