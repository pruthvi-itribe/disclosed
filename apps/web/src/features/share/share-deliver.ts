import type { IconReport } from '../../shared/ui/ReportingIconButton';

/** How long every image report stays before the control is itself again —
 * success and failure alike, unlike the text copy's permanent cross. */
export const IMAGE_REVERT_MS = 2000;

/**
 * A file name from a ticker, with everything that is not one removed. The
 * symbol is exchange text, and this is the one place on the page it reaches
 * something other than textContent — a download attribute a browser turns
 * into a path. Whitelisted rather than escaped.
 */
export const shareFileName = (symbol: string): string => {
  const safe = String(symbol).replace(/[^A-Za-z0-9._-]/g, '');
  return `disclosed-${safe === '' ? 'filing' : safe}.png`;
};

/** The picture as a file — the only link on this page that is not a
 * document, and the one exemption from safeHref: there is no exchange text
 * in a URL the browser minted from a blob this page just drew. */
const download = (
  canvas: HTMLCanvasElement,
  symbol: string,
  report: IconReport,
): void => {
  canvas.toBlob((blob) => {
    if (!blob) {
      report.fail('image failed', IMAGE_REVERT_MS);
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = shareFileName(symbol);
    link.click();
    // Revoked, or the picture is held in memory as long as the tab is.
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    report.done('Downloaded', IMAGE_REVERT_MS);
  }, 'image/png');
};

/**
 * The picture onto the clipboard, or into the downloads folder — and the
 * button says WHICH: a control that reports one success for two different
 * outcomes has taught the reader to look in the wrong place.
 *
 * THE CLIPBOARD ITEM IS BUILT AROUND A PROMISE, not an awaited blob: Safari
 * ends the user gesture at the first await, and a write started after
 * toBlob has called back is a write it refuses. An innocent `await toBlob`
 * refactor breaks Safari silently, and no test can catch it — hence this
 * sentence.
 */
export const shareDeliver = (
  canvas: HTMLCanvasElement,
  symbol: string,
  report: IconReport,
): void => {
  if (window.ClipboardItem && navigator.clipboard?.write) {
    const png = new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('the canvas produced no image'));
      }, 'image/png');
    });
    navigator.clipboard
      .write([new window.ClipboardItem({ 'image/png': png })])
      .then(
        () => report.done('Image copied', IMAGE_REVERT_MS),
        () => download(canvas, symbol, report),
      );
    return;
  }
  download(canvas, symbol, report);
};
