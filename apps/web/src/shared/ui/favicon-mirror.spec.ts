import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The favicon is the server page's, byte for byte: recomputed here from
 * logo.ts the same way logo.ts computes it (encodeURIComponent over the
 * standalone SVG), then compared against the data: URI carried in
 * index.html. A redrawn mark starts on the server and is re-encoded.
 */
describe('the favicon', () => {
  it('is the encoded BRAND_FAVICON_SVG from logo.ts', () => {
    const source = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'dashboard',
        'src',
        'ui',
        'logo.ts',
      ),
      'utf8',
    );
    const marker = 'export const BRAND_FAVICON_SVG = `';
    const start = source.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const from = start + marker.length;
    const svg = source.slice(from, source.indexOf('`;', from));

    const html = readFileSync(
      join(__dirname, '..', '..', '..', 'index.html'),
      'utf8',
    );
    expect(html).toContain(`data:image/svg+xml,${encodeURIComponent(svg)}`);
  });
});
