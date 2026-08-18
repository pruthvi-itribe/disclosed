import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The three ported stylesheets are VERBATIM copies of the server's, and this
 * is what makes that a fact rather than a hope: each file is compared
 * character for character against the literal it was extracted from. A rule
 * changed on the server fails here until it is re-extracted; a rule changed
 * here by hand fails immediately, which is what the DO-NOT-EDIT headers mean.
 *
 * page.css alone differs by one block: :root moved to tokens.css in Plan 1
 * and must not be defined twice.
 */
const SERVER_UI = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'dashboard',
  'src',
  'ui',
);

const literalBody = (file: string, constName: string): string => {
  const text = readFileSync(join(SERVER_UI, file), 'utf8');
  const marker = `export const ${constName} = \``;
  const start = text.indexOf(marker);
  expect(start, `${file} must export ${constName}`).toBeGreaterThan(-1);
  return text.slice(start + marker.length, text.lastIndexOf('`;'));
};

/** A ported file's CSS: everything after its DO-NOT-EDIT header. */
const portedCss = (file: string): string => {
  const text = readFileSync(join(__dirname, file), 'utf8');
  return text.slice(text.indexOf('*/\n') + '*/\n'.length);
};

describe('the ported stylesheets', () => {
  it('page.css is PAGE_STYLE minus the :root block tokens.css owns', () => {
    const body = literalBody('page-style.ts', 'PAGE_STYLE');
    const start = body.indexOf(':root {');
    const end = body.indexOf('\n}', start) + '\n}'.length;
    const withoutRoot = body.slice(0, start) + body.slice(end + 1);
    expect(withoutRoot).not.toContain(':root');
    expect(portedCss('page.css')).toBe(withoutRoot);
  });

  it('brief.css is PAGE_STYLE_BRIEF whole', () => {
    expect(portedCss('brief.css')).toBe(
      literalBody('page-style-brief.ts', 'PAGE_STYLE_BRIEF'),
    );
  });

  it('logo.css is BRAND_LOGO_STYLE whole', () => {
    const source = readFileSync(join(SERVER_UI, 'logo.ts'), 'utf8');
    const marker = 'export const BRAND_LOGO_STYLE = `';
    const start = source.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const from = start + marker.length;
    const body = source.slice(from, source.indexOf('`;', from));
    expect(portedCss('logo.css')).toBe(body);
  });

  it('focus.css is PAGE_STYLE_FOCUS whole', () => {
    expect(portedCss('focus.css')).toBe(
      literalBody('page-style-focus.ts', 'PAGE_STYLE_FOCUS'),
    );
  });
});
