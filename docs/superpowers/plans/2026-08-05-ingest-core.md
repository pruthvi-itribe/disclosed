# Redbox Ingest Core — Implementation Plan (Phases 1–3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest every NSE corporate announcement with no silent loss, measure the real filtering yield over a 31-day corpus, and alert market-moving filings to Telegram within ~2s of exchange dissemination.

**Architecture:** NestJS monorepo with one app (`apps/ingest`) over two libs (`libs/filings`, `libs/notify`). All decision logic — date parsing, rollover detection, cadence, alert gating — lives in pure functions in `libs/filings` so it is testable without HTTP, Mongo, or timers. The adapter interface isolates NSE so a licensed vendor feed can replace it later without touching anything above it.

**Tech Stack:** Node 18.20.8, TypeScript 5.1, NestJS 10, Mongoose 8 (MongoDB), Bull 4 + Redis, `node-telegram-bot-api` 0.67, Jest 29 + ts-jest, `nock` for HTTP fixtures.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-05-filings-pipeline-design.md`. Read it before Task 1.
- **`exchdisstime` is the authoritative clock.** Never use local time for latency or alert-window decisions.
- **NSE timestamps are IST with no timezone marker.** Naive `new Date()` parsing is a 5.5-hour bug on a UTC server. Always parse via `parseNseDate`.
- **`seq_id` is a global counter across all NSE streams.** It is a valid cursor. It is NOT a completeness proof — gaps are normal and prove nothing.
- **No live NSE calls in tests.** All HTTP is `nock`-mocked from recorded fixtures.
- `strict: true` in tsconfig. This is a greenfield product core, deliberately stricter than `cat-trader`.
- Conventional commits: `<type>: <description>`.
- `npm install` may need `--legacy-peer-deps` (matches `cat-trader`).
- Never commit `.env`, cookies, or the corpus JSONL (large).

## File Structure

```
redbox/
  nest-cli.json                              monorepo project registry
  tsconfig.json                              strict, @app/* path aliases
  jest.config.js                             root config, moduleNameMapper
  package.json
  docker-compose.yml                         mongo + redis for local dev
  .env.example
  apps/ingest/src/
    main.ts                                  bootstrap
    ingest.module.ts                         root module
    config/configuration.ts                  typed env config
    session/session.service.ts               Akamai cookie jar + re-bootstrap
    poller/poller.service.ts                 hot/drain orchestration
    poller/circuit-breaker.ts                pure: failure counting
    alert/alert.service.ts                   watchlist + insert-only firing
  libs/filings/src/
    index.ts                                 public surface
    filing.types.ts                          Filing domain entity
    source-adapter.interface.ts              SourceAdapter
    nse/nse.types.ts                         raw NSE record shape
    nse/nse-date.ts                          pure: IST parsing
    nse/nse.mapper.ts                        pure: raw -> Filing
    nse/nse.adapter.ts                       HTTP adapter
    logic/rollover.ts                        pure: cursor + hole detection
    logic/cadence.ts                         pure: adaptive poll delay
    logic/alert-window.ts                    pure: cold-start suppression
    logic/taxonomy.ts                        pure: routine-discard categories
    persistence/filing.schema.ts             Mongoose schema
    persistence/filing.repository.ts         upsert + insert detection
  libs/notify/src/
    index.ts
    telegram.service.ts                      send + degraded alerts
    alert-formatter.ts                       pure: wire-format headline
  tools/corpus/fetch-corpus.ts               Phase 1: pull N days to JSONL
  tools/corpus/analyse-corpus.ts             Phase 1: yield measurement
  test/fixtures/nse-live-page.json           recorded 20-record page
  test/fixtures/nse-day-range.json           recorded date-range slice
```

**Task dependency order:** 1 → 2 → (3 → 4 Phase 1 deliverable) → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12.

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `nest-cli.json`, `jest.config.js`, `.gitignore`, `.env.example`, `docker-compose.yml`
- Create: `libs/filings/src/index.ts`, `libs/filings/tsconfig.lib.json`
- Create: `libs/notify/src/index.ts`, `libs/notify/tsconfig.lib.json`
- Create: `apps/ingest/src/main.ts`, `apps/ingest/src/ingest.module.ts`, `apps/ingest/tsconfig.app.json`
- Test: `libs/filings/src/logic/taxonomy.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `@app/filings` and `@app/notify` path aliases resolving in both `tsc` and Jest. `ROUTINE_CATEGORIES: ReadonlySet<string>` and `isRoutine(category: string): boolean` from `@app/filings`.

- [ ] **Step 1: Initialise package.json and install**

```bash
cd /Users/pruthvi/workspace/personal/redbox
npm init -y
npm i --legacy-peer-deps \
  @nestjs/common@^10.0.0 @nestjs/core@^10.0.0 \
  @nestjs/config@^4.0.2 @nestjs/schedule@^4.1.2 @nestjs/event-emitter@^2.1.1 \
  @nestjs/mongoose@^11.0.4 mongoose@^8.21.0 \
  @nestjs/bull@^11.0.4 bull@^4.16.5 \
  axios@^1.13.2 tough-cookie@^4.1.4 node-telegram-bot-api@^0.67.0 \
  class-validator@^0.14.3 class-transformer@^0.5.1 reflect-metadata rxjs
npm i -D --legacy-peer-deps \
  @nestjs/cli@^10.0.0 @nestjs/schematics@^10.0.0 @nestjs/testing@^10.0.0 \
  typescript@^5.1.3 ts-node@^10.9.1 ts-jest@^29.1.0 jest@^29.5.0 \
  @types/jest@^29.5.2 @types/node@^20.0.0 @types/node-telegram-bot-api@^0.64.13 \
  nock@^13.5.4 \
  eslint@^8.0.0 @typescript-eslint/eslint-plugin@^8.0.0 @typescript-eslint/parser@^8.0.0 \
  eslint-config-prettier@^9.0.0 eslint-plugin-prettier@^5.0.0 prettier@^3.0.0
```

No platform adapter is installed: `main.ts` uses `NestFactory.createApplicationContext`,
so there is no HTTP server. `@nestjs/platform-express` would pull in the `multer`
advisory chain for nothing. If a later phase adds an HTTP surface, the dependency
returns and `main.ts` switches to `NestFactory.create`.

Copy `.eslintrc.js` and `.prettierrc` from `cat-trader` rather than inventing a style,
adjusting only the lint glob to `{apps,libs,tools}`.

- [ ] **Step 2: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "target": "ES2021",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strict": true,
    "resolveJsonModule": true,
    "paths": {
      "@app/filings": ["libs/filings/src"],
      "@app/filings/*": ["libs/filings/src/*"],
      "@app/notify": ["libs/notify/src"],
      "@app/notify/*": ["libs/notify/src/*"]
    }
  },
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Write nest-cli.json**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "apps/ingest/src",
  "monorepo": true,
  "root": "apps/ingest",
  "compilerOptions": {
    "webpack": false,
    "tsConfigPath": "apps/ingest/tsconfig.app.json"
  },
  "projects": {
    "ingest": {
      "type": "application",
      "root": "apps/ingest",
      "entryFile": "main",
      "sourceRoot": "apps/ingest/src",
      "compilerOptions": { "tsConfigPath": "apps/ingest/tsconfig.app.json" }
    },
    "filings": {
      "type": "library",
      "root": "libs/filings",
      "entryFile": "index",
      "sourceRoot": "libs/filings/src",
      "compilerOptions": { "tsConfigPath": "libs/filings/tsconfig.lib.json" }
    },
    "notify": {
      "type": "library",
      "root": "libs/notify",
      "entryFile": "index",
      "sourceRoot": "libs/notify/src",
      "compilerOptions": { "tsConfigPath": "libs/notify/tsconfig.lib.json" }
    }
  }
}
```

- [ ] **Step 4: Write jest.config.js**

```js
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  collectCoverageFrom: ['apps/**/*.(t|j)s', 'libs/**/*.(t|j)s'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@app/filings(|/.*)$': '<rootDir>/libs/filings/src/$1',
    '^@app/notify(|/.*)$': '<rootDir>/libs/notify/src/$1',
  },
};
```

- [ ] **Step 5: Write the three tsconfig project files**

`apps/ingest/tsconfig.app.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": { "outDir": "../../dist", "rootDir": "../../" },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.spec.ts"]
}
```

`rootDir` must be set explicitly. Without it tsc infers the rootDir from the
compilation's common ancestor, so the emit path silently changes the moment the
app first imports from a lib — `dist/apps/ingest/main.js` becomes
`dist/apps/ingest/apps/ingest/src/main.js` and `start:prod` breaks. Pinning both
`rootDir` and `outDir` makes the emit path `dist/apps/ingest/src/main.js`
regardless of what is imported.

`libs/filings/tsconfig.lib.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": { "outDir": "../../dist/libs/filings" },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.spec.ts"]
}
```

`libs/notify/tsconfig.lib.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": { "outDir": "../../dist/libs/notify" },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.spec.ts"]
}
```

- [ ] **Step 6: Add scripts to package.json**

Replace the `"scripts"` block with:
```json
{
  "build": "nest build ingest",
  "start:dev": "nest start ingest --watch",
  "start:prod": "node dist/apps/ingest/src/main",
  "test": "jest",
  "test:watch": "jest --watch",
  "test:cov": "jest --coverage",
  "lint": "eslint \"{apps,libs,tools}/**/*.ts\" --fix",
  "corpus:fetch": "ts-node -r tsconfig-paths/register tools/corpus/fetch-corpus.ts",
  "corpus:analyse": "ts-node -r tsconfig-paths/register tools/corpus/analyse-corpus.ts"
}
```

Then install the path-resolver used by those scripts:
```bash
npm i -D --legacy-peer-deps tsconfig-paths@^4.2.0
```

- [ ] **Step 7: Write the failing test for the taxonomy helper**

Create `libs/filings/src/logic/taxonomy.spec.ts`:
```ts
import { isRoutine, ROUTINE_CATEGORIES } from './taxonomy';

