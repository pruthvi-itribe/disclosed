/**
 * What this pipeline emits for a results filing, beside what a competitor did.
 *
 * THE ACCEPTANCE TEST FOR THE RESULTS LANE, runnable against the live exchange.
 * On 2026-08-06 a competitor published three lines for APOLLOTYRE seqId
 * 106729105, a filing this pipeline held in full and published nothing for. This
 * tool fetches that document — and any other filing named on the command line,
 * or a sample drawn from the live collection — parses it with the same code the
 * worker runs, asks the configured model for its results table, puts the answer
 * through the real gate, and prints both the line and every refusal.
 *
 * IT MAKES REAL MODEL CALLS. There is no offline mode, deliberately: the
 * deterministic half of this lane is covered by `.spec.ts` files that never
 * touch a network, and the only thing this tool can add is what a model actually
 * proposes on a real statement.
 *
 * Run:
 *   npm run results:verify                       # APOLLOTYRE, the acceptance case
 *   npm run results:verify -- --seq 106729105 --seq 106728252
 *   npm run results:verify -- --sample 8         # from the live collection
 */
// FIRST, before anything reads `process.env`. This is a CLI rather than the
// service, and the service gets its environment from its supervisor.
import 'dotenv/config';
import mongoose from 'mongoose';
import {
  AttachmentFetcher,
  composeResultsLine,
  decideAttachment,
  extractPdfText,
  FilingSchema,
  resultsEligibility,
  verifyResults,
  type FilingDocument,
  type ResultsExtractor,
} from '@app/filings';
import { buildResultsExtractor } from '../../apps/ingest/src/enrichment/claim-extractor.factory';
import { loadConfig } from '../../apps/ingest/src/config/configuration';

/** The acceptance case, and exactly what the competitor published for it. */
const ACCEPTANCE_SEQ = 106_729_105;
const PUBLISHED: readonly string[] = [
  'APOLLO TYRES: Q1 CONS NET PROFIT 3.49B RUPEES VS 129M (YOY)',
  'APOLLO TYRES: Q1 REVENUE 74B RUPEES VS 65.61B (YOY)',
  'APOLLO TYRES: Q1 EBITDA 8.68B RUPEES VS 8.68B (YOY) || Q1 EBITDA MARGIN 11.73% VS 13.32% (YOY)',
];

interface Row {
  readonly seqId: number;
  readonly symbol: string;
  readonly category: string;
  readonly summary: string;
  readonly attachmentUrl: string | null;
}

const readAll = (name: string): readonly string[] => {
  const values: string[] = [];
  process.argv.forEach((argument, index) => {
    if (argument === `--${name}`) values.push(process.argv[index + 1] ?? '');
  });
  return values;
};

