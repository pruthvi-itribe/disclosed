# The three processes this repository runs, from one build.
#
# ONE FILE, FOUR TARGETS, because the three apps share a package.json, a
# lockfile, a tsconfig and every library under `libs/`. Three Dockerfiles would
# be three copies of the same eleven lines and three chances for them to drift
# apart on the node version or the install flags; `--target` names which
# process comes out, and `docker compose` names the target per service.
#
#   docker build --target ingest     -t disclosed-ingest .
#   docker build --target enrichment -t disclosed-enrichment .
#   docker build --target dashboard  -t disclosed-dashboard .
#
# node:20-alpine, pinned by MAJOR only on purpose: a digest pin would freeze
# the security patches this image gets for free on every rebuild, and the
# lockfile is what actually pins what runs.

# --------------------------------------------------------------- the build ---
#
# Dev dependencies live here and nowhere else. `nest build` needs TypeScript,
# the Nest CLI and the schematics; none of the three runtimes needs any of them,
# and this stage is discarded whole.
FROM node:20-alpine AS build
WORKDIR /app

# The manifest before the source, so a source-only change reuses the install
# layer. This is the difference between a 15-second rebuild and a 90-second one.
COPY package.json package-lock.json ./

# --ignore-scripts, and it is not a nicety. `mongodb-memory-server` is a dev
# dependency whose postinstall DOWNLOADS A MONGOD BINARY from a CDN — a build
# that reaches the network for something no runtime uses, and one that fails
# the build when that CDN is having a day. Nothing in the three apps has a
# meaningful install script: `@node-rs/argon2` ships prebuilt binaries as
# optional dependencies rather than compiling anything.
RUN npm ci --ignore-scripts

COPY tsconfig.json nest-cli.json ./
COPY libs ./libs
COPY apps ./apps

# All three at once. `nest build enrichment` emits into the ingest app's tree
# (see `nest-cli.json`), so the two share this one output directory.
RUN npm run build

# ------------------------------------------------------------ the web bundle ---
#
# The React client, built in its own stage from its own lockfile — React and
# Vite never touch the server's dependency tree, which is the whole reason
# `apps/web` is its own npm project. Only the `dashboard` target copies the
# result; `ingest` and `enrichment` never see this stage, so a UI change
# rebuilds nothing of theirs.
FROM node:20-alpine AS web-build
WORKDIR /web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci --ignore-scripts
COPY apps/web ./
# The client's API types are MIRRORED BY IMPORT from the server's own type
# file (type-only-imports.spec.ts holds that rule), so the type check needs
# that one file where the relative import resolves. It is 602 lines of pure
# type declarations with no imports of its own, and nothing of it survives
# into the bundle. Without this line the first dispatched deploy failed:
# every API type collapsed to any and tsc reported the cascade, not the
# cause (2026-08-18).
COPY apps/dashboard/src/filings/dashboard.types.ts /dashboard/src/filings/dashboard.types.ts
# `tsc --noEmit && vite build` — the same two passes CI runs, then the same
# audit CI runs, so an image cannot carry a bundle CI never cleared.
RUN npm run build && npm run audit

# ------------------------------------------------- the production modules ---
#
# A SEPARATE INSTALL RATHER THAN `npm prune`. Pruning mutates the build stage's
# tree in place and leaves whatever the prune did not understand; a clean
# `--omit=dev` install from the same lockfile produces exactly the set the
# lockfile says production is.
FROM node:20-alpine AS modules
WORKDIR /app
COPY package.json package-lock.json ./

# OPTIONAL DEPENDENCIES ARE KEPT, and that is deliberate rather than lazy.
# `@node-rs/argon2` distributes its native binary AS an optional dependency —
# one per platform, selected by npm from `os`/`cpu`/`libc` — so `--omit=optional`
# would produce an image that installs cleanly, boots, and then throws the
# first time anybody signs in or registers. On alpine the one that must land is
# `@node-rs/argon2-linux-<arch>-musl`; the check below fails the build rather
# than shipping an image that cannot hash a password.
RUN npm ci --omit=dev --ignore-scripts \
 && node -e "require('@node-rs/argon2').hashSync('x')" \
 && echo "argon2: native binary present for $(node -p 'process.platform+\"-\"+process.arch')"