describe('taxonomy', () => {
  it('marks demat status filings as routine', () => {
    expect(isRoutine('Updates')).toBe(true);
  });

  it('marks newspaper publication as routine', () => {
    expect(isRoutine('Copy of Newspaper Publication')).toBe(true);
  });

  it('does not mark order wins as routine', () => {
    expect(isRoutine('Bagging/Receiving of orders/contracts')).toBe(false);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(isRoutine('  copy of NEWSPAPER publication ')).toBe(true);
  });

  it('treats unknown categories as non-routine so nothing is silently dropped', () => {
    expect(isRoutine('Some Category NSE Invented Yesterday')).toBe(false);
  });

  it('exposes the routine set for corpus analysis', () => {
    expect(ROUTINE_CATEGORIES.size).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 8: Run the test to verify it fails**

Run: `npx jest libs/filings/src/logic/taxonomy.spec.ts`
Expected: FAIL — `Cannot find module './taxonomy'`

- [ ] **Step 9: Write the minimal implementation**

Create `libs/filings/src/logic/taxonomy.ts`:
```ts
/**
 * Categories (NSE `desc` field) that carry no market signal and no content value.
 * Anything not listed here is treated as non-routine: the gate fails open at this
 * stage so an unrecognised category is reviewed rather than silently discarded.
 */
export const ROUTINE_CATEGORIES: ReadonlySet<string> = new Set([
  'updates',
  'general updates',
  'copy of newspaper publication',
  'trading window',
  'trading window-xbrl',
  'statement of deviation(s) or variation(s) under reg. 32',
]);

const normalise = (category: string): string => category.trim().toLowerCase();

export const isRoutine = (category: string): boolean =>
  ROUTINE_CATEGORIES.has(normalise(category));
```

Create `libs/filings/src/index.ts`:
```ts
export * from './logic/taxonomy';
```

Create `libs/notify/src/index.ts`:
```ts
export {};
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `npx jest libs/filings/src/logic/taxonomy.spec.ts`
Expected: PASS — 6 passing

- [ ] **Step 11: Write the placeholder app entrypoint so `nest build` succeeds**

`apps/ingest/src/ingest.module.ts`:
```ts
import { Module } from '@nestjs/common';

@Module({})
export class IngestModule {}
```

`apps/ingest/src/main.ts`:
```ts
import { NestFactory } from '@nestjs/core';
import { IngestModule } from './ingest.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(IngestModule);
  await app.init();
}

void bootstrap();
```

- [ ] **Step 12: Verify the build compiles**

Run: `npm run build`
Expected: exits 0, produces `dist/apps/ingest/src/main.js`

- [ ] **Step 13: Write .gitignore, .env.example and docker-compose.yml**

`.gitignore`:
```
node_modules/
dist/
coverage/
.env
*.log
data/corpus/
```

`.env.example`:
```
MONGO_URI=mongodb://localhost:27017/redbox
REDIS_HOST=localhost
REDIS_PORT=6379
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
NSE_HOT_INTERVAL_MS=2000
NSE_IDLE_INTERVAL_MS=30000
ALERT_WINDOW_MS=600000
```

`docker-compose.yml`:
```yaml
services:
  mongo:
    image: mongo:7
    ports: ['27017:27017']
    volumes: ['redbox-mongo:/data/db']
  redis:
    image: redis:7-alpine
    ports: ['6379:6379']
volumes:
  redbox-mongo:
```

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "chore: scaffold nestjs monorepo with filings and notify libs"
```

---

### Task 2: Filing domain type, IST date parsing, and the NSE mapper

**Files:**
- Create: `libs/filings/src/filing.types.ts`, `libs/filings/src/nse/nse.types.ts`, `libs/filings/src/nse/nse-date.ts`, `libs/filings/src/nse/nse.mapper.ts`
- Create: `test/fixtures/nse-live-page.json`
- Modify: `libs/filings/src/index.ts`
- Test: `libs/filings/src/nse/nse-date.spec.ts`, `libs/filings/src/nse/nse.mapper.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Filing` interface; `parseNseDate(input: string): Date`; `mapNseRecord(raw: NseRawRecord): Filing`; `NseRawRecord` interface.

- [ ] **Step 1: Record the live-page fixture**

```bash
mkdir -p test/fixtures
curl -s -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36' \
  -H 'Referer: https://www.nseindia.com/companies-listing/corporate-filings-announcements' \
  'https://www.nseindia.com/api/corporate-announcements?index=equities' \
  | python3 -m json.tool > test/fixtures/nse-live-page.json
python3 -c "import json;d=json.load(open('test/fixtures/nse-live-page.json'));print('records:',len(d))"
```
Expected: `records: 20`

- [ ] **Step 2: Write the failing test for IST date parsing**

Create `libs/filings/src/nse/nse-date.spec.ts`:
```ts
import { parseNseDate } from './nse-date';

describe('parseNseDate', () => {
  it('parses an NSE timestamp as IST, not local time', () => {
    // 05-Aug-2026 10:28:17 IST === 04:58:17 UTC
    const parsed = parseNseDate('05-Aug-2026 10:28:17');
    expect(parsed.toISOString()).toBe('2026-08-05T04:58:17.000Z');
  });

  it('handles a timestamp that crosses the UTC date boundary', () => {
    // 01-Jan-2026 03:00:00 IST === 31-Dec-2025 21:30:00 UTC
    const parsed = parseNseDate('01-Jan-2026 03:00:00');
    expect(parsed.toISOString()).toBe('2025-12-31T21:30:00.000Z');
  });

  it('parses every month abbreviation', () => {
    expect(parseNseDate('15-Dec-2026 00:00:00').toISOString()).toBe(
      '2026-12-14T18:30:00.000Z',
    );
    expect(parseNseDate('15-Mar-2026 12:00:00').toISOString()).toBe(
      '2026-03-15T06:30:00.000Z',
    );
  });

  it('throws on a malformed timestamp rather than returning Invalid Date', () => {
    expect(() => parseNseDate('not a date')).toThrow(/Unparseable NSE date/);
  });

  it('throws on an unknown month abbreviation', () => {
    expect(() => parseNseDate('05-Xyz-2026 10:00:00')).toThrow(
      /Unparseable NSE date/,
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest nse-date`
Expected: FAIL — `Cannot find module './nse-date'`

- [ ] **Step 4: Implement parseNseDate**

First create `libs/filings/src/logic/safe-echo.ts` — untrusted payload content is
echoed into error messages that get logged, so it must be bounded and single-line.
An unbounded echo lets a corrupt or hostile field forge a log line:

```ts
const MAX_ECHO_LENGTH = 32;

/**
 * Bounds and flattens untrusted input before it is interpolated into an error
 * message. Truncation caps log volume; replacing CR/LF/TAB keeps one record on
 * one line, so a forged newline cannot fabricate a second log entry.
 */
export function safeEcho(value: string): string {
  return value.slice(0, MAX_ECHO_LENGTH).replace(/[\r\n\t]/g, ' ');
}
```

Export it from `libs/filings/src/index.ts` alongside the other logic modules.

Then create `libs/filings/src/nse/nse-date.ts`:
```ts
import { safeEcho } from '../logic/safe-echo';

const MONTHS: Readonly<Record<string, number>> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** IST is UTC+05:30 year-round; India observes no daylight saving. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const PATTERN = /^(\d{2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/;

/**
 * Parses an NSE timestamp such as "05-Aug-2026 10:28:17".
 *
 * NSE emits these in IST with no timezone marker. Parsing with `new Date(...)`
 * would interpret them in the server's local zone — a 5.5-hour error on a UTC
 * host. This function always treats the input as IST and returns a correct
 * absolute instant.
 */
export function parseNseDate(input: string): Date {
  const match = PATTERN.exec(input.trim());
  if (!match) {
    throw new Error(`Unparseable NSE date: "${safeEcho(input)}"`);
  }

  const [, dd, mon, yyyy, hh, mm, ss] = match;
  const month = MONTHS[mon.toLowerCase()];
  if (month === undefined) {
    throw new Error(
      `Unparseable NSE date: "${safeEcho(input)}" (unknown month "${safeEcho(mon)}")`,
    );
  }

  const utcMillis = Date.UTC(
    Number(yyyy), month, Number(dd),
    Number(hh), Number(mm), Number(ss),
  );

  return new Date(utcMillis - IST_OFFSET_MS);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest nse-date`
Expected: PASS — 5 passing

- [ ] **Step 6: Write the failing test for the mapper**

Create `libs/filings/src/nse/nse.mapper.spec.ts`:
```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { mapNseRecord } from './nse.mapper';
import type { NseRawRecord } from './nse.types';

const FIXTURE: NseRawRecord[] = JSON.parse(
  readFileSync(join(__dirname, '../../../../test/fixtures/nse-live-page.json'), 'utf8'),
);

const sample: NseRawRecord = {
  seq_id: '106725630',
  symbol: 'PANACEABIO',
  sm_name: 'Panacea Biotec Limited',
  sm_isin: 'INE922B01023',
  smIndustry: 'Pharmaceuticals',
  desc: 'Bagging/Receiving of orders/contracts',
  attchmntText: 'Panacea Biotec Limited has informed the Exchange about an order.',
  attchmntFile: 'https://nsearchives.nseindia.com/corporate/X.pdf',
  an_dt: '05-Aug-2026 10:28:17',
  exchdisstime: '05-Aug-2026 10:28:18',
};

describe('mapNseRecord', () => {
  it('maps identity fields', () => {
    const filing = mapNseRecord(sample);
    expect(filing.seqId).toBe(106725630);
    expect(filing.symbol).toBe('PANACEABIO');
    expect(filing.isin).toBe('INE922B01023');
    expect(filing.companyName).toBe('Panacea Biotec Limited');
    expect(filing.category).toBe('Bagging/Receiving of orders/contracts');
  });

  it('uses exchdisstime as the authoritative dissemination clock', () => {
    const filing = mapNseRecord(sample);
    expect(filing.disseminatedAt.toISOString()).toBe('2026-08-05T04:58:18.000Z');
    expect(filing.announcedAt.toISOString()).toBe('2026-08-05T04:58:17.000Z');
  });

  it('coerces seq_id to a number for ordering', () => {
    expect(typeof mapNseRecord(sample).seqId).toBe('number');
  });

  it('nulls an empty attachment url rather than storing ""', () => {
    const filing = mapNseRecord({ ...sample, attchmntFile: '' });
    expect(filing.attachmentUrl).toBeNull();
  });

  it('falls back to an_dt when exchdisstime is missing', () => {
    const { exchdisstime, ...withoutDiss } = sample;
    const filing = mapNseRecord(withoutDiss as NseRawRecord);
    expect(filing.disseminatedAt.toISOString()).toBe('2026-08-05T04:58:17.000Z');
  });

  it('maps every record in the recorded fixture without throwing', () => {
    expect(FIXTURE.length).toBeGreaterThan(0);
    for (const raw of FIXTURE) {
      const filing = mapNseRecord(raw);
      expect(Number.isFinite(filing.seqId)).toBe(true);
      expect(filing.disseminatedAt.getTime()).not.toBeNaN();
    }
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx jest nse.mapper`
Expected: FAIL — `Cannot find module './nse.mapper'`

- [ ] **Step 8: Implement the types and mapper**

Create `libs/filings/src/filing.types.ts`:
```ts
export interface Filing {
  /** Global NSE sequence id. Monotonic and unique; a cursor, not a completeness proof. */
  seqId: number;
  symbol: string;
  isin: string;
  companyName: string;
  industry: string | null;
  /** NSE `desc` field — the category taxonomy. */
  category: string;
  summary: string;
  attachmentUrl: string | null;
  announcedAt: Date;
  /** Authoritative clock for all latency and alert-window decisions. */
  disseminatedAt: Date;
  ingestedAt: Date;
}
```

Create `libs/filings/src/nse/nse.types.ts`:
```ts
/** Raw record shape returned by /api/corporate-announcements. */
export interface NseRawRecord {
  seq_id: string;
  symbol: string;
  sm_name: string;
  sm_isin: string;
  smIndustry?: string | null;
  desc: string;
  attchmntText?: string | null;
  attchmntFile?: string | null;
  an_dt: string;
  exchdisstime?: string | null;
}
```

Create `libs/filings/src/nse/nse.mapper.ts`:
```ts
import type { Filing } from '../filing.types';
import { parseNseDate } from './nse-date';
import type { NseRawRecord } from './nse.types';

const nullIfBlank = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/**
 * Converts a raw NSE announcement record into the Filing domain entity.
 * Pure: no clock reads beyond `ingestedAt`, no IO.
 */
export function mapNseRecord(raw: NseRawRecord, ingestedAt = new Date()): Filing {
  const announcedAt = parseNseDate(raw.an_dt);
  const disseminated = nullIfBlank(raw.exchdisstime);

  return {
    seqId: Number(raw.seq_id),
    symbol: raw.symbol,
    isin: raw.sm_isin,
    companyName: raw.sm_name,
    industry: nullIfBlank(raw.smIndustry),
    category: raw.desc,
    summary: nullIfBlank(raw.attchmntText) ?? '',
    attachmentUrl: nullIfBlank(raw.attchmntFile),
    announcedAt,
    // NSE occasionally omits exchdisstime; an_dt is the only honest fallback.
    disseminatedAt: disseminated ? parseNseDate(disseminated) : announcedAt,
    ingestedAt,
  };
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx jest nse`
Expected: PASS — all `nse-date` and `nse.mapper` tests green

- [ ] **Step 10: Export from the lib surface**

Replace `libs/filings/src/index.ts`:
```ts
export * from './filing.types';
export * from './logic/taxonomy';
export * from './nse/nse.types';
export * from './nse/nse-date';
export * from './nse/nse.mapper';
```

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: add filing domain type, IST date parsing and NSE mapper"
```

---

### Task 3: Corpus fetch tool

**Files:**
- Create: `tools/corpus/fetch-corpus.ts`
- Test: `tools/corpus/date-range.spec.ts`
- Create: `libs/filings/src/nse/nse-date-range.ts`
- Modify: `libs/filings/src/index.ts`

**Interfaces:**
- Consumes: `mapNseRecord`, `Filing` from `@app/filings`.
- Produces: `toNseDateParam(date: Date): string` (formats as `dd-mm-yyyy`); a JSONL corpus at `data/corpus/<from>_<to>.jsonl`.

- [ ] **Step 1: Write the failing test for date-param formatting**

Create `tools/corpus/date-range.spec.ts`:
```ts
import { toNseDateParam } from '@app/filings';

describe('toNseDateParam', () => {
  it('formats as dd-mm-yyyy in IST', () => {
    // 2026-08-05T04:58:18Z is 05-Aug-2026 in IST
    expect(toNseDateParam(new Date('2026-08-05T04:58:18.000Z'))).toBe('05-08-2026');
  });

  it('uses the IST calendar day, not the UTC day', () => {
    // 2026-08-04T20:00:00Z is 05-Aug-2026 01:30 IST — must be the 5th, not the 4th
    expect(toNseDateParam(new Date('2026-08-04T20:00:00.000Z'))).toBe('05-08-2026');
  });

  it('zero-pads single-digit days and months', () => {
    expect(toNseDateParam(new Date('2026-01-03T12:00:00.000Z'))).toBe('03-01-2026');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest date-range`
Expected: FAIL — `toNseDateParam is not a function`

- [ ] **Step 3: Implement toNseDateParam**

Create `libs/filings/src/nse/nse-date-range.ts`:
```ts
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Formats a Date as the `dd-mm-yyyy` parameter NSE's date-range endpoint expects,
 * using the IST calendar day. A UTC-day formatting would silently shift filings
 * between 18:30 and 00:00 UTC onto the wrong day.
 */
export function toNseDateParam(date: Date): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return `${pad(ist.getUTCDate())}-${pad(ist.getUTCMonth() + 1)}-${ist.getUTCFullYear()}`;
}
```

Append to `libs/filings/src/index.ts`:
```ts
export * from './nse/nse-date-range';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest date-range`
Expected: PASS — 3 passing

- [ ] **Step 5: Write the corpus fetch tool**

Create `tools/corpus/fetch-corpus.ts`:
```ts
/**
 * Phase 1 measurement tool. Pulls a date range from NSE's uncapped date-range
 * endpoint and writes one mapped Filing per line as JSONL.
 *
 * Usage: npm run corpus:fetch -- --days 31
 */
import axios from 'axios';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { mapNseRecord, toNseDateParam, type NseRawRecord } from '@app/filings';

const BASE = 'https://www.nseindia.com/api/corporate-announcements';
const LANDING = 'https://www.nseindia.com/companies-listing/corporate-filings-announcements';
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

  const url =
    `${BASE}?index=equities&from_date=${toNseDateParam(from)}&to_date=${toNseDateParam(to)}`;
  console.log(`Fetching ${days} days: ${url}`);

  const started = Date.now();
  const { data } = await client.get<NseRawRecord[]>(url, {
    headers: { Cookie: cookies },
  });
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
      console.warn(`Skipped seq_id=${raw.seq_id}: ${(error as Error).message}`);
    }
  }

  writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
  console.log(`Wrote ${mapped} filings to ${outPath} (${failed} unmappable)`);
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
```

- [ ] **Step 6: Run the tool against live NSE**

Run: `npm run corpus:fetch -- --days 31`
Expected: prints ~17,000 records, writes `data/corpus/*.jsonl`, reports 0 unmappable.

If any records are unmappable, fix `mapNseRecord` and add a regression test before continuing — an unmappable record is a silent data loss path.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add corpus fetch tool for phase 1 yield measurement"
```

---

### Task 4: Corpus analysis — the Phase 1 yield measurement

**Files:**
- Create: `tools/corpus/analyse-corpus.ts`
- Create: `libs/filings/src/logic/ambiguity.ts`
- Modify: `libs/filings/src/index.ts`
- Test: `libs/filings/src/logic/ambiguity.spec.ts`

**Interfaces:**
- Consumes: `Filing`, `isRoutine` from `@app/filings`.
- Produces: `hasAmbiguityKeyword(text: string): boolean`; `extractRupeeAmounts(text: string): number[]` (returns amounts in rupees); a printed funnel report.

- [ ] **Step 1: Write the failing test for ambiguity and amount extraction**

Create `libs/filings/src/logic/ambiguity.spec.ts`:
```ts
import { hasAmbiguityKeyword, extractRupeeAmounts } from './ambiguity';

describe('hasAmbiguityKeyword', () => {
  it.each([
    'Company emerged as L1 bidder for the project',
    'Received a Letter of Intent from the customer',
    'Signed an MoU with the state government',
    'Received in-principle approval from the board',
  ])('flags conditional language: %s', (text) => {
    expect(hasAmbiguityKeyword(text)).toBe(true);
  });

  it('does not flag an unconditional order win', () => {
    expect(
      hasAmbiguityKeyword('Received a work order worth Rs. 78.24 Crore from UNICEF'),
    ).toBe(false);
  });

  it('matches case-insensitively', () => {
    expect(hasAmbiguityKeyword('LETTER OF INTENT received')).toBe(true);
  });

  it('does not match L1 inside an unrelated word', () => {
    expect(hasAmbiguityKeyword('Model XL1000 launched')).toBe(false);
  });
});

describe('extractRupeeAmounts', () => {
  it('parses crore amounts into rupees', () => {
    expect(extractRupeeAmounts('order worth Rs. 78.24 Crore')).toEqual([782_400_000]);
  });

  it('parses lakh amounts into rupees', () => {
    expect(extractRupeeAmounts('penalty of INR 5 Lakh')).toEqual([500_000]);
  });

  it('handles comma-grouped digits', () => {
    expect(extractRupeeAmounts('Rs 1,234.50 crore')).toEqual([12_345_000_000]);
  });

  it('returns every amount found', () => {
    expect(extractRupeeAmounts('Rs 10 crore and Rs 5 lakh')).toEqual([
      100_000_000, 500_000,
    ]);
  });

  it('returns an empty array when no amount is present', () => {
    expect(extractRupeeAmounts('Board meeting scheduled')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest ambiguity`
Expected: FAIL — `Cannot find module './ambiguity'`

- [ ] **Step 3: Implement the helpers**

Create `libs/filings/src/logic/ambiguity.ts`:
```ts
/**
 * Conditional-language markers. A filing containing any of these is NOT a
 * confirmed event — "emerged as L1 bidder" is not "won the order". These force
 * manual review rather than auto-drafting, which is the exact error class seen
 * in competitor headlines.
 */
const AMBIGUITY_PATTERNS: readonly RegExp[] = [
  /\bL-?1\b/i,
  /\bletter of intent\b/i,
  /\bLoI\b/,
  /\bMoU\b/i,
  /\bmemorandum of understanding\b/i,
  /\bin-?principle\b/i,
  /\bpreferred bidder\b/i,
  /\bsubject to\b/i,
];

export const hasAmbiguityKeyword = (text: string): boolean =>
  AMBIGUITY_PATTERNS.some((pattern) => pattern.test(text));

const MULTIPLIERS: Readonly<Record<string, number>> = {
  crore: 10_000_000,
  cr: 10_000_000,
  lakh: 100_000,
  lac: 100_000,
};

const AMOUNT_PATTERN =
  /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d+)?)\s*(crore|cr|lakh|lac)\b/gi;

/**
 * Extracts rupee amounts, normalised to rupees. Returns an empty array when the
 * text carries no figure — which for the newsjack lane means no hook, no post.
 */
export function extractRupeeAmounts(text: string): number[] {
  const amounts: number[] = [];
  for (const match of text.matchAll(AMOUNT_PATTERN)) {
    const value = Number(match[1].replace(/,/g, ''));
    const multiplier = MULTIPLIERS[match[2].toLowerCase()];
    if (Number.isFinite(value) && multiplier) {
      amounts.push(value * multiplier);
    }
  }
  return amounts;
}
```

Append to `libs/filings/src/index.ts`:
```ts
export * from './logic/ambiguity';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest ambiguity`
Expected: PASS — 9 passing

- [ ] **Step 5: Write the analysis tool**

Create `tools/corpus/analyse-corpus.ts`:
```ts
/**
 * Phase 1 deliverable. Replays the deterministic funnel stages over the corpus
 * and reports survivor counts at each stage.
 *
 * The size-relative materiality threshold is NOT applied here — it needs a
 * securities master (market cap by ISIN) that does not exist yet. This measures
 * everything upstream of that gate, which is the bulk of the filtering.
 *
 * Usage: npm run corpus:analyse -- data/corpus/<file>.jsonl
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  isRoutine,
  hasAmbiguityKeyword,
  extractRupeeAmounts,
  type Filing,
} from '@app/filings';

/** Categories that carry defamation or SEBI exposure — never auto-drafted. */
const LEGAL_BLOCK_PATTERNS: readonly RegExp[] = [
  /litigation|arbitration|court|tribunal/i,
  /sebi|show[- ]cause|enforcement|adjudicat/i,
  /insolvency|ibc\b|nclt|liquidat/i,
  /auditor.*(resign|qualif)|qualif.*auditor/i,
  /whistle ?blower|fraud|default|misstatement/i,
];

const isLegallyBlocked = (filing: Filing): boolean =>
  LEGAL_BLOCK_PATTERNS.some(
    (p) => p.test(filing.category) || p.test(filing.summary),
  );

function resolveInputPath(argv: string[]): string {
  const explicit = argv[2];
  if (explicit) return explicit;
  const dir = join(process.cwd(), 'data', 'corpus');
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
  if (files.length === 0) {
    throw new Error('No corpus found. Run `npm run corpus:fetch` first.');
  }
  return join(dir, files[files.length - 1]);
}

function main(): void {
  const path = resolveInputPath(process.argv);
  const filings: Filing[] = readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Filing);

  const days = new Set(
    filings.map((f) => new Date(f.disseminatedAt).toISOString().slice(0, 10)),
  ).size;

  const afterRoutine = filings.filter((f) => !isRoutine(f.category));
  const afterLegal = afterRoutine.filter((f) => !isLegallyBlocked(f));
  const withAmount = afterLegal.filter(
    (f) => extractRupeeAmounts(f.summary).length > 0,
  );
  const unambiguous = withAmount.filter((f) => !hasAmbiguityKeyword(f.summary));

  const line = (label: string, n: number): void => {
    const pct = ((n / filings.length) * 100).toFixed(1);
    console.log(
      `${label.padEnd(34)} ${String(n).padStart(6)}  ${pct.padStart(5)}%  ${(n / days).toFixed(1)}/day`,
    );
  };

  console.log(`\nCorpus: ${path}`);
  console.log(`${filings.length} filings across ${days} days\n`);
  line('total', filings.length);
  line('after routine-category discard', afterRoutine.length);
  line('after legal blocklist', afterLegal.length);
  line('with an extractable amount', withAmount.length);
  line('unambiguous (newsjack candidates)', unambiguous.length);

  console.log('\nTop categories among candidates:');
  const byCategory = new Map<string, number>();
  for (const f of unambiguous) {
    byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + 1);
  }
  [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([cat, n]) => console.log(`  ${String(n).padStart(5)}  ${cat}`));

  const perDay = unambiguous.length / days;
  console.log(
    `\nVERDICT: ${perDay.toFixed(1)} newsjack candidates/day before the ` +
      `market-cap gate.\nThe market-cap gate will reduce this further. If the ` +
      `post-gate figure lands below ~1/day, the newsjack lane cannot sustain a ` +
      `cadence and only the teardown lane justifies itself.\n`,
  );
}

