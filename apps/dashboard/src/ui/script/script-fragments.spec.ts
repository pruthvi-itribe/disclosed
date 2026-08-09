import { PAGE_SCRIPT } from '../page-script';
import { SCRIPT_ACCOUNT } from './script-account';
import { SCRIPT_ADMIN } from './script-admin';
import { SCRIPT_BASE } from './script-base';
import { SCRIPT_BRIEF } from './script-brief';
import { SCRIPT_CELLS } from './script-cells';
import { SCRIPT_COMPANY } from './script-company';
import { SCRIPT_FEED } from './script-feed';
import { SCRIPT_FOCUS } from './script-focus';
import { SCRIPT_POLL } from './script-poll';
import { SCRIPT_SUGGEST } from './script-suggest';
import { SCRIPT_VIEWS } from './script-views';

/**
 * The client script is ten strings joined into one function, and these are
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
  // After `script-feed`: it calls that fragment's `writeInsight`, and
  // `feedCard` calls this one's `openFocus`.
  ['script-focus', SCRIPT_FOCUS],
  // After `script-feed`, because the deck's every string reaches the DOM
  // through `writeClaim` and `safeHref` and nothing else.
  ['script-brief', SCRIPT_BRIEF],
  ['script-company', SCRIPT_COMPANY],
  ['script-admin', SCRIPT_ADMIN],
  ['script-poll', SCRIPT_POLL],
  ['script-suggest', SCRIPT_SUGGEST],
  // Before `script-views`: that fragment ends with the three lines that start
  // the page, and `api/me` must be asked above them.
  ['script-account', SCRIPT_ACCOUNT],
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

  it('declares every label table it reads', () => {
    // THE FAILURE THIS SHIPPED. `script-company.ts` called
    // `describe(METRIC_LABEL, ...)` against a table nobody had written, which is
    // a `ReferenceError` thrown inside the four-second poll — so the company
    // page rendered once, served a 200, and then stopped repainting. The
    // fragments share one scope, so the throw took every later view with it.
    //
    // NARROWED TO `_LABEL` AND `_GLYPH` ON PURPOSE, rather than to every
    // shouty name. Those are the lookup tables, they are always `var`-declared
    // in a fragment, and — unlike `IST`, `NSE` or `GET` — they never occur
    // inside a string a reader sees, so the rule needs no allowlist to stay
    // true. A rule with an allowlist of exceptions is a rule that grows one
    // more every time it is wrong.
    const code = PAGE_SCRIPT.replace(/\/\*[\s\S]*?\*\//g, ' ')
      // `//` is a comment unless it follows a colon, which is how every URL in
      // a string here spells `https://`.
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

    const TABLE = /\b[A-Z][A-Z0-9_]*_(?:LABEL|GLYPH)\b/g;
    const read = new Set(code.match(TABLE) ?? []);
    const declared = new Set(
      (code.match(/\bvar\s+[A-Z][A-Z0-9_]*_(?:LABEL|GLYPH)\b/g) ?? []).map(
        (line) => line.replace(/\bvar\s+/, ''),
      ),
    );

    expect(read.size).toBeGreaterThan(0);
    expect([...read].filter((name) => !declared.has(name))).toEqual([]);
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
    // THE ONE LINE THAT IS NOT A FRAGMENT is the server's admin flag, written
    // into the script because the fragments read it at load — before any fetch
    // returns — to decide what to wire up. See `page-script.ts`.
    expect(PAGE_SCRIPT).toBe(
      `\n(function () {\n  'use strict';\n  var ADMIN_ENABLED = true;\n${joined}\n})();\n`,
    );
  });
});
