/**
 * Reads one filing's results table twice — once off each parser — and prints
 * what the gate does with each.
 *
 * WHY THIS EXISTS. The parsing half of the hybrid rests on one claim: that
 * Docling's reading order and the retuned basis reach turn a table the gate
 * REFUSES into one it PUBLISHES, on the same document, with the same extractor
 * and the same verifier. That is a claim about two runs, and the only honest
 * way to state it is to make both runs and print both answers.
 *
 * It calls a model twice — once per parser — so it costs about $0.002 a filing.
 * It writes NOTHING to the collection.
 *
 * Run:  npm run results:prove -- 106729105 106729415
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import {
  AttachmentFetcher,
  basisReachFor,
  composeResultsLine,
  decideAttachment,
  extractPdfText,
  FilingSchema,
  readWithRouting,
  resultsEligibility,
  verifyResults,
  type FilingDocument,
  type ParseRoute,
  type ResultsExtractor,
} from '@app/filings';
import { buildResultsExtractor } from '../../apps/ingest/src/enrichment/claim-extractor.factory';
import { buildDoclingConverter } from '../../apps/ingest/src/enrichment/docling.factory';
import { loadConfig } from '../../apps/ingest/src/config/configuration';

interface Attempt {
  readonly route: ParseRoute;
  readonly chars: number;
  readonly text: string;
}

/** One parser's text, put through the whole results lane. */
const runLane = async (
  extractor: ResultsExtractor,
  filing: {
    readonly symbol: string;
    readonly category: string;
    readonly summary: string;
  },
  attempt: Attempt,
): Promise<string> => {
  const eligibility = resultsEligibility(filing, attempt.text);
  if (!eligibility.eligible) {
    return `not eligible — ${eligibility.reason}`;
  }

  const extraction = await extractor.extractResults({
    symbol: filing.symbol,
    category: filing.category,
    summary: filing.summary,
    documentText: attempt.text,
  });
  if (extraction.outcome === 'failed') {
    return `extractor failed — ${extraction.message}`;
  }
  if (extraction.results === null) {
    return 'the model found no results table';
  }

  const verified = verifyResults({
    documentText: attempt.text,
    proposed: extraction.results,
    // THE WHOLE POINT OF THIS TOOL: the bound follows the parser that produced
    // the text. 400 for pdf-parse, 2,400 for Docling, both measured.
    basisReach: basisReachFor(attempt.route),
  });

  if (verified.outcome === 'refused') {
    return `REFUSED (${verified.reason}) — ${verified.detail}`;
  }
  return (
    `PUBLISHED  ${composeResultsLine(filing.symbol, verified.results)}\n` +
    `             basis=${verified.results.basis} ` +
    `period=${verified.results.period} vs ${verified.results.priorPeriod} ` +
    `figures=${verified.results.figures.length}`
  );
};

const main = async (): Promise<void> => {
  const seqIds = process.argv
    .slice(2)
    .map(Number)
    .filter((value) => Number.isInteger(value));
  if (seqIds.length === 0) {
    process.stderr.write('usage: prove-results-route <seqId>...\n');
    process.exitCode = 1;
    return;
  }

  const config = loadConfig();
  const extractor = buildResultsExtractor(config);
  if (extractor === null) {
    process.stderr.write('no results extractor is configured\n');
    process.exitCode = 1;
    return;
  }
  const converter = buildDoclingConverter(config);

  await mongoose.connect(config.mongoUri);
  const model = mongoose.model<FilingDocument>('Filing', FilingSchema);
  const fetcher = new AttachmentFetcher(config.enrichmentMaxBytes);

  for (const seqId of seqIds) {
    const filing = await model
      .findOne(
        { seqId },
        {
          _id: 0,
          seqId: 1,
          symbol: 1,
          category: 1,
          summary: 1,
          attachmentUrl: 1,
        },
      )
      .lean()
      .exec();
    if (filing === null) continue;

    const decision = decideAttachment(filing.attachmentUrl ?? null);
    if (decision.outcome === 'skip') continue;
    const fetched = await fetcher.fetch(decision.url);
    if (fetched.outcome !== 'ok') continue;
    const parsed = await extractPdfText(fetched.body);
    if (parsed.outcome !== 'ok') continue;

    const routed = await readWithRouting({
      category: filing.category,
      data: fetched.body,
      fileName: `${seqId}.pdf`,
      text: parsed.text,
      pages: parsed.pages,
      converter,
    });

    const cheap: Attempt = {
      route: 'pdf-parse',
      chars: parsed.text.length,
      text: parsed.text,
    };
    const routedAttempt: Attempt = {
      route: routed.route,
      chars: routed.text.length,
      text: routed.text,
    };

    process.stdout.write(
      `\n=== ${seqId} ${filing.symbol} — ${filing.category} ===\n` +
        `  exchange summary: ${filing.summary.slice(0, 120)}\n\n` +
        `  [pdf-parse, reach ${basisReachFor('pdf-parse')}] ` +
        `${cheap.chars} chars\n    ${await runLane(extractor, filing, cheap)}\n\n`,
    );

    if (routedAttempt.route === 'pdf-parse') {
      process.stdout.write(`  [routed] same parser — ${routed.routeReason}\n`);
      continue;
    }

    process.stdout.write(
      `  [${routedAttempt.route}, reach ${basisReachFor(routedAttempt.route)}] ` +
        `${routedAttempt.chars} chars\n    ` +
        `${await runLane(extractor, filing, routedAttempt)}\n`,
    );
  }

  await mongoose.disconnect();
};

void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
