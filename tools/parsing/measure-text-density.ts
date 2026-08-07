/**
 * Measures how much text a document's own text layer carries per page, so the
 * routing threshold for "present but starved" can be set on evidence.
 *
 * WHY THIS EXISTS. `routeAfterFirstRead` escalates to OCR on `hasTextLayer ===
 * false`, which is a binary test, and a binary test cannot see the case that
 * costs us the most: an investor presentation whose text layer holds the slide
 * TITLES and nothing else. BRITANNIA's deck (seqId 106730232) is 4,439,475
 * bytes and produced 6,172 characters — it has a text layer, so it never
 * escalated, and all three claims proposed from it were refused. LUPIN's decks
 * read 21,546 characters through `pdf-parse` and yielded one line between them.
 *
 * A document like that is not scanned and is not healthy. The distinguishing
 * quantity is text per page: a text-native filing carries thousands of
 * characters a page, a raster scan carries single digits, and an image-heavy
 * deck sits in between — which is exactly why a threshold has to be measured
 * rather than assumed, and why this prints the whole distribution instead of a
 * verdict.
 *
 * COSTS NO MODEL CALLS. It fetches and parses cheaply; the labels come from
 * what the pipeline already stored for each filing.
 *
 * Usage:
 *   npm run density:measure -- [--limit 40] [--category "Investor Presentation"]
 */
import 'dotenv/config';
import mongoose, { type Model } from 'mongoose';
import {
  AttachmentFetcher,
  extractPdfText,
  FilingSchema,
  type FilingDocument,
} from '@app/filings';
import { loadConfig } from '../../apps/ingest/src/config/configuration';

/** One document, measured. */
interface Density {
  readonly symbol: string;
  readonly seqId: number;
  readonly category: string;
  readonly bytes: number;
  readonly pages: number;
  readonly chars: number;
  /** The quantity under test. */
  readonly perPage: number;
  /** What the stored enrichment made of it, as the outcome label. */
  readonly storedRoute: string | null;
  readonly storedClaims: number;
  readonly storedChars: number | null;
}

const readArg = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
};

/**
 * The sample.
 *
 * DELIBERATELY THREE POPULATIONS, not one. A distribution over presentations
 * alone would show a spread with no way to say which end is broken. The scanned
 * filings are the known-bad anchor and the claim-bearing press releases are the
 * known-good one, so the threshold can be placed in a gap between labelled
 * groups rather than at a percentile of an unlabelled one.
 */
async function sample(
  model: Model<FilingDocument>,
  limit: number,
  category: string | null,
): Promise<readonly FilingDocument[]> {
  const base = {
    attachmentUrl: { $nin: [null, '', '-'] },
    'enrichment.documentChars': { $gt: 0 },
  };

  if (category !== null) {
    return model
      .find({ ...base, category })
      .sort({ disseminatedAt: -1 })
      .limit(limit)
      .lean()
      .exec() as unknown as readonly FilingDocument[];
  }

  const groups: readonly (readonly [string, Record<string, unknown>])[] = [
    ['presentations', { ...base, category: 'Investor Presentation' }],
    ['scanned', { ...base, 'enrichment.parseRoute': 'docling-ocr' }],
    [
      'claim-bearing text',
      {
        ...base,
        category: 'Press Release',
        'enrichment.claims.0': { $exists: true },
      },
    ],
  ];

  const out: FilingDocument[] = [];
  for (const [, filter] of groups) {
    const rows = (await model
      .find(filter)
      .sort({ disseminatedAt: -1 })
      .limit(Math.ceil(limit / groups.length))
      .lean()
      .exec()) as unknown as readonly FilingDocument[];
    out.push(...rows);
  }
  return out;
}

const pct = (rows: readonly number[], p: number): number => {
  if (rows.length === 0) return 0;
  const sorted = [...rows].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  ];
};

async function main(): Promise<void> {
  const config = loadConfig();
  const limit = Number(readArg('limit', '45'));
  const category = readArg('category', '') || null;

  await mongoose.connect(config.mongoUri);
  const model = mongoose.model<FilingDocument>('Filing', FilingSchema);
  const rows = await sample(model, limit, category);

  process.stdout.write(`measuring ${rows.length} document(s)\n\n`);

  const fetcher = new AttachmentFetcher(config.enrichmentMaxBytes);
  const measured: Density[] = [];

  for (const filing of rows) {
    const url = filing.attachmentUrl;
    if (typeof url !== 'string' || url.length === 0) continue;

    const fetched = await fetcher.fetch(url);
    if (fetched.outcome !== 'ok') {
      process.stdout.write(
        `  skip ${filing.symbol} — fetch ${fetched.outcome}\n`,
      );
      continue;
    }

    const parsed = await extractPdfText(fetched.body);
    if (parsed.outcome !== 'ok') {
      process.stdout.write(`  skip ${filing.symbol} — ${parsed.message}\n`);
      continue;
    }

    const chars = parsed.text.trim().length;
    measured.push({
      symbol: filing.symbol,
      seqId: filing.seqId,
      category: filing.category,
      bytes: fetched.bytes,
      pages: parsed.pages,
      chars,
      perPage: parsed.pages === 0 ? 0 : Math.round(chars / parsed.pages),
      storedRoute: filing.enrichment?.parseRoute ?? null,
      storedClaims: filing.enrichment?.claims?.length ?? 0,
      storedChars: filing.enrichment?.documentChars ?? null,
    });

    // The same pacing the enrichment worker uses. This tool reads the exchange
    // exactly as the pipeline does and must not read it any harder.
    await new Promise((r) => setTimeout(r, config.enrichmentRequestDelayMs));
  }

  measured.sort((a, b) => a.perPage - b.perPage);

  process.stdout.write(
    '\nsymbol         seq         category                        pages    chars   per-page   MB    route           claims\n',
  );
  for (const d of measured) {
    process.stdout.write(
      `${d.symbol.padEnd(14)} ${String(d.seqId).padEnd(11)} ${d.category.slice(0, 30).padEnd(31)} ` +
        `${String(d.pages).padStart(5)} ${String(d.chars).padStart(8)} ${String(d.perPage).padStart(9)} ` +
        `${(d.bytes / 1e6).toFixed(1).padStart(6)}  ${String(d.storedRoute).padEnd(15)} ${d.storedClaims}\n`,
    );
  }

  const byGroup = (label: string, rows: readonly Density[]): void => {
    if (rows.length === 0) return;
    const per = rows.map((r) => r.perPage);
    process.stdout.write(
      `\n${label.padEnd(26)} n=${String(rows.length).padStart(3)}  ` +
        `min=${Math.min(...per)}  p25=${pct(per, 25)}  median=${pct(per, 50)}  ` +
        `p75=${pct(per, 75)}  max=${Math.max(...per)}`,
    );
  };

  process.stdout.write('\n--- chars per page, by labelled group ---');
  byGroup(
    'scanned (docling-ocr)',
    measured.filter((d) => d.storedRoute === 'docling-ocr'),
  );
  byGroup(
    'presentations',
    measured.filter((d) => d.category === 'Investor Presentation'),
  );
  byGroup(
    '  ..of those, 0 claims',
    measured.filter(
      (d) => d.category === 'Investor Presentation' && d.storedClaims === 0,
    ),
  );
  byGroup(
    '  ..of those, >=1 claim',
    measured.filter(
      (d) => d.category === 'Investor Presentation' && d.storedClaims > 0,
    ),
  );
  byGroup(
    'claim-bearing text',
    measured.filter((d) => d.category === 'Press Release'),
  );
  process.stdout.write('\n\n');

  await mongoose.disconnect();
}

void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
