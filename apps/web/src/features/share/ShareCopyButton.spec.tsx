import { act, fireEvent, render } from '@testing-library/react';
import { ShareCopyButton, COPY_REVERT_MS } from './ShareCopyButton';
import { shareText } from './share-text';
import type { FilingView } from '../../shared/types/api';

const filing = (): FilingView =>
  ({
    symbol: 'SKIPPER',
    companyName: 'Skipper Limited',
    category: 'Financial Results',
    disseminatedAtIstHuman: '9 Aug 2026, 9:15 am',
    enrichment: {
      amountDisplay: null,
      resultsLine: null,
      claims: [{ text: 'Revenue was 1,204 crore', echo: false }],
    },
  }) as unknown as FilingView;

const renderButton = () =>
  render(<ShareCopyButton filing={filing()} ui="card-copy" />);

const setClipboard = (writeText: ReturnType<typeof vi.fn> | undefined) => {
  Object.defineProperty(navigator, 'clipboard', {
    value: writeText === undefined ? undefined : { writeText },
    configurable: true,
  });
};

describe('ShareCopyButton', () => {
  afterEach(() => {
    setClipboard(undefined);
    vi.useRealTimers();
  });

  it('is a live region carrying both names', () => {
    const { container } = renderButton();
    const button = container.querySelector('[data-ui="card-copy"]');
    expect(button?.getAttribute('aria-live')).toBe('polite');
    expect(button?.getAttribute('aria-label')).toBe('Copy as text');
    expect(button?.getAttribute('title')).toBe('Copy as text');
  });

  it('copies the message, reports Copied, and reverts after 1500ms', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    const { container } = renderButton();
    const button = container.querySelector('[data-ui="card-copy"]') as Element;

    fireEvent.click(button);
    await act(async () => {
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith(shareText(filing()));
    // The visible report and the audible one come from one update.
    expect(button.querySelector('.iconsaid')?.textContent).toBe('Copied');
    expect(button.querySelector('polyline')).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(COPY_REVERT_MS);
    });
    expect(button.querySelector('.iconsaid')?.textContent).toBe('');
  });

  // The cross is permanent: a control that failed must not quietly become a
  // copy button again as if nothing happened.
  it('reports a refused write with a cross that never reverts', async () => {
    vi.useFakeTimers();
    setClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    const { container } = renderButton();
    const button = container.querySelector('[data-ui="card-copy"]') as Element;

    fireEvent.click(button);
    await act(async () => {
      await Promise.resolve();
    });
    expect(button.querySelector('.iconsaid')?.textContent).toBe('failed');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(button.querySelector('.iconsaid')?.textContent).toBe('failed');
  });

  // navigator.clipboard is absent on an insecure origin; the page says so
  // rather than throwing.
  it('says no clipboard when there is none', () => {
    setClipboard(undefined);
    const { container } = renderButton();
    const button = container.querySelector('[data-ui="card-copy"]') as Element;
    fireEvent.click(button);
    expect(button.querySelector('.iconsaid')?.textContent).toBe('no clipboard');
  });

  it('does not open the card behind it', async () => {
    setClipboard(vi.fn().mockResolvedValue(undefined));
    const opened = vi.fn();
    const { container } = render(
      <div onClick={opened}>
        <ShareCopyButton filing={filing()} ui="card-copy" />
      </div>,
    );
    fireEvent.click(
      container.querySelector('[data-ui="card-copy"]') as Element,
    );
    expect(opened).not.toHaveBeenCalled();
  });
});
