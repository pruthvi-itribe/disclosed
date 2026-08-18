import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The tokens are a PORT, not a redesign, so this asserts they match the
 * server-rendered stylesheet they came from. A drift here is a visual change,
 * which this project has excluded.
 *
 * SEVENTEEN, not the plan's fourteen: page-style.ts also declares --panel-2
 * and the --brand-1/--brand-2 pair that --brand-gradient references, and a
 * verbatim port cannot leave a referenced token behind.
 */
const REQUIRED = [
  '--bg', '--panel', '--panel-2', '--text', '--muted', '--line', '--accent',
  '--brand-1', '--brand-2', '--brand-gradient', '--brand-ink', '--flash',
  '--ok', '--warn', '--bad', '--sans', '--mono',
] as const;

describe('the design tokens', () => {
  const css = readFileSync(join(__dirname, 'tokens.module.css'), 'utf8');

  it.each(REQUIRED)('defines %s', (token) => {
    expect(css).toContain(`${token}:`);
  });

  // NO WEB FONT. `--sans` and `--mono` must name system faces; a remote font
  // would break the self-contained invariant and the bundle audit would catch
  // it, but failing here says why.
  it('names only system font stacks', () => {
    expect(css).not.toMatch(/@import|@font-face/);
    expect(css).not.toMatch(/https?:\/\//);
  });

  // Each value must be the one page-style.ts declares, character for
  // character. The comparison is against the live source so a repaint there
  // fails here, telling the porter to re-copy rather than letting the two
  // clients drift apart.
  it('matches the server stylesheet value for value', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'dashboard', 'src', 'ui', 'page-style.ts'),
      'utf8',
    );
    for (const token of REQUIRED) {
      const inSource = source.match(new RegExp(`${token}: ([^;]+);`));
      expect(inSource, `${token} missing from page-style.ts`).not.toBeNull();
      expect(css).toContain(`${token}: ${inSource?.[1] ?? ''};`);
    }
  });
});
