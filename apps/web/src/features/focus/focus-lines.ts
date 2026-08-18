import type { EnrichmentView } from '../../shared/types/api';

export interface FocusLine {
  readonly text: string;
  readonly direction: string;
  readonly evidence: string;
  readonly span: string;
  readonly periodSpan: string;
}

/**
 * Every claim, echoes included, uncapped — deliberately NOT insightLines.
 * That one skips echoes because the feed is a scan; this is one filing,
 * opened on purpose, and "everything this filing said" cannot quietly omit
 * a sentence the document contains. It also carries the spans, which the
 * feed's version has no use for.
 */
export const focusLines = (e: EnrichmentView): readonly FocusLine[] =>
  e.claims.map((claim) => ({
    text: claim.text,
    direction: claim.direction ?? '',
    evidence: claim.directionEvidence ?? '',
    span: claim.span || '',
    periodSpan: claim.periodSpan ?? '',
  }));
