import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, relative } from 'path';

/** One thing the bundle carries that it must not. */
export interface Violation {
  readonly file: string;
  readonly rule: string;
  readonly detail: string;
}

/**
 * XML namespace URIs are NAMES rather than addresses — `createElementNS`
 * needs them and no browser fetches them. Every one lives under w3.org, and
 * react-dom's production build carries five (xhtml, svg, xlink, xml, MathML)
 * that cannot be built out, so the allowance is the prefix rather than a list
 * that goes stale when React adds one.
 */
const XML_NAMESPACE_PREFIX = 'http://www.w3.org/';

/**
 * react-dom's production error path interpolates this into thrown Error
 * messages so a HUMAN can decode a minified error. The code never fetches it,
 * and it cannot be built out of react-dom. The allowance is this one page —
 * any other reactjs.org URL still fails.
 */
const REACT_ERROR_DECODER = 'https://reactjs.org/docs/error-decoder.html';

/** Any absolute http(s) URL. */
const ABSOLUTE_URL = /https?:\/\/[^\s"'`)]+/g;

const isAllowed = (url: string): boolean =>
  url.startsWith(XML_NAMESPACE_PREFIX) || url.startsWith(REACT_ERROR_DECODER);

const filesUnder = (dir: string): readonly string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });

/**
 * Everything the built bundle carries that would leave this origin.
 *
 * Reads the EMITTED OUTPUT rather than the source, which is the point: a
 * transitive import that fetches at runtime is invisible in the source and
 * present here.
 */
export const auditBundle = (dir: string): readonly Violation[] => {
  if (!existsSync(dir)) {
    return [
      { file: dir, rule: 'no-bundle', detail: 'the directory does not exist' },
    ];
  }

  const files = filesUnder(dir).filter((f) => /\.(html|js|css)$/.test(f));
  if (files.length === 0) {
    return [
      { file: dir, rule: 'no-bundle', detail: 'no html, js or css emitted' },
    ];
  }

  const violations: Violation[] = [];

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const name = relative(dir, file);

    for (const url of source.match(ABSOLUTE_URL) ?? []) {
      if (isAllowed(url)) continue;
      violations.push({ file: name, rule: 'absolute-url', detail: url });
    }

    if (file.endsWith('.html')) {
      // THE LINK BUDGET IS TWO, EACH NAMED: one data: favicon (loads
      // nothing) and at most one stylesheet whose href stays relative — the
      // file Vite emitted into assets/, which the absolute-url rule above
      // already audits. The server-rendered page allowed only the favicon
      // because its CSS was a <style> element; a built bundle's stylesheet
      // arrives as a link, and refusing it would be refusing the build.
      // Anything else is a font, a preconnect or a second sheet — refused.
      const links = source.match(/<link\b[^>]*>/g) ?? [];
      let icons = 0;
      let sheets = 0;
      for (const link of links) {
        if (/rel="icon"/.test(link) && /href="data:/.test(link)) {
          icons += 1;
          continue;
        }
        if (/rel="stylesheet"/.test(link) && !/href="[a-z]+:/.test(link)) {
          sheets += 1;
          continue;
        }
        violations.push({
          file: name,
          rule: 'link-budget',
          detail: `unbudgeted link: ${link}`,
        });
      }
      if (icons > 1 || sheets > 1) {
        violations.push({
          file: name,
          rule: 'link-budget',
          detail: `${icons} icon and ${sheets} stylesheet links; the budget is one of each`,
        });
      }
    }
  }

  return violations;
};
