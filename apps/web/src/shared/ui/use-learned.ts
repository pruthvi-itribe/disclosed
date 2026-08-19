import { useCallback, useState } from 'react';

/**
 * A teaching aid that goes away once it has taught.
 *
 * A legend is furniture the moment a reader knows the marks — asked
 * directly on 2026-08-19: "is it needed always? how long should it be
 * there?" The honest answer is "until you have read it", which only the
 * reader can say, so this is a DISMISSAL they make and the browser
 * remembers, not a timer or a view count guessing on their behalf.
 *
 * No storage (private mode, a locked-down browser) means not learned:
 * the aid keeps showing, which is the degraded-but-correct end — the
 * opposite default would hide the key from a reader who never dismissed
 * it. Read once at mount; nothing else in the tree writes this key.
 */
export const useLearned = (
  key: string,
): { readonly learned: boolean; readonly learn: () => void } => {
  const [learned, setLearned] = useState(() => {
    try {
      return localStorage.getItem(key) === 'yes';
    } catch {
      return false;
    }
  });

  const learn = useCallback(() => {
    setLearned(true);
    try {
      localStorage.setItem(key, 'yes');
    } catch {
      // Dismissed for this session only, which is what a browser that
      // stores nothing can honour.
    }
  }, [key]);

  return { learned, learn };
};
