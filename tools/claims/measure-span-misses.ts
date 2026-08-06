/**
 * Measures WHY the verbatim gate refuses spans, on live documents.
 *
 * ================================================================
 * WHY THIS EXISTS
 * ================================================================
 *
 * `span-not-found` is the largest single claim discard in the live collection,
 * and until this tool ran, the reason it fired was a guess. Two guesses are
 * available and they demand opposite responses: the model is INVENTING, in which
 * case the gate is working exactly as designed and the count is the feature; or
 * the model is PARAPHRASING PUNCTUATION, in which case a true claim about a real
 * company is being thrown away because a typographic apostrophe met a straight
 * one.
 *
 * So this runs the real extractor against real documents, keeps every span it
 * proposes, and for the ones the gate refuses, walks a LADDER of increasingly
 * permissive comparisons to find the cheapest one that would have matched. The
 * rung a miss lands on IS its cause:
 *
 *   whitespace-only ... what shipped before: runs of whitespace collapsed
 *   typography ....... quotes, dashes, ligatures, invisible characters
 *   table-cells ...... markdown pipes read as separators
 *   line-break-hyphen  a hyphen a page break interrupted
 *   -------------------- everything above is what `span-canon.ts` repairs -----
 *   alnum-only ....... letters and digits alone, all punctuation discarded.
 *                      NOT a repair and never will be — it is the CEILING of
 *                      what any punctuation-class repair could ever recover, so
 *                      the gap between it and the rung above is the measure of
 *                      what this module still misses.
 *   case-fold ........ the same, ignoring case. Diagnostic only: case is
 *                      meaningful in a disclosure and is never folded.
 *   paraphrase ....... a region of the document shares most of the span's words
 *                      but not its characters. The model rewrote a real sentence.
 *   invention ........ no region of the document resembles it. The gate earned
 *                      its keep.
 *
 * It writes NOTHING to the database.
 *
 * Run:  npm run span:measure -- --sample 60
 *       npm run span:measure -- --sample 60 --stored   (re-check stored discards)
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import {
  ALL_REPAIRS,
  AttachmentFetcher,
  canonicalSpan,
  claimEligibility,
  decideAttachment,
  extractPdfText,
  FilingSchema,
  findVerbatimSpan,
  hasUsableTextLayer,
  NO_REPAIRS,
  readWithRouting,
  type CanonRepairs,
  type FilingDocument,
  type ProposedClaim,
} from '@app/filings';
import { buildClaimExtractor } from '../../apps/ingest/src/enrichment/claim-extractor.factory';
import { buildDoclingConverter } from '../../apps/ingest/src/enrichment/docling.factory';
import { loadConfig } from '../../apps/ingest/src/config/configuration';

const readArg = (name: string, fallback: number): number => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`--${name} must be a finite number >= 0`);
  }
  return value;
};

const pct = (part: number, whole: number): string =>
  whole === 0 ? '0.0%' : `${((part / whole) * 100).toFixed(1)}%`;

/** The ladder, in order. The first rung that matches is the cause. */
const RUNGS: readonly (readonly [string, CanonRepairs])[] = [
  ['whitespace-only', NO_REPAIRS],
  ['typography', { ...NO_REPAIRS, typography: true }],
  ['table-cells', { ...NO_REPAIRS, typography: true, tableCells: true }],
  ['line-break-hyphen', ALL_REPAIRS],
];

/** Letters and digits alone. The ceiling of any punctuation-class repair. */
const alnum = (value: string): string => value.replace(/[^0-9A-Za-z]+/g, '');

/** The same projection, with the map back, so a miss can be shown side by side. */
function alnumProjection(source: string): {
  readonly text: string;
  readonly origin: readonly number[];
} {
  const characters: string[] = [];
  const origin: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (/[0-9A-Za-z]/.test(source[index])) {
      characters.push(source[index]);
      origin.push(index);
    }
  }
  return { text: characters.join(''), origin };
}

