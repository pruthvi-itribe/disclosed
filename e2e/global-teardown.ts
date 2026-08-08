import { readFileSync, rmSync } from 'fs';
import mongoose from 'mongoose';
import { ACCOUNT_FILE, mongoUri, STATE_DIR } from './session';

/**
 * Removes the account the run created: the user, its sessions, its watchlist.
 *
 * THROUGH THE DRIVER RATHER THAN THROUGH A ROUTE, because there is no
 * account-deletion route yet (follow-on F8), and a browser suite that left a
 * user document behind on every run would be a slow leak in a real collection.
 *
 * Named collections rather than models: this file has no schemas and needs none
 * to delete three documents.
 *
 * NEVER FAILS THE RUN. A teardown that throws turns a green suite red and tells
 * the operator nothing about the product; the worst case here is one row with a
 * recognisable `e2e-…@turret.test` address, which is exactly why the address is
 * shaped that way.
 */
export default async function globalTeardown(): Promise<void> {
  let email: string;
  try {
    email = (JSON.parse(readFileSync(ACCOUNT_FILE, 'utf8')) as { email: string })
      .email;
  } catch {
    // Setup never got far enough to create one. Nothing to remove.
    return;
  }

  const connection = mongoose.createConnection(mongoUri());
  try {
    await connection.asPromise();
    const db = connection.db;
    if (db) {
      const user = await db.collection('users').findOne({ email });
      if (user) {
        await db.collection('sessions').deleteMany({ userId: user._id });
        await db.collection('watchlists').deleteMany({ userId: user._id });
        await db.collection('users').deleteOne({ _id: user._id });
      }
    }
  } catch (error) {
    // Reported, not thrown. A killed mongod after a green run must not turn the
    // run red — but a leaked account must not be silent either.
    process.stderr.write(
      `e2e teardown could not remove ${email}: ${String(error)}\n`,
    );
  } finally {
    await connection.close();
    rmSync(STATE_DIR, { recursive: true, force: true });
  }
}
