import { createEtagStore } from './etag-store';

/**
 * Express tags EVERY response `W/"..."`. Storing a weak validator and sending
 * it back would make every GET start answering 304 — including views whose
 * renderers were never taught to expect one. Only strong validators are kept.
 */
describe('createEtagStore', () => {
  it('keeps a strong validator and returns it for the same path', () => {
    const store = createEtagStore();
    store.remember('/api/filings?limit=25', '"abc"');
    expect(store.validatorFor('/api/filings?limit=25')).toBe('"abc"');
  });

  it('ignores a weak validator', () => {
    const store = createEtagStore();
    store.remember('/api/summary', 'W/"abc"');
    expect(store.validatorFor('/api/summary')).toBeNull();
  });

  it('keys on the whole path including its query', () => {
    const store = createEtagStore();
    store.remember('/api/filings?limit=25', '"a"');
    expect(store.validatorFor('/api/filings?limit=50')).toBeNull();
  });

  it('returns null for a path it has never seen', () => {
    expect(createEtagStore().validatorFor('/api/nothing')).toBeNull();
  });

  it('replaces a validator when the resource changes', () => {
    const store = createEtagStore();
    store.remember('/api/filings', '"one"');
    store.remember('/api/filings', '"two"');
    expect(store.validatorFor('/api/filings')).toBe('"two"');
  });

  // Nothing authenticated may outlive the tab. A validator is a fingerprint of
  // a signed-in response and belongs in memory only.
  it('touches no browser storage', () => {
    const store = createEtagStore();
    store.remember('/api/filings', '"abc"');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
