import { readdirSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

/**
 * The server's DTO types are shared by `import type`, and ONLY by that. A
 * runtime import that resolves outside apps/web would pull server code into
 * the bundle and couple the two dependency trees this repository keeps
 * separate on purpose. `import type` is erased at compile time, so the type
 * namespace is shared while the runtime never is — this spec is what bounds
 * the direction of that dependency.
 *
 * Inline type specifiers (`import { type X } from ...`) count as runtime
 * here: stricter than the compiler needs, and simpler than parsing which
 * specifiers carry the keyword.
 */

const IMPORT_FROM = /^\s*(import|export)\s+([^'"]*?)from\s+['"]([^'"]+)['"]/gm;
const BARE_IMPORT = /^\s*import\s+['"]([^'"]+)['"]/gm;

const WEB_ROOT = resolve(__dirname, '..', '..', '..');

/** Relative specifiers in `source` that resolve outside apps/web without `type`. */
const runtimeEscapes = (source: string, fileDir: string): readonly string[] => {
  const escapes: string[] = [];

  const record = (clause: string, specifier: string): void => {
    if (!specifier.startsWith('.')) return; // a package, from apps/web's own tree
    const target = resolve(fileDir, specifier);
    if (target.startsWith(WEB_ROOT)) return;
    if (/^\s*type\s/.test(clause)) return; // `import type` / `export type ... from`
    escapes.push(specifier);
  };

  for (const m of source.matchAll(IMPORT_FROM)) {
    record(m[2] ?? '', m[3] ?? '');
  }
  for (const m of source.matchAll(BARE_IMPORT)) {
    record('', m[1] ?? '');
  }
  return escapes;
};

const sourcesUnder = (dir: string): readonly string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourcesUnder(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });

describe('runtimeEscapes', () => {
  const HERE = __dirname;

  // The checker is only worth having if it FAILS on what it claims to catch.
  it('reports a runtime import that resolves outside apps/web', () => {
    const source =
      "import { something } from '../../../../dashboard/src/filings/dashboard.types';";
    expect(runtimeEscapes(source, HERE)).toHaveLength(1);
  });

  it('reports a bare side-effect import that escapes', () => {
    const source = "import '../../../../dashboard/src/ui/page-style';";
    expect(runtimeEscapes(source, HERE)).toHaveLength(1);
  });

  it('reports a runtime re-export that escapes', () => {
    const source =
      "export { something } from '../../../../dashboard/src/filings/dashboard.types';";
    expect(runtimeEscapes(source, HERE)).toHaveLength(1);
  });

  it('allows import type from the server tree', () => {
    const source =
      "import type { FilingView } from '../../../../dashboard/src/filings/dashboard.types';";
    expect(runtimeEscapes(source, HERE)).toEqual([]);
  });

  it('allows export type from the server tree', () => {
    const source =
      "export type { FilingView } from '../../../../dashboard/src/filings/dashboard.types';";
    expect(runtimeEscapes(source, HERE)).toEqual([]);
  });

  it('allows package imports and relative imports inside apps/web', () => {
    const source =
      "import { useState } from 'react';\nimport { helper } from './helper';\nimport './tokens.css';";
    expect(runtimeEscapes(source, HERE)).toEqual([]);
  });
});

describe('the web source tree', () => {
  it('has no runtime import escaping apps/web', () => {
    const offenders: string[] = [];
    for (const file of sourcesUnder(resolve(WEB_ROOT, 'src'))) {
      const escapes = runtimeEscapes(readFileSync(file, 'utf8'), dirname(file));
      for (const specifier of escapes) {
        offenders.push(`${file}: ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
