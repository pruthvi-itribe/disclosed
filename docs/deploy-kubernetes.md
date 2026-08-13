# Deploying Disclosed to the DOKS prod cluster

The same five moving parts as the droplet — Mongo, the poller, the enrichment
lane, the dashboard, an edge — rearranged into three Deployments, one Service
and two Ingresses on the DigitalOcean Kubernetes cluster that already runs
`tralkserver`. The manifests are in `k8s/`, the workflows in
`.github/workflows/`.

**This is the second deployment target, not a replacement for the first.**
[`deploy-digitalocean.md`](./deploy-digitalocean.md) is the droplet, and every
measurement in this document comes from it. Read its section 1 before arguing
with a resource limit here.

**This was deployed for real on 2026-08-13** and is running. What that run
proved, and the four things it did NOT, are in
[What was actually verified](#what-was-actually-verified) and
[What is not verified](#what-is-not-verified). Both sections are kept
truthful rather than triumphant: an item moves out of the second list only
when something was observed, not when it seems likely to work.

---

## 1. The shape, and the one thing that is not tralk's shape

| Workload | Replicas | Listens on | Reached by |
|---|---|---|---|
| `ingest` | 1 | nothing | nothing — it polls NSE |
| `enrichment` | 1 | nothing | nothing — it reads the queue |
| `dashboard` | 1 | `127.0.0.1:7717` + sidecar on `:8080` | Service → Ingress |
| Mongo | — | — | **managed, outside the cluster** — see section 3 |

`ingest` and `enrichment` have **no Service and no probe**, and that is not an
omission: `apps/ingest/src/main.ts` opens no socket, which is why the
Dockerfile publishes no port and defines no healthcheck for either target.
A green `rollout status` means the process started and did not exit. What they
are actually doing is a question for their logs and for the dashboard's
feed-lag number.

### The dashboard pod has two containers

The dashboard binds `127.0.0.1`, hard-coded and deliberately not configurable
(`apps/dashboard/src/config/configuration.ts`). A Kubernetes Service sends
traffic to the **pod IP**, and a process on loopback is not there. No
annotation changes that.

Every container in a pod shares one network namespace — the same primitive
`docker-compose.deploy.yml` reaches for with `network_mode: service:caddy`. So
the pod runs `dashboard` (the app, on loopback) and `edge` (`caddy:2-alpine`,
listening `0.0.0.0:8080`, proxying to `127.0.0.1:7717`). The Service points at
`8080`. The invariant is kept rather than routed around.

The sidecar's config is a ConfigMap in `k8s/30-dashboard.yaml`, **derived from
the repository's `Caddyfile` rather than copied from it**: no `email`, no TLS,
no `www` block, a port-only site address. The `reverse_proxy` line, the header
block and the two `Cache-Control` replacements are the shipped file's,
unchanged. **If either file's policy moves, both have to.**

### Where the numbers came from

Every request and limit in `k8s/` is the measured table in
`deploy-digitalocean.md` section 1, not an estimate:

| Container | Measured | Request | Limit |
|---|---|---|---|
| `ingest` | 49.2 MiB fresh, 127.5 MiB at 32 h | 128Mi / 50m | 256Mi / 1 CPU |
| `enrichment` | 57.9 MiB idle, **210.2 MiB peak parsing a PDF** | 192Mi / 100m | 512Mi / 1 CPU |
| `dashboard` | 50.1 MiB idle, 153.4 MiB under a full browser suite | 128Mi / 50m | 320Mi / 500m |
| `edge` (caddy) | 13.8 MiB | 16Mi / 10m | 64Mi / 200m |
| **Total** | **~505 MiB worst case** | **464Mi / 210m** | **1152Mi / 2.7 CPU** |

Enrichment's limit is 2.4x its peak rather than the 2x used elsewhere, because
that peak moves with **the size of a filing** rather than with traffic, and
the consequence of getting it wrong is an OOMKill in the middle of a document.

---

## 2. What the founder must add to GitHub

**Two repository secrets. That is the whole list.** Settings → Secrets and
variables → Actions → New repository secret.

| Secret | Value | Where it is used |
|---|---|---|
| `DIGITALOCEAN_ACCESS_TOKEN` | A DigitalOcean PAT with **read/write** scope on Kubernetes | `digitalocean/action-doctl@v2`, to fetch the cluster's kubeconfig |
| `ARG_INVESTORSTRIBEDEV_ACCESS_TOKEN` | The Docker Hub **access token** for the `investorstribe` account | `docker/login-action@v3`, to push the three images |

Both names are tralk-nest-server's, spelled identically, because **they are the
same two credentials**. If tralk's are still valid, copying the values across
is the whole of this step. (`ARG_` and `DEV` are archaeology from the argonaut
pipeline; the name is kept rather than improved so a rotation is one search
across both repositories instead of two.)

**Nothing else is a GitHub secret.** The Anthropic key, the Telegram pair, the
Firebase pair and the Mongo URI never touch CI — they are Kubernetes Secrets,
created directly against the cluster in section 4, which is how the DO DNS
token and the Docker Hub pull secret already reach tralk's clusters.

### The Docker Hub repositories

The workflow pushes to six tags across three repositories:

```
docker.io/investorstribe/disclosed-ingest-prod
docker.io/investorstribe/disclosed-enrichment-prod
docker.io/investorstribe/disclosed-dashboard-prod
```

each tagged `<short-sha>` and `doks-prod-latest`, plus a `doks-buildcache` tag
that buildx writes and nothing deploys. **Create them as private** before the
first run, or Docker Hub creates them public on first push and the images are
readable by anyone. The manifests carry `imagePullSecrets: dockerhub-pull` on
that assumption.

---

## 3. Where the data lives

**Managed Mongo, not a StatefulSet.** This follows what tralk's *prod* does —
`prod-mongo-v2` in `managed-dbs/`, private-VPC only, firewalled to the
cluster — rather than what its *stage* does, which is an in-cluster
StatefulSet on a `do-block-storage` PVC.

The reasoning, in order of weight:

1. **The cluster's node pool is one node.** A StatefulSet's PVC survives a pod,
   but a single-node pool means every node replacement is a full outage of the
   database, and `do-block-storage` volumes have to detach and reattach before
   the pod can start again.
2. **Backups become mine to write.** Managed Mongo has point-in-time restore in
   the DO control panel. An in-cluster Mongo needs the CronJob, the Spaces
   bucket and the restore rehearsal that section 8 of the droplet doc
   describes, and a backup nobody has restored is a hypothesis.
3. **It costs nothing new.** `prod-mongo-v2` (db-s-1vcpu-2gb) already hosts
   `tralkdb`, `notificationsdb`, `instrumentsdb` and `rewardsdb`. Disclosed's
   entire live collection is **10.3 MB of documents, 7 MB of storage and 6 MB
   of indexes for 3,947 filings**, growing about 2.6 MB a day — roughly 1 GB a
   year. It is a rounding error on that cluster.
4. **Nothing here needs a replica set of its own.** The droplet runs a plain
   `mongo:7` with no replica set and no transactions; a managed cluster is
   strictly more than that.

**If a StatefulSet is wanted instead**, tralk-infra's `stage/stage-mongo.tf` is
the working reference — headless Service, `rs0` single-node replica set, the
keyfile init-container that copies out of the Secret mount because mongod
refuses to resolve through the symlink chain, and a 10Gi `do-block-storage`
volumeClaimTemplate. It is not carried here because shipping an unused second
data path is a second thing to keep correct.

---

## 4. Cluster prerequisites, created out-of-band

Four Secrets, created with `kubectl` and not committed anywhere. This is the
pattern tralk-infra already uses for `digitalocean-dns` and `dockerhub-pull`
— *"kept out of tf state — installed via kubectl so it never hits disk"* — and
it is the one place these manifests **must** diverge from tralkserver's prod
deployment, which bakes its database credentials into the image via
`prod.yaml`. This repository cannot do that: `.dockerignore` excludes `.env`
for exactly this reason (*"a file copied into a layer is in the image for
anyone who pulls it, whatever a later `rm` does"*).

```bash
export DIGITALOCEAN_ACCESS_TOKEN=<dop_v1_...>
doctl kubernetes cluster kubeconfig save prod

kubectl apply -f k8s/00-namespace.yaml
```

**1. The image pull secret** — same name tralk's prod uses, so the manifests
read the same:

```bash
kubectl -n disclosed create secret docker-registry dockerhub-pull \
  --docker-server=https://index.docker.io/v1/ \
  --docker-username=investorstribe \
  --docker-password='<the same Docker Hub access token>'
```

**2. The database URI**, from the DO control panel's connection string for
`prod-mongo-v2`, with **the database name changed to `turret`** and the
**private** host used, not the public one:

```bash
kubectl -n disclosed create secret generic disclosed-mongo \
  --from-literal=MONGO_URI='mongodb+srv://<user>:<pass>@private-prod-mongo-v2-....mongo.ondigitalocean.com/turret?tls=true&authSource=admin&replicaSet=<rs>'
```

**3. The pipeline's keys** — read by `ingest` and `enrichment`, which share one
config loader and therefore get one Secret. Leave the Telegram pair blank for
no alerts at all; half-configured is treated as unconfigured and says so at
boot.

```bash
kubectl -n disclosed create secret generic disclosed-pipeline \
  --from-literal=ANTHROPIC_API_KEY='sk-ant-...' \
  --from-literal=OPENROUTER_API_KEY='' \
  --from-literal=TELEGRAM_BOT_TOKEN='' \
  --from-literal=TELEGRAM_CHAT_ID=''
```

**4. The dashboard's identity keys.** Neither is a service-account key —
verifying an ID token is a signature check against Google's public
certificates — and the Web API key is printed into `/auth` by design.

```bash
kubectl -n disclosed create secret generic disclosed-dashboard \
  --from-literal=FIREBASE_PROJECT_ID='disclosed-...' \
  --from-literal=FIREBASE_WEB_API_KEY='AIza...'
```

**Add `disclosed.live` to the Firebase console's authorised domains**, or every
sign-in fails with an unauthorised-domain error that names nothing useful.

### Why the keys are split three ways

`docker-compose.deploy.yml` gives all three containers one `.env.deploy`,
because compose has no cheaper option. Kubernetes does, and the dashboard is
**the only pod with a route in from the internet** — so the Anthropic key, the
one that costs money if it leaks, is in a Secret that pod does not mount.

The split is by **process family, not by consumer**: `ingest` and `enrichment`
read the same `apps/ingest/src/config/configuration.ts`, so handing them
different environments would make their boot lines disagree about `claims=`
and `docling=` for a deployment where nothing is actually different.

### What the cluster already has

`ingress-nginx`, `cert-manager` and the `letsencrypt-prod` ClusterIssuer are
installed in the `platform` namespace by tralk-infra's `prod/platform.tf`.
`k8s/40-ingress.yaml` uses them and installs neither.

**And here is the one thing to settle before applying that file.** The issuer
solves **DNS-01 using a DigitalOcean API token** — it writes a `_acme-challenge`
TXT record through the DO DNS API, which only works for zones whose
**nameservers are at DigitalOcean**. `deploy-digitalocean.md` section 2
recommends putting `disclosed.live` behind **Cloudflare**. Those two facts do
not compose: with the zone at Cloudflare, cert-manager will write a TXT record
into a DO zone nobody resolves, the challenge will never propagate, and the
Ingress will sit without a certificate while giving no obvious reason.

**Decided 2026-08-13: option 3.** `disclosed.live` was registered at Namecheap
and its nameservers move to **Cloudflare**, because the app is already built
for that edge — `CF-Connecting-IP` is the production rate-limit key and only
exists when Cloudflare is in the path. So this repository ships its own
`letsencrypt-cloudflare` ClusterIssuer in [`k8s/05-issuer.yaml`](../k8s/05-issuer.yaml),
solving DNS-01 with a Cloudflare token scoped to `Zone / DNS / Edit` on that
one zone, and both Ingresses carry that annotation. tralk's `letsencrypt-prod`
is untouched and still owns tralk's zones. The three options are kept below
because the reasoning is what makes the choice re-checkable.

Three ways out, in the order they cost:

1. **Move `disclosed.live`'s nameservers to DigitalOcean.** The existing issuer
   then works unchanged, and the certificate can be issued *before* the
   hostname resolves at the load balancer — which makes the cutover off the
   droplet a DNS change rather than a downtime window. That pre-issuance is the
   whole reason DNS-01 was chosen for tralk. **The cost is Cloudflare**: no
   edge WAF, no DDoS absorption, and the load balancer's IP on public DNS.
2. **Keep Cloudflare and switch this Ingress to HTTP-01**, with its own
   ClusterIssuer so tralk's is untouched. Then the certificate can only be
   issued *after* the A record points at the load balancer, so the cutover has
   a window in which the site is unreachable — minutes, and it burns Let's
   Encrypt rate limit if it fails. Leave the record **DNS-only (grey cloud)**
   until the certificate is issued, exactly as the droplet doc says for Caddy.
3. **Keep Cloudflare and add a Cloudflare DNS-01 solver** to a new
   ClusterIssuer, with a Cloudflare API token in a Secret. Best of both, one
   more credential to hold, and a new cluster-scoped object next to tralk's.

Whichever is chosen, the `cert-manager.io/cluster-issuer` annotation on both
Ingresses in `k8s/40-ingress.yaml` is the one line that changes.

---

## 5. The first deploy

```bash
# 1. Everything in section 4, once.

# 2. The manifests. Numbered so the directory applies in dependency order.
kubectl apply -f k8s/

# 3. The images. Actions → "Deploy Disclosed to DOKS prod" → Run workflow.
#    Manual-only by design; see the workflow header.
```

The workflow builds all three targets from the one Dockerfile in parallel,
pushes `<short-sha>` and `doks-prod-latest`, then `kubectl set image` on all
three Deployments, waits for each rollout, and finally curls
`http://dashboard:8080/api/health` from a throwaway pod inside the cluster.

**Before the DNS cutover**, prove it end to end without moving the record:

```bash
kubectl -n disclosed get ingress                 # ADDRESS = the LB IP
kubectl -n disclosed get certificate             # READY must be True
curl --resolve disclosed.live:443:<LB-IP> -sSI https://disclosed.live/api/health
```

The `--resolve` line is the whole trick: it exercises TLS, the Ingress, the
sidecar and the app against the real hostname while public DNS still points at
the droplet.

**This check only works under a DNS-01 issuer** — options 1 and 3 in section 4.
Under HTTP-01 (option 2) the certificate cannot exist until the A record has
already moved, so the order inverts: cut DNS over first, watch
`kubectl -n disclosed get certificate` go READY, and accept the window. Do the
`--resolve` check against plain `http://` beforehand to prove everything except
TLS.

Then, and only then, move the `A` record for `disclosed.live` (and `www`) to
the load balancer IP.

**Run the browser suite before the deploy, against a local stack.** CI does not
run it — the reason is in `.github/workflows/ci.yaml`'s header — so this is the
step that covers the specs asserting the *served* document, including the two
that assert the app and landing pages contain no `https?://` at all.

```bash
npm run start:dashboard        # AUTH_MODE resolves to local with no FIREBASE_* set
npx playwright test            # in another shell; DASHBOARD_URL defaults to :7717
```

**It cannot be pointed at this deployment**, and that is by design rather than
by omission: global setup registers its account through the in-house register
route, which `AUTH_MODE=firebase` closes on purpose, and `e2e/global-setup.ts`
throws with exactly that explanation. There is deliberately no bypass in the
server. So the browser gate runs against a local `AUTH_MODE=local` stack built
from the same commit, and the prod smoke test is the `--resolve` curl above
plus signing in once by hand.

---

## 6. Moving the database in

The source is the development stack's Mongo — `redbox-mongo-1` on
`127.0.0.1:27117`, database `turret`, volume `turret-mongo` — or the droplet's,
if one is running. Same procedure either way.

**`mongodump` into an archive, not a volume copy.** Copying `/data/db` out from
under a running mongod produces a file that restores sometimes.

```bash
# From the development stack (docker-compose.yml).
STAMP=$(date -u +%Y-%m-%dT%H%M%SZ)
docker compose exec -T mongo \
  mongodump --db turret --archive --gzip > ~/turret-$STAMP.archive.gz

ls -lh ~/turret-$STAMP.archive.gz    # expect well under 100 MB
```

The restore is the half nobody tests, and the awkward part is reach:
`prod-mongo-v2` is **private-VPC only**, firewalled to the DOKS nodes, so a
laptop cannot see it by default. Two ways in, in order of preference.

### The simple way: borrow a trusted source

DigitalOcean → Databases → `prod-mongo-v2` → Settings → **Trusted Sources** →
add your current public IP. Then restore from the laptop against the **public**
hostname, and **remove the entry when you are done** — it is the only thing
standing between that database and the internet.

```bash
# Public host, not the private- one. From the DO connection-details panel.
MONGO_ADMIN='mongodb+srv://<user>:<pass>@prod-mongo-v2-....mongo.ondigitalocean.com/?tls=true&authSource=admin'

# INTO A SCRATCH DATABASE FIRST. Not caution theatre: a restore that silently
# landed half a collection looks exactly like one that worked.
mongorestore --uri "$MONGO_ADMIN" --archive --gzip \
  --nsFrom 'turret.*' --nsTo 'scratch.*' < ~/turret-$STAMP.archive.gz

mongosh "$MONGO_ADMIN" --quiet \
  --eval 'db.getSiblingDB("scratch").filings.countDocuments({})'
```

Compare that count against the source before going further:

```bash
docker compose exec -T mongo mongosh --quiet \
  --eval 'db.getSiblingDB("turret").filings.countDocuments({})'
```

Equal? Repeat the restore without the `--nsFrom`/`--nsTo` pair so it lands in
`turret`, then drop `scratch`.

### The other way: a throwaway pod inside the cluster

If adding a trusted source is not acceptable, the cluster is already inside the
VPC. This streams the archive into a pod's stdin:

```bash
kubectl -n disclosed run mongo-restore \
  --image=mongo:7 --restart=Never --rm -i \
  --env="MONGO_ADMIN=$MONGO_ADMIN" \
  --command -- sh -c \
  'mongorestore --uri "$MONGO_ADMIN" --archive --gzip --nsFrom "turret.*" --nsTo "scratch.*"' \
  < ~/turret-$STAMP.archive.gz
```

Two things about it, both of which have teeth:

- **Do not add `-t`/`--tty`.** A TTY mangles binary stdin and the gzip archive
  arrives corrupt. `-i` alone is correct.
- **`--env` puts the URI, password included, into the pod spec**, readable by
  anyone with `get pods` for as long as the pod exists (seconds, and `--rm`
  deletes it). It is also in your shell history. The trusted-source path above
  avoids both, which is why it is listed first.

The count to expect is the development stack's, for the same collection. The
indexes rebuild themselves: `ingest` and `enrichment` both call `.init()` on
the filings model at boot, and `libs/accounts/src/account-indexes.ts` creates
the account indexes explicitly because the dashboard's connection carries
`autoIndex: false`.

**Stop the droplet's poller before the cutover, not after.** Two pollers
writing the same filings into two databases is recoverable; two pollers sending
the operator two of every alert while one of the two databases is the one
nobody is reading is how a quiet outage happens.

---

## 7. What stays manual

Everything in this list is manual **on purpose**, and each one matches how
tralk is operated:

1. **Applying the manifests.** CI only ever runs `kubectl set image`. The token
   it holds can roll out a build of reviewed code and cannot rewrite an Ingress
   or delete a namespace. tralk splits it the same way — its manifests are
   Terraform in `tralk-infra`, applied by a human.
2. **Creating and rotating the four Secrets.** They never enter git, CI, or a
   Terraform state file.
3. **Triggering the deploy.** `workflow_dispatch` only, matching what tralk's
   prod workflow says it wants until a few deploys have gone cleanly. A push
   trigger on `main` is a two-line change to the `on:` block.
4. **Bumping `disclosed.live/edge-config-revision`** in
   `k8s/30-dashboard.yaml` when the sidecar's Caddyfile changes. `kubectl
   apply` does not compute it, a mounted ConfigMap updates in place on a delay,
   and Caddy does not watch the file — so without the bump a policy edit
   applies at the next unrelated deploy and nobody can say when it took effect.
5. **Scaling.** Both worker Deployments are pinned at 1 replica for reasons
   written into their manifests; neither has an HPA and neither should get one
   without reading those comments first.
6. **DNS.** The `A` records for `disclosed.live` and `www` are moved by hand
   after the `--resolve` check in section 5 passes.

---

## What was actually verified

### On the cluster, 2026-08-13

The first real deploy. Everything below was observed, not inferred:

- **The pods reach `prod-mongo-v2` over the VPC.** A throwaway pod authenticated,
  wrote and read. This was open item 1 and is closed.
- **The database user cannot escape its own database.** `disclosed` holds
  `readWrite` on `turret` alone; an insert into `tralkdb` returned
  `Unauthorized`. That closes open question 3 — `doctl databases user create`
  makes DBADMIN-on-admin and has no flag to do otherwise, so the user is
  created through the API with `settings.mongo_user_settings` (the flat
  `mongo_user_settings` form is rejected 422).
- **The sidecar arrangement works in-cluster.** `dashboard:8080/api/health`
  answered 200 with exactly one `Cache-Control: private, no-store, max-age=0`,
  the full CSP, HSTS, `X-Frame-Options: DENY` and **no `Server` header**.
- **The images run on `linux/amd64`.** Built, pushed and pulled; open item 6
  is closed.
- **The three boot lines say what they should**: `enrichWhere=separate-process`,
  `claims=openrouter/…`, `docling=http://docling:5001`, and on the dashboard
  `filings=read-only admin=off proxy=2 auth=firebase`. `admin=off` is the
  two-signal gate deciding correctly on a real production host.
- **Cold-start protection fired.** The poller drained the day and reported
  `Stored 58 filings outside the alert window` rather than alerting them.
- **Docling serves from its own node.** Of 2,740 filings, 549 were read by
  `docling-layout` and 37 by `docling-ocr` — so the ClusterIP path is real
  work, not a silent fallback to `pdf-parse`.
- **End-to-end latency, in production**: median 93 seconds from dissemination
  to the document being read, against the product's stated ~2 minute target.

### On a developer machine, no cluster involved

- **All eight objects pass `kubectl apply --dry-run=client -f k8s/`** (kubectl
  v1.34.1, the same minor as the cluster's 1.34.5-do.3).
- **Both workflows pass `actionlint` v1.7.7 with zero findings.** `shellcheck`
  was not available to it, so the four `run:` blocks were read by hand; all
  four are `for` loops and `echo`s over quoted variables.
- **The sidecar arrangement was proved, not assumed.** A stand-in server bound
  to `127.0.0.1:7717` in a container, exactly as `main.ts` binds: the published
  port answered **nothing** (curl could not connect). With `caddy:2-alpine`
  started in the same network namespace and this ConfigMap's Caddyfile, the
  same port answered **200**, carrying **exactly one** `Cache-Control:
  private, no-store, max-age=0` — so the `>` replacement did replace the
  upstream's own `no-store` rather than adding a second header — the full CSP,
  HSTS, `X-Frame-Options: DENY`, and **no `Server` header**.
- **`caddy validate` accepts the ConfigMap's Caddyfile** and logs
  `automatic HTTPS is completely disabled for server`, which is the intended
  state: TLS belongs to the Ingress.
- **The gates are green on this branch**: 5,382 tests in 137 suites,
  `tsc --noEmit` clean, `eslint` clean without `--fix`.

## What is not verified

1. **Nothing has been served to the public internet yet.** The workloads run
   and the database path is proven, but `k8s/40-ingress.yaml` is deliberately
   NOT applied: applying it before the `cloudflare-dns` Secret exists starts
   an ACME challenge that can only fail, repeatedly and against Let's
   Encrypt's rate limit. So the Ingress admission webhook, DNS-01 issuance
   through Cloudflare, and every item below that needs a request arriving from
   outside are still unproven.
2. ~~**Which HSTS header reaches the browser.**~~ Answered 2026-08-13:
   **nginx's wins.** A request through the real ingress carries
   `Strict-Transport-Security: max-age=31536000; includeSubDomains` — one
   year, ingress-nginx's default — not the sidecar's two-year commitment, and
   there is exactly ONE of the header rather than two.

   Left as it is, deliberately. A year still satisfies the preload list's
   floor, and raising it means a cluster-wide ConfigMap **shared with
   tralkserver** — someone else's security header changed as a side effect of
   this project's preference. That is a decision to take on purpose, not a fix
   to apply quietly. The sidecar keeps sending two years so a deployment
   without nginx in front is still correct.
3. **`TRUST_PROXY=2` is set here and has never run against the cluster.** The
   former open item — `trust proxy` never set, so no `Secure` on the cookie and
   a rate limiter keyed to the proxy — is closed in code and proved by tests
   (`apps/dashboard/src/auth/trust-proxy.e2e.spec.ts`), but every number in it
   is derived from configuration read off disk rather than from a request that
   actually made the trip. Three things to check with `kubectl exec` and one
   `curl` after the first deploy:
   - **The forwarded chain the app receives.** `TRUST_PROXY=2` assumes
     ingress-nginx and the Caddy sidecar are the only hops that write
     `X-Forwarded-For`. If a third appears, the count is wrong in the direction
     that matters — see the manifest comment.
   - ~~**That the sidecar kept nginx's scheme.**~~ **Confirmed 2026-08-13.** A
     request through the real ingress arrives at the sidecar carrying
     `X-Forwarded-Proto: https`, so the cookie will carry `Secure`. This was
     the failure mode that looks like success from every other angle —
     `trusted_proxies private_ranges` is what prevents Caddy overwriting it
     with `http`.
   - **That `CF-Connecting-IP` arrives** — still unproven, and cannot be
     proven until a record is actually proxied through Cloudflare. The
     preflight above used `curl --resolve` straight at the load balancer,
     which bypasses Cloudflare by design, and the header was correctly absent.

4. **The load balancer's public address bypasses Cloudflare, and nothing here
   stops it.** A caller who reaches it directly traverses the same trusted hops
   and can therefore send any `CF-Connecting-IP`, choosing its own rate-limit
   bucket. There is no signal left at the app to distinguish that request:
   nginx discarded the forwarded chain, so the Cloudflare edge address never
   arrives either. The fix is a DigitalOcean firewall restricting the LB to
   Cloudflare's published ranges — a change in `tralk-infra`, shared with
   tralkserver, and a decision rather than a commit inside this task. What the
   gap costs is evasion of a per-IP bucket, not entry: the per-account backoff
   is persisted and reads no address at all.
5. **No log aggregation and no uptime check.** Pod logs are lost with the pod.
   `/api/health` is outside the session guard precisely so a monitor can use it
   without a credential — point something at it.

   The first deploy made this worse than it reads. An enrichment worker emitted
   **43,628 log lines in roughly ten minutes**, almost all of them pdf.js
   repeating `Warning: Ran out of space in font private use area.` — so the
   Nest lines that actually say what the pipeline decided were buried, and
   `kubectl logs --tail` returned nothing but font warnings. Pod logs are
   currently the ONLY observability this deployment has, and they are already
   unreadable. Silencing pdf.js' warnings is the cheap half; the real fix is
   shipping logs somewhere they outlive the pod.

6. ~~**The images have never been built for `linux/amd64`.**~~ Closed
   2026-08-13: built by the workflow, pulled by the nodes, running.

---

## Open questions for the founder

**Answered by the 2026-08-13 deploy.** The questions are kept below rather than
deleted, because the reasoning is what makes an answer re-checkable:

- **0 (DNS/ACME)** — Namecheap registration, nameservers moved to **Cloudflare**,
  and this repository ships its own `letsencrypt-cloudflare` ClusterIssuer
  (`k8s/05-issuer.yaml`). See the decision note in section 4.
- **1 (does it belong on tralk's cluster)** — yes, but not on tralk's *node*.
  The pool was grown 1 → 2 for Docling (2026-08-12) and 2 → 3 for the app
  (2026-08-13). Disclosed's workloads and tralkserver now share a cluster and
  a managed database, not a machine. **The pool is still terraform-managed
  from tralk-infra with a stale count in state; a `terraform apply` there
  would shrink it and evict this.** Bump that variable to 3.
- **2 (images under `investorstribe`)** — yes, three private repositories.
- **3 (which database, under which user)** — `turret`, and a `disclosed` user
  scoped `readWrite` to it alone. Proven by a refused write to `tralkdb`.
- **5 (`AUTH_MODE`)** — `firebase`, confirmed in the running boot line.

Still open: **4** (the droplet/dev poller — both are running, against separate
databases, and only one should be the one anybody trusts) and **6** (nothing
backs up the managed database on a schedule of ours).

0. **Where does `disclosed.live`'s DNS live, and therefore which ACME challenge
   can succeed?** This is the blocker, not a preference — section 4's "What the
   cluster already has" lays out the three answers and what each costs. The
   existing `letsencrypt-prod` issuer only works if the zone's nameservers are
   at DigitalOcean; the droplet doc recommends Cloudflare. Nothing else in this
   document can be tested until it is decided.
1. **Does Disclosed belong on tralk's `prod` cluster at all?** It is one
   `s-4vcpu-8gb` node (~$60/mo) already carrying tralkserver (300m/500Mi
   requested, 1500m/1500Mi limits), ingress-nginx and cert-manager. Adding
   464Mi/210m of requests fits; the 1152Mi of limits is the number to watch,
   and a node replacement now takes two products down instead of one. The
   alternatives are a second node (+$48/mo) or a cluster of its own (+$60/mo).
2. **Should the images live under `investorstribe`?** Using it means one access
   token and one habit. It also means a personal project's images sit in the
   company's registry namespace. A separate Docker Hub account is a one-line
   change to `REGISTRY_NAMESPACE` in the workflow plus a second secret.
3. **Which database on `prod-mongo-v2`, and under which user?** These manifests
   assume a `turret` database and a user scoped to it. A shared admin user
   would give the enrichment worker write access to `tralkdb`.
4. **Is the droplet retired or kept?** Both can run — they are separate
   databases — but only one should have a poller, and section 6 says why.
5. **`AUTH_MODE=firebase` is pinned in the manifest.** If sign-in should be
   `local` on this deployment, that is a one-word change plus deleting three
   origins from the sidecar's CSP.
6. **Nothing backs up the managed database on a schedule of ours.** DO's
   point-in-time restore covers the cluster; the droplet's `backup.sh` produced
   an off-provider copy in Spaces, and no equivalent CronJob is shipped here.