main();
```

- [ ] **Step 6: Run the analysis**

Run: `npm run corpus:analyse`
Expected: a funnel table and a per-day candidate count.

**This is the Phase 1 gate.** Record the output in the spec's Open Questions section before starting Task 5. If the candidate count is implausible (0, or thousands), the deterministic patterns need tuning — fix them here, where it is cheap, not after the scorer exists.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add corpus funnel analysis for phase 1 yield measurement"
```

---

### Task 5: SourceAdapter interface and NSE adapter

**Files:**
- Create: `libs/filings/src/source-adapter.interface.ts`, `libs/filings/src/nse/nse.adapter.ts`
- Create: `apps/ingest/src/session/session.service.ts`
- Create: `test/fixtures/nse-day-range.json`
- Modify: `libs/filings/src/index.ts`
- Test: `libs/filings/src/nse/nse.adapter.spec.ts`

**Interfaces:**
- Consumes: `mapNseRecord`, `toNseDateParam`, `Filing`.
- Produces: `SourceAdapter` with `fetchLatest(): Promise<Filing[]>` and `fetchDay(date: Date): Promise<Filing[]>`; `NseAdapter implements SourceAdapter`; `SessionService.getCookieHeader(): Promise<string>` and `SessionService.invalidate(): void`.

- [ ] **Step 1: Record the day-range fixture (trimmed to keep the repo small)**

