import { useEffect } from 'react';

/**
 * ONE CLASS ON THE BODY, so exactly one view is ever in scroll-lock: the
 * deck is a scroll container sized to the window, and the page behind it
 * must not scroll too. Split from App at the line cap; the shell's door
 * writes the same property through main.tsx for the same reason.
 */
export const useBriefBodyClass = (view: string): void => {
  useEffect(() => {
    document.body.className = view === 'brief' ? 'briefing' : '';
    return () => {
      document.body.className = '';
    };
  }, [view]);
};
