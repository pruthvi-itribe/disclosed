import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { describeError, stackOf } from '@app/common';
import {
  describeDashboardConfig,
  loadDashboardConfig,
} from './config/configuration';
import { DashboardModule } from './dashboard.module';
import { createShutdownHandler } from './lifecycle/shutdown';

const logger = new Logger('dashboard');

/**
 * Starts the read-only dashboard.
 *
 * This is the ONLY process in the repository that listens on a socket, and
 * `apps/ingest` must stay that way — see the header of `dashboard.module.ts`
 * for why the two apps are separate and what merging them would cost.
 */
async function bootstrap(): Promise<void> {
  // Read before the app is created, so a malformed DASHBOARD_PORT stops the
  // process here rather than inside `listen()` with an error naming neither the
  // variable nor the limit. `ConfigModule` reads the same function again from
  // inside the container; both readings are pure and agree.
  const config = loadDashboardConfig();

  const app = await NestFactory.create(DashboardModule, {
    // NOTHING IS MOUNTED GLOBALLY. This used to mean "no request body is read
    // anywhere", and it no longer does: a password cannot travel in a query
    // string, because query strings land in access logs, `Referer` headers and
    // browser history. `DashboardModule.configure()` mounts
    // `express.json({limit: '4kb'})` on `/api/auth` and nowhere else.
    //
    // What this flag still buys is the part that mattered: no `urlencoded`, so
    // qs's array handling never touches a request, and no `multipart`, so
    // multer stays unreachable. The feed routes, the watchlist routes and the
    // page itself are parsed by nothing.
    bodyParser: false,
  });

  // Express advertises itself in `X-Powered-By` on every response. Removing it
  // is not a defence on its own, but naming the framework and its major version
  // to anyone who can reach the port is free reconnaissance, and this port is
  // reachable by every process on the host.
  app.getHttpAdapter().getInstance().disable('x-powered-by');

  // Exposed so the URL in the README and the process log agree, and with the
  // credentials in the mongo URI redacted: a password in a log file outlives
  // the process that wrote it.
  logger.log(describeDashboardConfig(config));

  // The latch and the error path live in `lifecycle/shutdown.ts` so they can
  // be tested; a re-entrancy bug here is silent until the day two signals
  // arrive close together.
  const shutdown = createShutdownHandler({
    app,
    // Bound rather than wrapped in arrows: Nest's Logger reads `this` for the
    // context tag, so an unbound reference would log without the "dashboard"
    // prefix that tells an operator which process spoke.
    log: logger.log.bind(logger),
    logError: logger.error.bind(logger),
    exit: process.exit,
    describe: describeError,
  });

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // LOOPBACK ONLY. The second argument is not optional and not a default:
  // without it Nest binds every interface, and this is an unauthenticated view
  // of an unauthenticated database. See `DASHBOARD_HOST` for why the host is
  // not configurable.
  await app.listen(config.port, config.host);
  logger.log(`Dashboard listening on http://${config.host}:${config.port}`);
}

void bootstrap().catch((error: unknown) => {
  logger.error(
    `Dashboard failed to start: ${describeError(error)}`,
    stackOf(error),
  );
  process.exit(1);
});
