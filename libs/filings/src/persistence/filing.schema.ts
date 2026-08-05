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