```bash
curl -s -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36' \
  -H 'Referer: https://www.nseindia.com/companies-listing/corporate-filings-announcements' \
  "https://www.nseindia.com/api/corporate-announcements?index=equities&from_date=04-08-2026&to_date=04-08-2026" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); json.dump(d[:100], open('test/fixtures/nse-day-range.json','w'), indent=1)"
python3 -c "import json;print('records:',len(json.load(open('test/fixtures/nse-day-range.json'))))"
```
Expected: `records: 100`

- [ ] **Step 2: Write the failing adapter test**

Create `libs/filings/src/nse/nse.adapter.spec.ts`:
```ts
import nock from 'nock';
import { readFileSync } from 'fs';
import { join } from 'path';
import { NseAdapter } from './nse.adapter';

const FIXTURES = join(__dirname, '../../../../test/fixtures');
const livePage = JSON.parse(readFileSync(join(FIXTURES, 'nse-live-page.json'), 'utf8'));
const dayRange = JSON.parse(readFileSync(join(FIXTURES, 'nse-day-range.json'), 'utf8'));

const HOST = 'https://www.nseindia.com';

class StubSession {
  public invalidated = 0;
  async getCookieHeader(): Promise<string> {
    return 'nsit=stub';
  }
  invalidate(): void {
    this.invalidated += 1;
  }
}

describe('NseAdapter', () => {
  let session: StubSession;
  let adapter: NseAdapter;

  beforeEach(() => {
    nock.cleanAll();
    session = new StubSession();
    adapter = new NseAdapter(session);
  });

  afterAll(() => nock.restore());

  it('fetchLatest returns mapped filings from the live page', async () => {
    nock(HOST)
      .get('/api/corporate-announcements')
      .query({ index: 'equities' })
      .reply(200, livePage);

    const filings = await adapter.fetchLatest();

    expect(filings).toHaveLength(20);
    expect(typeof filings[0].seqId).toBe('number');
    expect(filings[0].disseminatedAt).toBeInstanceOf(Date);
  });

  it('fetchLatest sorts descending by seqId regardless of response order', async () => {
    const shuffled = [...livePage].reverse();
    nock(HOST)
      .get('/api/corporate-announcements')
      .query({ index: 'equities' })
      .reply(200, shuffled);

    const filings = await adapter.fetchLatest();
    const ids = filings.map((f) => f.seqId);

    expect(ids).toEqual([...ids].sort((a, b) => b - a));
  });

  it('fetchDay requests the dd-mm-yyyy range for that IST day', async () => {
    nock(HOST)
      .get('/api/corporate-announcements')
      .query({ index: 'equities', from_date: '04-08-2026', to_date: '04-08-2026' })
      .reply(200, dayRange);

    const filings = await adapter.fetchDay(new Date('2026-08-04T10:00:00.000Z'));

    expect(filings).toHaveLength(100);
  });

  it('invalidates the session and retries once on 403', async () => {
    nock(HOST)
      .get('/api/corporate-announcements')
      .query({ index: 'equities' })
      .reply(403, 'Access Denied');
    nock(HOST)
      .get('/api/corporate-announcements')
      .query({ index: 'equities' })
      .reply(200, livePage);

    const filings = await adapter.fetchLatest();

    expect(session.invalidated).toBe(1);
    expect(filings).toHaveLength(20);
  });

  it('throws after the retry also fails, so the caller can trip the breaker', async () => {
    nock(HOST)
      .get('/api/corporate-announcements')
      .query({ index: 'equities' })
      .twice()
      .reply(403, 'Access Denied');

    await expect(adapter.fetchLatest()).rejects.toThrow(/NSE request failed/);
  });

  it('throws when the payload is not an array (NSE error strings)', async () => {
    nock(HOST)
      .get('/api/corporate-announcements')
      .query({ index: 'equities' })
      .reply(200, '"No Record Found!"');

    await expect(adapter.fetchLatest()).rejects.toThrow(/Unexpected NSE payload/);
  });

  it('skips unmappable records rather than failing the whole batch', async () => {
    nock(HOST)
      .get('/api/corporate-announcements')
      .query({ index: 'equities' })
      .reply(200, [{ ...livePage[0], an_dt: 'garbage' }, livePage[1]]);

    const filings = await adapter.fetchLatest();

    expect(filings).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest nse.adapter`
Expected: FAIL — `Cannot find module './nse.adapter'`

- [ ] **Step 4: Write the interface**

Create `libs/filings/src/source-adapter.interface.ts`:
```ts
import type { Filing } from './filing.types';

/**
 * The product boundary. `NseAdapter` implements this today; a licensed vendor
 * feed replaces it when commercial redistribution is required, with no changes
 * above this interface.
 */
export interface SourceAdapter {
  /** Newest filings available on the live page. Cheap; safe to poll every 2s. */
  fetchLatest(): Promise<Filing[]>;

  /** Every filing for the given IST calendar day. The drain / reconcile path. */
  fetchDay(date: Date): Promise<Filing[]>;
}

/** Provides and refreshes the bot-management cookie jar. */
export interface SessionProvider {
  getCookieHeader(): Promise<string>;
  invalidate(): void;
}
```

- [ ] **Step 5: Implement the adapter**

Create `libs/filings/src/nse/nse.adapter.ts`:
```ts
import axios, { type AxiosInstance } from 'axios';
import type { Filing } from '../filing.types';
import type { SessionProvider, SourceAdapter } from '../source-adapter.interface';
import { mapNseRecord } from './nse.mapper';
import { toNseDateParam } from './nse-date-range';
import type { NseRawRecord } from './nse.types';

const BASE_PATH = '/api/corporate-announcements';
const ORIGIN = 'https://www.nseindia.com';
const LANDING = `${ORIGIN}/companies-listing/corporate-filings-announcements`;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export class NseAdapter implements SourceAdapter {
  private readonly http: AxiosInstance;

  constructor(
    private readonly session: SessionProvider,
    http?: AxiosInstance,
  ) {
    this.http =
      http ??
      axios.create({
        baseURL: ORIGIN,
        timeout: 15_000,
        headers: { 'User-Agent': UA, Referer: LANDING, Accept: '*/*' },
        // Non-2xx must reject so the retry path and circuit breaker can see it.
        validateStatus: (status) => status >= 200 && status < 300,
      });
  }

  async fetchLatest(): Promise<Filing[]> {
    return this.fetch({ index: 'equities' });
  }

  async fetchDay(date: Date): Promise<Filing[]> {
    const day = toNseDateParam(date);
    return this.fetch({ index: 'equities', from_date: day, to_date: day });
  }

  /** Issues the request, retrying exactly once after a session refresh on 401/403. */
  private async fetch(params: Record<string, string>): Promise<Filing[]> {
    try {
      return await this.request(params);
    } catch (error) {
      if (!this.isAuthFailure(error)) throw error;
      this.session.invalidate();
      try {
        return await this.request(params);
      } catch (retryError) {
        throw new Error(
          `NSE request failed after session refresh: ${(retryError as Error).message}`,
        );
      }
    }
  }

  private async request(params: Record<string, string>): Promise<Filing[]> {
    const cookie = await this.session.getCookieHeader();
    const { data } = await this.http.get<NseRawRecord[] | string>(BASE_PATH, {
      params,
      headers: { Cookie: cookie },
    });

    // NSE returns a bare JSON string (e.g. "No Record Found!") instead of an
    // error status when it has nothing to give.
    if (!Array.isArray(data)) {
      throw new Error(`Unexpected NSE payload: ${JSON.stringify(data).slice(0, 80)}`);
    }

    const filings: Filing[] = [];
    for (const raw of data) {
      try {
        filings.push(mapNseRecord(raw));
      } catch {
        // A single malformed record must not discard the whole batch.
        continue;
      }
    }

    return filings.sort((a, b) => b.seqId - a.seqId);
  }

  private isAuthFailure(error: unknown): boolean {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    return status === 401 || status === 403;
  }
}
```

Append to `libs/filings/src/index.ts`:
```ts
export * from './source-adapter.interface';
export * from './nse/nse.adapter';
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx jest nse.adapter`
Expected: PASS — 7 passing

- [ ] **Step 7: Implement SessionService**

Create `apps/ingest/src/session/session.service.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import type { SessionProvider } from '@app/filings';

const LANDING =
  'https://www.nseindia.com/companies-listing/corporate-filings-announcements';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Cookies live ~30 min in practice; refresh well before that. */
const TTL_MS = 10 * 60 * 1000;

@Injectable()
export class SessionService implements SessionProvider {
  private readonly logger = new Logger(SessionService.name);
  private cookieHeader: string | null = null;
  private fetchedAt = 0;
  private inFlight: Promise<string> | null = null;

  async getCookieHeader(): Promise<string> {
    const fresh = this.cookieHeader && Date.now() - this.fetchedAt < TTL_MS;
    if (fresh) return this.cookieHeader as string;

    // Collapse concurrent refreshes so a burst of polls issues one bootstrap.
    this.inFlight ??= this.bootstrap().finally(() => {
      this.inFlight = null;
    });

    return this.inFlight;
  }

  invalidate(): void {
    this.logger.warn('Session invalidated; next request will re-bootstrap');
    this.cookieHeader = null;
    this.fetchedAt = 0;
  }

  private async bootstrap(): Promise<string> {
    const response = await axios.get(LANDING, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      timeout: 15_000,
    });

    const header = (response.headers['set-cookie'] ?? [])
      .map((cookie: string) => cookie.split(';')[0])
      .join('; ');

    if (!header) {
      throw new Error('NSE landing page returned no cookies');
    }

    this.cookieHeader = header;
    this.fetchedAt = Date.now();
    this.logger.log('NSE session bootstrapped');
    return header;
  }
}
```

- [ ] **Step 8: Verify the whole suite still passes**

Run: `npm test`
Expected: PASS — all suites green

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add SourceAdapter interface, NSE adapter and session service"
```

---

### Task 6: Rollover detection and adaptive cadence

This is the highest-value test in the system. It guards the no-loss guarantee.

**Files:**
- Create: `libs/filings/src/logic/rollover.ts`, `libs/filings/src/logic/cadence.ts`
- Modify: `libs/filings/src/index.ts`
- Test: `libs/filings/src/logic/rollover.spec.ts`, `libs/filings/src/logic/cadence.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `detectRollover(input: RolloverInput): RolloverResult`; `nextPollDelayMs(input: CadenceInput): number`; `isInFilingWindow(now: Date): boolean`.

- [ ] **Step 1: Write the failing rollover test**

Create `libs/filings/src/logic/rollover.spec.ts`:
```ts
import { detectRollover } from './rollover';

describe('detectRollover', () => {
  it('treats every record as new on first run and demands a drain', () => {
    const result = detectRollover({ pageSeqIds: [30, 20, 10], cursor: null });

    expect(result.newSeqIds).toEqual([30, 20, 10]);
    expect(result.holeDetected).toBe(true);
  });

  it('returns only ids above the cursor when the page overlaps', () => {
    const result = detectRollover({ pageSeqIds: [50, 40, 30, 20], cursor: 30 });

    expect(result.newSeqIds).toEqual([50, 40]);
    expect(result.holeDetected).toBe(false);
  });

  it('reports no new records when the cursor is at the top of the page', () => {
    const result = detectRollover({ pageSeqIds: [50, 40, 30], cursor: 50 });

    expect(result.newSeqIds).toEqual([]);
    expect(result.holeDetected).toBe(false);
  });

  it('detects a hole when the whole page is newer than the cursor', () => {
    // Page turned over between polls: nothing on it overlaps what we have.
    const result = detectRollover({ pageSeqIds: [90, 80, 70], cursor: 60 });

    expect(result.newSeqIds).toEqual([90, 80, 70]);
    expect(result.holeDetected).toBe(true);
  });

  it('does not flag a hole when the oldest id equals the cursor', () => {
    const result = detectRollover({ pageSeqIds: [90, 80, 70], cursor: 70 });

    expect(result.newSeqIds).toEqual([90, 80]);
    expect(result.holeDetected).toBe(false);
  });

  it('tolerates non-contiguous seq ids, which are normal', () => {
    // seq_id is a global counter; gaps belong to other NSE streams.
    const result = detectRollover({
      pageSeqIds: [106725630, 106725580, 106725492],
      cursor: 106725492,
    });

    expect(result.newSeqIds).toEqual([106725630, 106725580]);
    expect(result.holeDetected).toBe(false);
  });

  it('handles an empty page without claiming a hole', () => {
    const result = detectRollover({ pageSeqIds: [], cursor: 100 });

    expect(result.newSeqIds).toEqual([]);
    expect(result.holeDetected).toBe(false);
  });

  it('sorts unordered input descending before deciding', () => {
    const result = detectRollover({ pageSeqIds: [20, 50, 30, 40], cursor: 30 });

    expect(result.newSeqIds).toEqual([50, 40]);
    expect(result.holeDetected).toBe(false);
  });

  it('never returns ids at or below the cursor', () => {
    const result = detectRollover({ pageSeqIds: [10, 20, 30], cursor: 30 });

    expect(result.newSeqIds.every((id) => id > 30)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest rollover`
