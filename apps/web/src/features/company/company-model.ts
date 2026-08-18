import type {
  ClaimView,
  FilingView,
  ResultsView,
} from '../../shared/types/api';
import { groupInt } from '../../shared/format/group-int';

/**
 * The company page's five sections as pure functions of the one payload —
 * ported rule for rule from script-company.ts, measurements included. Every
 * lookup keyed on document text uses a Map, because 'constructor' is a key
 * on every plain object's prototype.
 */

export interface FigureBlock {
  readonly results: ResultsView;
  readonly figures: ResultsView['figures'];
  readonly istDay: string;
  readonly disseminatedAtIst: string;
}

/** The published figures, deduped on CONTENT rather than quarter. */
export const figureBlocks = (
  items: readonly FilingView[],
): readonly FigureBlock[] => {
  const seen = new Set<string>();
  const blocks: FigureBlock[] = [];
  for (const filing of items) {
    const results = filing.enrichment.results;
    if (!results || results.figures.length === 0) continue;
    // Every published token, in order, so two blocks collapse only when a
    // reader would see the same characters twice — a press release repeating
    // the table collapses, a RESTATEMENT (same quarter, new numbers) draws
    // two blocks. VIJAYA is the live case: one filing prints EPS, the other
    // does not.
    let signature = `${results.period}|${results.basis}`;
    for (const figure of results.figures) {
      signature += `|${figure.metric}:${figure.current}:${figure.prior}:${figure.unit}`;
    }
    if (seen.has(signature)) continue;
    seen.add(signature);
    blocks.push({
      results,
      figures: results.figures,
      istDay: filing.istDay,
      disseminatedAtIst: filing.disseminatedAtIst,
    });
  }
  return blocks;
};

export interface NextItem {
  readonly date: string;
  readonly what: string;
  readonly span: string;
  readonly filedOn: string;
  readonly filedAt: string;
}

/**
 * What the company has dated ahead of it. Selected on claim.commitments and
 * NOTHING else — the server decides "still ahead" because IST rolls at 18:30
 * UTC and a browser deciding locally would show yesterday's record date as
 * upcoming all evening. One entry per date and word (HGS filed one AGM date
 * in four documents in a week); soonest first, word as tie-break so a
 * repaint cannot reorder two appointments on one day.
 */
export const nextItems = (
  items: readonly FilingView[],
): readonly NextItem[] => {
  const seen = new Set<string>();
  const found: NextItem[] = [];
  for (const filing of items) {
    for (const claim of filing.enrichment.claims) {
      for (const one of claim.commitments ?? []) {
        const key = `${one.date}|${one.evidence.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({
          date: one.date,
          what: one.evidence,
          span: claim.span,
          filedOn: filing.istDay,
          filedAt: filing.disseminatedAtIst,
        });
      }
    }
  }
  return [...found].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.what < b.what ? -1 : 1;
  });
};

export interface MarkDay {
  readonly day: string;
  readonly claims: readonly ClaimView[];
}

const MARKABLE = new Set(['expansion', 'contraction', 'mixed']);

/**
 * One row per IST DAY, not per filing: SONATSOFTW filed five marked
 * documents on 2026-08-06 and the per-filing version drew five rows that
 * read as five days. Oldest first — the response arrives newest first, so
 * the walk runs backwards. Nothing is counted: "four increases and one
 * decrease" is a verdict, and 13 of the 45 printed decreases are falling
 * bad loans, debt, borrowing costs or emissions.
 */
export const markDays = (items: readonly FilingView[]): readonly MarkDay[] => {
  const order: string[] = [];
  const byDay = new Map<string, ClaimView[]>();
  for (let i = items.length - 1; i >= 0; i--) {
    const filing = items[i] as FilingView;
    for (const claim of filing.enrichment.claims) {
      if (claim.direction === null || !MARKABLE.has(claim.direction)) continue;
      let day = byDay.get(filing.istDay);
      if (day === undefined) {
        day = [];
        byDay.set(filing.istDay, day);
        order.push(filing.istDay);
      }
      day.push(claim);
    }
  }
  return order.map((day) => ({ day, claims: byDay.get(day) ?? [] }));
};

/**
 * Claims below which the topic mix is not drawn — the ONLY floor on the
 * page, and it is on CLAIMS, not filings: CAPACITE has 23 claims across 2
 * filings and a filing floor would suppress it. Measured over the 547
 * companies with at least one claim: floor 1 draws 547 (64% multi-topic),
 * 2→466/75%, 3→368/84%, 4→257/90%, 5→222/92% — four is where the curve
 * flattens, 3→4 buys six points and 4→5 buys two.
 */
export const MIN_TOPIC_CLAIMS = 4;

export interface TopicSegment {
  readonly topic: string;
  readonly count: number;
}

/**
 * Claims counted by topic, null under 'other' so the segments sum to the
 * claim count the rest of the page shows — deliberately opposite to the
 * Brief's per-card pill, which has no sum to keep. Count desc, name asc so
 * a repaint cannot reorder equal segments.
 */
export const topicMix = (
  items: readonly FilingView[],
): readonly TopicSegment[] | null => {
  const counts = new Map<string, number>();
  let total = 0;
  for (const filing of items) {
    for (const claim of filing.enrichment.claims) {
      const topic = claim.topic ?? 'other';
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
      total += 1;
    }
  }
  if (total < MIN_TOPIC_CLAIMS) return null;
  return [...counts.entries()]
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : 1))
    .map(([topic, count]) => ({ topic, count }));
};

export interface PlanItem {
  readonly quote: string;
  readonly evidence: string;
  readonly filedOn: string;
  readonly filedAt: string;
}

/**
 * The company's own forward-looking sentences. Selected on planEvidence and
 * NOTHING else (claim-plan.ts owns the rule — the kind alone is 22% right);
 * echoes skipped the way the feed's headlines skip them; the SPAN quoted,
 * never the claim text — the span is the document's bytes, the text is the
 * extractor's compression, and a section headed "in their words" may only
 * show the first. Newest first, uncapped (the busiest company held 7).
 */
export const planItems = (
  items: readonly FilingView[],
): readonly PlanItem[] => {
  const found: PlanItem[] = [];
  for (const filing of items) {
    for (const claim of filing.enrichment.claims) {
      if (!claim.planEvidence) continue;
      if (claim.echo === true) continue;
      found.push({
        quote: claim.span
          ? `"${String(claim.span).replace(/\s+/g, ' ').trim()}"`
          : 'No source sentence is stored for this line.',
        evidence: claim.planEvidence,
        filedOn: filing.istDay,
        filedAt: filing.disseminatedAtIst,
      });
    }
  }
  return found;
};

/**
 * The one remaining statement about the shape of OUR holdings, and the first
 * thing that tells a reader whether anything below it means anything.
 */
export const coverageLine = (
  items: readonly FilingView[],
  total: number,
): string => {
  const days = [...new Set(items.map((f) => f.istDay))].sort();
  if (days.length === 0) return '';
  return (
    `${groupInt(total)} filings held across ${days.length}` +
    (days.length === 1 ? ' IST day · ' : ' IST days · ') +
    `${days[0]} to ${days[days.length - 1]}`
  );
};
