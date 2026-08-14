import { describeMongoTarget } from './mongo-target';

/**
 * The tests that matter here are the ones asserting what is NOT printed.
 *
 * A redaction proven only on the shapes it was written against is a redaction
 * that leaks the first time the input looks slightly different — so the cases
 * below are mostly about hosts arriving in forms the naive split would miss.
 */
describe('describeMongoTarget', () => {
  it('keeps a loopback host whole, port included', () => {
    expect(describeMongoTarget('mongodb://localhost:27117/turret')).toBe(
      'mongodb://localhost:27117/turret',
    );
    expect(describeMongoTarget('mongodb://127.0.0.1:27017/turret')).toBe(
      'mongodb://127.0.0.1:27017/turret',
    );
  });

  it('withholds a host that is not this machine, and keeps the database', () => {
    expect(
      describeMongoTarget(
        'mongodb+srv://user:secret@some-cluster.example/turret',
      ),
    ).toBe('mongodb+srv://***@<host-withheld>/turret');
  });

  // THE PASSWORD WAS ALREADY HANDLED; these assert the host is too, which is
  // the whole point of this change.
  it.each([
    'mongodb+srv://u:p@some-cluster.example/turret?retryWrites=true',
    'mongodb://u:p@a.example:27017,b.example:27017/turret?replicaSet=a-set',
    'mongodb://a.example:27017/turret',
  ])('names no host and no option for %s', (uri) => {
    const described = describeMongoTarget(uri);
    expect(described).toContain('<host-withheld>');
    expect(described).not.toContain('example');
    expect(described).not.toContain('replicaSet');
    expect(described).not.toContain('a-set');
    expect(described).not.toContain('secret');
    expect(described).toContain('turret');
  });

  // A replica-set list: one member is as much of a clue as all of them.
  it('withholds every member of a host list, not just the first', () => {
    const described = describeMongoTarget(
      'mongodb://u:p@one.example:27017,two.example:27017/turret',
    );
    expect(described).not.toContain('one');
    expect(described).not.toContain('two');
  });

  // A password may legally contain `/` and `?`, which a naive left-to-right
  // split would read as the start of the path.
  it('is not fooled by a password containing a slash or a question mark', () => {
    const described = describeMongoTarget(
      'mongodb+srv://user:pa/ss?word@some-cluster.example/turret',
    );
    expect(described).toBe('mongodb+srv://***@<host-withheld>/turret');
    expect(described).not.toContain('pa/ss');
  });

  it('drops the query string even when there is no database', () => {
    expect(
      describeMongoTarget(
        'mongodb+srv://u:p@some-cluster.example/?replicaSet=x',
      ),
    ).toBe('mongodb+srv://***@<host-withheld>');
  });

  it('says nothing at all rather than throwing on a malformed value', () => {
    expect(describeMongoTarget('')).toBe('<host-withheld>');
    expect(describeMongoTarget('not-a-uri')).toBe('<host-withheld>');
    expect(describeMongoTarget(undefined as unknown as string)).toBe(
      '<host-withheld>',
    );
  });

  it('keeps the scheme, so srv and standard stay distinguishable', () => {
    expect(describeMongoTarget('mongodb+srv://u:p@x.example/db')).toContain(
      'mongodb+srv://',
    );
    expect(describeMongoTarget('mongodb://u:p@x.example/db')).toContain(
      'mongodb://',
    );
  });
});
