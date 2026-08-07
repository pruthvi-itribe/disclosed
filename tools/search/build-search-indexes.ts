/**
 * Builds the two indexes the search box needs on a LIVE collection, then proves
 * they are the ones the queries actually use.
 *
 * WHY THIS EXISTS AS A TOOL. The dashboard cannot build them: `dashboard.module`
 * sets `autoIndex: false` so a viewer can never alter the collection, which is
 * the right rule and is not being relaxed for a search box. The ingest process
 * builds schema-declared indexes on connect — but only ON CONNECT, and the one
 * process in this system that must not be restarted casually is the poller. So
 * this is how an operator adds the indexes to a running database without taking
 * ingestion down, and it is how anyone re-checks the claims the schema comments
 * make about them.
 *
 * DELIBERATELY NOT `syncIndexes()`, for the reason `enrich-filings.ts` gives:
 * that reconciles the collection against the schema and will DROP and recreate
 * any index whose spec has drifted, including the unique one on `seqId`. A live
 * poller inserting during that window would have every re-seen filing accepted
 * as new, and a restart would re-alert the whole day. `createIndex` is
 * idempotent and additive and cannot drop anything.
 *
 * It writes NO DOCUMENTS. The only thing it changes is the collection's index
 * catalogue.
 *
 * Run:  npm run search:indexes
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { FilingSchema, type FilingDocument } from '@app/filings';
import { CompanyDirectory } from '../../apps/dashboard/src/search/company-directory';

/** The explain fields worth printing; everything else is noise at this size. */
interface Plan {
  readonly stage: string;
  readonly nReturned: number;
  readonly keys: number;
  readonly docs: number;
  readonly ms: number;
}

const uri = (): string => {
  const value = process.env.MONGO_URI;
  if (value === undefined || value === '') {
    throw new Error(
      'MONGO_URI is not set; this tool will not guess a database',
    );
  }
  return value;
};

/** Reads a `find` explain down to the numbers that decide whether it scanned. */
const findPlan = (explained: unknown): Plan => {
  const root = explained as {
    queryPlanner: { winningPlan: Record<string, unknown> };
    executionStats: {
      nReturned: number;
      totalKeysExamined: number;
      totalDocsExamined: number;
      executionTimeMillis: number;
    };
  };
  const stats = root.executionStats;
  return {
    stage: JSON.stringify(root.queryPlanner.winningPlan).includes('COLLSCAN')
      ? 'COLLSCAN'
      : String(root.queryPlanner.winningPlan.stage),
    nReturned: stats.nReturned,
    keys: stats.totalKeysExamined,
    docs: stats.totalDocsExamined,
    ms: stats.executionTimeMillis,
  };
};

/** The same, for an aggregation, whose plan hides one level down. */
const aggregatePlan = (explained: unknown): Plan => {
  const stages = (explained as { stages?: Record<string, unknown>[] }).stages;
  const cursor = stages?.[0]?.$cursor as {
    queryPlanner: { winningPlan: Record<string, unknown> };
    executionStats: {
      nReturned: number;
      totalKeysExamined: number;
      totalDocsExamined: number;
      executionTimeMillis: number;
    };
  };
  return findPlan(cursor);
};

const show = (label: string, plan: Plan): void => {
  console.log(
    `  ${label.padEnd(34)} ${plan.stage.padEnd(20)} ` +
      `returned=${String(plan.nReturned).padStart(5)} ` +
      `keys=${String(plan.keys).padStart(5)} ` +
      `docs=${String(plan.docs).padStart(5)} ` +
      `${plan.ms}ms`,
  );
};

async function main(): Promise<void> {
  await mongoose.connect(uri());
  const model = mongoose.model<FilingDocument>('Filing', FilingSchema);
  const total = await model.collection.countDocuments({});
  console.log(`filings in the collection: ${total}\n`);

  // BUILT FROM THE SCHEMA'S OWN DECLARATIONS rather than restated here. A
  // second copy of the text index's field list and weights would be the thing
  // that silently stops matching the schema, and the whole point of this tool
  // is that what it builds is what the application assumes.
  console.log('building (idempotent; nothing is dropped)…');
  for (const [spec, options] of FilingSchema.indexes()) {
    const name = (options as { name?: string }).name ?? '(unnamed)';
    const started = Date.now();
    await model.collection.createIndex(
      spec as Parameters<typeof model.collection.createIndex>[0],
      options as Parameters<typeof model.collection.createIndex>[1],
    );
    console.log(`  ${name.padEnd(40)} ${Date.now() - started}ms`);
  }

  console.log('\nquery plans (this is the claim the schema comments make):');

  // The type-ahead's two reads. `docs=0` is the assertion: a covered index scan
  // never touches a document, so building the suggestion list cannot pull the
  // collection through the page cache the poller is using.
  show(
    'directory: companies',
    aggregatePlan(
      await model
        .aggregate(CompanyDirectory.COMPANY_PIPELINE, {
          hint: CompanyDirectory.COMPANY_INDEX,
        })
        .explain('executionStats'),
    ),
  );
  show(
    'directory: categories',
    aggregatePlan(
      await model
        .aggregate(CompanyDirectory.CATEGORY_PIPELINE, {
          hint: CompanyDirectory.CATEGORY_INDEX,
        })
        .explain('executionStats'),
    ),
  );

  // And the same two WITHOUT the hint, because the hint is the whole reason
  // they are covered. Printed side by side so nobody has to take that on trust.
  show(
    'directory: companies, unhinted',
    aggregatePlan(
      await model
        .aggregate(CompanyDirectory.COMPANY_PIPELINE)
        .explain('executionStats'),
    ),
  );

  // The search itself, on the queries that returned nothing before it existed.
  for (const term of [
    'britannia',
    'lupin pharma',
    'solar',
    'stock split',
    'zzzqqq',
  ]) {
    show(
      `search: ${JSON.stringify(term)}`,
      findPlan(
        await model
          .find({ $text: { $search: term } })
          .explain('executionStats'),
      ),
    );
  }

  await mongoose.disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
