import type { LiveKind } from '../../shared/api/use-poll';
import type { SummaryView } from '../../shared/types/api';

/**
 * Poll health and the IST time of the last refresh. The label vocabulary is
 * the old setLive()'s: connecting at boot, live on success, and "refresh
 * failed" for both stale and down — the dot's colour carries the difference.
 * generatedAtIst is printed as sent; the browser never formats a timestamp.
 */
export function LiveIndicator({
  live,
  generatedAtIst,
}: {
  readonly live: LiveKind;
  readonly generatedAtIst: SummaryView['generatedAtIst'] | null;
}): JSX.Element {
  const kind = live === 'connecting' ? '' : live;
  const label = live === 'stale' || live === 'down' ? 'refresh failed' : live;
  return (
    <div className="status">
      <span id="live-dot" className={`dot${kind ? ` ${kind}` : ''}`} />
      <span id="live-text">{label}</span>
      <span id="generated" className="muted mono">
        {generatedAtIst === null ? '' : `updated ${generatedAtIst} IST`}
      </span>
    </div>
  );
}
