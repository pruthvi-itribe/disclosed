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

  // CROSS-ORIGIN CALLERS, AND THERE ARE NORMALLY NONE. The React client is
  // served same-origin, so this list is empty in production and CORS never
  // engages. It is here for a local dev server on another port, for
  // non-browser clients — and for the mobile shell, whose WebView serves the
  // bundled client from a local scheme and asks this origin from there. The
  // shell's origins are fixed strings Capacitor owns (capacitor://localhost
  // on iOS, https://localhost on Android), added to CORS_ALLOWED_ORIGINS by
  // the operator at deploy time like every other entry; a hostile native app
  // gains nothing from the allowance because each app's WebView has its own
  // cookie jar and no session in it.
  //
  // `credentials` is on because the session travels as a cookie for a browser,
  // and that is precisely why the origin list may never be `*` — the
  // configuration reader refuses one.
  if (config.corsAllowedOrigins.length > 0) {
    app.enableCors({
      origin: [...config.corsAllowedOrigins],
      credentials: true,
      methods: ['GET', 'POST', 'DELETE'],
      // `If-None-Match` is the client's own revalidation (api-get.ts) and is
      // not a CORS-safelisted header: absent here, every conditional GET from
      // a cross-origin caller dies in preflight and the 304 saving with it.
      allowedHeaders: [
        'Content-Type',
        'Accept',
        'Authorization',
        'If-None-Match',
      ],
      // Without this a cross-origin caller can receive the ETag and never
      // READ it — headers.get('ETag') answers null — so the validator store
      // stays empty and every poll is a full page, silently.
      exposedHeaders: ['ETag'],
    });
  }

  /**
   * WHAT THE FORWARDED HEADERS ARE WORTH, and it is `false` unless an operator
   * said otherwise — see `readTrustProxy`. Two things read this and nothing
   * else does: `req.secure`, which decides whether the session cookie carries
   * `Secure` (`auth/session.service.ts`), and `req.ip`, which is what the auth
   * rate limiter counts (`auth/client-key.ts`).
   *
   * ================================================================
   * WHY A PRECISE SPECIFICATION IS NOT SPOOFABLE
   * ================================================================
   *
   * Express resolves the client address RIGHT TO LEFT. It starts at the socket
   * this process actually accepted, walks outwards through `X-Forwarded-For`
   * while each hop is one the specification names, and stops at the FIRST hop
   * it does not recognise — that address is `req.ip`. A client can prepend
   * anything it likes to the header, but what it prepends lands to the LEFT of
   * where the walk stops, so it is read past and discarded.
   *
   * The property that makes this hold is that the count is DERIVED FROM THE
   * CHAIN rather than raised until something works. Naming more hops than
   * always write the header would let the walk continue into entries a client
   * supplied; naming fewer resolves to a proxy, which is merely coarse. So the
   * failure directions are not symmetric, and the safe mistake is the small
   * number. `TRUST_PROXY=true` is refused at load for the same reason: it
   * recognises every hop, so the walk never stops and lands on the leftmost
   * entry, which is exactly the value the client chose.
   *
   * `X-Forwarded-Proto` is a separate question and a stronger position: express
   * honours it only when the FIRST hop is trusted, and in production nothing a
   * client sends survives to be read. ingress-nginx sets it unconditionally
   * from its own `$scheme` (`proxy_set_header X-Forwarded-Proto
   * $pass_access_scheme`, verified in the controller-v1.11.3 template), so the
   * client's copy is overwritten one hop before it reaches the sidecar. The
   * cookie therefore cannot be downgraded by asking, and cannot be upgraded
   * either — which matters more, because a `Secure` cookie set over plain http
   * is dropped by the browser without a word and the login presents as
   * succeeding and immediately forgetting you.
   *
   * SET UNCONDITIONALLY, INCLUDING THE `false`. Express's own default is
   * `false`, so a host with no `TRUST_PROXY` gets a no-op rather than a
   * different code path — one line that always runs is easier to reason about
   * than a branch that usually does not.
   */
  app.getHttpAdapter().getInstance().set('trust proxy', config.trustProxy);

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
