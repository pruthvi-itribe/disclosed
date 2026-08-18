import { shareDeliver, shareFileName, IMAGE_REVERT_MS } from './share-deliver';
import type { IconReport } from '../../shared/ui/ReportingIconButton';

const BLOB = new Blob(['png'], { type: 'image/png' });

const canvasWith = (blob: Blob | null): HTMLCanvasElement =>
  ({
    toBlob: (cb: (b: Blob | null) => void) => cb(blob),
  }) as unknown as HTMLCanvasElement;

const report = (): IconReport & {
  done: ReturnType<typeof vi.fn>;
  fail: ReturnType<typeof vi.fn>;
} => ({ done: vi.fn(), fail: vi.fn() });

const setClipboardWrite = (write: ReturnType<typeof vi.fn> | undefined) => {
  Object.defineProperty(window, 'ClipboardItem', {
    value:
      write === undefined
        ? undefined
        : class {
            constructor(readonly items: unknown) {}
          },
    configurable: true,
  });
  Object.defineProperty(navigator, 'clipboard', {
    value: write === undefined ? undefined : { write },
    configurable: true,
  });
};

const stubDownloadSurface = () => {
  const clicks: string[] = [];
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:x'),
    configurable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: vi.fn(),
    configurable: true,
  });
  const spy = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    });
  return { clicks, spy };
};

describe('shareFileName', () => {
  // The one place exchange text reaches something other than textContent —
  // a download attribute a browser turns into a path. Whitelisted.
  it('whitelists the symbol into a path', () => {
    expect(shareFileName('M&M')).toBe('disclosed-MM.png');
    expect(shareFileName('TCS')).toBe('disclosed-TCS.png');
    expect(shareFileName('&/&')).toBe('disclosed-filing.png');
  });
});

describe('shareDeliver', () => {
  afterEach(() => {
    setClipboardWrite(undefined);
    vi.restoreAllMocks();
  });

  it('copies through a ClipboardItem built around a PROMISE and says so', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    setClipboardWrite(write);
    const r = report();

    shareDeliver(canvasWith(BLOB), 'TCS', r);
    await Promise.resolve();
    await Promise.resolve();

    // Safari ends the user gesture at the first await: the item must be
    // handed an unresolved promise, never an awaited blob.
    const item = write.mock.calls[0]?.[0]?.[0] as {
      items: { 'image/png': unknown };
    };
    expect(item.items['image/png']).toBeInstanceOf(Promise);
    expect(r.done).toHaveBeenCalledWith('Image copied', IMAGE_REVERT_MS);
  });

  it('falls back to a named download when the clipboard refuses', async () => {
    const write = vi.fn().mockRejectedValue(new Error('denied'));
    setClipboardWrite(write);
    const { clicks } = stubDownloadSurface();
    const r = report();

    shareDeliver(canvasWith(BLOB), 'TCS', r);
    await Promise.resolve();
    await Promise.resolve();

    expect(clicks).toEqual(['disclosed-TCS.png']);
    expect(r.done).toHaveBeenCalledWith('Downloaded', IMAGE_REVERT_MS);
  });

  it('downloads directly when there is no ClipboardItem', () => {
    setClipboardWrite(undefined);
    const { clicks } = stubDownloadSurface();
    const r = report();

    shareDeliver(canvasWith(BLOB), 'ESAF', r);

    expect(clicks).toEqual(['disclosed-ESAF.png']);
    expect(r.done).toHaveBeenCalledWith('Downloaded', IMAGE_REVERT_MS);
  });

  it('reports a canvas that produced no image', () => {
    setClipboardWrite(undefined);
    stubDownloadSurface();
    const r = report();

    shareDeliver(canvasWith(null), 'TCS', r);

    expect(r.fail).toHaveBeenCalledWith('image failed', IMAGE_REVERT_MS);
    expect(r.done).not.toHaveBeenCalled();
  });
});
