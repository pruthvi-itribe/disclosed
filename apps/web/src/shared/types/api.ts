/**
 * The server's response DTOs, shared by type-only import.
 *
 * IMPORTED, NOT GENERATED: `dashboard.types.ts` is a pure type module — zero
 * imports, zero runtime exports — so `import type` shares the one source of
 * truth and is erased at compile time. Drift is impossible and not one byte
 * of server code reaches the bundle. `type-only-imports.spec.ts` bounds the
 * direction of the dependency: a RUNTIME import escaping apps/web fails the
 * build.
 *
 * Features import from here rather than reaching into the server tree
 * themselves, so the path below exists in exactly one file.
 */
export type {
  FilingView,
  SummaryView,
  PageMeta,
  EnrichmentView,
  ClaimView,
  ClaimCommitmentView,
  ResultsView,
  ResultsFigureView,
  IndustrySource,
} from '../../../../dashboard/src/filings/dashboard.types';
