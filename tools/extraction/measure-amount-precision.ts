/**
 * Measures the monetary-amount extractor against a hand-labelled corpus.
 *
 * The claim this project makes about `extractMaterialAmount` is not "it finds
 * most amounts" — it is "it never emits a wrong one". That claim is worthless
 * asserted and only meaningful measured, so the corpus (60 real NSE filings,
 * text extracted from the PDFs NSE served) and the ground-truth labels (read
 * and recorded by hand, one document at a time) are both committed next to the
 * code, and this script recomputes the numbers from them.
 *
 * Run:  npm run amount:measure
 * Exit: non-zero if precision is below 100%, or if a label no longer matches
 *       the corpus it describes.
 *
 * The same measurement runs inside the test suite (amount-corpus.spec.ts) so a
 * precision regression fails the build. This script exists for the fuller
 * breakdown a human wants when deciding whether to loosen a rule.
 */
import { extractMaterialAmount } from '@app/filings';
import corpus from '../../libs/filings/src/logic/__fixtures__/amount-corpus.json';
import groundTruth from '../../libs/filings/src/logic/__fixtures__/amount-ground-truth.json';

type Verdict = 'amount' | 'none' | 'ambiguous' | 'band' | 'unreadable';

interface Label {
  readonly seqId: number;
  readonly symbol: string;
  readonly verdict: string;
  readonly rupees: number | null;
  readonly evidence: string | null;
  readonly note: string;
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

const labels = new Map<number, Label>(
  (groundTruth as readonly Label[]).map((label) => [label.seqId, label]),
);

interface Row {
  readonly symbol: string;
  readonly category: string;
  readonly verdict: Verdict;
  readonly truth: number | null;
  readonly emitted: number | null;
  readonly reason: string | null;
  readonly correct: boolean;
  readonly wrong: boolean;
}

const rows: Row[] = [];
const labelErrors: string[] = [];

for (const filing of corpus) {
  const label = labels.get(filing.seqId);
  if (label === undefined) {
    labelErrors.push(
      `${filing.symbol} (${filing.seqId}): no ground-truth label`,
    );
    continue;
  }
  // A label that no longer quotes text present in the document is a stale
  // label, and a stale label makes every number below meaningless.
  if (
    label.evidence !== null &&
    !squash(filing.text).includes(squash(label.evidence))
  ) {
    labelErrors.push(
      `${filing.symbol} (${filing.seqId}): evidence "${label.evidence}" is not in the document`,
    );
  }

  const result = extractMaterialAmount({
    documentText: filing.text,
    category: filing.category,
    summary: filing.summary,
  });
  const emitted = result.outcome === 'extracted' ? result.rupees : null;
  const correct =
    emitted !== null && label.verdict === 'amount' && emitted === label.rupees;
  rows.push({
    symbol: filing.symbol,
    category: filing.category,
    verdict: label.verdict as Verdict,
    truth: label.rupees,
    emitted,
    reason: result.outcome === 'refused' ? result.reason : null,
    correct,
    wrong: emitted !== null && !correct,
  });
}

const ORDER_WIN = new Set([
  'Bagging/Receiving of orders/contracts',
  'Awarding of order(s)/contract(s)',
]);

const report = (title: string, subset: readonly Row[]): void => {
  const emitted = subset.filter((row) => row.emitted !== null);
  const correct = subset.filter((row) => row.correct);
  const stated = subset.filter((row) => row.verdict === 'amount');
  const precision = emitted.length === 0 ? 1 : correct.length / emitted.length;
  console.log(`\n${title} (n=${subset.length})`);
  console.log(
    `  precision  ${correct.length}/${emitted.length} = ${(precision * 100).toFixed(1)}%`,
  );
  console.log(
    `  recall     ${correct.length}/${stated.length} = ${
      stated.length === 0
        ? 'n/a'
        : ((correct.length / stated.length) * 100).toFixed(1) + '%'
    }`,
  );
};

console.log('=== per filing ===');
for (const row of rows) {
  const mark = row.wrong ? 'WRONG' : row.correct ? 'ok   ' : '     ';
  console.log(
    [
      mark,
      row.symbol.padEnd(12),
      (row.verdict as string).padEnd(10),
      String(row.truth ?? '-').padEnd(13),
      String(row.emitted ?? '-').padEnd(13),
      row.reason ?? '',
    ].join(' '),
  );
}

report('ALL', rows);
report(
  'ORDER WINS',
  rows.filter((row) => ORDER_WIN.has(row.category)),
);

console.log('\n=== refusals by reason ===');
const byReason = new Map<string, number>();
for (const row of rows.filter((r) => r.reason !== null)) {
  byReason.set(
    row.reason as string,
    (byReason.get(row.reason as string) ?? 0) + 1,
  );
}
for (const [reason, count] of [...byReason].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${reason.padEnd(22)} ${count}`);
}

const wrong = rows.filter((row) => row.wrong);
console.log(`\n=== wrong emissions: ${wrong.length} ===`);
for (const row of wrong) {
  console.log(
    `  ${row.symbol}: emitted ${row.emitted}, truth ${row.truth ?? 'none'}`,
  );
}
for (const error of labelErrors) console.log(`LABEL ERROR ${error}`);

process.exitCode = wrong.length > 0 || labelErrors.length > 0 ? 1 : 0;
