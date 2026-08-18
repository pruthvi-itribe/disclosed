import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/** Injection token: the loaded bundle in react mode, `null` in server mode. */
export const WEB_BUNDLE = 'WEB_BUNDLE';

export interface WebAsset {
  readonly content: Buffer;
  readonly type: string;
}

export interface WebBundle {
  readonly indexHtml: string;
  /** Keyed by bare filename — the only names `GET /assets/:file` answers. */
  readonly assets: ReadonlyMap<string, WebAsset>;
}

/**
 * The two types Vite emits. A new extension appearing in `dist/assets` is a
 * build change this map has not been taught, and serving it with a guessed
 * content type is a silent fallback — so an unknown extension throws at boot.
 */
const ASSET_TYPES: ReadonlyMap<string, string> = new Map([
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
]);

/**
 * Reads the React bundle ONCE, eagerly, into memory — ~240 KB, cheaper than
 * runtime filesystem reads, and serving only from this boot-time map makes
 * path traversal a non-question. Called only when `WEB_CLIENT=react`; a
 * bundle that cannot be served stops the process here so the failure lands
 * in the startup log rather than in the first reader's browser. In server
 * mode this module never touches the disk.
 */
export const loadWebBundle = (distDir: string): WebBundle => {
  let indexHtml: string;
  let names: readonly string[];
  try {
    indexHtml = readFileSync(join(distDir, 'index.html'), 'utf8');
    // Vite always emits an assets directory; its absence is a half-copied
    // dist, and so is an unreadable one.
    names = readdirSync(join(distDir, 'assets'));
  } catch (cause) {
    throw new Error(
      `WEB_CLIENT=react but no servable bundle at "${distDir}": ` +
        `${cause instanceof Error ? cause.message : String(cause)}. ` +
        'Build apps/web (npm run build) or point WEB_DIST_DIR at the dist.',
    );
  }

  const assets = new Map<string, WebAsset>();
  for (const name of names) {
    const extension = name.slice(name.lastIndexOf('.'));
    const type = ASSET_TYPES.get(extension);
    if (type === undefined) {
      throw new Error(
        `The web bundle at "${distDir}" contains "${name}", whose type this ` +
          'loader has not been taught — teach ASSET_TYPES in web-bundle.ts ' +
          'rather than serving a guess.',
      );
    }
    assets.set(name, {
      content: readFileSync(join(distDir, 'assets', name)),
      type,
    });
  }

  return { indexHtml, assets };
};
