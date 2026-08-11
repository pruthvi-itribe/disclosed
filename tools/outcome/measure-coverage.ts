/**
 * Measures what share of filings produce an outcome, before and after.
 *
 * WHY THIS EXISTS AS A TOOL. "71% of filings produce nothing at all" was the
 * claim that motivated the coverage work, and "every filing now produces an
 * outcome" is the claim that replaced it. Both are numbers, and a number nobody
 * can re-derive is an assertion. This re-derives them, from the live collection
 * and from the committed corpus, and prints the old gate's answer beside the new
 * one on the same population.
 *
 * THE OLD GATE IS REPRODUCED HERE ON PURPOSE. It was deleted from
 * `claim-eligibility.ts` — leaving a dead allowlist in the source is how the
 * next gap happens — but the before/after comparison needs it, so it lives here
 * as a historical reference with no caller in the pipeline. If it drifts from
 * what shipped it drifts in a measurement tool rather than in a gate.
 *
 * Run:  npm run coverage:measure
 *       npm run coverage:measure -- --corpus
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import mongoose from 'mongoose';
import {
  categoryGroupFor,
  composeOutcome,
  confidenceTierFor,
  claimEligibility,
  FilingSchema,
  isLegallyBlocked,
  isRoutine,
  MIN_CLAIM_DOCUMENT_CHARS,
  type CategoryGroup,
  type ConfidenceTier,
  type CoverageSkipReason,
  type FilingDocument,
} from '@app/filings';
import { loadConfig } from '../../apps/ingest/src/config/configuration';

/**
 * The 22-name allowlist as it stood before this work, verbatim.
 *
 * HISTORICAL. Nothing in the pipeline reads it. `Outcome of Board Meeting` was
 * added to it late, after the results gap was found, so this is the list as it
 * ended rather than as it began — which makes the before/after comparison
 * conservative: the real gap was wider than what this prints.
 */
const OLD_CLAIM_BEARING_CATEGORIES: ReadonlySet<string> = new Set([
  'investor presentation',
  'press release',
  'analysts/institutional investor meet/con. call updates',
  'monthly business updates',
  'business update',
  'updates on acquisition',
  'acquisition',
  'agreements',
  'arrangements for strategic, technical, manufacturing, or marketing tie up',
  'joint venture',
  'capacity addition',
  'commencement of commercial production/operations',
  'product launch',
  'new product launch',
  'awarding of order(s)/contract(s)',
  'bagging/receiving of orders/contracts',
  'amalgamation/merger',
  'credit rating',
  'credit rating- new',
  'credit rating- revision',
  'disclosure of material issue',
  'integrated filing- financial',
  'outcome of board meeting',
  'press release (revised)',
]);

/**
 * The old gate's fifth test, a vocabulary pattern over the document text, is
 * DELIBERATELY NOT REPRODUCED.
 *
 * It cannot be: the document text is not stored, only its character count. Two
 * substitutes were considered and both rejected. Running it against the exchange
 * summary tests one templated sentence where the real gate tested tens of
 * thousands of characters, which understates the old reach by an unknown and
 * large factor; re-fetching every document to run it honestly would spend
 * thousands of NSE requests to measure a gate that no longer exists.
 *
 * So the figure below is an UPPER BOUND on what the old gate read. The missing
 * test could only ever refuse more — it was measured refusing 100 of the 932
 * live filings the gate judged, 10.7% — so the real "produced nothing at all"
 * share is HIGHER than what this prints. The bound is stated in the honest
 * direction: it flatters the behaviour being replaced.
 */

interface Row {
  readonly symbol: string;
  readonly category: string;
  readonly summary: string;
  readonly documentChars: number | null;
  readonly hasClaims: boolean;
  readonly hasResults: boolean;
  readonly hasAmount: boolean;
}

/**
 * Whether the OLD gate would have read this filing — an upper bound.
 *
 * Four of its five tests, all evaluable from stored fields. See above for why
 * the fifth is left out and which direction that biases the answer.
 */
const oldGateWouldRead = (row: Row): boolean => {
  if (isRoutine(row.category)) return false;
  if (!OLD_CLAIM_BEARING_CATEGORIES.has(row.category.trim().toLowerCase())) {
    return false;
  }
  if (isLegallyBlocked(row)) return false;
  return (row.documentChars ?? 0) >= MIN_CLAIM_DOCUMENT_CHARS;
};

const pct = (part: number, whole: number): string =>
  whole === 0 ? '0.00%' : `${((part / whole) * 100).toFixed(2)}%`;

const bump = <T>(into: Map<T, number>, key: T): void => {
  into.set(key, (into.get(key) ?? 0) + 1);
};

/**
 * Per-document cost of one claim call at the configured provider.
 *
 * Measured rather than modelled: `gate-and-attachments-report.md` records
 * $0.00081 a document over 8 real filings at the 96,000-character cap on
 * `deepseek/deepseek-v4-flash-0731`. Stated here so the daily figure below is
 * traceable to a run rather than to a price list.
 */
const MEASURED_COST_PER_DOCUMENT = 0.00081;