Expected: FAIL — `Cannot find module './rollover'`

- [ ] **Step 3: Implement detectRollover**

Create `libs/filings/src/logic/rollover.ts`:
```ts
export interface RolloverInput {
  /** seq_ids present on the fetched page, any order. */
  pageSeqIds: readonly number[];
  /** Highest seq_id already ingested, or null before the first successful poll. */
  cursor: number | null;
}

export interface RolloverResult {
  /** Ids to ingest, descending. */
  newSeqIds: number[];
  /** True when the page cannot prove continuity with what we already hold. */
  holeDetected: boolean;
}

/**
 * Decides what to ingest and whether a drain is required.
 *
 * The completeness rule: if the OLDEST id on the page is still newer than our
 * cursor, the page turned over between polls and there is no overlap to prove
 * we saw everything in between. We cannot use seq_id contiguity for this —
 * seq_id is a global counter across all NSE streams, so gaps are normal and
 * prove nothing. Overlap is the only honest signal.
 */
export function detectRollover({ pageSeqIds, cursor }: RolloverInput): RolloverResult {
  const descending = [...pageSeqIds].sort((a, b) => b - a);

  if (descending.length === 0) {
    return { newSeqIds: [], holeDetected: false };
  }

  if (cursor === null) {
    // Cold start: nothing to overlap against, so drain the day to be safe.
    return { newSeqIds: descending, holeDetected: true };
  }

  const oldestOnPage = descending[descending.length - 1];

  return {
    newSeqIds: descending.filter((id) => id > cursor),
    holeDetected: oldestOnPage > cursor,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest rollover`
Expected: PASS — 9 passing

- [ ] **Step 5: Write the failing cadence test**

Create `libs/filings/src/logic/cadence.spec.ts`:
```ts
import { nextPollDelayMs, isInFilingWindow } from './cadence';

const HOT = 2000;
const IDLE = 30000;
const opts = { hotIntervalMs: HOT, idleIntervalMs: IDLE, burstThreshold: 8 };

// 2026-08-05T04:58:18Z === 10:28:18 IST
const midMorningIst = new Date('2026-08-05T04:58:18.000Z');
// 2026-08-05T20:00:00Z === 01:30 IST next day
const deadOfNightIst = new Date('2026-08-05T20:00:00.000Z');
// 2026-08-05T13:00:00Z === 18:30 IST — results window, still hot
const eveningIst = new Date('2026-08-05T13:00:00.000Z');

describe('isInFilingWindow', () => {
  it('is open mid-morning IST', () => {
    expect(isInFilingWindow(midMorningIst)).toBe(true);
  });

  it('is open in the evening results window', () => {
    expect(isInFilingWindow(eveningIst)).toBe(true);
  });

  it('is closed in the small hours IST', () => {
    expect(isInFilingWindow(deadOfNightIst)).toBe(false);
  });
});

describe('nextPollDelayMs', () => {
  it('returns the hot interval inside the filing window', () => {
    expect(nextPollDelayMs({ newCount: 1, now: midMorningIst, ...opts })).toBe(HOT);
  });

  it('returns the idle interval outside the filing window', () => {
    expect(nextPollDelayMs({ newCount: 0, now: deadOfNightIst, ...opts })).toBe(IDLE);
  });

  it('re-polls immediately when a burst fills the page', () => {
    expect(nextPollDelayMs({ newCount: 8, now: midMorningIst, ...opts })).toBe(0);
  });

  it('re-polls immediately on a burst even outside the filing window', () => {
    // Filings do land off-window; a burst there matters more, not less.
    expect(nextPollDelayMs({ newCount: 12, now: deadOfNightIst, ...opts })).toBe(0);
  });

  it('does not treat a count just below the threshold as a burst', () => {
    expect(nextPollDelayMs({ newCount: 7, now: midMorningIst, ...opts })).toBe(HOT);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx jest cadence`
Expected: FAIL — `Cannot find module './cadence'`

- [ ] **Step 7: Implement cadence**

Create `libs/filings/src/logic/cadence.ts`:
```ts
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Filings land far outside market hours — results routinely arrive 17:00–21:00
 * IST. The window is deliberately wider than the trading session.
 */
const WINDOW_OPEN_HOUR_IST = 7;
const WINDOW_CLOSE_HOUR_IST = 23;

export function isInFilingWindow(now: Date): boolean {
  const istHour = new Date(now.getTime() + IST_OFFSET_MS).getUTCHours();
  return istHour >= WINDOW_OPEN_HOUR_IST && istHour < WINDOW_CLOSE_HOUR_IST;
}

export interface CadenceInput {
  /** New records ingested on the poll that just completed. */
  newCount: number;
  now: Date;
  hotIntervalMs: number;
  idleIntervalMs: number;
  /** New-record count at which the page is assumed to be filling fast. */
  burstThreshold: number;
}

/**
 * Delay before the next poll. A burst means the 20-record page is turning over
 * quickly, so we re-poll immediately rather than waiting out the interval and
 * risking a rollover.
 */
export function nextPollDelayMs({
  newCount,
  now,
  hotIntervalMs,
  idleIntervalMs,
  burstThreshold,
}: CadenceInput): number {
  if (newCount >= burstThreshold) return 0;
  return isInFilingWindow(now) ? hotIntervalMs : idleIntervalMs;
}
```

Append to `libs/filings/src/index.ts`:
```ts
export * from './logic/rollover';
export * from './logic/cadence';
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx jest cadence`
Expected: PASS — 8 passing

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add rollover detection and adaptive poll cadence"
```

---

### Task 7: Mongo schema and repository

**Files:**
- Create: `libs/filings/src/persistence/filing.schema.ts`, `libs/filings/src/persistence/filing.repository.ts`
- Modify: `libs/filings/src/index.ts`
- Test: `libs/filings/src/persistence/filing.repository.spec.ts`

**Interfaces:**
- Consumes: `Filing`.
- Produces: `FilingDocument`, `FilingSchema`, `FilingRepository` with `insertNew(filings: Filing[]): Promise<Filing[]>` (returns only rows that did not already exist) and `getMaxSeqId(): Promise<number | null>`.

- [ ] **Step 1: Install the in-memory Mongo test server**

```bash
npm i -D --legacy-peer-deps mongodb-memory-server@^9.4.0
```

- [ ] **Step 2: Write the failing repository test**

Create `libs/filings/src/persistence/filing.repository.spec.ts`:
```ts
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { FilingRepository } from './filing.repository';
import { FilingSchema, type FilingDocument } from './filing.schema';
import type { Filing } from '../filing.types';

const makeFiling = (seqId: number): Filing => ({
  seqId,
  symbol: 'TEST',
  isin: 'INE000000001',
  companyName: 'Test Ltd',
  industry: 'Testing',
  category: 'Bagging/Receiving of orders/contracts',
  summary: `Order number ${seqId}`,
  attachmentUrl: null,
  announcedAt: new Date('2026-08-05T04:58:17.000Z'),
  disseminatedAt: new Date('2026-08-05T04:58:18.000Z'),
  ingestedAt: new Date('2026-08-05T04:58:19.000Z'),
});

