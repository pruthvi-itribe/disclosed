import { MAX_ECHO_LENGTH, safeEcho } from './safe-echo';

describe('safeEcho', () => {
  it('passes a short clean value through unchanged', () => {
    expect(safeEcho('106725630')).toBe('106725630');
  });

  it('collapses newlines so a value cannot forge a second log line', () => {
    const forged = 'ok\nMalformed NSE record (seq_id=999): "symbol" is fine';
    const echoed = safeEcho(forged);
    expect(echoed).not.toContain('\n');
    expect(echoed.split('\n')).toHaveLength(1);
  });

  it('collapses carriage returns and tabs too', () => {
    expect(safeEcho('a\rb\tc')).toBe('a b c');
  });

  it('truncates an over-long value to the cap', () => {
    const long = 'x'.repeat(MAX_ECHO_LENGTH * 4);
    expect(safeEcho(long)).toHaveLength(MAX_ECHO_LENGTH);
  });

  it('caps a value whose control characters would otherwise survive', () => {
    const long = `${'y'.repeat(MAX_ECHO_LENGTH * 2)}\n${'z'.repeat(10)}`;
    const echoed = safeEcho(long);
    expect(echoed).toHaveLength(MAX_ECHO_LENGTH);
    expect(echoed).not.toContain('\n');
  });
});
