/**
 * Phase 1 measurement tool. Pulls a date range from NSE's uncapped date-range
 * endpoint and writes one mapped Filing per line as JSONL.
 *
 * Usage: npm run corpus:fetch -- --days 31
 */
import axios from 'axios';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  mapNseRecord,
  safeEcho,
  toNseDateParam,
  type NseRawRecord,
} from '@app/filings';

const BASE = 'https://www.nseindia.com/api/corporate-announcements';
const LANDING =
  'https://www.nseindia.com/companies-listing/corporate-filings-announcements';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const OUT_DIR = join(process.cwd(), 'data', 'corpus');

function parseDays(argv: string[]): number {
  const idx = argv.indexOf('--days');
  const value = idx >= 0 ? Number(argv[idx + 1]) : 31;
  if (!Number.isInteger(value) || value < 1 || value > 90) {
    throw new Error('--days must be an integer between 1 and 90');
  }
  return value;
}

/**
 * Reads the sequence id for a log line without trusting the record.
 *
 * `NseRawRecord` is a compile-time shape only; a null element in the array
 * would make a plain `raw.seq_id` throw from inside the catch block and turn
 * one bad record into a crashed run. Echoed through `safeEcho` because the
 * value is untrusted and lands in a log.
 */
function seqIdLabel(raw: NseRawRecord | null | undefined): string {
  const seqId: unknown = raw?.seq_id;
  return typeof seqId === 'string' && seqId.trim()
    ? safeEcho(seqId.trim())
    : 'unknown';
}

async function main(): Promise<void> {
  const days = parseDays(process.argv);
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  const client = axios.create({
    headers: { 'User-Agent': UA, Referer: LANDING, Accept: '*/*' },
    timeout: 120_000,
    withCredentials: true,
  });

  // Bootstrap the Akamai cookie jar by touching the landing page first.
  const landing = await client.get(LANDING);
  const cookies = (landing.headers['set-cookie'] ?? [])
    .map((c: string) => c.split(';')[0])
    .join('; ');

  const url = `${BASE}?index=equities&from_date=${toNseDateParam(from)}&to_date=${toNseDateParam(to)}`;
  console.log(`Fetching ${days} days: ${url}`);

  const started = Date.now();
  const { data } = await client.get<NseRawRecord[]>(url, {
    headers: { Cookie: cookies },
  });

  // NSE answers a blocked or throttled request with an HTML body or an error
  // object, both of which reach here typed as an array. Fail loudly at the
  // boundary rather than crashing on `data.length` further down.
  if (!Array.isArray(data)) {
    throw new Error(
      `Expected an array of records from NSE, got ${typeof data}`,
    );
  }
  console.log(`Received ${data.length} records in ${Date.now() - started}ms`);

  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(
    OUT_DIR,
    `${toNseDateParam(from)}_${toNseDateParam(to)}.jsonl`,
  );

  let mapped = 0;
  let failed = 0;
  const lines: string[] = [];
  for (const raw of data) {
    try {
      lines.push(JSON.stringify(mapNseRecord(raw)));
      mapped += 1;
    } catch (error) {
      failed += 1;
      console.warn(
        `Skipped seq_id=${seqIdLabel(raw)}: ${(error as Error).message}`,
      );
    }
  }

  writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
  console.log(`Wrote ${mapped} filings to ${outPath} (${failed} unmappable)`);
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