describe('FilingRepository', () => {
  let mongo: MongoMemoryServer;
  let model: Model<FilingDocument>;
  let repo: FilingRepository;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    model = mongoose.model<FilingDocument>('Filing', FilingSchema);
    await model.syncIndexes();
  }, 60_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await model.deleteMany({});
    repo = new FilingRepository(model);
  });

  it('inserts new filings and returns them', async () => {
    const inserted = await repo.insertNew([makeFiling(10), makeFiling(20)]);

    expect(inserted.map((f) => f.seqId).sort()).toEqual([10, 20]);
    expect(await model.countDocuments()).toBe(2);
  });

  it('returns only genuinely new filings on a second call', async () => {
    await repo.insertNew([makeFiling(10), makeFiling(20)]);

    const second = await repo.insertNew([makeFiling(20), makeFiling(30)]);

    expect(second.map((f) => f.seqId)).toEqual([30]);
    expect(await model.countDocuments()).toBe(3);
  });

  it('is idempotent — re-inserting the same batch yields nothing new', async () => {
    const batch = [makeFiling(10), makeFiling(20)];
    await repo.insertNew(batch);

    expect(await repo.insertNew(batch)).toEqual([]);
    expect(await model.countDocuments()).toBe(2);
  });

  it('getMaxSeqId returns null on an empty collection', async () => {
    expect(await repo.getMaxSeqId()).toBeNull();
  });

  it('getMaxSeqId returns the highest seqId', async () => {
    await repo.insertNew([makeFiling(10), makeFiling(500), makeFiling(200)]);

    expect(await repo.getMaxSeqId()).toBe(500);
  });

  it('handles an empty batch without touching the database', async () => {
    expect(await repo.insertNew([])).toEqual([]);
  });

  it('enforces uniqueness on seqId at the index level', async () => {
    const indexes = await model.collection.indexes();
    const seqIndex = indexes.find((i) => i.key?.seqId !== undefined);

    expect(seqIndex?.unique).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest filing.repository`
Expected: FAIL — `Cannot find module './filing.repository'`

- [ ] **Step 4: Implement the schema**

Create `libs/filings/src/persistence/filing.schema.ts`:
```ts
import { Schema, type Document } from 'mongoose';
import type { Filing } from '../filing.types';

export type FilingDocument = Filing & Document;

export const FilingSchema = new Schema<FilingDocument>(
  {
    seqId: { type: Number, required: true, unique: true, index: true },
    symbol: { type: String, required: true, index: true },
    isin: { type: String, required: true, index: true },
    companyName: { type: String, required: true },
    industry: { type: String, default: null },
    category: { type: String, required: true, index: true },
    summary: { type: String, default: '' },
    attachmentUrl: { type: String, default: null },
    announcedAt: { type: Date, required: true },
    disseminatedAt: { type: Date, required: true, index: true },
    ingestedAt: { type: Date, required: true },
  },
  { collection: 'filings', versionKey: false },
);
```

- [ ] **Step 5: Implement the repository**

Create `libs/filings/src/persistence/filing.repository.ts`:
```ts
import type { Model } from 'mongoose';
import type { Filing } from '../filing.types';
import type { FilingDocument } from './filing.schema';

/** MongoDB duplicate-key error code. */
const DUPLICATE_KEY = 11000;

export class FilingRepository {
  constructor(private readonly model: Model<FilingDocument>) {}

  /**
   * Inserts filings, returning ONLY those that did not already exist.
   *
   * The return value is what gates alerting: an alert fires on insert, never on
   * a record we have already seen. Using unordered insertMany plus duplicate-key
   * filtering keeps that decision atomic at the database, so a restart mid-poll
   * cannot re-alert.
   */
  async insertNew(filings: readonly Filing[]): Promise<Filing[]> {
    if (filings.length === 0) return [];

    try {
      const docs = await this.model.insertMany(filings, { ordered: false });
      return docs.map((doc) => doc.toObject() as Filing);
    } catch (error) {
      const inserted = this.extractInserted(error, filings);
      if (inserted === null) throw error;
      return inserted;
    }
  }

  async getMaxSeqId(): Promise<number | null> {
    const top = await this.model
      .findOne({}, { seqId: 1 })
      .sort({ seqId: -1 })
      .lean()
      .exec();

    return top?.seqId ?? null;
  }

  /**
   * On a partially-successful unordered insertMany, Mongo throws but reports
   * which indexes failed. Everything not in that set was written.
   * Returns null when the error is not a duplicate-key error.
   */
  private extractInserted(
    error: unknown,
    filings: readonly Filing[],
  ): Filing[] | null {
    const bulk = error as {
      code?: number;
      writeErrors?: Array<{ index?: number; err?: { index?: number; code?: number } }>;
    };

    const writeErrors = bulk.writeErrors ?? [];
    const allDuplicates =
      writeErrors.length > 0 &&
      writeErrors.every((we) => (we.err?.code ?? bulk.code) === DUPLICATE_KEY);

    if (!allDuplicates && bulk.code !== DUPLICATE_KEY) return null;

    const failedIndexes = new Set(
      writeErrors.map((we) => we.index ?? we.err?.index).filter((i): i is number => i !== undefined),
    );

    return filings.filter((_, index) => !failedIndexes.has(index));
  }
}
```

Append to `libs/filings/src/index.ts`:
```ts
export * from './persistence/filing.schema';
export * from './persistence/filing.repository';
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx jest filing.repository`
Expected: PASS — 7 passing

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add filing schema and repository with insert-only detection"
```

---

### Task 8: Cold-start alert gating

**Files:**
- Create: `libs/filings/src/logic/alert-window.ts`
- Modify: `libs/filings/src/index.ts`
- Test: `libs/filings/src/logic/alert-window.spec.ts`

**Interfaces:**
- Consumes: `Filing`.
- Produces: `isWithinAlertWindow(filing: Filing, now: Date, windowMs: number): boolean`; `partitionForAlerting(filings, now, windowMs): { alertable: Filing[]; silent: Filing[] }`.

- [ ] **Step 1: Write the failing test**

Create `libs/filings/src/logic/alert-window.spec.ts`:
```ts
import { isWithinAlertWindow, partitionForAlerting } from './alert-window';
import type { Filing } from '../filing.types';

const WINDOW = 10 * 60 * 1000;
const now = new Date('2026-08-05T05:00:00.000Z');

const at = (iso: string): Filing => ({
  seqId: 1,
  symbol: 'TEST',
  isin: 'INE000000001',
  companyName: 'Test Ltd',
  industry: null,
  category: 'Bagging/Receiving of orders/contracts',
  summary: 'Order received',
  attachmentUrl: null,
  announcedAt: new Date(iso),
  disseminatedAt: new Date(iso),
  ingestedAt: now,
});

describe('isWithinAlertWindow', () => {
  it('allows a filing disseminated seconds ago', () => {
    expect(isWithinAlertWindow(at('2026-08-05T04:59:50.000Z'), now, WINDOW)).toBe(true);
  });

  it('rejects a filing disseminated an hour ago', () => {
    expect(isWithinAlertWindow(at('2026-08-05T04:00:00.000Z'), now, WINDOW)).toBe(false);
  });

  it('rejects a filing exactly at the window edge', () => {
    expect(isWithinAlertWindow(at('2026-08-05T04:50:00.000Z'), now, WINDOW)).toBe(false);
  });

  it('allows a filing just inside the window edge', () => {
    expect(isWithinAlertWindow(at('2026-08-05T04:50:01.000Z'), now, WINDOW)).toBe(true);
  });

  it('allows a filing with a slightly future timestamp (clock skew)', () => {
    expect(isWithinAlertWindow(at('2026-08-05T05:00:05.000Z'), now, WINDOW)).toBe(true);
  });
});

describe('partitionForAlerting', () => {
  it('suppresses a historical backfill entirely', () => {
    // The cold-start storm case: a drain returns a full day of old filings.
    const backfill = Array.from({ length: 1000 }, () => at('2026-08-04T10:00:00.000Z'));

    const { alertable, silent } = partitionForAlerting(backfill, now, WINDOW);

    expect(alertable).toHaveLength(0);
    expect(silent).toHaveLength(1000);
  });

  it('splits a mixed batch correctly', () => {
    const batch = [at('2026-08-05T04:59:00.000Z'), at('2026-08-04T10:00:00.000Z')];

    const { alertable, silent } = partitionForAlerting(batch, now, WINDOW);

    expect(alertable).toHaveLength(1);
    expect(silent).toHaveLength(1);
  });

  it('handles an empty batch', () => {
    expect(partitionForAlerting([], now, WINDOW)).toEqual({ alertable: [], silent: [] });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest alert-window`
Expected: FAIL — `Cannot find module './alert-window'`

- [ ] **Step 3: Implement the gate**

Create `libs/filings/src/logic/alert-window.ts`:
```ts
import type { Filing } from '../filing.types';

/**
 * Guards the cold-start alert storm: a first run, or a restart after downtime,
 * drains up to ~1000 filings that all look new to the repository. Without this
 * gate every one of them would fire a Telegram alert.
 *
 * Uses `disseminatedAt` (the exchange clock), never ingest or local time.
 */
export function isWithinAlertWindow(
  filing: Filing,
  now: Date,
  windowMs: number,
): boolean {
  const age = now.getTime() - new Date(filing.disseminatedAt).getTime();
  // Negative age means NSE's clock is marginally ahead of ours; still fresh.
  return age < windowMs;
}

export interface AlertPartition {
  alertable: Filing[];
  silent: Filing[];
}

/** Splits a batch into what may alert and what is stored silently. */
export function partitionForAlerting(
  filings: readonly Filing[],
  now: Date,
  windowMs: number,
): AlertPartition {
  const alertable: Filing[] = [];
  const silent: Filing[] = [];

  for (const filing of filings) {
    (isWithinAlertWindow(filing, now, windowMs) ? alertable : silent).push(filing);
  }

  return { alertable, silent };
}
```

Append to `libs/filings/src/index.ts`:
```ts
export * from './logic/alert-window';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest alert-window`
Expected: PASS — 8 passing

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add cold-start alert window gating"
```

---

### Task 9: Circuit breaker

**Files:**
- Create: `apps/ingest/src/poller/circuit-breaker.ts`
- Test: `apps/ingest/src/poller/circuit-breaker.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `CircuitBreaker` class with `recordSuccess(): void`, `recordFailure(): boolean` (returns true exactly on the transition into the degraded state), `isDegraded(): boolean`, `consecutiveFailures(): number`.

- [ ] **Step 1: Write the failing test**

Create `apps/ingest/src/poller/circuit-breaker.spec.ts`:
```ts
import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
  it('starts healthy', () => {
    const breaker = new CircuitBreaker(3);

    expect(breaker.isDegraded()).toBe(false);
    expect(breaker.consecutiveFailures()).toBe(0);
  });

  it('does not trip below the threshold', () => {
    const breaker = new CircuitBreaker(3);

    expect(breaker.recordFailure()).toBe(false);
    expect(breaker.recordFailure()).toBe(false);
    expect(breaker.isDegraded()).toBe(false);
  });

  it('signals exactly once on the transition into degraded', () => {
    const breaker = new CircuitBreaker(3);
    breaker.recordFailure();
    breaker.recordFailure();

    expect(breaker.recordFailure()).toBe(true);
    // Already degraded — must not re-notify on every subsequent failure.
    expect(breaker.recordFailure()).toBe(false);
    expect(breaker.isDegraded()).toBe(true);
  });

  it('resets on success', () => {
    const breaker = new CircuitBreaker(3);
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();

    expect(breaker.consecutiveFailures()).toBe(0);
    expect(breaker.recordFailure()).toBe(false);
  });

  it('recovers from degraded on success and can trip again', () => {
    const breaker = new CircuitBreaker(2);
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.isDegraded()).toBe(true);

    breaker.recordSuccess();
    expect(breaker.isDegraded()).toBe(false);

    breaker.recordFailure();
    expect(breaker.recordFailure()).toBe(true);
  });

  it('rejects a threshold below 1', () => {
    expect(() => new CircuitBreaker(0)).toThrow(/threshold/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest circuit-breaker`
Expected: FAIL — `Cannot find module './circuit-breaker'`

- [ ] **Step 3: Implement the breaker**

Create `apps/ingest/src/poller/circuit-breaker.ts`:
```ts
/**
 * Counts consecutive poll failures so a blind poller becomes louder than a
 * healthy one. `recordFailure` returns true only on the transition into the
 * degraded state, so the operator is notified once rather than every 2 seconds.
 */
export class CircuitBreaker {
  private failures = 0;
  private degraded = false;

  constructor(private readonly threshold: number) {
    if (!Number.isInteger(threshold) || threshold < 1) {
      throw new Error('CircuitBreaker threshold must be an integer >= 1');
    }
  }

  recordSuccess(): void {
    this.failures = 0;
    this.degraded = false;
  }

  /** @returns true exactly on the transition healthy -> degraded. */
  recordFailure(): boolean {
    this.failures += 1;
    if (this.failures >= this.threshold && !this.degraded) {
      this.degraded = true;
      return true;
    }
    return false;
  }

  isDegraded(): boolean {
    return this.degraded;
  }

  consecutiveFailures(): number {
    return this.failures;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest circuit-breaker`
Expected: PASS — 6 passing

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add poller circuit breaker"
```

---

### Task 10: Telegram client and wire-format alert formatter

**Files:**
- Create: `libs/notify/src/alert-formatter.ts`, `libs/notify/src/telegram.service.ts`
- Modify: `libs/notify/src/index.ts`
- Test: `libs/notify/src/alert-formatter.spec.ts`

**Interfaces:**
- Consumes: `Filing` from `@app/filings`.
- Produces: `formatFilingAlert(filing: Filing): string`; `formatDegradedAlert(consecutiveFailures: number, lastError: string): string`; `TelegramService.send(text: string): Promise<void>`.

- [ ] **Step 1: Write the failing formatter test**

Create `libs/notify/src/alert-formatter.spec.ts`:
```ts
import { formatFilingAlert, formatDegradedAlert } from './alert-formatter';
import type { Filing } from '@app/filings';

const filing: Filing = {
  seqId: 106725630,
  symbol: 'PANACEABIO',
  isin: 'INE922B01023',
  companyName: 'Panacea Biotec Limited',
  industry: 'Pharmaceuticals',
  category: 'Bagging/Receiving of orders/contracts',
  summary:
    'Panacea Biotec Limited has informed the Exchange about receiving a letter ' +
    'of award for supply of bivalent oral polio vaccine to UNICEF.',
  attachmentUrl: 'https://nsearchives.nseindia.com/corporate/X.pdf',
  announcedAt: new Date('2026-08-05T04:58:17.000Z'),
  disseminatedAt: new Date('2026-08-05T04:58:18.000Z'),
  ingestedAt: new Date('2026-08-05T04:58:19.000Z'),
};

describe('formatFilingAlert', () => {
  it('leads with the symbol in caps, wire style', () => {
    expect(formatFilingAlert(filing).split('\n')[0]).toBe(
      'PANACEABIO — BAGGING/RECEIVING OF ORDERS/CONTRACTS',
    );
  });

  it('includes the summary verbatim, not paraphrased', () => {
    expect(formatFilingAlert(filing)).toContain(filing.summary);
  });

  it('renders the dissemination time in IST', () => {
    expect(formatFilingAlert(filing)).toContain('10:28:18 IST');
  });

  it('includes the source attachment link', () => {
    expect(formatFilingAlert(filing)).toContain(filing.attachmentUrl as string);
  });

  it('omits the source line when there is no attachment', () => {
    const output = formatFilingAlert({ ...filing, attachmentUrl: null });

    expect(output).not.toContain('Source:');
  });

  it('escapes HTML so a filing cannot inject markup into the message', () => {
    const output = formatFilingAlert({
      ...filing,
      summary: 'Order <b>worth</b> & more',
    });

    expect(output).toContain('Order &lt;b&gt;worth&lt;/b&gt; &amp; more');
  });
});

describe('formatDegradedAlert', () => {
  it('states the failure count and the error', () => {
    const output = formatDegradedAlert(3, 'Request failed with status code 403');

    expect(output).toContain('INGEST DEGRADED');
    expect(output).toContain('3 consecutive');
    expect(output).toContain('403');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest alert-formatter`
Expected: FAIL — `Cannot find module './alert-formatter'`

- [ ] **Step 3: Implement the formatter**

Create `libs/notify/src/alert-formatter.ts`:
```ts
import type { Filing } from '@app/filings';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const pad = (n: number): string => String(n).padStart(2, '0');

const toIstClock = (date: Date): string => {
  const ist = new Date(new Date(date).getTime() + IST_OFFSET_MS);
  return `${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}:${pad(ist.getUTCSeconds())} IST`;
};

/** Telegram HTML parse mode requires these three escaped. */
const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Wire-convention format: symbol and category in caps on line one, then the
 * exchange's own words verbatim. Nothing is paraphrased or interpreted — that
 * is what makes the alert trustworthy and keeps it clear of advisory framing.
 */
export function formatFilingAlert(filing: Filing): string {
  const lines = [
    `${filing.symbol.toUpperCase()} — ${filing.category.toUpperCase()}`,
    '',
    escapeHtml(filing.summary),
    '',
    toIstClock(filing.disseminatedAt),
  ];

  if (filing.attachmentUrl) {
    lines.push(`Source: ${filing.attachmentUrl}`);
  }

  return lines.join('\n');
}

export function formatDegradedAlert(
  consecutiveFailures: number,
  lastError: string,
): string {
  return [
    'INGEST DEGRADED',
    '',
    `${consecutiveFailures} consecutive poll failures.`,
    `Last error: ${escapeHtml(lastError)}`,
  ].join('\n');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest alert-formatter`
Expected: PASS — 7 passing

- [ ] **Step 5: Implement the Telegram service**

Create `libs/notify/src/telegram.service.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly bot: TelegramBot | null;
  private readonly chatId: string;

  constructor(config: ConfigService) {
    const token = config.get<string>('TELEGRAM_BOT_TOKEN') ?? '';
    this.chatId = config.get<string>('TELEGRAM_CHAT_ID') ?? '';

    // Absent credentials must degrade to logging, never crash ingest.
    this.bot = token ? new TelegramBot(token, { polling: false }) : null;
    if (!this.bot) {
      this.logger.warn('TELEGRAM_BOT_TOKEN unset — alerts will only be logged');
    }
  }

  async send(text: string): Promise<void> {
    if (!this.bot || !this.chatId) {
      this.logger.log(`[alert suppressed]\n${text}`);
      return;
    }

    try {
      await this.bot.sendMessage(this.chatId, text, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
    } catch (error) {
      // A Telegram outage must never stop ingestion.
      this.logger.error(`Telegram send failed: ${(error as Error).message}`);
    }
  }
}
```

Replace `libs/notify/src/index.ts`:
```ts
export * from './alert-formatter';
export * from './telegram.service';
```

- [ ] **Step 6: Verify the suite passes**

Run: `npm test`
Expected: PASS — all suites green

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add telegram service and wire-format alert formatter"
```

---

### Task 11: AlertService with watchlist matching

**Files:**
- Create: `apps/ingest/src/alert/alert.service.ts`
- Test: `apps/ingest/src/alert/alert.service.spec.ts`

**Interfaces:**
- Consumes: `Filing`, `isRoutine`, `partitionForAlerting`, `TelegramService`, `formatFilingAlert`.
- Produces: `AlertService.processInserted(filings: Filing[], now?: Date): Promise<Filing[]>` returning the filings that actually alerted.

- [ ] **Step 1: Write the failing test**

Create `apps/ingest/src/alert/alert.service.spec.ts`:
```ts
import { AlertService } from './alert.service';
import type { Filing } from '@app/filings';

const now = new Date('2026-08-05T05:00:00.000Z');

const makeFiling = (overrides: Partial<Filing> = {}): Filing => ({
  seqId: 1,
  symbol: 'PANACEABIO',
  isin: 'INE922B01023',
  companyName: 'Panacea Biotec Limited',
  industry: 'Pharmaceuticals',
  category: 'Bagging/Receiving of orders/contracts',
  summary: 'Order received',
  attachmentUrl: null,
  announcedAt: new Date('2026-08-05T04:59:50.000Z'),
  disseminatedAt: new Date('2026-08-05T04:59:50.000Z'),
  ingestedAt: now,
  ...overrides,
});

describe('AlertService', () => {
  let sent: string[];
  let service: AlertService;

  const telegram = { send: async (t: string) => void sent.push(t) };

  beforeEach(() => {
    sent = [];
    service = new AlertService(telegram as never, {
      alertWindowMs: 10 * 60 * 1000,
      watchlist: [],
    });
  });

  it('alerts a fresh non-routine filing', async () => {
    const alerted = await service.processInserted([makeFiling()], now);

    expect(alerted).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('PANACEABIO');
  });

  it('suppresses routine categories', async () => {
    const alerted = await service.processInserted(
      [makeFiling({ category: 'Copy of Newspaper Publication' })],
      now,
    );

    expect(alerted).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('suppresses a stale backfill entirely', async () => {
    const backfill = Array.from({ length: 500 }, (_, i) =>
      makeFiling({ seqId: i, disseminatedAt: new Date('2026-08-04T10:00:00.000Z') }),
    );

    const alerted = await service.processInserted(backfill, now);

    expect(alerted).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('restricts to the watchlist when one is configured', async () => {
    service = new AlertService(telegram as never, {
      alertWindowMs: 10 * 60 * 1000,
      watchlist: ['RELIANCE'],
    });

    const alerted = await service.processInserted(
      [makeFiling({ symbol: 'PANACEABIO' }), makeFiling({ seqId: 2, symbol: 'RELIANCE' })],
      now,
    );

    expect(alerted.map((f) => f.symbol)).toEqual(['RELIANCE']);
  });

  it('matches the watchlist case-insensitively', async () => {
    service = new AlertService(telegram as never, {
      alertWindowMs: 10 * 60 * 1000,
      watchlist: ['reliance'],
    });

    const alerted = await service.processInserted(
      [makeFiling({ symbol: 'RELIANCE' })],
      now,
    );

    expect(alerted).toHaveLength(1);
  });

  it('sends oldest-first so the feed reads chronologically', async () => {
    const older = makeFiling({ seqId: 1, symbol: 'AAA' });
    const newer = makeFiling({ seqId: 2, symbol: 'BBB' });

    await service.processInserted([newer, older], now);

    expect(sent[0]).toContain('AAA');
    expect(sent[1]).toContain('BBB');
  });

  it('handles an empty batch', async () => {
    expect(await service.processInserted([], now)).toEqual([]);
    expect(sent).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest alert.service`
Expected: FAIL — `Cannot find module './alert.service'`

- [ ] **Step 3: Implement the service**

Create `apps/ingest/src/alert/alert.service.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { isRoutine, partitionForAlerting, type Filing } from '@app/filings';
import { formatFilingAlert, TelegramService } from '@app/notify';

export interface AlertOptions {
  alertWindowMs: number;
  /** Empty means alert on every non-routine filing. */
  watchlist: readonly string[];
}

@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);
  private readonly watchlist: ReadonlySet<string>;

  constructor(
    private readonly telegram: TelegramService,
    private readonly options: AlertOptions,
  ) {
    this.watchlist = new Set(options.watchlist.map((s) => s.toUpperCase()));
  }

  /**
   * Called with filings the repository confirmed as NEW inserts. Never call this
   * with the full poll result — alerting on anything already stored would
   * re-notify on every restart.
   */
  async processInserted(filings: readonly Filing[], now = new Date()): Promise<Filing[]> {
    if (filings.length === 0) return [];

    const { alertable, silent } = partitionForAlerting(
      filings,
      now,
      this.options.alertWindowMs,
    );

    if (silent.length > 0) {
      this.logger.log(`Stored ${silent.length} filings outside the alert window`);
    }

    const matched = alertable
      .filter((filing) => !isRoutine(filing.category))
      .filter((filing) => this.isWatched(filing))
      .sort((a, b) => a.seqId - b.seqId);

    for (const filing of matched) {
      await this.telegram.send(formatFilingAlert(filing));
    }

    return matched;
  }

  private isWatched(filing: Filing): boolean {
    if (this.watchlist.size === 0) return true;
    return this.watchlist.has(filing.symbol.toUpperCase());
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest alert.service`
Expected: PASS — 7 passing

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add alert service with watchlist and cold-start gating"
```

---

### Task 12: PollerService and application wiring

**Files:**
- Create: `apps/ingest/src/poller/poller.service.ts`, `apps/ingest/src/config/configuration.ts`
- Modify: `apps/ingest/src/ingest.module.ts`, `apps/ingest/src/main.ts`
- Create: `README.md`
- Test: `apps/ingest/src/poller/poller.service.spec.ts`

**Interfaces:**
- Consumes: `SourceAdapter`, `FilingRepository`, `AlertService`, `CircuitBreaker`, `detectRollover`, `nextPollDelayMs`.
- Produces: `PollerService.tick(now?: Date): Promise<PollResult>` where `PollResult = { ingested: number; alerted: number; drained: boolean; delayMs: number }`.

- [ ] **Step 1: Write the failing poller test**

Create `apps/ingest/src/poller/poller.service.spec.ts`:
```ts
import { PollerService } from './poller.service';
import type { Filing, SourceAdapter } from '@app/filings';

const now = new Date('2026-08-05T04:58:20.000Z'); // 10:28 IST, inside the window

const makeFiling = (seqId: number, iso = '2026-08-05T04:58:18.000Z'): Filing => ({
  seqId,
  symbol: 'TEST',
  isin: 'INE000000001',
  companyName: 'Test Ltd',
  industry: null,
  category: 'Bagging/Receiving of orders/contracts',
  summary: `Order ${seqId}`,
  attachmentUrl: null,
  announcedAt: new Date(iso),
  disseminatedAt: new Date(iso),
  ingestedAt: now,
});

class StubAdapter implements SourceAdapter {
  public latest: Filing[] = [];
  public day: Filing[] = [];
  public dayCalls = 0;
  public failNext: Error | null = null;

  async fetchLatest(): Promise<Filing[]> {
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
    return this.latest;
  }

  async fetchDay(): Promise<Filing[]> {
    this.dayCalls += 1;
    return this.day;
  }
}

class StubRepo {
  public stored = new Map<number, Filing>();
  async insertNew(filings: readonly Filing[]): Promise<Filing[]> {
    const fresh = filings.filter((f) => !this.stored.has(f.seqId));
    fresh.forEach((f) => this.stored.set(f.seqId, f));
    return fresh;
  }
  async getMaxSeqId(): Promise<number | null> {
    const ids = [...this.stored.keys()];
    return ids.length ? Math.max(...ids) : null;
  }
}

class StubAlerts {
  public alerted: Filing[] = [];
  async processInserted(filings: readonly Filing[]): Promise<Filing[]> {
    this.alerted.push(...filings);
    return [...filings];
  }
}

describe('PollerService', () => {
  let adapter: StubAdapter;
  let repo: StubRepo;
  let alerts: StubAlerts;
  let degraded: string[];
  let service: PollerService;

  beforeEach(() => {
    adapter = new StubAdapter();
    repo = new StubRepo();
    alerts = new StubAlerts();
    degraded = [];
    service = new PollerService(
      adapter,
      repo as never,
      alerts as never,
      { send: async (t: string) => void degraded.push(t) } as never,
      { hotIntervalMs: 2000, idleIntervalMs: 30000, burstThreshold: 8, failureThreshold: 3 },
    );
  });

  it('ingests new filings and drains on the first run', async () => {
    adapter.latest = [makeFiling(30), makeFiling(20)];
    adapter.day = [makeFiling(30), makeFiling(20), makeFiling(10)];

    const result = await service.tick(now);

    // Cold start has no cursor to overlap against, so it must drain.
    expect(result.drained).toBe(true);
    expect(adapter.dayCalls).toBe(1);
    expect(result.ingested).toBe(3);
  });

  it('does not drain when the page overlaps the cursor', async () => {
    adapter.latest = [makeFiling(30), makeFiling(20)];
    adapter.day = [];
    await service.tick(now);
    adapter.dayCalls = 0;

    adapter.latest = [makeFiling(40), makeFiling(30), makeFiling(20)];
    const result = await service.tick(now);

    expect(result.drained).toBe(false);
    expect(adapter.dayCalls).toBe(0);
    expect(result.ingested).toBe(1);
  });

  it('drains when the page has rolled over past the cursor', async () => {
    adapter.latest = [makeFiling(20), makeFiling(10)];
    adapter.day = [];
    await service.tick(now);
    adapter.dayCalls = 0;

    // Every id on the new page is above the cursor — no overlap, possible hole.
    adapter.latest = [makeFiling(90), makeFiling(80)];
    adapter.day = [makeFiling(90), makeFiling(80), makeFiling(50), makeFiling(30)];
    const result = await service.tick(now);

    expect(result.drained).toBe(true);
    expect(adapter.dayCalls).toBe(1);
    // The drain recovered the two filings the hot page never showed us.
    expect(repo.stored.has(50)).toBe(true);
    expect(repo.stored.has(30)).toBe(true);
  });

  it('does not re-alert filings already stored', async () => {
    adapter.latest = [makeFiling(30)];
    adapter.day = [makeFiling(30)];
    await service.tick(now);
    const firstCount = alerts.alerted.length;

    await service.tick(now);

    expect(alerts.alerted.length).toBe(firstCount);
  });

  it('returns the hot interval as the next delay inside the window', async () => {
    adapter.latest = [makeFiling(30)];
    adapter.day = [makeFiling(30)];

    expect((await service.tick(now)).delayMs).toBe(2000);
  });

  it('returns zero delay when a burst fills the page', async () => {
    adapter.latest = Array.from({ length: 10 }, (_, i) => makeFiling(100 + i));
    adapter.day = adapter.latest;

    expect((await service.tick(now)).delayMs).toBe(0);
  });

  it('sends a degraded alert after the failure threshold', async () => {
    adapter.failNext = new Error('403 Access Denied');
    await service.tick(now);
    adapter.failNext = new Error('403 Access Denied');
    await service.tick(now);
    expect(degraded).toHaveLength(0);

    adapter.failNext = new Error('403 Access Denied');
    await service.tick(now);

    expect(degraded).toHaveLength(1);
    expect(degraded[0]).toContain('INGEST DEGRADED');
  });

  it('does not throw when a poll fails, so the loop survives', async () => {
    adapter.failNext = new Error('network down');

    await expect(service.tick(now)).resolves.toMatchObject({ ingested: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest poller.service`
Expected: FAIL — `Cannot find module './poller.service'`

- [ ] **Step 3: Implement the poller**

Create `apps/ingest/src/poller/poller.service.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import {
  detectRollover,
  nextPollDelayMs,
  type Filing,
  type FilingRepository,
  type SourceAdapter,
} from '@app/filings';
import { formatDegradedAlert, TelegramService } from '@app/notify';
import { AlertService } from '../alert/alert.service';
import { CircuitBreaker } from './circuit-breaker';

export interface PollerOptions {
  hotIntervalMs: number;
  idleIntervalMs: number;
  burstThreshold: number;
  failureThreshold: number;
}

export interface PollResult {
  ingested: number;
  alerted: number;
  drained: boolean;
  delayMs: number;
}

@Injectable()
export class PollerService {
  private readonly logger = new Logger(PollerService.name);
  private readonly breaker: CircuitBreaker;
  private cursor: number | null = null;
  private running = false;

  constructor(
    private readonly adapter: SourceAdapter,
    private readonly repository: FilingRepository,
    private readonly alerts: AlertService,
    private readonly telegram: TelegramService,
    private readonly options: PollerOptions,
  ) {
    this.breaker = new CircuitBreaker(options.failureThreshold);
  }

  /** Restores the cursor from storage so a restart does not re-alert. */
  async initialise(): Promise<void> {
    this.cursor = await this.repository.getMaxSeqId();
    this.logger.log(`Resuming from cursor ${this.cursor ?? 'cold start'}`);
  }

  /** Runs the poll loop until `stop()` is called. */
  async start(): Promise<void> {
    this.running = true;
    await this.initialise();

    while (this.running) {
      const { delayMs } = await this.tick();
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  stop(): void {
    this.running = false;
  }

  /**
   * One poll cycle. Never throws — a poll failure must not kill the loop, it
   * must be counted so the breaker can escalate.
   */
  async tick(now = new Date()): Promise<PollResult> {
    let page: Filing[];
    try {
      page = await this.adapter.fetchLatest();
      this.breaker.recordSuccess();
    } catch (error) {
      return this.handleFailure(error as Error, now);
    }

    const { newSeqIds, holeDetected } = detectRollover({
      pageSeqIds: page.map((f) => f.seqId),
      cursor: this.cursor,
    });

    const newOnPage = page.filter((f) => newSeqIds.includes(f.seqId));
    let candidates: Filing[] = newOnPage;

    if (holeDetected) {
      // No overlap with what we hold — re-pull the whole IST day and reconcile.
      this.logger.warn('Rollover detected; draining the day');
      try {
        const day = await this.adapter.fetchDay(now);
        candidates = this.mergeById(newOnPage, day);
      } catch (error) {
        this.logger.error(`Drain failed: ${(error as Error).message}`);
      }
    }

    const inserted = await this.repository.insertNew(candidates);
    const alerted = await this.alerts.processInserted(inserted, now);

    if (page.length > 0) {
      this.cursor = Math.max(this.cursor ?? 0, ...page.map((f) => f.seqId));
    }

    return {
      ingested: inserted.length,
      alerted: alerted.length,
      drained: holeDetected,
      delayMs: nextPollDelayMs({
        newCount: newSeqIds.length,
        now,
        hotIntervalMs: this.options.hotIntervalMs,
        idleIntervalMs: this.options.idleIntervalMs,
        burstThreshold: this.options.burstThreshold,
      }),
    };
  }

  private mergeById(a: readonly Filing[], b: readonly Filing[]): Filing[] {
    const merged = new Map<number, Filing>();
    for (const filing of [...a, ...b]) merged.set(filing.seqId, filing);
    return [...merged.values()];
  }

  private async handleFailure(error: Error, now: Date): Promise<PollResult> {
    this.logger.error(`Poll failed: ${error.message}`);

    if (this.breaker.recordFailure()) {
      await this.telegram.send(
        formatDegradedAlert(this.breaker.consecutiveFailures(), error.message),
      );
    }

    return {
      ingested: 0,
      alerted: 0,
      drained: false,
      delayMs: nextPollDelayMs({
        newCount: 0,
        now,
        hotIntervalMs: this.options.hotIntervalMs,
        idleIntervalMs: this.options.idleIntervalMs,
        burstThreshold: this.options.burstThreshold,
      }),
    };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest poller.service`
Expected: PASS — 8 passing

- [ ] **Step 5: Write the typed configuration**

Create `apps/ingest/src/config/configuration.ts`:
```ts
export interface IngestConfig {
  mongoUri: string;
  telegramBotToken: string;
  telegramChatId: string;
  hotIntervalMs: number;
  idleIntervalMs: number;
  alertWindowMs: number;
  burstThreshold: number;
  failureThreshold: number;
  watchlist: string[];
}

const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const loadConfig = (): IngestConfig => ({
  mongoUri: process.env.MONGO_URI ?? 'mongodb://localhost:27017/redbox',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? '',
  hotIntervalMs: int(process.env.NSE_HOT_INTERVAL_MS, 2000),
  idleIntervalMs: int(process.env.NSE_IDLE_INTERVAL_MS, 30000),
  alertWindowMs: int(process.env.ALERT_WINDOW_MS, 600_000),
  burstThreshold: int(process.env.BURST_THRESHOLD, 8),
  failureThreshold: int(process.env.FAILURE_THRESHOLD, 3),
  watchlist: (process.env.WATCHLIST ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
});
```

- [ ] **Step 6: Wire the module**

Replace `apps/ingest/src/ingest.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  FilingRepository,
  FilingSchema,
  NseAdapter,
  type FilingDocument,
} from '@app/filings';
import { TelegramService } from '@app/notify';
import { AlertService } from './alert/alert.service';
import { PollerService } from './poller/poller.service';
import { SessionService } from './session/session.service';
import { loadConfig } from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [loadConfig] }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('mongoUri'),
      }),
    }),
    MongooseModule.forFeature([{ name: 'Filing', schema: FilingSchema }]),
  ],
  providers: [
    SessionService,
    TelegramService,
    {
      provide: NseAdapter,
      inject: [SessionService],
      useFactory: (session: SessionService) => new NseAdapter(session),
    },
    {
      provide: FilingRepository,
      inject: [getModelToken('Filing')],
      useFactory: (model: Model<FilingDocument>) => new FilingRepository(model),
    },
    {
      provide: AlertService,
      inject: [TelegramService, ConfigService],
      useFactory: (telegram: TelegramService, config: ConfigService) =>
        new AlertService(telegram, {
          alertWindowMs: config.get<number>('alertWindowMs') as number,
          watchlist: config.get<string[]>('watchlist') as string[],
        }),
    },
    {
      provide: PollerService,
      inject: [NseAdapter, FilingRepository, AlertService, TelegramService, ConfigService],
      useFactory: (
        adapter: NseAdapter,
        repository: FilingRepository,
        alerts: AlertService,
        telegram: TelegramService,
        config: ConfigService,
      ) =>
        new PollerService(adapter, repository, alerts, telegram, {
          hotIntervalMs: config.get<number>('hotIntervalMs') as number,
          idleIntervalMs: config.get<number>('idleIntervalMs') as number,
          burstThreshold: config.get<number>('burstThreshold') as number,
          failureThreshold: config.get<number>('failureThreshold') as number,
        }),
    },
  ],
})
export class IngestModule {}
```

- [ ] **Step 7: Wire the entrypoint**

Replace `apps/ingest/src/main.ts`:
```ts
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { IngestModule } from './ingest.module';
import { PollerService } from './poller/poller.service';

async function bootstrap(): Promise<void> {
  const logger = new Logger('bootstrap');
  const app = await NestFactory.createApplicationContext(IngestModule);
  app.enableShutdownHooks();

  const poller = app.get(PollerService);

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`${signal} received, stopping poller`);
    poller.stop();
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  logger.log('Starting ingest poll loop');
  await poller.start();
}

void bootstrap();
```

- [ ] **Step 8: Verify build and full suite**

Run: `npm run build && npm test`
Expected: build exits 0; all suites pass.

- [ ] **Step 9: Check coverage meets the 80% bar**

Run: `npm run test:cov`
Expected: statements ≥80%. If below, add tests for the uncovered branches before committing — do not lower the bar.

- [ ] **Step 10: Smoke-test against live NSE**

```bash
docker compose up -d
cp .env.example .env   # fill TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
npm run start:dev
```

Expected within 30 seconds: `Resuming from cursor cold start`, then `Rollover detected; draining the day`, then a stored count. **No alert storm** — the drain is historical and the alert window suppresses it. If Telegram floods, stop immediately; the cold-start gate is broken.

- [ ] **Step 11: Write README.md**

```markdown
# Redbox — NSE filings ingest

Low-latency ingest of NSE corporate announcements with a no-loss guarantee,
feeding a Telegram alert lane.

## Quick start

    docker compose up -d
    cp .env.example .env      # set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
    npm install --legacy-peer-deps
    npm run start:dev

## Phase 1 measurement

    npm run corpus:fetch -- --days 31
    npm run corpus:analyse

Reports the deterministic funnel and the per-day newsjack candidate count.

## How the no-loss guarantee works

A 2s hot poll reads NSE's 20-record live page. If the OLDEST seq_id on that page
is still newer than our cursor, the page turned over between polls and we cannot
prove continuity — so we drain the full IST day from the uncapped date-range
endpoint and reconcile. seq_id is a global counter across NSE streams, so gaps in
it are normal and are never used as a loss signal.

## Design docs

- Spec: `docs/superpowers/specs/2026-08-05-filings-pipeline-design.md`
- Plan: `docs/superpowers/plans/2026-08-05-ingest-core.md`
```

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: add poller service, application wiring and readme"
```

---

## Self-Review

**Spec coverage.** Every phase 1–3 requirement maps to a task: monorepo split (T1), adapter interface (T5), IST clock discipline (T2), hot/drain two-tier polling (T12), rollover completeness (T6, T12), cold-start storm protection (T8, T11), circuit-breaker degraded alerting (T9, T12), insert-only alerting (T7, T11), wire-format headlines (T10), corpus measurement (T3, T4), recorded-fixture testing (T2, T5), 80% coverage (T12 step 9).

**Deliberately deferred, matching the spec's Open Questions:** the market-cap materiality gate (needs a securities master), the BSE adapter (endpoint unverified), and all phase 4 content components. Task 4 measures the funnel *upstream* of the market-cap gate and prints an explicit verdict, which is the phase 1 deliverable.

**Known interface consistency points:** `SessionProvider` (T5) is what `SessionService` (T5) implements and what `NseAdapter` consumes. `FilingRepository.insertNew` returns only new rows (T7) — that return value is exactly what `AlertService.processInserted` consumes (T11), which is the mechanism preventing re-alerting on restart. `nextPollDelayMs` (T6) takes the same options object shape that `PollerOptions` (T12) supplies.