function report(label: string, rows: readonly Row[]): void {
  const total = rows.length;
  const byGroup = new Map<CategoryGroup, number>();
  const byTier = new Map<ConfidenceTier, number>();
  let oldRead = 0;
  let newRead = 0;
  let stated = 0;
  let outcomes = 0;
  // BY REASON, not two counters with an `else`. When the triage gate added two
  // more skip codes an `else` would have filed both under "covering letter" and
  // reported a length test doing a category's work — which is exactly the
  // collapse this whole measurement exists to expose.
  const bySkip = new Map<CoverageSkipReason, number>();

  for (const row of rows) {
    const outcome = composeOutcome(row);
    if (outcome.text.length > 0) outcomes += 1;
    if (outcome.source === 'exchange-summary') stated += 1;
    bump(byGroup, categoryGroupFor(row.category));
    bump(
      byTier,
      confidenceTierFor({
        hasVerifiedClaim: row.hasClaims,
        hasVerifiedResults: row.hasResults,
        hasVerifiedAmount: row.hasAmount,
        outcomeSource: outcome.source,
      }),
    );

    if (oldGateWouldRead(row)) oldRead += 1;

    // The new gate needs the document's TEXT, which is not stored; three of its
    // four tests are reproduced from the stored character count, the legal block
    // and the category, none of which looks at the document's words. The fourth,
    // `shared-page`, cannot be reproduced — it counts company identities in the
    // text — so the skip total below is a LOWER bound and "read for insights" is
    // an upper one, in the same honest direction as the old gate's figure.
    const verdict = claimEligibility(row, 'x'.repeat(row.documentChars ?? 0));
    if (verdict.eligible) newRead += 1;
    else bump(bySkip, verdict.skip);
  }

  const skipLines = [...bySkip.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(
      ([skip, count]) =>
        `skipped: ${skip.padEnd(35)}${String(count).padStart(6)}  ${pct(count, total)}\n`,
    )
    .join('');

  process.stdout.write(
    `\n=== ${label}: ${total} filing(s) ===\n\n` +
      `--- an outcome, before and after ---\n` +
      `BEFORE  read by the old gate (UPPER BOUND)  ${String(oldRead).padStart(6)}  ${pct(oldRead, total)}\n` +
      `BEFORE  produced nothing at all (AT LEAST)  ${String(total - oldRead).padStart(6)}  ${pct(total - oldRead, total)}\n` +
      `AFTER   carry an outcome line               ${String(outcomes).padStart(6)}  ${pct(outcomes, total)}\n` +
      `AFTER   ...of which the exchange's words    ${String(stated).padStart(6)}  ${pct(stated, total)}\n` +
      `AFTER   ...of which the category alone      ${String(total - stated).padStart(6)}  ${pct(total - stated, total)}\n\n` +
      `--- who gets a model call ---\n` +
      `read for insights                           ${String(newRead).padStart(6)}  ${pct(newRead, total)}\n` +
      skipLines +
      `cost at $${MEASURED_COST_PER_DOCUMENT}/document                  ` +
      `$${(newRead * MEASURED_COST_PER_DOCUMENT).toFixed(2)}\n\n` +
      `--- confidence tier ---\n`,
  );
  for (const [tier, count] of [...byTier.entries()].sort(
    (left, right) => right[1] - left[1],
  )) {
    process.stdout.write(
      `${tier.padEnd(44)}${String(count).padStart(6)}  ${pct(count, total)}\n`,
    );
  }

  process.stdout.write('\n--- category group ---\n');
  for (const [group, count] of [...byGroup.entries()].sort(
    (left, right) => right[1] - left[1],
  )) {
    process.stdout.write(
      `${group.padEnd(44)}${String(count).padStart(6)}  ${pct(count, total)}\n`,
    );
  }
}

async function fromMongo(): Promise<void> {
  const config = loadConfig();
  await mongoose.connect(config.mongoUri);
  try {
    const model = mongoose.model<FilingDocument>('Filing', FilingSchema);
    const docs = await model
      .find({}, { _id: 0, symbol: 1, category: 1, summary: 1, enrichment: 1 })
      .lean()
      .exec();

    report(
      'live collection',
      docs.map((doc) => ({
        symbol: doc.symbol,
        category: doc.category,
        summary: doc.summary ?? '',
        documentChars: doc.enrichment?.documentChars ?? null,
        hasClaims: (doc.enrichment?.claims?.length ?? 0) > 0,
        hasResults: (doc.enrichment?.resultsLine ?? null) !== null,
        hasAmount: (doc.enrichment?.amountRupees ?? null) !== null,
      })),
    );
  } finally {
    await mongoose.disconnect();
  }
}

function fromCorpus(path: string): void {
  const rows = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, string>)
    .map((row) => ({
      symbol: row.symbol,
      category: row.category,
      summary: row.summary ?? '',
      // The corpus holds no parsed document, so the length test cannot run
      // against it. Reported as such rather than assumed away.
      documentChars: null,
      hasClaims: false,
      hasResults: false,
      hasAmount: false,
    }));
  report(`corpus ${path}`, rows);
}

const main = async (): Promise<void> => {
  const index = process.argv.indexOf('--corpus');
  if (index === -1) {
    await fromMongo();
    return;
  }
  fromCorpus(
    process.argv[index + 1] ?? 'data/corpus/05-07-2026_05-08-2026.jsonl',
  );
};

void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
