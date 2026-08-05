import { ok, okWith } from './envelope';

describe('ok', () => {
  it('wraps a payload as a success envelope', () => {
    expect(ok({ total: 3 })).toEqual({
      success: true,
      data: { total: 3 },
      error: null,
      meta: null,
    });
  });

  it('always carries the error key, even on success', () => {
    // A field that only appears on failure is a field the client forgets to
    // check, and then renders `undefined` as though it were data.
    expect('error' in ok([])).toBe(true);
    expect(ok([]).error).toBeNull();
  });

  it('survives a JSON round trip with all four keys intact', () => {
    // `meta: undefined` would be DROPPED by JSON.stringify and the key would
    // simply not exist on the wire, which is the failure this pins.
    expect(Object.keys(JSON.parse(JSON.stringify(ok({ a: 1 }))))).toEqual([
      'success',
      'data',
      'error',
      'meta',
    ]);
  });

  it('does not copy or reorder the payload', () => {
    const data = [1, 2, 3];

    expect(ok(data).data).toBe(data);
  });
});

describe('okWith', () => {
  it('carries metadata alongside the payload', () => {
    expect(okWith(['a'], { total: 1 })).toEqual({
      success: true,
      data: ['a'],
      error: null,
      meta: { total: 1 },
    });
  });
});
