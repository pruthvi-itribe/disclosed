import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The founder's logo as artwork rather than as a redrawing.
 *
 * ================================================================
 * WHY A RASTER EXISTS HERE AT ALL, NEXT TO `logo.ts`
 * ================================================================
 *
 * `logo.ts` draws the mark in SVG and says why: three HTML pages carry it at
 * 21–34px, vector costs 0.9 KB, and a 1.03 MB PNG base64ed into every document
 * would be ~1.4 MB of data URI on each of them. Nothing about that changes.
 *
 * What changed is that the product now draws a picture somebody SENDS — the
 * share card — and on that card the mark is the only part a stranger
 * recognises. The SVG is a redrawing measured off `logo/disclosed-logo.png`
 * (its own header says so), and a redrawing is exactly what the founder noticed
 * was not the same logo. So the card gets the artwork.
 *
 * ================================================================
 * DOWNSCALED ONCE, COMMITTED, AND SERVED — NOT INLINED
 * ================================================================
 *
 * `apps/dashboard/src/ui/assets/disclosed-logo-256.png` is
 * `logo/disclosed-logo.png` at 256px, produced with `sips -Z 256` and checked
 * in at 65 KB. The original stays untouched as the canonical asset.
 *
 * 256 because the card draws it at 104px and nothing displays a 1080px-wide
 * share image at more than about twice that, so 2.5× is already more resolution
 * than any reader will see. The full 1,254px file is 1.03 MB for the same
 * 104 drawn pixels.
 *
 * READ ONCE, AT IMPORT, so a build that failed to copy the asset fails at boot
 * with a path in the message rather than at the first click with a blank corner
 * — `nest-cli.json` has the copy rule, and an asset pipeline that silently did
 * nothing is precisely the failure this module must not absorb.
 *
 * The path is relative to this file in both the source tree and `dist`, which
 * is why the asset lives beside the module that reads it rather than at the
 * repository root.
 */
export const BRAND_RASTER_FILE = 'disclosed-logo-256.png';

/** The bytes the route sends. See above for why this is read eagerly. */
export const BRAND_RASTER: Buffer = readFileSync(
  join(__dirname, 'assets', BRAND_RASTER_FILE),
);
