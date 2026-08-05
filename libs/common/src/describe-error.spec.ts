import {
  describeError,
  safeJson,
  safeText,
  stackOf,
  UNPRINTABLE,
} from './describe-error';

/** The shape `String()` cannot convert: no prototype, so no `toString`. */
const nullPrototype = (): unknown => Object.create(null) as unknown;

/** A structure `JSON.stringify` refuses. */
const circular = (): unknown => {
  const node: Record<string, unknown> = {};
  node.self = node;
  return node;
};

describe('safeText', () => {
  const CASES: ReadonlyArray<readonly [string, () => unknown, string]> = [
    ['a string', () => 'access denied', 'access denied'],
    ['a number', () => 42, '42'],
    ['zero', () => 0, '0'],
    ['null', () => null, 'null'],
    ['undefined', () => undefined, 'undefined'],
    ['false', () => false, 'false'],
    ['an Error', () => new Error('boom'), 'Error: boom'],
    ['an array', () => [1, 2], '1,2'],
    ['a plain object', () => ({ a: 1 }), '[object Object]'],
    [
      'a symbol, which String() handles but + does not',
      () => Symbol('x'),
      'Symbol(x)',
    ],
  ];

  it.each(CASES)('renders %s', (_label, make, expected) => {
    expect(safeText(make())).toBe(expected);
  });

  it('renders an object with a null prototype rather than throwing', () => {
    // The whole reason this function exists. `String(Object.create(null))`
    // raises "Cannot convert object to primitive value", and every caller is a
    // catch block — so the raise replaces the error being handled.
    expect(() => String(nullPrototype())).toThrow();

    expect(safeText(nullPrototype())).toBe(UNPRINTABLE);
  });

  it('renders an object whose toString itself throws', () => {
    const hostile = {
      toString(): never {
        throw new Error('no');
      },
    };

    expect(safeText(hostile)).toBe(UNPRINTABLE);
  });

  it('always returns a string, for every shape a throw can take', () => {
    const shapes: unknown[] = [
      'x',
      0,
      null,
      undefined,
      true,
      [],
      {},
      new Error('e'),
      nullPrototype(),
      circular(),
      Symbol('s'),
      () => undefined,
      BigInt(1),
    ];

    for (const shape of shapes) {
      expect(typeof safeText(shape)).toBe('string');
    }
  });
});

describe('safeJson', () => {
  it('serialises an ordinary object', () => {
    expect(safeJson({ ok: false, error_code: 429 })).toBe(
      '{"ok":false,"error_code":429}',
    );
  });

  it('falls back to text when stringify returns undefined', () => {
    // JSON.stringify(undefined) is undefined, not a string.
    expect(safeJson(undefined)).toBe('undefined');
  });

  it('falls back to text on a circular structure', () => {
    expect(safeJson(circular())).toBe('[object Object]');
  });

  it('falls back to the unprintable marker when even that fails', () => {
    // A cycle AND no prototype: stringify throws, then String throws.
    const node = Object.create(null) as Record<string, unknown>;
    node.self = node;

    expect(safeJson(node)).toBe(UNPRINTABLE);
  });

  it('does not throw on a BigInt, which stringify refuses', () => {
    expect(safeJson(BigInt(9))).toBe('9');
  });
});

describe('describeError', () => {
  it('names the error class, because Error and TypeError mean different things', () => {
    expect(describeError(new TypeError('x is not a function'))).toBe(
      'TypeError: x is not a function',
    );
  });

  it('keeps a custom error name', () => {
    const error = new Error('denied');
    error.name = 'AxiosError';

    expect(describeError(error)).toBe('AxiosError: denied');
  });

  it('describes a subclass by its own name', () => {
    class DrainError extends Error {
      constructor() {
        super('day endpoint refused');
        this.name = 'DrainError';
      }
    }

    expect(describeError(new DrainError())).toBe(
      'DrainError: day endpoint refused',
    );
  });

  const NON_ERRORS: ReadonlyArray<readonly [string, () => unknown, string]> = [
    ['a bare string', () => 'access denied', 'access denied'],
    ['null', () => null, 'null'],
    ['undefined', () => undefined, 'undefined'],
    ['a number', () => 42, '42'],
    ['a null-prototype object', nullPrototype, UNPRINTABLE],
  ];

  it.each(NON_ERRORS)('describes %s without throwing', (_l, make, expected) => {
    expect(describeError(make())).toBe(expected);
  });

  it('never throws, for any shape', () => {
    const shapes: unknown[] = [
      new Error('e'),
      'x',
      null,
      undefined,
      nullPrototype(),
      circular(),
      Symbol('s'),
    ];

    for (const shape of shapes) {
      expect(() => describeError(shape)).not.toThrow();
    }
  });
});

describe('stackOf', () => {
  it('returns the stack of a real Error', () => {
    expect(stackOf(new Error('boom'))).toContain('Error: boom');
  });

  it('returns undefined for anything that is not an Error', () => {
    // undefined, not '', because a Nest logger renders undefined as "no stack"
    // and an empty string as a blank stack line.
    for (const shape of [null, undefined, 'x', 42, {}, nullPrototype()]) {
      expect(stackOf(shape)).toBeUndefined();
    }
  });

  it('does not throw on a null-prototype value', () => {
    expect(() => stackOf(nullPrototype())).not.toThrow();
  });
});
