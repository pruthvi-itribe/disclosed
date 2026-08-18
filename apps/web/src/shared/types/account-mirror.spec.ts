import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The account types are MIRRORED rather than imported (their controllers
 * import Nest, which this project's tsc cannot follow), so every field name
 * is asserted against the controller source — a rename there fails here
 * instead of drifting silently.
 */
const AUTH_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'dashboard',
  'src',
  'auth',
);

describe('the mirrored account types', () => {
  it('MeView matches auth.controller.ts field for field', () => {
    const source = readFileSync(join(AUTH_DIR, 'auth.controller.ts'), 'utf8');
    for (const field of [
      'signedIn',
      'email',
      'watchCount',
      'watchCap',
      'unread',
      'channels',
    ]) {
      expect(source, field).toMatch(new RegExp(`readonly ${field}\\??:`));
    }
  });

  // use-poll clamps the watchlist feed's limit to this value because the
  // server's bounds reader throws rather than clamps; a change there must
  // fail here, not 400 in production.
  it('the watchlist feed limit cap still reads 200 on the server', () => {
    const source = readFileSync(
      join(AUTH_DIR, 'watchlist.controller.ts'),
      'utf8',
    );
    expect(source).toMatch(/MAX_WATCH_LIMIT = 200;/);
  });

  it('WatchedCompany matches watchlist.controller.ts field for field', () => {
    const source = readFileSync(
      join(AUTH_DIR, 'watchlist.controller.ts'),
      'utf8',
    );
    for (const field of [
      'symbol',
      'companyName',
      'addedAt',
      'addedAtIst',
      'filingsHeld',
      'lastFiledAt',
      'lastFiledAtIst',
    ]) {
      expect(source, field).toMatch(new RegExp(`readonly ${field}\\??:`));
    }
  });
});
