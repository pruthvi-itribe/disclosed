/**
 * Measures how much of a document's text layer is READABLE, so the routing
 * threshold for "present but corrupt" can be set on evidence.
 *
 * WHY THIS EXISTS. `hasUsableTextLayer` counts non-space characters, which is a
 * test of QUANTITY. A PDF whose font carries a broken `ToUnicode` map emits one
 * character per glyph — the right number of them, in the right places — and
 * every one is wrong. MSWIL's newspaper disclosure (seqId 106726228) is the
 * measured case: 9,226 non-space characters, of which the covering letter's
 * first 500 are English and the remaining 8,726 read
 * `1DWLRQDO6WRFN([FKDQJHRI,QGLD/LPLWHG` — "NationalStockExchangeofIndiaLimited"
 * displaced three code points. It passes the quantity test by 92x and carries
 * no information at all.
 *
 * The distinguishing quantity is therefore not how much text there is but how
 * much of it is words. This prints the whole distribution rather than a verdict,
 * because the threshold has to sit in a measured gap and the shape of the gap is
 * the argument for it.
 *
 * WHY A VOWEL RATE AND NOT A DICTIONARY. A dictionary is the obvious readability
 * test and it was the one this measurement started from — `/usr/share/dict/words`
 * over 66,941 windows is what LABELLED the distribution below. It cannot ship:
 * 236k words is not a constant, an Indian filing's proper nouns are not in it,
 * and a Regulation 33 table is mostly row labels and digits. The vowel rate over
 * Latin letters reproduces the dictionary's verdict at the only place the routing
 * needs it — English prose sits at 0.35-0.43 and displaced-encoding text at
 * 0.17-0.29 — costs one pass over the string, and needs no table.
 *
 * COSTS NO MODEL CALLS. It fetches and parses cheaply, and reuses the text cache
 * `measure-ambiguity-scope.ts` already populated.
 *
 * Usage:
 *   npm run quality:measure -- [--limit 400] [--category "..."]
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import mongoose, { type Model } from 'mongoose';
import {
  AttachmentFetcher,
  decideAttachment,
  extractPdfText,
  FilingSchema,
  readableWindowFraction,
  type FilingDocument,
} from '@app/filings';
import { loadConfig } from '../../apps/ingest/src/config/configuration';

/** One document, measured. */
interface Quality {
  readonly symbol: string;
  readonly seqId: number;
  readonly category: string;
  readonly chars: number;
  /** The quantity under test. */
  readonly fraction: number;
  readonly storedRoute: string | null;
  readonly storedClaims: number;
}

const readArg = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The sample.
 *
 * NEWSPAPER PUBLICATIONS ARE TAKEN WHOLE and everything else is sampled, because
 * the two populations answer different questions. The newspaper page is the one
 * document shape that legitimately carries non-English text — a Marathi AGM
 * notice, another company's SARFAESI notice — so it is where a readability test
 * is most likely to be WRONG, and a threshold that has not seen all of them has
 * not been tested against its own worst case. Everything else is the control:
 * ordinary filings whose text layer is known good because the pipeline already
 * read claims out of them.
 */
async function sample(
  model: Model<FilingDocument>,
  limit: number,
  category: string | null,
): Promise<readonly FilingDocument[]> {
  const base = { attachmentUrl: { $nin: [null, '', '-'] } };
  if (category !== null) {
    return model
      .find({ ...base, category })
      .limit(limit)
      .lean()
      .exec() as unknown as readonly FilingDocument[];
  }

  const papers = (await model
    .find({ ...base, category: 'Copy of Newspaper Publication' })
    .lean()
    .exec()) as unknown as readonly FilingDocument[];
  const rest = (await model
    .find({ ...base, category: { $ne: 'Copy of Newspaper Publication' } })
    .sort({ disseminatedAt: -1 })
    .limit(limit)
    .lean()
    .exec()) as unknown as readonly FilingDocument[];
  return [...papers, ...rest];
}

/** The same cache `measure-ambiguity-scope.ts` writes, keyed the same way. */
function cachePath(cacheDir: string, seqId: number): string {
  const key = createHash('sha256')
    .update(String(seqId))
    .digest('hex')
    .slice(0, 16);
  return join(cacheDir, `${key}.txt`);
}

