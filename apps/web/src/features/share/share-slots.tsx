import { useCallback } from 'react';
import { ShareCopyButton } from './ShareCopyButton';
import { ShareImageButton } from './ShareImageButton';
import type { FilingView } from '../../shared/types/api';

export type ShareSlot = (filing: FilingView) => JSX.Element;

/**
 * The share controls per surface — the ui names are the parity contract
 * (card-copy/card-copy-image on every grid, focus-copy/focus-copy-image in
 * the dialog). A hook so the two callbacks keep stable identities across
 * App renders.
 */
export const useShareSlots = (): {
  readonly onCard: ShareSlot;
  readonly onFocus: ShareSlot;
} => {
  const onCard = useCallback(
    (f: FilingView) => (
      <>
        <ShareCopyButton filing={f} ui="card-copy" />
        <ShareImageButton filing={f} ui="card-copy-image" />
      </>
    ),
    [],
  );
  const onFocus = useCallback(
    (f: FilingView) => (
      <>
        <ShareCopyButton filing={f} ui="focus-copy" />
        <ShareImageButton filing={f} ui="focus-copy-image" />
      </>
    ),
    [],
  );
  return { onCard, onFocus };
};
