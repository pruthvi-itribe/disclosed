import { act } from '@testing-library/react';
import type { ApiResult } from './api-get';

/** Shared doubles for the poll specs — split when the suite hit the cap. */
export const envelope = <T,>(data: T, meta: unknown = null) => ({
  success: true,
  data,
  error: null,
  meta,
});

export const SUMMARY = { totalFilings: 11918, todayIstDay: '2026-08-18' };
export const FILINGS = [{ seqId: 1 }, { seqId: 2 }];
export const META = { total: 2, offset: 0, returned: 2, hasMore: false };

export type AnyResult = Promise<ApiResult<unknown>>;

export const okApiGet = () =>
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  vi.fn((path: string, _current?: () => boolean): AnyResult => {
    if (path === '/api/summary') {
      return Promise.resolve({ status: 'ok', body: envelope(SUMMARY) });
    }
    return Promise.resolve({ status: 'ok', body: envelope(FILINGS, META) });
  });

export const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