/**
 * What the document actually says where the span nearly matched.
 *
 * The one output that turns "the repairs did not cover this" into a rule
 * somebody can write. Returns null when the span is not there on letters and
 * digits either, which is the invention case and has nothing to show.
 */
function documentTextAt(documentText: string, span: string): string | null {
  const haystack = alnumProjection(documentText);
  const needle = alnum(span);
  const at = haystack.text.indexOf(needle);
  if (at === -1) return null;
  const start = haystack.origin[at];
  const end = haystack.origin[at + needle.length - 1] + 1;
  return documentText.slice(start, end);
}

const words = (value: string): readonly string[] =>
  value
    .toLowerCase()
    .split(/[^0-9a-z]+/)
    .filter((word) => word.length > 2);

/**
 * The best word-overlap any window of the document achieves against the span.
 *
 * DIAGNOSTIC ONLY, and it must stay that way: this is a similarity score, and a
 * similarity score is exactly what the gate is not allowed to contain. It exists
 * to tell a rewritten real sentence from a fabricated one when reporting, so the
 * two are not counted together.
 */
function bestOverlap(documentText: string, span: string): number {
  const needle = words(span);
  if (needle.length === 0) return 0;
  const wanted = new Set(needle);
  const haystack = words(documentText);
  if (haystack.length < needle.length) {
    return haystack.filter((word) => wanted.has(word)).length / needle.length;
  }

  let hits = 0;
  for (let index = 0; index < needle.length; index += 1) {
    if (wanted.has(haystack[index])) hits += 1;
  }
  let best = hits;
  for (let index = needle.length; index < haystack.length; index += 1) {
    if (wanted.has(haystack[index])) hits += 1;
    if (wanted.has(haystack[index - needle.length])) hits -= 1;
    if (hits > best) best = hits;
  }
  return best / needle.length;
}

/** Where a proposed span sits on the ladder. */
function classify(documentText: string, span: string): string {
  for (const [name, repairs] of RUNGS) {
    if (findVerbatimSpan(documentText, span, repairs) !== null) return name;
  }
  if (alnum(documentText).includes(alnum(span))) return 'alnum-only';
  if (alnum(documentText).toLowerCase().includes(alnum(span).toLowerCase())) {
    return 'case-fold';
  }
  return bestOverlap(documentText, span) >= 0.75 ? 'paraphrase' : 'invention';
}

interface Row {
  readonly seqId: number;
  readonly symbol: string;
  readonly category: string;
  readonly summary: string;
  readonly attachmentUrl: string | null;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const sampleSize = readArg('sample', 60);
  const delayMs = readArg('delay', config.enrichmentRequestDelayMs);

  await mongoose.connect(config.mongoUri);
  const model = mongoose.model<FilingDocument>('Filing', FilingSchema);

  const rows = (await model
    .find(
      {
        attachmentUrl: { $nin: [null, '', '-'] },
        'enrichment.documentChars': { $gte: 1500 },
      },
      {
        _id: 0,
        seqId: 1,
        symbol: 1,
        category: 1,
        summary: 1,
        attachmentUrl: 1,
      },
    )
    .sort({ disseminatedAt: -1 })
    .limit(sampleSize)
    .lean()
    .exec()) as unknown as Row[];

  const extractor = buildClaimExtractor(config);
  if (extractor === null) {
    throw new Error('no claim extractor is configured; set CLAIM_API_KEY');
  }
  const converter = buildDoclingConverter(config);
  const fetcher = new AttachmentFetcher(config.enrichmentMaxBytes);

  process.stdout.write(
    `sampling ${rows.length} filing(s) at ${delayMs}ms apart, ` +
      `docling=${converter === null ? 'off' : 'on'}\n\n`,
  );

  const causes = new Map<string, number>();
  const examples = new Map<string, string[]>();
  let documents = 0;
  let proposed = 0;
  let foundBefore = 0;
  let foundAfter = 0;