const readNumber = (name: string, fallback: number): number => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--${name} must be a whole number >= 1`);
  }
  return value;
};

/**
 * The filings to look at.
 *
 * Named seqIds win; then a sample of results-bearing categories newest first;
 * then the one acceptance case. The sample is drawn from the collection rather
 * than hard-coded so the run says something about today's filings rather than
 * about a fixture.
 */
async function chooseFilings(
  model: mongoose.Model<FilingDocument>,
): Promise<readonly Row[]> {
  const named = readAll('seq')
    .map(Number)
    .filter((value) => Number.isInteger(value) && value > 0);
  if (named.length > 0) {
    return model
      .find({ seqId: { $in: named } }, { _id: 0 })
      .lean<Row[]>()
      .exec();
  }

  const sample = readNumber('sample', 0);
  if (sample > 0) {
    return model
      .find(
        {
          category: {
            $in: [
              'Outcome of Board Meeting',
              'Integrated Filing- Financial',
              'Press Release',
              'Investor Presentation',
            ],
          },
          summary: /financial result|quarter ended/i,
        },
        { _id: 0 },
      )
      .sort({ disseminatedAt: -1 })
      .limit(sample)
      .lean<Row[]>()
      .exec();
  }

  return model.find({ seqId: ACCEPTANCE_SEQ }, { _id: 0 }).lean<Row[]>().exec();
}

/** Fetches and parses one attachment, or says why it could not. */
async function documentFor(
  fetcher: AttachmentFetcher,
  row: Row,
): Promise<string | null> {
  const decision = decideAttachment(row.attachmentUrl);
  if (decision.outcome === 'skip') {
    console.log(`  ! no readable attachment (${decision.reason})`);
    return null;
  }
  const fetched = await fetcher.fetch(decision.url);
  if (fetched.outcome !== 'ok') {
    console.log(`  ! fetch ${fetched.outcome}`);
    return null;
  }
  const parsed = await extractPdfText(fetched.body);
  if (parsed.outcome !== 'ok') {
    console.log(`  ! parse failed: ${parsed.message}`);
    return null;
  }
  return parsed.text;
}

async function runOne(
  extractor: ResultsExtractor,
  fetcher: AttachmentFetcher,
  row: Row,
): Promise<{ readonly line: string | null; readonly refusal: string | null }> {
  console.log('');
  console.log('='.repeat(78));
  console.log(`${row.symbol}  seqId ${row.seqId}  ${row.category}`);
  console.log(`  ${row.summary.slice(0, 140)}`);

  const text = await documentFor(fetcher, row);
  if (text === null) return { line: null, refusal: 'no-document' };
  console.log(`  ${text.length} characters`);

  const eligible = resultsEligibility(row, text);
  if (!eligible.eligible) {
    console.log(`  NOT ELIGIBLE: ${eligible.reason}`);
    return { line: null, refusal: 'not-eligible' };
  }

  const extraction = await extractor.extractResults({
    symbol: row.symbol,
    category: row.category,
    summary: row.summary,
    documentText: text,
  });
  if (extraction.outcome === 'failed') {
    console.log(`  EXTRACTOR FAILED: ${extraction.message}`);
    return { line: null, refusal: 'extractor-error' };
  }
  if (extraction.results === null) {
    console.log('  the model found no results statement');
    return { line: null, refusal: 'no-results' };
  }
  console.log(
    `  proposed: ${extraction.results.basis}, ` +
      `${extraction.results.figures.length} figure(s), ` +
      `columns "${extraction.results.columnsSpan.replace(/\s+/g, ' ').trim().slice(0, 60)}"`,
  );

  const verdict = verifyResults({
    documentText: text,
    proposed: extraction.results,
  });
  for (const dropped of verdict.discards) {
    console.log(
      `  DISCARD ${dropped.reason} (${dropped.metric}): ${dropped.detail}`,
    );
  }
  if (verdict.outcome === 'refused') {
    console.log(`  REFUSED ${verdict.reason}: ${verdict.detail}`);
    return { line: null, refusal: verdict.reason };
  }

  console.log(`  basis evidence : "${verdict.results.basisSpan}"`);
  console.log(`  column evidence: "${verdict.results.columnsSpan}"`);
  for (const figure of verdict.results.figures) {
    console.log(
      `  ${figure.metric.padEnd(14)} ${figure.current} vs ${figure.prior} ` +
        `[${figure.unit || '₹/share'}]  <- "${figure.span.replace(/\s+/g, ' ').trim().slice(0, 90)}"`,
    );
  }

  const line = composeResultsLine(row.symbol, verdict.results);
  console.log('');
  console.log(`  TURRET: ${line}`);
  if (row.seqId === ACCEPTANCE_SEQ) {
    console.log('');
    console.log('  what the competitor published:');
    for (const published of PUBLISHED) console.log(`    ${published}`);
  }
  return { line, refusal: null };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const extractor = buildResultsExtractor({
    claimsEnabled: config.claimsEnabled,
    claimProvider: config.claimProvider,
    anthropicApiKey: config.anthropicApiKey,
    openrouterApiKey: config.openrouterApiKey,
    claimModel: config.claimModel,
    claimEffort: config.claimEffort,
    claimMaxDocumentChars: config.claimMaxDocumentChars,
    resultsEnabled: config.resultsEnabled,
  });
  // Refuses rather than falling back to something offline: a run that quietly
  // stopped calling a model would print the same shape and prove nothing.
  if (extractor === null) {
    throw new Error(
      'no results extractor is configured; set RESULTS_ENABLED and a provider key',
    );
  }
  console.log(
    `model ${config.claimModel} (${config.claimProvider}, ${config.claimEffort})`,
  );

  await mongoose.connect(config.mongoUri);
  try {
    const model = mongoose.model<FilingDocument>('Filing', FilingSchema);
    const rows = await chooseFilings(model);
    if (rows.length === 0) throw new Error('no filings matched');

    const fetcher = new AttachmentFetcher(config.enrichmentMaxBytes);
    const refusals = new Map<string, number>();
    let lines = 0;
    for (const row of rows) {
      const { line, refusal } = await runOne(extractor, fetcher, row);
      if (line !== null) lines += 1;
      if (refusal !== null) {
        refusals.set(refusal, (refusals.get(refusal) ?? 0) + 1);
      }
      // The same politeness the worker uses; the archive host has never been
      // asked to tolerate a fast sweep.
      await new Promise((resolve) =>
        setTimeout(resolve, config.enrichmentRequestDelayMs),
      );
    }

    console.log('');
    console.log('='.repeat(78));
    console.log(`${lines} of ${rows.length} filing(s) produced a results line`);
    for (const [reason, count] of [...refusals].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(3)}  ${reason}`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
