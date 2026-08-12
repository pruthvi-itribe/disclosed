# Deploying Disclosed to a DigitalOcean droplet

The whole product is five containers: Mongo, the poller, the enrichment lane,
the dashboard, and Caddy at the edge. This is the step-by-step, with every
number in it measured rather than estimated.

Nothing here has been run against a real droplet. What HAS been proved is that
the three images build and that the stack boots and serves: the evidence is in
[What was actually verified](#what-was-actually-verified) at the end, along with
[what a real deploy still needs](#what-a-real-deploy-still-needs) — read that
section before the first `up`.

---

## 1. Which droplet

**Recommended: Basic droplet, 2 vCPU / 4 GB / 80 GB SSD, Bangalore (BLR1).**

BLR1 because NSE and BSE are in Mumbai and the poller's budget is two seconds
from dissemination to stored; every other region adds a round trip to that
budget for no benefit to anybody.

### The measurement behind the size

`docker stats` against the stack running from `docker-compose.deploy.yml`, and
`ps -o rss` against the same processes on a developer machine over a longer
run. Both are recorded because they answer different questions: the container
figures are what a fresh boot costs, the host figures are what a process settles
at after a day of work.

| Process | In-container, fresh | Longer run |
|---|---|---|
| `caddy` (caddy:2-alpine) | 13.8 MiB | — |
| `dashboard` | 50.1 MiB idle | 153.4 MiB after a full browser suite |
| `ingest` (poller) | 49.2 MiB | 127.5 MiB after 32 h continuous |
| `enrichment` | 57.9 MiB between batches | **210.2 MiB peak while parsing PDFs** |
| `mongo:7` | 195.1 MiB (20 documents) | grows with the WiredTiger cache — see below |

**Sum of the worst case for the four app containers: ~505 MiB.** The peak
belongs to enrichment: `pdf-parse` holds a whole PDF and its page objects in
memory, and that is the one number that moves with the size of a filing rather
than with traffic.

**Mongo is the other half, and it scales with the droplet, not with the data.**
WiredTiger's default cache is `max(256 MiB, 50% of (RAM − 1 GiB))`, so it takes
512 MiB on a 2 GB droplet and 1.5 GiB on a 4 GB one, whether or not the data
needs it. The data does not: the live collection is **3,947 filings in 10.3 MB
of documents, 7 MB of storage and 6 MB of indexes** — about 2.6 MB a day, so
roughly 1 GB a year. Disk is not a constraint on any droplet DigitalOcean
sells; RAM is, and only because Mongo will take what you give it.

**The build is what settles it.** `npm run build` peaks at **495.6 MiB** (three
`nest build` passes, 7.0 s wall on an M-series laptop), and `npm ci` adds its
own few hundred MB. Building on the droplet while the stack is running needs
that headroom on top of everything above.

| Droplet | Runs the stack | Builds on-box | Verdict |
|---|---|---|---|
| 1 GB / 1 vCPU ($6) | no | no | mongo's floor alone leaves nothing |
| 2 GB / 1 vCPU ($12) | yes, ~1.55 GB of 2 GB | **no** — the build OOMs | only with images built elsewhere |
| **4 GB / 2 vCPU ($24)** | **yes, ~2.3 GB of 4 GB** | **yes** | **recommended** |

If 2 GB has to be the answer, both of these are then mandatory rather than
optional: cap Mongo with `command: ["--wiredTigerCacheSizeGB", "0.25"]`, and
build the images on a laptop or in CI and push them to a registry instead of
building on the droplet.

**Add 2 GB of swap regardless.** It costs disk, it is never touched in steady
state, and it is the difference between a bad afternoon and an OOM-killed
poller:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

---

## 2. DNS for disclosed.live

Two topologies. **Cloudflare in front is the recommended default**; the
droplet-only path is the fallback and is documented because it is the one that
has no third party in the request path at all.

### The recommended default: Cloudflare in front of the droplet

Nameservers at Cloudflare, records in the Cloudflare dashboard:

| Type | Name | Value | Proxy |
|---|---|---|---|
| A | `disclosed.live` | *droplet IPv4* | **Proxied (orange)** |
| A | `www` | *droplet IPv4* | **Proxied (orange)** |
| AAAA | `disclosed.live` | *droplet IPv6* | Proxied (orange) |

What it buys, for nothing and with no code change: TLS terminated at the edge,
DDoS absorption in front of a single droplet, a WAF and rate limiting that
exists before a request reaches the app's own throttler, and the origin IP kept
off public DNS.

**The two settings that bite.**

1. **SSL/TLS mode must be Full (strict).** "Flexible" makes Cloudflare talk
   plain HTTP to the origin, which means the session cookie crosses the public
   internet in clear and `X-Forwarded-Proto` becomes a lie. Full (strict)
   requires the origin to present a certificate Cloudflare trusts — which
   Caddy's Let's Encrypt certificate is.

   *Order of operations matters:* leave the record **DNS-only (grey cloud)**
   for the first `docker compose up`, let Caddy complete the ACME HTTP-01
   challenge and get its certificate, then turn the proxy on. Caddy renews
   through the proxy afterwards (Cloudflare passes `/.well-known/acme-challenge`
   to the origin), but the first issuance is much less fiddly grey.

   The alternative is a **Cloudflare Origin CA certificate**, valid 15 years,
   trusted by Cloudflare and by nothing else. Then the Caddyfile's site block
   becomes `tls /etc/caddy/origin.pem /etc/caddy/origin-key.pem` and Caddy stops
   talking to Let's Encrypt at all. Use this if the orange cloud must be on from
   minute one.

2. **Nothing under `/api/*` may be cached, and `/` may not be either.** Every
   read is behind a session cookie, so a cached response is one reader's
   watchlist served to another. The `Caddyfile` sets
   `Cache-Control: private, no-store, max-age=0` on both — note the `>` in
   `header @api >Cache-Control`, which REPLACES the header the app already sent
   instead of adding a second one that an edge may resolve either way.

   Belt and braces at the edge, because Cloudflare's defaults have changed
   before: set **Caching → Configuration → Respect Existing Headers**, and add a
   Cache Rule `(http.request.uri.path contains "/api/")` → **Bypass cache**.

   There is nothing to gain by caching anything else. **There are no static
   assets**: the stylesheet, the script and the favicon are all inlined into the
   one document (CLAUDE.md, "The dashboard is self-contained"), so the entire
   site is one HTML response and a pile of JSON, and both are per-reader.

3. **No WebSockets to worry about.** The page polls `api/summary` and
   `api/filings` every four seconds over ordinary HTTP. Cloudflare proxies
   WebSockets fine, but there is no long-lived connection here to lose.

### The fallback: droplet only

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `disclosed.live` | *droplet IPv4* | 300 |
| A | `www` | *droplet IPv4* | 300 |
| AAAA | `disclosed.live` | *droplet IPv6* | 300 |

Caddy gets and renews a Let's Encrypt certificate on its own, the origin IP is
public, and the droplet absorbs whatever arrives. Everything in this document
works unchanged; you lose the edge and gain one fewer party in the path.

Either way, **before the first `up`**: point the records at the droplet and wait
for them to resolve. Caddy's HTTP-01 challenge fails if the name does not
resolve to it, and repeated failures burn a Let's Encrypt rate limit that takes
an hour to clear.

### Should the UI live on Cloudflare Pages instead?

Not yet — but the objection that it *cannot* is wrong, and it is worth being
precise about why.

**The page really is a static shell.** `renderDashboardPage()` carries no filing
data: it is markup, an inlined stylesheet and an inlined script, and every
number on screen is painted from `api/*` after load. There is no server-side
templating of content to unpick. So the split is a day of work, not a
re-architecture.

**V1 (ship this): Cloudflare as DNS, proxy and CDN in front of the droplet.**
Zero code changes, the topology above, and everything keeps working exactly as
it does on the droplet-only path.

**V2 (the documented growth path): the shell on Pages, the API on the droplet.**
What it would actually take:

1. **A build step that writes the shell to a file.** The page is already one
   self-contained document; a ten-line script calling `renderDashboardPage()`
   and writing `dist-static/index.html` is the whole of it. Pages serves that
   file.

2. **The landing-vs-app decision moves into the browser.** Today `GET /` serves
   the landing page to a signed-out request and the app to a signed-in one —
   one of the four routes outside the session guard. A static file cannot do
   that, so the shell would ship both and choose after `api/me` answers. **The
   real gate does not move**: every `api/*` read stays behind the session guard
   and keeps answering 401, so this is a rendering decision and not a security
   one. The cost is a first-paint flash of the wrong surface, and it is real.

3. **The admin flag disappears, which is free.** `ADMIN_ENABLED=false` in
   production means the panel and its fragment are not in the document anyway,
   so the static shell simply never includes them. The 404s on
   `/api/enrichment`, `/api/categories` and `/api/daily` stay where they are.

4. **Cookies and CORS, which is the fiddly part.** UI at `disclosed.live`, API
   at `api.disclosed.live`. The session cookie needs `Domain=.disclosed.live`;
   `SameSite=Lax` still works because those are same-site subdomains. Every
   `fetch` needs `credentials: 'include'`, the API needs an explicit CORS
   allowlist of exactly `https://disclosed.live` with
   `Access-Control-Allow-Credentials: true`, and `PUBLIC_ORIGIN` — which every
   mutation is checked against — stays `https://disclosed.live`. Verify this
   end to end before believing it; a wildcard origin with credentials is
   rejected by browsers, and a cookie without the `Domain` attribute is not
   sent cross-subdomain.

**The honest latency arithmetic:** the shell is one ~100 KB self-contained file.
Pages would serve it from an edge near the reader instead of from Bangalore —
worth perhaps 100–300 ms on the first paint for a reader outside India. Every
number on the page still round-trips to the droplet, four seconds apart, for as
long as the tab is open. **So the win is the first paint and nothing else**, and
it stays that way until there is an edge cache or a read replica for the API.
That is why V1 is the recommendation and V2 is written down rather than built.

---

## 3. The droplet, before anything else

```bash
# As root on a fresh Ubuntu 24.04 droplet.
adduser --disabled-password --gecos "" disclosed
usermod -aG sudo disclosed
install -d -m 700 -o disclosed -g disclosed /home/disclosed/.ssh
cp /root/.ssh/authorized_keys /home/disclosed/.ssh/ && chown disclosed:disclosed /home/disclosed/.ssh/authorized_keys

# Docker Engine + the compose plugin, from Docker's own repository.
curl -fsSL https://get.docker.com | sh
usermod -aG docker disclosed

# The firewall. 80 and 443 are the only things that need to be reachable;
# Mongo is not published at all and the dashboard binds loopback.
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable

# Unattended security updates, because nobody remembers to patch a droplet.
apt-get install -y unattended-upgrades && dpkg-reconfigure -plow unattended-upgrades
```

Then, as `disclosed`:

```bash
git clone <this repository> ~/disclosed
cd ~/disclosed
```

---

## 4. The environment file

One file, `~/disclosed/.env.deploy`, read by `docker-compose.deploy.yml`. It is
in `.gitignore` and must never be committed: it holds the Anthropic key and the
Telegram bot token.

```bash
install -m 600 /dev/null ~/disclosed/.env.deploy   # 600 BEFORE it has content
```

```ini
# ---------------------------------------------------------------- secrets ---
# THE ANTHROPIC KEY IS THE ONE THAT COSTS MONEY IF IT LEAKS. It is spent by the
# enrichment container and by nothing else.
ANTHROPIC_API_KEY=sk-ant-...

# The operator's alert channel. Leave both blank for no Telegram alerts at all;
# half-configured is treated as unconfigured and says so at boot.
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# --------------------------------------------------------- who signs in ---
# firebase, or blank to follow the keys below. The two Firebase values are a
# PAIR: both or neither, or the project is treated as unconfigured.
#
# NEITHER IS A SERVICE-ACCOUNT KEY. Verifying an ID token is a signature check
# against Google's public certificates, so there is no private key on this host.
# The Web API key is not a secret either — it is printed into /auth by design —
# but it lives here so the two travel together.
#
# ADD disclosed.live TO THE FIREBASE CONSOLE'S AUTHORISED DOMAINS, or every
# sign-in fails with an unauthorised-domain error that names nothing useful.
AUTH_MODE=firebase
FIREBASE_PROJECT_ID=disclosed-...
FIREBASE_WEB_API_KEY=AIza...
# Blank derives <project>.firebaseapp.com, which is what the console provisions.
FIREBASE_AUTH_DOMAIN=

# ------------------------------------------------------------ behaviour ---
# Thirty days, sliding, revocable. Sign-out-everywhere still works.
SESSION_TTL_DAYS=30

# The claim pipeline. Off means filings are still stored, still categorised and
# still shown — they simply carry no verified claim.
CLAIM_ENABLED=true
RESULTS_ENABLED=true

# The optional OCR parser. See section 7: unset is a fully supported deployment.
DOCLING_URL=
```

**Three things are NOT in this file, and that is deliberate.**
`docker-compose.deploy.yml` sets them itself, because they are facts about the
deployment rather than choices an operator makes per host:

| Key | Value | Why it is pinned in compose |
|---|---|---|
| `MONGO_URI` | `mongodb://mongo:27017/turret` | The service name on the internal network. Not reachable from anywhere else. |
| `PUBLIC_ORIGIN` | `https://disclosed.live` | Every mutation is Origin-guarded against it. Left at its loopback default, **every sign-in from the real page is refused with 403 BAD_ORIGIN**. |
| `ADMIN_ENABLED` | `false`, explicitly | The two-signal default would already resolve to off here; saying it costs one line and removes the argument. Off means the panel is not in the document and `/api/enrichment`, `/api/categories` and `/api/daily` answer 404 — not built, not merely forbidden. |

`ENRICH_IN_PROCESS=false` is pinned there too — see section 6.

---

## 5. Caddy

`Caddyfile` is in the repository root and is mounted read-only. Two things in
it need a human before the first deploy:

1. **`email ops@disclosed.live`** in the global block — Let's Encrypt sends
   expiry warnings there, and an unset address means the only notice of a
   stalled renewal is the site going down.
2. **The CSP's `gstatic` and `googleapis` origins** exist for `/auth` in
   firebase mode, which loads the Firebase Web SDK at a pinned version. Running
   `AUTH_MODE=local` instead? Delete them and the policy gets shorter.

The rest is automatic: Caddy answers the ACME challenge on 80, serves 443,
redirects `www` to the apex, and renews without being asked. Its account key and
certificates live in the `caddy-data` volume — losing that volume means
re-issuing from Let's Encrypt and burning rate limit, so it is worth keeping.

**Caddy and the dashboard share one network namespace.** The dashboard binds
`127.0.0.1` and that is hard-coded, not configurable
(`apps/dashboard/src/config/configuration.ts`: it is a read-only view over an
unauthenticated database, and making the bind address an environment variable
would make `0.0.0.0` a one-line mistake). In a container that means it is
reachable from inside its own namespace and nowhere else — so
`network_mode: "service:caddy"` puts the dashboard inside Caddy's namespace
rather than routing around the invariant. Caddy reaches it at `127.0.0.1:7717`;
nothing else can reach it at all.

**The cost, stated plainly:** the two share a lifecycle. `docker compose restart
caddy` tears down the namespace the dashboard is living in. Always restart both.

---

## 6. Bringing it up

```bash
cd ~/disclosed
docker compose -f docker-compose.deploy.yml build     # ~3 min cold, ~20 s warm
docker compose -f docker-compose.deploy.yml up -d
docker compose -f docker-compose.deploy.yml ps
```

Expected within about a minute: `mongo` healthy, `dashboard` healthy, the other
three `Up`. Then:

```bash
curl -s https://disclosed.live/api/health          # {"success":true,...,"status":"ok"...}
docker compose -f docker-compose.deploy.yml logs ingest | grep bootstrap
```

That last line is the one to read, because it prints **what the container
actually resolved** rather than what the file says:

```
mongo=mongodb://mongo:27017/turret hot=2000ms idle=30000ms ... enrich=on
enrichWhere=separate-process ... claims=on docling=off telegram=unconfigured
```

`enrichWhere=separate-process` is the setting that protects the poller's
two-second budget. With the default (`ENRICH_IN_PROCESS=true`) the enrichment
lane runs inside the poller's process, and Node runs both loops on one thread:
parsing a PDF is CPU work inside pdf.js with no `await` for the event loop to
escape through, so the poller's timers do not fire while it runs. The compose
file pins it to `false` and runs the `enrichment` service instead. **Both
containers must be up, or nothing reads a source PDF and the queue grows
silently** — the ingest container says exactly that at boot.

---

## 7. Docling — and why nothing breaks without it

`DOCLING_URL` **ships unset, and that is a fully supported deployment.** The
factory that reads it returns null for an unset or unparseable value and never
throws (`apps/ingest/src/enrichment/docling.factory.ts`), so with no value the
pipeline is exactly the one that existed before hybrid parsing: every document
read by `pdf-parse`, scanned filings reaching `no-text-layer`, nothing failing.
The requirement it was built to is "the pipeline must keep working on a machine
with no Python on it", and it is expressed as a *default* rather than as a
fallback path, because a fallback nobody runs is a fallback that does not work.

**Degradation is visible rather than silent.** `requeue-policy.ts` records that a
deployment with no `DOCLING_URL` has no OCR parser configured, and the ingest
container's boot line says `docling=off`.

**What setting it buys**, measured over 38 real filings: the 1.11% of filings
that are raster scans become readable at all, and the 8.66% that carry a results
table get the right reading order (`pdf-parse` puts one filing's standalone rows
2,977 characters before their own heading, which is how a nearest-heading rule
reads *consolidated* for a *standalone* row — a wrong number about a named
listed company).

**What it costs is why it is not in this compose file:** `docling-serve` holds
**2.3–2.6 GB resident with OCR off and 3.8–7.4 GB with it on**. That is larger
than the recommended droplet. Two honest options:

- **Its own droplet** (8 GB minimum, 16 GB with OCR), on a private VPC network,
  with `DOCLING_URL=http://<private-ip>:5001` in `.env.deploy`. Raise
  `DOCLING_SERVE_MAX_SYNC_WAIT` on that service to match `DOCLING_TIMEOUT_MS`
  (default 300000): docling-serve's own default is 120 s and it answers 504 past
  it *while still finishing the work*, which loses the document. A live run hit
  exactly that on a 15-page scan that took 131 s.
- **Leave it off.** ~99% of filings are unaffected.

`DOCLING_COOLDOWN_MS` (default 300000) stops further requests for five minutes
after a failure to *reach* the service, so a Docling droplet that is down costs
one timeout rather than one per eligible filing.

---

## 8. Backing up the Mongo volume

The data is small and irreplaceable-ish: the collection is **10.3 MB of
documents plus 6 MB of indexes for 3,947 filings**, growing about 2.6 MB a day.
A year of it fits in a gzipped dump of well under a gigabyte. There is no excuse
for not having one.

**`mongodump` into a dated archive, not a volume copy.** Copying
`/data/db` out from under a running mongod produces a file that restores
sometimes; `mongodump` is consistent and a tenth the size.

`~/disclosed/backup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd ~/disclosed
STAMP=$(date -u +%Y-%m-%dT%H%M%SZ)
OUT=~/backups
mkdir -p "$OUT"
docker compose -f docker-compose.deploy.yml exec -T mongo \
  mongodump --db turret --archive --gzip > "$OUT/turret-$STAMP.archive.gz"
# Keep 14 dailies locally; the off-box copy is what actually saves you.
ls -1t "$OUT"/turret-*.archive.gz | tail -n +15 | xargs -r rm --
# OFF THE DROPLET. A backup on the same disk as the database is not a backup:
# it survives a bad migration and nothing else.
rclone copy "$OUT/turret-$STAMP.archive.gz" spaces:disclosed-backups/
```

```bash
chmod +x ~/disclosed/backup.sh
crontab -e   # 17 20 * * *  /home/disclosed/disclosed/backup.sh >> /home/disclosed/backup.log 2>&1
```

20:17 UTC is 01:47 IST — after the IST day has rolled at 18:30 UTC and well
clear of the filing window.

**Restore, which is the half nobody tests:**

```bash
docker compose -f docker-compose.deploy.yml exec -T mongo \
  mongorestore --db turret --archive --gzip --drop < ~/backups/turret-<stamp>.archive.gz
```

`--drop` replaces the collections. Restore into a scratch database first
(`--nsFrom 'turret.*' --nsTo 'scratch.*'`) and count the documents before
pointing anything at it. **A backup nobody has restored is a hypothesis.**

DigitalOcean's own droplet snapshots (weekly, 20% of droplet cost) are worth
having on top: they restore the whole machine rather than the data, which is the
faster answer to "the droplet is gone" and no answer at all to "somebody dropped
a collection".

---

## 9. Updating

```bash
cd ~/disclosed
git pull
docker compose -f docker-compose.deploy.yml build
docker compose -f docker-compose.deploy.yml up -d
```

`up -d` recreates only the containers whose image or configuration changed and
leaves the rest running, so an update that touched only the dashboard does not
interrupt the poller.

**Restart Caddy and the dashboard together, always** — they share a network
namespace:

```bash
docker compose -f docker-compose.deploy.yml restart caddy dashboard
```

**Take a backup before an update that changes a schema or a migration.** The
update path has no rollback of its own; the rollback is `git checkout <previous
tag> && docker compose ... build && up -d`, and that restores the code, not the
data.

Housekeeping, occasionally — a droplet that never prunes fills up with old
layers:

```bash
docker image prune -f
docker builder prune -f --filter until=168h
```

---

## What a real deploy still needs

Found while building this and **not fixed here**, because each one is a change
to shipped behaviour that wants a decision rather than a commit inside a
deployment task.

1. **`TRUST_PROXY` exists now, and this deployment has to opt in.**
   `apps/dashboard/src/main.ts` calls `app.set('trust proxy', ...)` with
   whatever `TRUST_PROXY` carries, and **unset is still off** — so on this
   droplet, until the variable is added, both consequences below are unchanged.

   **`TRUST_PROXY=1` is the value for this arrangement**: one hop, because Caddy
   is the only thing in front of the app and it terminates TLS itself, so the
   `X-Forwarded-Proto` it writes is the scheme the browser actually used. Set
   it and:
   - **The session cookie gains `Secure`.** Today it works over https but
     nothing stops a browser sending it over plain http to the same host; HSTS
     in the `Caddyfile` closes most of that window and the attribute closes all
     of it.
   - **The rate limiter stops keying every request to Caddy's address.** The
     auth limits are 10/minute and 60/hour (`dashboard.module.ts`), and without
     this they are a *global* limit — one person fumbling their password locks
     out everyone.

   **With Cloudflare's orange cloud on, the second half is only partly fixed
   here**, and not by a bigger hop count: what connects to Caddy is then a
   Cloudflare edge address, so the resolved client is an edge and not a reader.
   `apps/dashboard/src/auth/client-key.ts` is what reaches the reader —
   `CF-Connecting-IP`, read only through a trusted chain — and its header
   explains what that does and does not close.

2. **No log aggregation and no uptime check.** Logs are `json-file`, capped at
   5 × 10 MB per container, and are lost with the droplet. `/api/health` is one
   of the four routes outside the session guard precisely so a monitor can use
   it without a credential — point something at it.

3. **The images are built for the architecture they are built on.** These were
   verified on `linux/arm64` (Apple Silicon). A standard DigitalOcean droplet is
   `amd64`; building on the droplet, as section 6 does, is correct and needs no
   flag. Building on a laptop to push to a registry needs
   `docker buildx build --platform linux/amd64`.

4. **`ENRICH_ENABLED` and `ENRICH_IN_PROCESS` are not in `.env.example`,**
   though `configuration.ts` reads both (default `true`). The compose file pins
   `ENRICH_IN_PROCESS=false`, so the deployment is correct — but an operator
   reading `.env.example` to learn what exists will not find the setting that
   protects the poller's budget.

5. **Nothing here has run on a droplet.** DNS propagation, the first ACME
   issuance, Cloudflare's Full (strict) handshake against Caddy's certificate,
   and the `network_mode: service:caddy` restart ordering under `systemd`-managed
   Docker are all unverified against the real thing.

---

## What was actually verified

On a developer machine, against Docker 28 / Compose v5, `linux/arm64`:

- **All three images build.** `docker build --target ingest|enrichment|dashboard`
  all succeed. **460 MB each**, sharing every layer but the final `CMD` — one
  460 MB tree on disk, not three. Production `node_modules` is 221.8 MB before
  the `@google-cloud` trim and 213.0 MB after; `dist` is 4.8 MB.
- **The argon2 native binary lands on musl.** `@node-rs/argon2-linux-arm64-musl`
  is installed and `hashSync` runs inside the image — the build fails rather
  than shipping an image that cannot hash a password. This is why
  `--omit=optional` is not used: it would take that binary with it.
- **Trimming `@google-cloud` does not break Firebase sign-in.** In the built
  image `admin.auth()` constructs and `verifyIdToken('not-a-token')` rejects
  with `auth/argument-error` — the application's own error, not
  `MODULE_NOT_FOUND`.
- **The whole stack boots and serves.** Brought up under a scratch project name
  against a scratch Mongo volume: mongo healthy, dashboard healthy (its own
  `HEALTHCHECK` passing), and `GET /api/health` answering **200 through Caddy**
  — which proves the shared-namespace arrangement reaches a dashboard bound to
  `127.0.0.1`.

  *With one substitution, stated:* Caddy ran with `auto_https off` on a
  published `:18080`, because asking Let's Encrypt for `disclosed.live` from a
  laptop the domain does not point at fails and burns a rate limit. The
  `reverse_proxy`, the `Cache-Control` replacement and the shared namespace are
  the shipped file's; the TLS block is the one part of the `Caddyfile` a droplet
  has to prove. The committed file passes `caddy validate` and `caddy fmt`
  clean.
- **The pipeline actually ran.** The `ingest` container bootstrapped an NSE
  session, drained the IST day and stored 20 filings into the scratch Mongo; the
  `enrichment` container picked them up and parsed PDFs. The memory table in
  section 1 was measured during that.
- **Then it was torn down**, volumes included. The development stack on
  `127.0.0.1:27117` and the dashboard on `127.0.0.1:7717` were untouched
  throughout, which is why the deployment compose file has its own filename, its
  own project name and its own volume names.
