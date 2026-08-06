/**
 * Runs real filings through the real router and prints which parser read each.
 *
 * WHY THIS EXISTS. Three routing rules were argued from a measurement spike, and
 * a rule that is only argued is a rule nobody has watched fire. This fetches
 * named filings from the exchange, runs them through `extractPdfText` and then
 * `readWithRouting` — the same two calls the enrichment worker makes, in the
 * same order — and prints the decision, the reason, and what changed.
 *
 * It writes NOTHING. No database, no enrichment record, no alert. It is a
 * demonstration, so it can be pointed at any seqId without consequences.
 *
 * Run:  npm run routing:prove -- 106729105 106729415 106726156
 *       DOCLING_URL= npm run routing:prove -- 106729105     # the fallback path
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import {
  AttachmentFetcher,
  decideAttachment,
  extractPdfText,
  FilingSchema,
  hasUsableTextLayer,
  looksLikeResultsStatement,
  readWithRouting,
  type FilingDocument,
} from '@app/filings';
import { buildDoclingConverter } from '../../apps/ingest/src/enrichment/docling.factory';
import { loadConfig } from '../../apps/ingest/src/config/configuration';

const main = async (): Promise<void> => {
  const seqIds = process.argv
    .slice(2)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value));

  if (seqIds.length === 0) {
    process.stderr.write('usage: prove-routing <seqId> [more seqIds...]\n');
    process.exitCode = 1;
    return;
  }

  const config = loadConfig();
  const converter = buildDoclingConverter(config);
  process.stdout.write(
    `DOCLING_URL=${config.doclingUrl.trim() === '' ? '(unset)' : config.doclingUrl} ` +
      `converter=${converter === null ? 'null' : 'wired'}\n\n`,
  );

  await mongoose.connect(config.mongoUri);
  const model = mongoose.model<FilingDocument>('Filing', FilingSchema);
  const fetcher = new AttachmentFetcher(config.enrichmentMaxBytes);

  for (const seqId of seqIds) {
    const filing = await model
      .findOne(
        { seqId },
        { _id: 0, seqId: 1, symbol: 1, category: 1, attachmentUrl: 1 },
      )
      .lean()
      .exec();

    if (filing === null) {
      process.stdout.write(`${seqId}: not in the collection\n\n`);
      continue;
    }

    const decision = decideAttachment(filing.attachmentUrl ?? null);
    if (decision.outcome === 'skip') {
      process.stdout.write(`${seqId} ${filing.symbol}: ${decision.reason}\n\n`);
      continue;
    }

    const fetched = await fetcher.fetch(decision.url);
    if (fetched.outcome !== 'ok') {
      process.stdout.write(
        `${seqId} ${filing.symbol}: fetch ${fetched.outcome}\n\n`,
      );
      continue;
    }

    const cheapStarted = Date.now();
    const parsed = await extractPdfText(fetched.body);
    const cheapMs = Date.now() - cheapStarted;
    if (parsed.outcome !== 'ok') {
      process.stdout.write(
        `${seqId} ${filing.symbol}: unreadable — ${parsed.message}\n\n`,
      );
      continue;
    }

    const routedStarted = Date.now();
    const routed = await readWithRouting({
      category: filing.category,
      data: fetched.body,
      fileName: `${seqId}.pdf`,
      text: parsed.text,
      pages: parsed.pages,
      converter,
    });
    const routedMs = Date.now() - routedStarted;

    process.stdout.write(
      `=== ${seqId} ${filing.symbol} — ${filing.category} ===\n` +
        `  pages                ${parsed.pages}\n` +
        `  pdf-parse            ${parsed.text.length} chars in ${cheapMs}ms\n` +
        `  has text layer       ${hasUsableTextLayer(parsed.text)}\n` +
        `  results statement    ${looksLikeResultsStatement(parsed.text)}\n` +
        `  ROUTE                ${routed.route}\n` +
        `  reason               ${routed.routeReason}\n` +
        `  fallback             ${routed.fallbackReason ?? '(none)'}\n` +
        `  final text           ${routed.text.length} chars ` +
        `(routing took ${routedMs}ms)\n\n`,
    );
  }

  await mongoose.disconnect();
};

void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