async function readDocument(
  filing: FilingDocument,
  fetcher: AttachmentFetcher,
  cacheDir: string,
  delayMs: number,
): Promise<string | null> {
  const cached = cachePath(cacheDir, filing.seqId);
  if (existsSync(cached)) return readFileSync(cached, 'utf8');

  const decision = decideAttachment(filing.attachmentUrl);
  if (decision.outcome !== 'fetch' || decision.kind !== 'pdf') return null;

  const fetched = await fetcher.fetch(decision.url);
  await sleep(delayMs);
  if (fetched.outcome !== 'ok') return null;

  const parsed = await extractPdfText(fetched.body);
  if (parsed.outcome !== 'ok' || parsed.text.trim().length === 0) return null;

  writeFileSync(cached, parsed.text, 'utf8');
  return parsed.text;
}

const histogram = (label: string, values: readonly number[]): void => {
  if (values.length === 0) return;
  process.stdout.write(`\n${label}  (n=${values.length})\n`);
  for (let lo = 0; lo < 1; lo += 0.05) {
    const n = values.filter((v) => v >= lo && v < lo + 0.05).length;
    const bar = '#'.repeat(Math.round((60 * n) / values.length));
    process.stdout.write(
      `  ${lo.toFixed(2)}-${(lo + 0.05).toFixed(2)} ${String(n).padStart(4)} ${bar}\n`,
    );
  }
  const at1 = values.filter((v) => v >= 1).length;
  process.stdout.write(`  1.00       ${String(at1).padStart(4)}\n`);
};

async function main(): Promise<void> {
  const config = loadConfig();
  const limit = Number(readArg('limit', '400'));
  const category = readArg('category', '') || null;
  const cacheDir = readArg('cache', 'data/corpus/.ambiguity-scope-cache');
  mkdirSync(cacheDir, { recursive: true });

  await mongoose.connect(config.mongoUri);
  const model = mongoose.model<FilingDocument>('Filing', FilingSchema);
  const rows = await sample(model, limit, category);
  process.stdout.write(`measuring ${rows.length} document(s)\n`);

  const fetcher = new AttachmentFetcher(config.enrichmentMaxBytes);
  const measured: Quality[] = [];

  for (const filing of rows) {
    const text = await readDocument(
      filing,
      fetcher,
      cacheDir,
      config.enrichmentRequestDelayMs,
    );
    if (text === null) continue;
    measured.push({
      symbol: filing.symbol,
      seqId: filing.seqId,
      category: filing.category,
      chars: text.replace(/\s+/g, '').length,
      fraction: readableWindowFraction(text),
      storedRoute: filing.enrichment?.parseRoute ?? null,
      storedClaims: filing.enrichment?.claims?.length ?? 0,
    });
  }

  const papers = measured.filter(
    (m) => m.category === 'Copy of Newspaper Publication',
  );
  const others = measured.filter(
    (m) => m.category !== 'Copy of Newspaper Publication',
  );

  process.stdout.write(`\nread ${measured.length} document(s)\n`);
  histogram(
    'readable-window fraction, ALL',
    measured.map((m) => m.fraction),
  );
  histogram(
    'readable-window fraction, newspaper publications',
    papers.map((m) => m.fraction),
  );
  histogram(
    'readable-window fraction, every other category',
    others.map((m) => m.fraction),
  );

  process.stdout.write('\n--- 40 lowest ---\n');
  process.stdout.write(
    'fraction  chars  claims route          category                        symbol / seqId\n',
  );
  for (const m of [...measured]
    .sort((a, b) => a.fraction - b.fraction)
    .slice(0, 40)) {
    process.stdout.write(
      `${m.fraction.toFixed(3)}   ${String(m.chars).padStart(6)} ${String(m.storedClaims).padStart(5)}  ` +
        `${String(m.storedRoute).padEnd(14)} ${m.category.slice(0, 30).padEnd(31)} ${m.symbol} ${m.seqId}\n`,
    );
  }
  process.stdout.write('\n');

  await mongoose.disconnect();
}

void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
