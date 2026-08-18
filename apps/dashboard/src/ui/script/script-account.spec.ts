import { readFileSync } from 'fs';
import { join } from 'path';
import { SCRIPT_ACCOUNT } from './script-account';

describe('the watching ask', () => {
  // The watchlist feed's bounds reader THROWS a 400 above 200 rather than
  // clamping, and the feed's own limit grows through 500 just by scrolling —
  // sent unclamped, the first Watching poll after that killed the view for
  // the whole session with a red banner every cycle. The React client
  // carries the same clamp as WATCHLIST_FEED_MAX_LIMIT in use-poll.ts.
  it('clamps the watchlist feed limit to the cap the server enforces', () => {
    expect(SCRIPT_ACCOUNT).toContain(
      "'api/watchlist/feed?limit=' + Math.min(state.limit, 200)",
    );
  });

  // The 200 above restates a server constant; if the server moves, this
  // pins the drift the same way account-mirror.spec.ts does for the React
  // client.
  it('mirrors the server constant it restates', () => {
    const source = readFileSync(
      join(__dirname, '../../auth/watchlist.controller.ts'),
      'utf8',
    );
    expect(source).toMatch(/MAX_WATCH_LIMIT = 200;/);
  });
});
