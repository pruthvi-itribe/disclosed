import type { Model } from 'mongoose';

/**
 * Builds the indexes for the account collections at dashboard boot.
 *
 * ================================================================
 * THE OPPOSITE OF `FilingRepository.assertIndexes`, ON PURPOSE
 * ================================================================
 *
 * That one FAILS rather than repairs when an index is missing, and this one
 * creates. The asymmetry is the whole point and is about ownership, not taste:
 *
 *   - `filings` is shared with a LIVE POLLER. A background index build there
 *     competes with the write path this project exists to keep fast, so it is
 *     an operational event an operator must choose — a dashboard quietly
 *     building one behind them would defeat the check.
 *   - `users`, `sessions` and `watchlists` are THIS PROCESS'S OWN. It is the
 *     only writer, they are empty on day one, and a build on them costs
 *     nothing and races nothing.
 *
 * It is also not optional. `sessions.expiresAt` is the only thing that ever
 * deletes a session, and `users.email` unique is the only thing that stops two
 * registrations for one address racing into two accounts. A dashboard running
 * without these is a dashboard quietly accumulating both.
 *
 * WHY IT IS NOT `autoIndex: true`. The connection carries `autoIndex: false` so
 * this application can never alter the `filings` collection, including its
 * indexes, and that must stay true. This builds indexes on the account models
 * BY NAME instead, which is narrow enough to be obviously safe.
 */

/** Only the two methods this needs, so a caller cannot hand it a write handle by accident. */
export interface IndexableModel {
  readonly modelName: string;
  createIndexes: Model<never>['createIndexes'];
}

/**
 * Creates every index the account schemas declare.
 *
 * `createIndexes` rather than `syncIndexes`: sync DROPS indexes the schema does
 * not declare, and this process shares a database with the ingest. A drop is
 * not a thing a viewer should ever be able to do to a collection it did not
 * write, even one of its own — an operator debugging with a hand-made index
 * should not lose it to a dashboard restart.
 *
 * REJECTS rather than logging, so a boot that cannot build a TTL index is a
 * boot that fails. Silent success here is a sessions collection that grows
 * forever and an email uniqueness guarantee that does not exist.
 */
export const assertAccountIndexes = async (
  models: readonly IndexableModel[],
): Promise<void> => {
  for (const model of models) {
    try {
      await model.createIndexes();
    } catch (error) {
      throw new Error(
        `Could not build the indexes for the "${model.modelName}" collection. ` +
          'Accounts cannot run without them: the sessions TTL is the only ' +
          'thing that expires a session, and the unique email index is the ' +
          'only thing that stops one address becoming two accounts. ' +
          `Cause: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
};
