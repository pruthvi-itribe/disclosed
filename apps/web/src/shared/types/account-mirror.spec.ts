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
