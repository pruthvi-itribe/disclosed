export interface Filing {
  /** Global NSE sequence id. Monotonic and unique; a cursor, not a completeness proof. */
  seqId: number;
  symbol: string;
  isin: string;
  companyName: string;
  industry: string | null;
  /** NSE `desc` field - the category taxonomy. */
  category: string;
  summary: string;
  attachmentUrl: string | null;
  announcedAt: Date;
  /** Authoritative clock for all latency and alert-window decisions. */
  disseminatedAt: Date;
  ingestedAt: Date;
}
