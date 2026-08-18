import type { EnrichmentView } from '../types/api';

/** One headline line on a card: the text, and the movement mark's facts. */
export interface InsightLine {
  readonly text: string;
  readonly direction: string;
  readonly evidence: string;
}

/**
 * What a card leads with, ported from the old insightLines: the results line
 * first — a row of figures has no direction of its own and never will — then
 * every claim that is not an echo. Echoes are skipped AS HEADLINES ONLY: a
 * repeat is still real evidence for its own filing, so it stays in the
 * payload and in the focus view.
 */
export const insightLines = (e: EnrichmentView): readonly InsightLine[] => {
  const lines: InsightLine[] = [];
  if (e.resultsLine) {
    lines.push({ text: e.resultsLine, direction: '', evidence: '' });
  }
  for (const claim of e.claims) {
    if (claim.echo === true) continue;
    lines.push({
      text: claim.text,
      direction: claim.direction ?? '',
      evidence: claim.directionEvidence ?? '',
    });
  }
  return lines;
};
