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
