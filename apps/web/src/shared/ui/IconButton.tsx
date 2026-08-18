import type { MouseEventHandler } from 'react';
import { IconSvg } from './IconSvg';
import type { IconShape } from './icons';

/**
 * A control that is a drawing and the words that stand in for it.
 *
 * BOTH LABELS, AND THEY ARE ONE STRING. aria-label is the name a screen
 * reader reads; title is the name a pointer discovers by resting on it.
 * Dropping the visible word is what buys the one-line footer, and carrying
 * both is the price of dropping it — a drawing whose meaning is only in the
 * designer's head is not a control.
 */
export function IconButton({
  shapes,
  label,
  ui,
  onClick,
}: {
  readonly shapes: readonly IconShape[];
  readonly label: string;
  readonly ui: string;
  readonly onClick?: MouseEventHandler<HTMLButtonElement>;
}): JSX.Element {
  return (
    <button
      type="button"
      className="iconbtn"
      data-ui={ui}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <IconSvg shapes={shapes} />
    </button>
  );
}
