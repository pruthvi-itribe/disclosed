import { useEffect, useRef, useState } from 'react';

/**
 * Same 1500ms every clipboard word on the old page reverts after —
 * ShareCopyButton carries its own copy of the constant, because no feature
 * imports a feature and 1.5s is the ported value, not a tunable.
 */
const COPY_REVERT_MS = 1500;

/**
 * The old briefCopy(), ported verbatim: what a reader sends to somebody is
 * the claims without our layout, every one prefixed with the symbol so a
 * pasted excerpt still says who said it. The button IS the report — 'Copied'
 * for 1500ms, 'no clipboard' on an insecure origin (a dashboard served over
 * plain http to a colleague must not throw), 'failed' on refusal, the last
 * two deliberately permanent the way the old page left them.
 */
export function BriefCopyButton({
  symbol,
  texts,
}: {
  readonly symbol: string;
  readonly texts: readonly string[];
}): JSX.Element {
  const [word, setWord] = useState('Copy');
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const onClick = (): void => {
    if (!navigator.clipboard) {
      setWord('no clipboard');
      return;
    }
    navigator.clipboard
      .writeText(`${symbol}: ${texts.join(`\n${symbol}: `)}`)
      .then(
        () => {
          setWord('Copied');
          timerRef.current = window.setTimeout(
            () => setWord('Copy'),
            COPY_REVERT_MS,
          );
        },
        () => setWord('failed'),
      );
  };

  return (
    <button type="button" className="copy" onClick={onClick}>
      {word}
    </button>
  );
}
