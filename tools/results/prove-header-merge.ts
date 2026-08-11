/**
 * Runs the results lane over documents already on disk and prints, per filing,
 * WHICH row the extractor quoted as the column header and what the gate then
 * did with it.
 *
 * WHY THIS EXISTS. `measure-header-tiers.ts` counts the SHAPE — how many
 * statements print their dates one row below a date-free grouping tier. That is
 * a fact about documents and not about refusals: nothing stores the
 * `columnsSpan` of a filing the gate refused, so whether the extractor actually
 * quoted the tier row is not answerable from the collection. This asks the
 * extractor and prints its answer.
 *
 * It answers the question WITHOUT shipping the merge, and the "before" needs no
 * second run: a quoted header stating fewer than two dates is exactly what
 * `verifyResults` refuses as `period-not-derivable`, so the count of dates in
 * the quoted row IS the outcome. `tierBelowSuppliesDates` below is the proposed
 * merge as a predicate, in its most generous reading.
 *
 * It reads documents from a directory `measure-header-tiers.ts --dump` wrote, so
 * it makes NO Docling requests. It DOES call a model once per filing, about
 * $0.002 each, and writes NOTHING to the collection.
 *
 * Usage:
 *   npm run merge:prove -- --from-dir DIR [--refusal period-not-derivable]
 */
import 'dotenv/config';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import mongoose from 'mongoose';
import {
  basisReachFor,
  columnDatesIn,
  composeResultsLine,
  FilingSchema,
  findVerbatimSpan,
  scaleReachFor,
  valueTokensIn,
  verifyResults,
  type FilingDocument,
  type SpanMatch,
} from '@app/filings';
import { buildResultsExtractor } from '../../apps/ingest/src/enrichment/claim-extractor.factory';
import { loadConfig } from '../../apps/ingest/src/config/configuration';

const argValue = (name: string): string | null => {
  const at = process.argv.indexOf(name);
  return at < 0 || at + 1 >= process.argv.length ? null : process.argv[at + 1];
};

const oneLine = (value: string): string =>
  value.replace(/\s+/g, ' ').trim().slice(0, 130);

const MARKDOWN_ROW = /^\s*\|.*\|\s*$/;
const SEPARATOR_ROW = /^\s*\|[\s|:-]+\|\s*$/;
const cellCount = (row: string): number => row.split('|').slice(1, -1).length;

/**
 * Whether the rows under the quoted one would supply the dates it lacks — the
 * tier merge issue 50 proposed, evaluated WITHOUT building it.
 *
 * Deliberately the most generous reading of that proposal: any of the next two
 * non-separator rows of the same width, carrying no figures, that states two or
 * more dates counts as a merge that would have fired. A tool that measured a
 * narrower rule than the one under discussion would understate the case for it.
 */
function tierBelowSuppliesDates(
  documentText: string,
  quoted: SpanMatch,
): boolean {
  if (columnDatesIn(quoted.evidence).length !== 0) return false;
  const lineStart = documentText.lastIndexOf('\n', quoted.offset - 1) + 1;
  let end = documentText.indexOf('\n', quoted.offset);
  if (end === -1) return false;
  const head = documentText.slice(lineStart, end);
  if (!MARKDOWN_ROW.test(head) || SEPARATOR_ROW.test(head)) return false;
  const cells = cellCount(head);

  let walked = 0;
  while (walked < 2 && end < documentText.length) {
    const start = end + 1;
    end = documentText.indexOf('\n', start);
    if (end === -1) end = documentText.length;
    const row = documentText.slice(start, end);
    if (SEPARATOR_ROW.test(row)) continue;
    if (!MARKDOWN_ROW.test(row)) return false;
    if (cellCount(row) !== cells) return false;
    if (valueTokensIn(row).length !== 0) return false;
    if (columnDatesIn(row).length >= 2) return true;
    walked += 1;
  }
  return false;
}

const main = async (): Promise<void> => {
  const fromDir = argValue('--from-dir');
  if (fromDir === null) {
    process.stderr.write('usage: prove-header-merge --from-dir DIR\n');
    process.exitCode = 1;
    return;
  }
  const refusal = argValue('--refusal');

  const config = loadConfig();
  const extractor = buildResultsExtractor(config);
  if (extractor === null) {
    process.stderr.write('no results extractor is configured\n');
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(config.mongoUri);
  const model = mongoose.model<FilingDocument>('Filing', FilingSchema);
  const cached = readdirSync(fromDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => Number(name.replace('.md', '')));

  const filings = await model
    .find(
      refusal === null
        ? { seqId: { $in: cached } }
        : {
            seqId: { $in: cached },
            'enrichment.resultsRefusalReason': refusal,
          },
      { _id: 0, seqId: 1, symbol: 1, category: 1, summary: 1, enrichment: 1 },
    )
    .sort({ seqId: 1 })
    .lean()
    .exec();

  let quotedTier = 0;
  let mergeFired = 0;
  let published = 0;
  const resolved: string[] = [];

  for (const filing of filings) {
    const documentText = readFileSync(
      join(fromDir, `${filing.seqId}.md`),
      'utf8',
    );
    const extraction = await extractor.extractResults({
      symbol: filing.symbol,
      category: filing.category,
      summary: filing.summary,
      documentText,
    });
    const stored = filing.enrichment?.resultsRefusalReason ?? 'published';
    const head = `${filing.seqId} ${filing.symbol.padEnd(12)} was=${stored.padEnd(22)}`;

    if (extraction.outcome === 'failed') {
      process.stdout.write(`${head} extractor failed: ${extraction.message}\n`);
      continue;
    }
    if (extraction.results === null) {
      process.stdout.write(`${head} the model found no results table\n`);
      continue;
    }

    const quoted = findVerbatimSpan(
      documentText,
      extraction.results.columnsSpan,
    );
    const quotedDates =
      quoted === null ? -1 : columnDatesIn(quoted.evidence).length;
    const merged =
      quoted !== null && tierBelowSuppliesDates(documentText, quoted);
    if (quotedDates === 0) quotedTier += 1;
    if (merged) mergeFired += 1;

    const verified = verifyResults({
      documentText,
      proposed: extraction.results,
      basisReach: basisReachFor('docling-layout'),
      scaleReach: scaleReachFor('docling-layout'),
    });
    const now =
      verified.outcome === 'refused'
        ? `REFUSED ${verified.reason}`
        : `PUBLISHED ${composeResultsLine(filing.symbol, verified.results)}`;
    if (verified.outcome === 'ok') published += 1;
    // A merge is credited only where it would have CHANGED the answer: the
    // quoted row alone states no date, which is the refusal, and the rows under
    // it state the columns.
    if (merged) resolved.push(`${filing.seqId} ${filing.symbol}`);

    process.stdout.write(
      `${head} quotedDates=${quotedDates} tierBelow=${merged ? 'YES' : 'no '} ${now}\n` +
        `    quoted: ${oneLine(extraction.results.columnsSpan)}\n`,
    );
  }

  process.stdout.write(
    `\n================ PROVE ================\n` +
      `filings=${filings.length} quotedADateFreeRow=${quotedTier} ` +
      `tierBelowWouldSupplyDates=${mergeFired} published=${published}\n` +
      `a tier merge would have changed (${resolved.length}):\n` +
      `${resolved.join('\n')}\n`,
  );

  await mongoose.disconnect();
};

void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