# FIREBASE-ADMIN'S OWN OPTIONAL DEPENDENCIES ARE THE EXCEPTION, and they are
# dropped BY NAME rather than by flag — `--omit=optional` would take argon2's
# binary with them, which is the trap above.
#
# `@google-cloud/firestore` and `@google-cloud/storage` are optional
# dependencies of `firebase-admin`, required LAZILY by `admin.firestore()` and
# `admin.storage()`. This codebase calls neither: the only thing it asks
# firebase-admin for is `verifyIdToken` (`apps/dashboard/src/auth/`).
#
# MEASURED, BECAUSE THE HEADLINE IS SMALLER THAN IT LOOKS: the production tree
# is 221.8 MB and this removes 8.8 MB of it (firestore 5.8, storage 2.9). The
# gRPC and protobuf trees those two pull in — `@grpc` at 4.8 MB and
# `google-gax` at 5.4 MB — are hoisted to the top level and stay, because
# nothing here can prove firebase-admin's own code never reaches them. So this
# is a 4% cut and not a transformation, kept because it is free and proven
# rather than because it is large.
#
# PROVEN, NOT ASSUMED. In the built image, `admin.auth()` constructs and
# `verifyIdToken('not-a-token')` rejects with `auth/argument-error` — the
# application's own error, not MODULE_NOT_FOUND. If that ever changes, sign-in
# breaks in firebase mode and this line is the first suspect.
RUN rm -rf node_modules/@google-cloud

# ------------------------------------------------------------- the runtime ---
#
# The shared base for all three processes: the production modules, the compiled
# output, and nothing else. No source, no tsconfig, no dev dependencies, no npm
# scripts — each process is started by `node` directly, so npm is not in the
# process tree and a signal reaches the app rather than a shell.
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# The `node` user ships with the image at uid 1000. Nothing here writes to the
# filesystem — the database is Mongo's volume and the logs go to stdout — so
# the whole tree stays owned by root and readable by nobody in particular.
USER node

COPY --from=modules /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# For the version string and nothing else; no script in it is ever run.
COPY package.json ./

# `dumb-init` is deliberately absent. `node` is pid 1 here and installs its own
# SIGTERM handler — `apps/ingest/src/main.ts` and the dashboard's `main.ts` both
# stop their loops and close the Nest app on it — so there is no zombie reaper
# to add and no signal to forward.

# ----------------------------------------------------------------- ingest ---
#
# The poller. Its budget is two seconds from dissemination to stored, which is
# why the deployed arrangement runs the enrichment lane as its own process:
# see ENRICH_IN_PROCESS in `apps/ingest/src/enrichment/in-process-lane.ts` and
# `docs/deploy-digitalocean.md`.
#
# LISTENS ON NOTHING. It opens no socket, so it publishes no port and needs no
# healthcheck endpoint; whether it is alive is a question for its logs and for
# the dashboard's feed-lag number.
FROM runtime AS ingest
CMD ["node", "dist/apps/ingest/src/main"]

# ------------------------------------------------------------- enrichment ---
#
# The lane that reads documents and proposes claims. Also listens on nothing.
FROM runtime AS enrichment
CMD ["node", "dist/apps/ingest/src/enrichment.main"]

# -------------------------------------------------------------- dashboard ---
#
# THE ONLY PROCESS IN THE REPOSITORY THAT LISTENS ON A SOCKET, and it binds
# 127.0.0.1 — hard-coded, not configurable, for the reason in
# `apps/dashboard/src/config/configuration.ts`. In a container that means it is
# reachable from inside this network namespace and from nowhere else, which is
# why `docker-compose.yml` puts Caddy in the SAME namespace rather than
# publishing a port here. Nothing about that is worked around in this file.
FROM runtime AS dashboard
# The built React bundle. The dashboard itself serves it — to signed-in
# readers only, and only when WEB_CLIENT=react (see the Plan 4 doc for why
# the server and not the Caddy sidecar makes that branch: Caddy can see
# cookie presence, not session validity). WEB_DIST_DIR names the copy for
# the config, so a deployment sets nothing but the flag — which is what
# keeps the cutover and its rollback one environment variable, no rebuild.
COPY --from=web-build /web/dist /srv/web
ENV WEB_DIST_DIR=/srv/web
EXPOSE 7717
# Asks the app the same question a monitor would, over the loopback it actually
# binds. `/api/health` is one of the four routes outside the session guard.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.DASHBOARD_PORT||7717)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "dist/apps/dashboard/src/main"]
