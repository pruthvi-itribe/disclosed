import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadWebBundle } from './web-bundle';

/**
 * The React bundle is read ONCE AT BOOT into memory: serving only from a
 * boot-time map makes path traversal a non-question, and a bundle that
 * cannot be served must stop the process at startup — an operator flips
 * `WEB_CLIENT=react` and the failure belongs in the startup log, not in
 * the first reader's browser.
 */
describe('loadWebBundle', () => {
  let dist: string;

  beforeEach(() => {
    dist = mkdtempSync(join(tmpdir(), 'web-bundle-'));
  });
  afterEach(() => {
    rmSync(dist, { recursive: true, force: true });
  });

  const write = (relative: string, content: string): void => {
    writeFileSync(join(dist, relative), content);
  };

  it('loads the document and the hashed assets with their types', () => {
    write('index.html', '<title>Disclosed</title>');
    mkdirSync(join(dist, 'assets'));
    write(join('assets', 'index-B_3N9wRR.js'), 'js;');
    write(join('assets', 'style-P3KybEPu.css'), 'css{}');

    const bundle = loadWebBundle(dist);

    expect(bundle.indexHtml).toBe('<title>Disclosed</title>');
    expect([...bundle.assets.keys()].sort()).toEqual([
      'index-B_3N9wRR.js',
      'style-P3KybEPu.css',
    ]);
    expect(bundle.assets.get('index-B_3N9wRR.js')?.type).toBe(
      'text/javascript; charset=utf-8',
    );
    expect(bundle.assets.get('style-P3KybEPu.css')?.type).toBe(
      'text/css; charset=utf-8',
    );
    expect(bundle.assets.get('index-B_3N9wRR.js')?.content.toString()).toBe(
      'js;',
    );
  });

  it('a missing bundle stops the boot, naming the directory', () => {
    expect(() => loadWebBundle(dist)).toThrow(dist);
    expect(() => loadWebBundle(dist)).toThrow(/WEB_CLIENT=react/);
  });

  // Vite emits .css and .js; a new extension appearing in dist/assets is a
  // build change this loader has not been taught, and serving it with a
  // guessed content type is exactly the silent fallback the repo refuses.
  it('an asset of unknown type stops the boot rather than being guessed at', () => {
    write('index.html', 'x');
    mkdirSync(join(dist, 'assets'));
    write(join('assets', 'style.woff2'), 'font');

    expect(() => loadWebBundle(dist)).toThrow(/style\.woff2/);
  });

  // A bundle with no assets directory is not a built bundle: Vite always
  // emits one, so its absence means a half-copied dist.
  it('a document without its assets directory stops the boot', () => {
    write('index.html', 'x');

    expect(() => loadWebBundle(dist)).toThrow(dist);
  });
});