  for (const row of rows) {
    const decision = decideAttachment(row.attachmentUrl);
    if (decision.outcome === 'skip') continue;

    const fetched = await fetcher.fetch(decision.url);
    if (fetched.outcome !== 'ok') continue;
    const parsed = await extractPdfText(fetched.body);
    if (parsed.outcome !== 'ok') continue;

    const routed = await readWithRouting({
      category: row.category,
      data: fetched.body,
      fileName: `${row.seqId}.pdf`,
      text: parsed.text,
      pages: parsed.pages,
      converter,
    });
    if (!hasUsableTextLayer(routed.text)) continue;
    if (!claimEligibility(row, routed.text).eligible) continue;

    const askedAt = Date.now();
    process.stdout.write(
      `  asking about ${row.symbol} ${row.seqId} (${routed.route}, ${routed.text.length} chars)\n`,
    );
    const extraction = await extractor.extract({
      symbol: row.symbol,
      category: row.category,
      summary: row.summary,
      documentText: routed.text,
    });
    documents += 1;
    process.stdout.write(
      `  [${documents}] ${row.symbol} ${row.seqId}: ${routed.route}, ` +
        `${routed.text.length} chars, ${Date.now() - askedAt}ms, ` +
        `${extraction.outcome === 'ok' ? `${extraction.claims.length} claim(s)` : 'extractor failed'}\n`,
    );
    if (extraction.outcome === 'failed') {
      process.stdout.write(`  ${row.symbol}: extractor failed\n`);
      continue;
    }

    for (const claim of extraction.claims as readonly ProposedClaim[]) {
      proposed += 1;
      const before = findVerbatimSpan(routed.text, claim.span, NO_REPAIRS);
      const after = findVerbatimSpan(routed.text, claim.span, ALL_REPAIRS);
      if (before !== null) foundBefore += 1;
      if (after !== null) foundAfter += 1;
      if (before !== null) continue;

      const cause = classify(routed.text, claim.span);
      causes.set(cause, (causes.get(cause) ?? 0) + 1);
      const kept = examples.get(cause) ?? [];
      if (kept.length < 4) {
        const quoted = canonicalSpan(claim.span);
        const source = documentTextAt(routed.text, claim.span);
        kept.push(
          `${row.symbol} ${row.seqId}\n      MODEL: ${quoted}` +
            (source === null ? '' : `\n      SOURCE: ${canonicalSpan(source)}`),
        );
        examples.set(cause, kept);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  const missed = proposed - foundBefore;
  process.stdout.write(
    `\n--- ${documents} document(s) read, ${proposed} span(s) proposed ---\n` +
      `matched BEFORE (whitespace only)  ${String(foundBefore).padStart(4)}  ${pct(foundBefore, proposed)}\n` +
      `matched AFTER  (canonicalised)    ${String(foundAfter).padStart(4)}  ${pct(foundAfter, proposed)}\n` +
      `span-not-found BEFORE             ${String(missed).padStart(4)}  ${pct(missed, proposed)}\n` +
      `span-not-found AFTER              ${String(proposed - foundAfter).padStart(4)}  ${pct(proposed - foundAfter, proposed)}\n\n` +
      `--- why each of the ${missed} miss(es) missed ---\n`,
  );

  const order = [
    'typography',
    'table-cells',
    'line-break-hyphen',
    'alnum-only',
    'case-fold',
    'paraphrase',
    'invention',
  ];
  for (const cause of order) {
    const count = causes.get(cause) ?? 0;
    if (count === 0) continue;
    process.stdout.write(
      `${cause.padEnd(20)} ${String(count).padStart(4)}  ${pct(count, missed)}\n`,
    );
    for (const example of examples.get(cause) ?? []) {
      process.stdout.write(`    ${example}\n`);
    }
  }

  await mongoose.disconnect();
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `span miss measurement failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
