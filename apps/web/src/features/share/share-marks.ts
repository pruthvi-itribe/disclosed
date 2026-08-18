/**
 * The two marks the picture can carry, loaded ONCE at module scope and
 * never at click: Safari ends the user gesture at the first await, so a
 * mark fetched on demand is a clipboard write refused. The favicon decodes
 * from the document's own data: URI with nothing to wait on; the raster is
 * a same-origin request (/brand/logo.png, session-guarded, and in dev
 * proxied beside /api). A card can be drawn as soon as EITHER has arrived;
 * the caller refuses only when both are missing, because a picture that
 * silently arrived without a logo would look like a design choice rather
 * than a failure.
 */
export interface ShareMarks {
  readonly logo: HTMLImageElement | null;
  readonly favicon: HTMLImageElement | null;
}

let logo: HTMLImageElement | null = null;
let favicon: HTMLImageElement | null = null;

const loadMarks = (): void => {
  const link = document.querySelector('link[rel="icon"]');
  const href = link?.getAttribute('href');
  if (href) {
    const image = new Image();
    image.onload = () => {
      favicon = image;
    };
    image.src = href;
  }

  const raster = new Image();
  raster.onload = () => {
    logo = raster;
  };
  raster.src = '/brand/logo.png';
};

if (typeof document !== 'undefined') loadMarks();

export const shareMarks = (): ShareMarks => ({ logo, favicon });

export const marksReady = (): boolean => logo !== null || favicon !== null;

/** Test seam: jsdom never fires Image.onload. */
export const setMarksForTest = (next: ShareMarks): void => {
  logo = next.logo;
  favicon = next.favicon;
};
