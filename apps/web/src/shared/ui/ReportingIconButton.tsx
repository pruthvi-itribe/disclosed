import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { IconSvg } from './IconSvg';
import { ICON_DONE, ICON_FAIL, type IconShape } from './icons';

export interface IconReport {
  /** Success: the check mark and its word, reverting to idle after ms. */
  readonly done: (word: string, revertAfterMs: number) => void;
  /** Failure: the cross and its word. No revert unless asked — the text
   * copy's cross is permanent, the image outcomes all revert. */
  readonly fail: (word: string, revertAfterMs?: number) => void;
}

/**
 * An IconButton that is its own aria-live region and reports through one
 * call: the drawing swaps and a visually clipped `.iconsaid` word lands in
 * the same update, so the visible report and the audible one cannot
 * disagree. Timers are cleared on unmount — the feed repaints every four
 * seconds, and the old page's leaked timeouts are a warning-and-dead-write
 * in React. Clicks stop propagation: every mount site sits inside an
 * openable card.
 */
export function ReportingIconButton({
  shapes,
  label,
  ui,
  onActivate,
}: {
  readonly shapes: readonly IconShape[];
  readonly label: string;
  readonly ui: string;
  readonly onActivate: (report: IconReport) => void;
}): JSX.Element {
  const [showing, setShowing] = useState<{
    readonly shapes: readonly IconShape[];
    readonly word: string;
  }>({ shapes, word: '' });
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const report: IconReport = {
    done: (word, revertAfterMs) => {
      setShowing({ shapes: ICON_DONE, word });
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        setShowing({ shapes, word: '' });
      }, revertAfterMs);
    },
    fail: (word, revertAfterMs) => {
      setShowing({ shapes: ICON_FAIL, word });
      if (revertAfterMs === undefined) return;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        setShowing({ shapes, word: '' });
      }, revertAfterMs);
    },
  };

  return (
    <button
      type="button"
      className="iconbtn"
      data-ui={ui}
      aria-label={label}
      title={label}
      aria-live="polite"
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onActivate(report);
      }}
    >
      <IconSvg shapes={showing.shapes} />
      <span className="iconsaid">{showing.word}</span>
    </button>
  );
}
