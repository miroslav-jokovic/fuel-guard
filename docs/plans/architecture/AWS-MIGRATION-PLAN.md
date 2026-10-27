# AWS migration — the app tier leaves Railway (2026-10-21)

Opened 2026-10-21 at the owner's request, after Railway published that an attacker had obtained
users' environment variables: *"we have some variables there that are connected to finance and I
can't risk this … tell me what we have to do to migrate app and web to AWS."*

This is a decision log. Decisions are `D-AWS*`, questions for the owner `Q-AWS*`, work items `AWS*`.
The progress log is at the END (append there, never into the tables).

It continues `PLATFORM-RELIABILITY-PLAN.md`: D-RLY9 named a target (ECS Fargate in us-west-2, one
NAT gateway, keep Supabase); D-RLY13 deferred it "until a move is decided". **The move is decided**
(owner, 2026-10-21, answering Q-AWS1: *"lets just go Supabase + EC2"*), which supersedes D-RLY13, and
the owner chose the cheaper EC2 shape over D-RLY9's ECS one (D-AWS3). Nothing here is built yet; no
code, no infrastructure, no variable has changed.

**Two separate jobs, and the first does not wait for the second.** Moving hosts does not un-leak a
key: a value copied off Railway works from anywhere until the vendor revokes it. So rotation (§4
AWS0) starts now, and the migration (AWS1 onward) follows on its own schedule. Railway's own post
("Security Disclosure: Wednesday October 21st", blog.railway.com) confirms an unauthorized party
reached the systems that store customer environment variables and obtained some **decrypted**; it
tells every customer to roll every variable, and says **all deployments are paused**. A Railway
variable only takes effect on a redeploy, so while deploys are paused a new key cannot go live on
Railway — revoking the old one first would break the feature. §5 says how rotation runs around that.

## 1. What is on Railway today (measured 2026-10-21, production)

Project `serene-elegance`, two environments (`production`, `uat`), same shape in each.

| Service | Public host | What it is | Secrets it holds (names only) |
|---|---|---|---|
| `@fleetguard/api` | `fleetguardapi-production.up.railway.app` | The back end. Static outbound IPs WEX allowlists; owns the scheduler lanes (D-RLY2) | ~75 variables: Supabase service role, EFS SOAP user/password, EFS Graph client secret, PSP production + UAT keys, `SECRETS_ENCRYPTION_KEY`, Samsara token + webhook secret, Telnyx, Brevo, Anthropic, Med-Stop, HERE, GovInfo, S3 backup keys |
| `@fleetguard/web` | `360.silvicominc.com` (custom domain) and `fleetguardweb-production.up.railway.app` | The front door; a full API with schedulers off; serves the applicant page same-origin (DEPLOYMENT.md) | Nearly the same set as api, including the service role, EFS Graph secret and `SECRETS_ENCRYPTION_KEY` |
| `platform-console` | `platform-console-production-3319.up.railway.app` | Internal console (`apps/admin` + `apps/admin-api`) | Supabase service role |
| `driver-dist` | `driver-dist-production.up.railway.app` | APK install page, 3.15 GB volume | `UPLOAD_TOKEN`, `TESTER_PASSWORD` |
| `Expo-Open-OTA` | `expo-open-ota-production-fcf8.up.railway.app` | Self-hosted OTA update server the driver app checks | `DB_KEYS_MASTER_KEY_B64` (wraps the update **code-signing** keys), `JWT_SECRET`, `ADMIN_PASSWORD`, its own `AWS_*` bucket keys, `DB_URL` |
| `Postgres` | private | The OTA server's database, 893 MB | — |

**What a stolen set unlocks, in order of harm:**

1. `SUPABASE_SERVICE_ROLE_KEY` + `SECRETS_ENCRYPTION_KEY` together → the whole database bypassing RLS,
   **and** the ability to open everything `lib/secretBox.ts` sealed: the EFS card mirror (full card
   numbers, `efsCardMirror.ts`), the EFS client certificate's private key, sealed SOAP credentials.
   The service role alone also reads the older plaintext credential columns secretBox's header names
   (`integration_credentials.samsara_api_token`, `efs_soap_credentials.soap_password`).
2. `EFS_SOAP_USERNAME`/`PASSWORD` → card management (limits, status) — but only from an allowlisted
   IP, which is the one control that still holds after a variable leak.
3. `PSP_API_KEY_PRODUCTION` → paid PSP orders.
4. `EFS_GRAPH_CLIENT_SECRET` → reads the EFS report mailbox.
5. Expo-Open-OTA's master key → signs an update every driver phone would install.
6. driver-dist `UPLOAD_TOKEN` → replaces the APK on the install page.
7. Telnyx / Brevo → texts and email as us, on our bill. Anthropic, HERE, Med-Stop, GovInfo,
   Samsara (read-only token; webhook secret forges events) → cost or data.

**Provider hostnames clients carry** — each must change before Railway can be switched off:

| Who | Where the host is set | Can we change it alone? |
|---|---|---|
| Driver app, installed builds | `EXPO_PUBLIC_API_URL` (GitHub secret, inlined into the JS bundle) = `fleetguardweb-production.up.railway.app` | Yes, by OTA — the bundle is JS |
| Driver app, OTA server address | `UPDATES_URL` → `updates.url` in `app.config.ts`, native config | **No** — needs a new native build installed on every phone |
| McLeod connector on Alex's VM | `FUELGUARD_INGEST_URL` = the api Railway host (`tools/mcleod-agent/connector.example.env`) | **No** — Alex edits the VM |
| Samsara webhook | Samsara console → `fleetguardweb-…/api/webhooks` (`routes/webhooks.test.ts`) | Yes, in Samsara's console |
| Office SPA | `VITE_API_URL` on `@fleetguard/web` = the api Railway host | Yes, a build variable |
| Platform console | `VITE_CUSTOMER_APP_URL` default in `apps/admin/src/layouts/AppShell.vue:30` | Yes |
| CI | `deploy-verify.yml` / `smoke.yml` `API_URL` / `WEB_URL` variables, `scripts/efs.mjs:49` default | Yes |
| Supabase Auth | site URL + redirect allowlist | Yes, Supabase dashboard |
| WEX | allowlisted outbound IPs (Railway static IPs of `@fleetguard/api`) | **No** — WEX adds the new IP |

## 2. Decisions

| ID | Decision | Why |
|---|---|---|
| **D-AWS1** | **Rotation first, independent of the move (AWS0).** Every secret in §1 is reissued at its vendor and the old one revoked, in the §5 order. New values go into AWS Systems Manager Parameter Store (AWS1 sets it up first, an hour's work) and are copied onto Railway only for as long as Railway still runs the app. | A leaked key stays valid on every host until revoked; the move protects only values created after it. Keeping the master copy off Railway means a second Railway incident leaks only what is still running there. |
| **D-AWS2** | **App tier only; Supabase stays.** Database, Auth, Storage and PostgREST do not move. The OTA server's small Postgres moves with the app (D-AWS8). | All three Supabase projects are already in AWS us-west-2, so the app lands next to its database. Moving off Supabase is 29 `supabase.auth` sites, 35 `storage.from` sites, RLS keyed on Supabase JWTs and the Management API in two workflows — weeks of work that answers a different question (hosting-cost estimate 2026-10-20). |
| **D-AWS3** | **One EC2 server per environment in us-west-2 (Oregon), ARM (Graviton):** production `t4g.large` (2 vCPU, 8 GB), staging `t4g.medium` (2 vCPU, 4 GB), Amazon Linux 2023, Docker Compose. **No ECS, no load balancer, no NAT gateway.** Rejected: ECS Fargate (D-RLY9's shape, ~$120–200/mo hosting, mostly the NAT gateway and load balancer we need only at a scale we do not have); Lightsail (~$15/mo cheaper, but its servers cannot take an IAM role, so secrets would sit in a file on the server — the failure this plan exists to fix); DigitalOcean (nearest region San Francisco, not next to Supabase); Hetzner (US prices roughly tripled in 2026); the owner's office server (measured 150–390 ms per Supabase request from Springfield vs tens of ms in-region; one internet line, one power feed). Owner chose this 2026-10-21. | Production today uses ~2 GB (api ~1.2 GB, web ~0.8 GB) and ~0.03 vCPU; 8 GB holds api ×2, worker, web, console, OTA and its database with room. Same region as Supabase matters because our slowness is serial round trips (PLATFORM-RELIABILITY §1). One server is the same single point of failure as today's one Railway replica; D-AWS14 is how it is recovered. Cost in §3. |
| **D-AWS4** | **Each server has one Elastic IP — its inbound address AND its outbound address.** WEX allowlists the production IP beside the Railway ones before cutover (AWS3). | A server in a public subnet sends from its own Elastic IP, so the fixed address WEX needs costs ~$3.65/mo instead of a ~$35/mo NAT gateway. Adding beside, not replacing, lets both hosts work during cutover and keeps rollback possible. |
| **D-AWS5** | **Our own domain names for every client-facing host, attached to Railway FIRST (AWS2), before anything moves.** Proposed: `360.silvicominc.com` (web, already ours), `api.360…`, `ota.360…`, `drivers.360…`, `console.360…`, and `staging-*` twins (Q-AWS4). Every client in the §1 host table is repointed to these while Railway still serves them. | Then the cutover is a DNS change, rollback is a DNS change, and the two steps we cannot control — a native driver build on every phone, Alex's VM — happen on their own timeline with nothing broken in between. A provider hostname in a client is how we got locked in; never again. |
| **D-AWS6** | **One container image for api, web and the worker**, built by a `Dockerfile` that reproduces `railway.json`'s build and start commands exactly (`node --import tsx apps/api/src/index.ts`, Node 22), pushed to ECR, tagged by commit, deployed by digest. Role comes from environment variables, as today. The console gets its own image. | Same artefact in staging and production. Node 22, not 24.10: the 24.10 worker drops the tsx loader (known production-only failure). |
| **D-AWS7** | **Secrets live in Parameter Store (SecureString, standard tier) under `/silvicom/<env>/<service>/`; the server's IAM role may read only its own environment's path.** The deploy script reads them into a `tmpfs` file under `/run` when a container starts — never onto the disk, never in the image, never in GitHub. Each container gets only its own service's path; the list per service is derived, not copied from Railway (Q-AWS8). | No key on disk to steal. Standard-tier parameters are free. Today web holds the EFS Graph secret, the service role and the sealing key though it runs no schedulers — every copy is one more place to leak. |
| **D-AWS8** | **What runs on each server** (Compose services): `api` ×2 (lane `egress`, D-RLY2), `worker` ×1 (lane `general`), `web` ×1, `console` ×1, `ota` ×1 + `ota-db` (Postgres, its data on the server's disk, nightly dump to S3), and **Caddy** in front (HTTPS certificates from Let's Encrypt, routes by host name, spreads `api.360…` across the two api containers). | The lease already enforces "one scheduler per lane per database", so two api containers — or Railway and AWS both running during cutover — cannot double-poll WEX or double-send. The OTA database is 893 MB; an RDS instance for it (~$15/mo) buys nothing a nightly dump and the disk snapshot do not. |
| **D-AWS9** | **Health and draining carry over.** Caddy health-checks `/healthz` (must stay 200, DEPLOYMENT.md) and stops routing to a container that fails it; the external monitor (Q-RLY1) watches `/api/version/ready`; each container's stop grace period equals today's Railway draining seconds. A deploy replaces the api containers one at a time, so a deploy drops nobody. | These are load-bearing on Railway; a new host must not quietly drop them. One-at-a-time is what gives a single server the "deploy without downtime" Railway gave us. |
| **D-AWS10** | **Deploys from GitHub through OIDC — no long-lived AWS keys in GitHub, no SSH.** CI builds and pushes the image, then asks the server through **SSM Run Command** to run its deploy script with that digest. Merge to `main` → staging. `release.yml` keeps its order (migrations, then code) but its "code" step becomes "deploy the approved commit's image to production" instead of fast-forwarding `production` for Railway. `RELEASE_TRAIN`, `require-ci-green`, `ci/tested-tree` and the path filter that replaces `watchPatterns` keep their meaning. | The release train is the contract the owner approves against; only its last hop changes. Port 22 stays closed; people reach the server through SSM Session Manager, which is logged. |
| **D-AWS11** | **Logs to CloudWatch, 30-day retention** (Docker's `awslogs` driver); the `[metrics]` line and `railway logs` recipes in DEPLOYMENT.md are rewritten as CloudWatch Logs Insights queries. | Our only request telemetry is that log line (memory: api has no request logging). |
| **D-AWS12** | **driver-dist becomes static files on S3 behind CloudFront**, with uploads by the CI role instead of `UPLOAD_TOKEN`. | It is a file shelf; a volume-backed container is the wrong shape for it. Removes one secret. |
| **D-AWS13** | **Cutover per environment, staging first, in the release window; Railway kept warm for 14 days with schedulers off** (`RUN_SCHEDULERS_IN_PROCESS=false`, lanes empty), then deleted (AWS12). | Rollback is DNS back to a host that still has the code. 14 days covers a full release cycle plus slow phones. |
| **D-AWS14** | **Recovery for a one-server environment:** daily EBS snapshots kept 7 days (Data Lifecycle Manager); EC2 automatic recovery on (moves the server to new hardware on a host failure, same IP and disk); the whole server is built from code (Q-AWS7) so a lost server is rebuilt from the last snapshot in ~30 minutes; IMDSv2 required; security group opens 80/443 only; security updates applied automatically. | This is what replaces "Railway restarts it for us". The data that matters is in Supabase and S3, not on the server; the server holds only the OTA database (dumped nightly) and logs (in CloudWatch). |
| **D-AWS15** | **Buy a 1-year Compute Savings Plan after the first full month**, sized to what the two servers actually used. | ~30% off the servers once the sizes are proven; committing before measuring could lock in the wrong size. |
| **D-AWS16** | **The driver app does not come to AWS; it will ship through the Google Play and Apple stores** once its purpose is settled (owner, 2026-10-22). So the OTA server and the APK install page are **not moved** (AWS8, AWS9 dropped, no `ota.360…`/`drivers.360…` names). Installed apps still call `fleetguardweb-production.up.railway.app`, so before Railway goes (AWS12) the OTA server ships **one last update** that points them at `api.360.silvicominc.com` (AWS2a); then the OTA server and the install page are switched off on Railway and `driver-ota.yml`, `driver-android.yml` and release.yml's driver-update step are removed. The leaked OTA secrets are contained meanwhile: `JWT_SECRET` rotated, the admin password changed in the xprem dashboard (it seeds only on first boot). `driver-store.yml` is the surviving lane. | Owner's distribution decision. A store build uses the store's signing, so the leaked code-signing keys stop mattering once the OTA server is off; until then rotating the dashboard credentials stops anyone publishing with the old ones. Saves AWS8/AWS9 work and the ~95%-adoption wait (Q-AWS10). After the last update, phones keep working on the bundle they have; a fix before the store builds means an APK or nothing. |
| **D-AWS17** | **The office app's API moves to AWS on its own origin, ahead of `api.360…`** (2026-10-26). Caddy on the production server sends `360.silvicominc.com/api/*` to the api replicas, which already run there with production's settings, and `PRODUCTION_VITE_API_URL` becomes `https://360.silvicominc.com`, so the SPA's calls leave Railway with the next released image. `api.360…`, the console, the driver app and the webhooks (Samsara, WEX) keep Railway's host until GoDaddy's NS delegation lands; the schedulers stay with #1743. A changed Caddyfile now recreates the caddy container (`CADDYFILE_HASH`), which nothing needed before. | The owner wanted the API on AWS on 2026-10-26, and DNS was the only blocker: GoDaddy had published nothing since 2026-10-23 (SOA 2026102306). `360.silvicominc.com` already resolves to the server and has its certificate, so this needs no DNS. The api replicas, not the web container, take `/api`, because the web container fences off the EFS routes (app.ts). Same origin also means CSP `'self'` and no CORS. Rollback: deploy the previous image (e.g. `3f517ed`, which calls Railway) through `aws-production.yml`. |

## 3. Target setup and cost

| Piece | Production | Staging |
|---|---|---|
| Server | `t4g.large`, 8 GB, 40 GB disk, Elastic IP | `t4g.medium`, 4 GB, 30 GB disk, Elastic IP |
| Runs (D-AWS8) | Caddy, api ×2, worker, web, console, ota + ota-db | Same, one api |
| Host names (D-AWS5) | `360.silvicominc.com`, `api.360…`, `ota.360…`, `console.360…` | `staging-*` twins |
| Driver install page | S3 + CloudFront, `drivers.360…` | Same |
| Secrets (D-AWS7) | Parameter Store `/silvicom/production/…` | `/silvicom/staging/…` |
| Database | Supabase (unchanged) | Supabase staging (unchanged) |

Monthly cost, us-west-2 on-demand list prices as known on 2026-10-21 (to be confirmed on AWS's
calculator at AWS1; Supabase estimated from list prices, not the invoice):

| Item | $/mo |
|---|---|
| Production server `t4g.large` | ~49 |
| Production Elastic IP + disk + snapshots | ~9 |
| Staging server `t4g.medium` + Elastic IP + disk | ~31 |
| CloudWatch logs, S3 (driver installs, OTA dumps), Parameter Store (free) | ~5 |
| **AWS hosting** | **~94** |
| Supabase (unchanged) | ~50 |
| **Total** | **~145**; **~125** after the Savings Plan (D-AWS15) |
| Today (Railway ~$53 + Supabase ~$50) | ~105 |

Not included, decided separately: external uptime monitor (Q-RLY1, ~$29), Supabase point-in-time
recovery (Q-RLY3, ~$100).

## 4. Work queue

| Item | What | Waits on | Who |
|---|---|---|---|
| **AWS0** | Rotate every secret in §1, in the §5 order; check each vendor for use we did not make | Nothing — **now** | Owner in vendor consoles; Claude for Railway/GitHub/Supabase and the reseal script |
| AWS0a | `SECRETS_ENCRYPTION_KEY` rotation needs code first: secretBox holds ONE key, and `efsCardRef.ts` derives card lookup handles from it, so a new key changes every handle. Build an old+new key read path, reseal every sealed row, recompute every card ref, then drop the old key | Q-AWS3 | Claude (PR + migration if refs are stored) |
| **AWS1** | AWS account(s), root MFA, Identity Center logins, budget alarm at $150, Parameter Store paths | Q-AWS6 | Owner creates the account and adds the card; Claude the rest |
| **AWS2** | Custom domains on Railway (D-AWS5); repoint web SPA, console, CI, Supabase Auth, Samsara webhook | Q-AWS4 (names, DNS access) | Claude + owner (DNS) |
| AWS2a | ~~Driver OTA, then a native build with `UPDATES_URL` = `ota.360…`~~ **Replaced by D-AWS16:** one last OTA update with `EXPO_PUBLIC_API_URL` = `api.360…`, published from the Railway OTA server; no native build | AWS2 (`api.360…` live) | Claude; owner sets the GitHub secret |
| AWS2b | Alex changes `FUELGUARD_INGEST_URL` on the VM to `api.360…` | AWS2 | Owner asks Alex |
| **AWS3** | Ask WEX to allowlist the production Elastic IP beside the Railway IPs | AWS4 (the IP exists) | Owner |
| AWS4 | Server foundations, as code (Q-AWS7): Elastic IPs, security groups, instance roles, snapshot policy, automatic recovery, the two servers | AWS1 | Claude |
| AWS5 | `Dockerfile` + ECR + GitHub OIDC role; image builds in CI next to `typecheck-build` | AWS1 | Claude |
| AWS6 | Compose stack + Caddy + deploy script (D-AWS8/9) on the staging server, secrets from Parameter Store | AWS4, AWS5 | Claude |
| AWS6a | Move the Supabase key watcher (`scripts/supabase-key-watch.mjs`, running from launchd on the owner's Mac since 2026-10-21) to the production server as a systemd timer, with a fine-grained Supabase token that can only read logs (`analytics_logs_read`) in Parameter Store; then remove the Mac's launchd job and Keychain items | AWS6 on production | Claude |
| AWS7 | Workflows: staging deploy on merge; `release.yml` code step; `deploy-verify.yml`, `smoke.yml`, `STAGING_*`/production URL variables, `pnpm verify:live` | AWS6 | Claude |
| AWS8 | ~~OTA server + its database onto the server~~ **Dropped (D-AWS16).** Instead: the Railway OTA server and install page are switched off after AWS2a, and their release-train steps removed | AWS2a | Claude |
| AWS9 | ~~driver-dist to S3 + CloudFront~~ **Dropped (D-AWS16)** — switched off with the OTA server | — | — |
| **AWS10** | Staging cutover: DNS `staging-*` → AWS; browser pass with the three fixtures; scheduler lanes `held` by the AWS containers | AWS6–AWS9 | Claude |
| **AWS11** | Production cutover in the release window: DNS → AWS; confirm EFS card management works from the new IP; lanes held; Railway schedulers off | AWS3 confirmed, AWS10 green for 1 week, AWS2a/2b adopted (Q-AWS10) | Claude runs; owner approves the night |
| AWS12 | After 14 days: delete Railway variables and services, remove its GitHub app, cancel; ask WEX to drop the Railway IPs; rewrite `docs/DEPLOYMENT.md`, `docs/WORKER-DEPLOYMENT.md`, root `CLAUDE.md` | AWS11 + 14 days | Claude; owner cancels billing |
| AWS13 | Savings Plan (D-AWS15) | AWS11 + one full month | Owner buys; Claude sizes it |

Rough calendar if nothing waits on a third party: AWS0 1–2 days (AWS0a ~2 days of it), AWS1–AWS10
about one week, AWS11 the week after. WEX (AWS3), Alex (AWS2b) and driver phones taking the native
build (AWS2a) are what the calendar actually depends on.

## 5. Runbooks (outline — expanded as each item is built)

### Rotation order (AWS0)

Each line: reissue at the vendor → put the new value in Parameter Store → set it on every Railway
service and environment that holds it → redeploy → confirm the feature works → revoke the old value.
Check the vendor's own log for use since 2026-10-01 before revoking, so evidence is not lost.

**While Railway's deploys are paused**, the redeploy step cannot happen, so the old value cannot be
revoked without breaking the feature. For each key, then: create the new one now (where the vendor
allows two at once), restrict or monitor the old one where the vendor allows it, and revoke it the
hour Railway builds resume. If they stay paused for days, AWS6 on the production server becomes the
fastest way to get new keys serving — that is a reason to start AWS1/AWS4 today, not a reason to
wait on rotation.

1. Supabase service role (and the anon key, if the project uses legacy JWT keys — rotating the JWT
   secret signs everyone out; Q-AWS3). Also: GitHub secrets that hold it, the console.
2. EFS SOAP password; then review EFS card changes and limit edits since 2026-10-01.
3. Credentials stored IN the database that the service role could read: EFS SOAP credentials,
   Samsara token in `integration_credentials`, the EFS client certificate (reissue with WEX if the
   sealing key is presumed leaked).
4. `SECRETS_ENCRYPTION_KEY` — AWS0a, after the code lands.
5. PSP production + UAT keys; review orders.
6. EFS Graph client secret (Azure app registration); review sign-in logs.
7. Expo-Open-OTA: master key, signing keys, JWT secret, admin password, bucket keys; driver-dist
   upload token + tester password.
8. Telnyx, Brevo (three places for Telnyx: api, web, release-notify secrets — DEPLOYMENT.md),
   Samsara token + webhook secret, Anthropic, Med-Stop, HERE, GovInfo, S3 backup keys (CloudTrail).
9. Railway itself: 2FA on, API tokens revoked, GitHub app access reviewed.

### Cutover (AWS10 / AWS11)

Lower DNS TTLs to 60 s a day ahead → AWS containers running and `/api/version/ready` 200 → set
Railway `RUN_SCHEDULERS_IN_PROCESS=false` and redeploy → AWS containers take the lanes
(`/api/version` `schedulers` all `held`) → switch DNS → watch `[metrics]` in CloudWatch, the EFS feed
age, the McLeod ingest, Samsara webhook arrivals, a driver check-in → raise TTLs after 24 h.

**What the workflows need at cutover (built 2026-10-22, #1728).** release.yml and deploy-verify.yml
ask each host whether Railway serves it (`/api/version` `deploymentId` = `RAILWAY_DEPLOYMENT_ID`), so
no workflow is edited on the night. The steps that are not DNS:

1. **As soon as `api.360…`/`console.360…` resolve to Railway (AWS2):** repository variables `API_URL`
   → `https://api.360.silvicominc.com`, `WEB_URL` → `https://360.silvicominc.com`, `CONSOLE_URL` →
   `https://console.360.silvicominc.com`, and `PRODUCTION_VITE_API_URL` → `https://api.360…`. The
   last matters most: the AWS production SPA image inlines it, and ECR tags are immutable, so a
   value changed after a commit's `-production` image was built reaches AWS only with the NEXT
   released commit. Today the AWS image would send the office's browsers to Railway's api host. The
   `STAGING_*` twins likewise once the staging names exist.
2. **WEX and Med-Stop both bind production's address.** The Med-Stop key is IP-bound to `api`'s
   egress (D-MS3, WORKER-DEPLOYMENT.md) exactly as WEX card management is, so Med-Stop is asked
   for `44.236.127.194` beside WEX (AWS3). Until both confirm, `RUN_SCHEDULERS` stays `false`.
3. **Schedulers move by lease, not by a stop-start.** A released commit with `RUN_SCHEDULERS=true` in
   `production.env` starts AWS's api ×2 (`egress`) and its worker (`general`, #1726 — 0 copies until
   then); they wait as standbys while Railway holds the leases. Setting Railway api's
   `RUN_SCHEDULERS_IN_PROCESS=false` and redeploying hands both lanes to AWS within a lease TTL;
   `/api/version` `schedulers` shows who holds them.

### Rollback

DNS back to Railway's custom-domain targets; set `RUN_SCHEDULERS_IN_PROCESS=true` on Railway api;
stop the AWS containers so the lease moves back. Valid until AWS12.

### Server lost (D-AWS14)

Automatic recovery handles a hardware fault on its own. A server that is gone or broken: launch a
new one from the code (Q-AWS7) on the latest snapshot, re-attach the Elastic IP (so WEX and DNS need
no change), run the deploy script with the current digest, restore the OTA database from the
nightly dump if the snapshot is older.

## 6. Open questions

- **Q-AWS1 — is the move decided?** **ANSWERED 2026-10-21: yes** — *"lets just go Supabase + EC2"*.
  Supersedes D-RLY13; WEX is asked as soon as the production Elastic IP exists (AWS3).
- **Q-AWS2 — was our project in Railway's incident?** Railway's post says the impact "may be limited to
  a subset of users", that affected customers are emailed directly, and that everyone should treat
  themselves as affected. Recommendation: check the owner's inbox for Railway's email and ask
  support for the time window, but rotate as if affected regardless.
- **Q-AWS3 — rotation that signs people out or breaks lookups.** (a) If Supabase still uses the legacy
  JWT secret, rotating it signs out every office user and driver; the new API keys rotate without
  that. (b) A new `SECRETS_ENCRYPTION_KEY` changes every EFS card ref (AWS0a). Recommendation: do
  (a) at night with a notice to offices; do (b) through the two-key reseal, never a straight swap.
- **Q-AWS4 — domain names and DNS.** Who controls DNS for `silvicominc.com`, and are the D-AWS5 names
  right? Recommendation: the names as proposed; Route 53 only if the current DNS host cannot do
  60 s TTLs.
- **Q-AWS6 — AWS account shape and owner.** One account for both environments, or separate production
  and staging accounts under one organization; whose card pays. Recommendation: two accounts, so a
  staging credential can never touch production.
- **Q-AWS7 — how the servers are built from code.** Terraform, AWS CDK (TypeScript, matches the repo),
  or by hand in the console. Recommendation: **CDK in `infra/`**, so the setup is reviewed in PRs
  and a lost server is rebuilt by one command (D-AWS14).
- **Q-AWS8 — how the per-service secret list is derived (D-AWS7).** Candidates: from `env.ts` schema
  groups tagged by role, or from the Railway lists minus what each role never reads. Recommendation:
  tag `env.ts` groups by role and generate the list — a hand list beside the schema is a copy.
- **Q-AWS9 — who can reach the console.** Today it is a public Railway host. Recommendation: Caddy
  allows `console.360…` only from the office IPs and the owner's, on top of its login.
- **Q-AWS10 — how many drivers must be on the new native build before production cutover?** **WITHDRAWN 2026-10-22 by D-AWS16** — there is no new native build; the one last OTA update (AWS2a) is what installed apps need.
  Installed builds still check the old OTA host for updates. Recommendation: keep Railway's OTA
  service alive past AWS12 until the build-card telemetry shows ≥95% of active drivers on the new
  build; everything else can cut over before that.
- **Q-AWS11 — Cloudflare in front?** Its free plan adds DDoS protection and hides the server's IP for
  inbound traffic (WEX only sees outbound, so the allowlist is unaffected). Recommendation: yes for
  the office and applicant hosts once cutover is stable; not a blocker.

- **Q-AWS12 — the AWS account cannot reach us-west-2 (found 2026-10-21, blocks AWS1/AWS3/AWS4).** The
  account created today is a "project" account in AWS's new simplified sign-up: it sits in an
  organization whose management account is the owner's, under AWS-managed service control policies
  that deny every region but **us-east-2 (Ohio)** — `ec2`/`ecr` calls in us-west-2 are refused with
  "explicit deny in a service control policy" — and deny parts of IAM (listing OIDC providers was
  refused, so GitHub OIDC, D-AWS10, is likely blocked too). Candidates: (a) the owner **activates
  advanced features** in AWS Settings (settings.aws.com → Projects → Actions → Explore advanced
  features; **irreversible**; removes the spend limit; makes the policies editable), then adds
  us-west-2 to the region policy's `RegionFloor` statement; (b) build in us-east-2 — rejected: Ohio to
  Oregon adds ~50 ms to every Supabase call, the exact problem D-AWS3 exists to avoid; (c) move
  Supabase to us-east-2 — a new project and a data migration, weeks. Recommendation: **(a)**, before
  any Elastic IP is allocated — an Elastic IP is regional, so an Ohio address given to WEX, PSP and
  Alex would have to be replaced.

- **Q-AWS13 — one SPA bundle for both environments? (found 2026-10-22, AWS5).** The office SPA reads
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL` and `VITE_APP_ENVIRONMENT` through
  `import.meta.env`, which Vite inlines at build time, and staging and production point at different
  Supabase projects. So the `app` image is built once per environment (as Railway builds once per
  environment today) and D-AWS6's "same artefact in staging and production" holds for the server code
  only. Candidates: (a) keep per-environment images — no code change, the production image is built
  by `release.yml` from the approved commit; (b) the API serves `/config.js` with these public values
  from its own environment and the SPA reads it at boot — one image for both, a small web change plus
  a test that no `import.meta.env.VITE_*` read remains. Recommendation: **(a) now, (b) as its own PR
  after cutover** — (a) moves nothing that works today; (b) is the honest end state.

- **Q-AWS14 — container settings at rest on the server (found 2026-10-22, AWS6).** D-AWS7 says secrets
  are "never onto the disk". `deploy.sh` keeps them out of the image and GitHub and writes them only to
  the `/run/silvicom` tmpfs, but Docker stores each container's environment in its own config under
  `/var/lib/docker` on the (encrypted) root volume, so a disk snapshot holds them. Candidates: (a)
  accept it — the volume and its snapshots are encrypted and readable only through this account;
  (b) mount `/run/silvicom/<service>.env` into the container read-only and have `env.ts` load it at
  boot (a small code change; Docker then stores only the path); (c) the app reads Parameter Store
  itself at boot with the server role (more code, and the API cannot start when SSM is down).
  Recommendation: **(b)**, before production cutover (AWS11); (a) is acceptable for staging now.

(Q-AWS5, where the OTA database goes, is settled by D-AWS8: on the server, dumped nightly.)

## 7. Progress log

- **2026-10-21** — Plan opened from the owner's request after Railway's breach report. Inventory in §1
  measured from `railway service list` and `railway variables` (names only, no values read) and the
  hosts in code on `main`. Nothing built. AWS0 is the first item regardless of the move.
- **2026-10-21** — Railway's disclosure read: decrypted variables, roll everything, deploys paused
  (§5 rotation note). Hosts compared (D-AWS3); owner answered Q-AWS1 and chose Supabase + one EC2
  server per environment over ECS. §2–§6 rewritten for that shape; cost in §3.
- **2026-10-22** — Production foundations built in us-west-2: EC2 `i-09fb5a309304be00b` (`t4g.large`), EIP `44.236.127.194`, SG `sg-08d7a8dc5cbb427cf`, role `arn:aws:iam::891568748437:role/silvicom-production-server`, volume `vol-0bfeadbbaa8cfce81`, DLM `policy-087142b4938365c82`, and budget `silvicom-monthly-250`; Q-AWS12 resolved by removing only `UsWest2Partitional` from `p-5g9gv5mm` (`AdvancedModeRegionRestrictionSecurityControlPolicy`, attached to root `r-8opx`).
- **2026-10-22** — Supabase secret-key rotation prepared (both projects use `sb_secret_` keys, held only
  by api/web/console on Railway; legacy anon key stays on — installed driver apps use it). Railway
  deploys work again (production redeployed 09:00 and 09:16 CT), so rotation runs on Railway now.
  AWS2 started: `api.360.silvicominc.com` (→ `@fleetguard/api`), `console.360.silvicominc.com`
  (→ `platform-console`) and `ota.360.silvicominc.com` (→ `Expo-Open-OTA`) attached on Railway
  production, waiting on the GoDaddy CNAME + TXT records. AWS5 started: ECR repositories
  `silvicom/app` and `silvicom/console` (immutable tags, scan on push, keep 60), GitHub OIDC provider
  and role `silvicom-github-deploy` (trusts only `main` of `miroslav-jokovic/fuel-guard`, ECR push
  only), ECR pull added to `silvicom-production-server`; Dockerfile + `image.yml` in their own PR.
  Q-AWS13 opened.
- **2026-10-22** — AWS5 merged (#1716): images build on every merge to main and land in ECR
  (`af12f59` first). AWS4 staging: EC2 `i-0f86e0b17f4794168` (`t4g.medium`, 30 GB encrypted, no key,
  termination protection), EIP `44.239.69.109`, SG `sg-04785553f8d719217` (80/443 only), role
  `silvicom-staging-server` (reads only `/silvicom/staging/*`, pulls ECR). Railway `uat` settings
  mirrored into Parameter Store `/silvicom/staging/{api,web,console}/` (58/32/4, re-runnable sync,
  Railway stays the source until cutover). CloudWatch log groups `/silvicom/{staging,production}`,
  30 days. AWS6 stack (`infra/server/`: compose, Caddyfile, deploy.sh) deployed to staging from a
  test image of its branch: all four containers healthy, `/api/version` schema `0509` current from
  the staging database, outbound IP = the EIP, 1.9 of 3.8 GB used. Schedulers stay on Railway
  (`RUN_SCHEDULERS=false`) until AWS10. Q-AWS14 opened.
- **2026-10-22** — AWS6 merged (#1718; secret scan now treats our own host names as public). AWS7
  staging half merged (#1720): `image.yml`'s `deploy-staging` deploys every merge to the AWS staging
  server through SSM; role `silvicom-github-deploy` gained `DeployStagingThroughSsm` (SendCommand
  only on `Environment=staging` instances — simulated: staging allowed, production denied). First
  automatic deploy: merge `9a6a1ee` → SSM `4a02e8b8…` → all containers healthy in 2m42s. Key watcher
  (#1715) merged with the timestamp fix after it crashed on the first AWS staging deploy (Supabase's
  log timestamps changed format); AWS Elastic IPs added to its own-address list. Railway still serves
  every user; next: AWS7 production half in `release.yml`, Q-AWS14, staging DNS + cutover (AWS10).
- **2026-10-22** — **Q-AWS14 answered (b)** and built (`infra/server/fetch-settings.sh`, bind-mounted
  read-only settings files read by the existing `dotenv/config` via `DOTENV_CONFIG_PATH`, boot service
  for reboots). Proven on AWS staging: Docker's stored env has no secret, 0 keys anywhere under
  `/var/lib/docker`, and a real reboot came back healthy unattended. Also learned: Railway builds a
  repo-root `Dockerfile` despite railway.json's NIXPACKS builder — #1716 broke Railway `uat` deploys
  until #1719 moved the image to `infra/image/` (production unaffected: it deploys only by release).
- **2026-10-22** — AWS7 production half built (#1723): `aws-production.yml` builds `<sha>-production`
  images from `PRODUCTION_VITE_*` repository variables and deploys them to the production server
  through SSM; `release.yml` calls it after `ship`, beside verify (gates nothing until AWS11), and
  again after an automatic rollback. It refuses any commit not on the `production` branch. New role
  `silvicom-github-release` trusts only GitHub environment `aws-production` (branch policy: `main`)
  and may send commands only to `Environment=production` (simulated: release role → production
  allowed, staging denied; deploy role → the reverse). The SSM call is now one script for both
  environments (`infra/ssm-deploy.sh`). Production server checked: Docker 25, Compose 2.40, tmpfs
  `/run/silvicom` mounted, SSM online. **Blocking the first production deploy:** Parameter Store
  `/silvicom/production/{api,web,console}` is empty — copying Railway production's values in is the
  owner's step (it writes production secrets; the automated copy was refused by the permission
  check).
- **2026-10-22** — #1723 merged. Production settings copied from Railway into Parameter Store by the
  owner (`/silvicom/production/{api,web,console}`: 71/37/4, same counts as Railway). First production
  deploy, dispatched with `v2026.10.22` (`10dad1c`): run 39866910947 green, api ×2 + web + console
  healthy, `/api/version` commit `10dad1c` schema `0509` current, outbound IP = `44.236.127.194`,
  2.9 of 7.8 GB used. Every container `RUN_SCHEDULERS_IN_PROCESS=false`; the lanes stay held by
  Railway. That commit predates Q-AWS14 (b), so Docker's stored env still holds secrets on production
  until the next release deploys a commit with #1722 — expected, not a regression. Railway serves every
  user; next: DNS records (AWS2), WEX allowlist for `44.236.127.194` (AWS3).
- **2026-10-22** — **D-AWS16 (owner):** the driver app will go to the stores, so the OTA server and the
  install page stay on Railway until one last OTA update repoints installed apps at
  `api.360.silvicominc.com`, then both are switched off; AWS8/AWS9 dropped, Q-AWS10 withdrawn. Read
  xprem's source (`mercuretechnologies/xprem`): `ADMIN_PASSWORD` seeds the admin only on first boot
  (migration `20260717100100_seed_first_admin_user.go`), so it is changed in the dashboard; CLI API
  tokens are random keys stored as SHA-256 hashes, not JWTs, so rotating `JWT_SECRET` does not break
  `EOO_TOKEN` and the last update. Rotation is the owner's step (the permission check refuses Claude
  writing secrets). The switch-off PR is prepared and held until the last update has shipped.
- **2026-10-22** — Owner kept the D-AWS16 order (rotate → last update → switch off), after being told
  production has ONE driver login (last sign-in 09/08) and two registered phones (last seen 09/15).
  Found: no over-the-air update has EVER been published (every `driver-ota` run since 09/16 needed
  approval, failed, or found "Native fingerprint changed"; none before), and the last APK on the
  install page is `be313b7` (08/09; every later `driver-android` run failed). So installed phones run
  `be313b7` exactly, and an update from `production` can never reach them. **AWS2a runbook:**
  1. `api.360.silvicominc.com` resolves at GoDaddy and Railway shows it verified with a certificate;
     `curl https://api.360.silvicominc.com/api/version` returns production's commit.
  2. GitHub secret `EXPO_PUBLIC_API_URL` = `https://api.360.silvicominc.com`.
  3. Dispatch `driver-ota.yml` from branch `claude/driver-last-update` (= `be313b7`, pushed
     2026-10-22): same JavaScript the phones run, only the API host changed. If the runner image has
     drifted and the fingerprint no longer matches, that workflow dispatches an APK build instead of
     publishing — then stop and ask; do not approve it.
  4. Check the run summary says "JavaScript update published".
  5. Merge #1724 (draft, held: deletes `driver-ota.yml`, `driver-android.yml`, `apps/driver-dist`,
     release.yml's driver step), then remove the `Expo-Open-OTA` + its Postgres and `driver-dist`
     services on Railway (both environments), and delete the branch.
  Rotation is the owner's: `rotate-ota-jwt.sh` (JWT_SECRET, both environments) plus a new admin
  password set in each OTA dashboard.
- **2026-10-22** — OTA `JWT_SECRET` rotated (owner, both environments). Both redeploys FAILED their
  health check at first: Railway had re-keyed bucket `xprem-updates` after the breach, and the OTA
  services held the old secret (`SignatureDoesNotMatch`; the old containers kept serving because they
  started before the re-key). Owner copied each environment's current bucket credentials onto its
  service; uat had been pointed at PRODUCTION's bucket and keys and now uses its own
  (`xprem-updates-nlalvjwqevp`). Both deployments SUCCESS and ready 01:13Z 10/23 — the new
  `JWT_SECRET` is live and the leaked one is dead. Production's signing keys stay in production's
  bucket, so the last update (AWS2a) can still sign. Open: admin password change in each dashboard.
- **2026-10-22 (night)** — Three PRs for what Claude could do while the owner does DNS and WEX:
  **#1726** the worker container for the `general` lane. `worker.ts` never reads
  `RUN_SCHEDULERS_IN_PROCESS`, so the copy count is derived from the server's `RUN_SCHEDULERS`
  (0 until cutover; started earlier it could take `general` from Railway and call Med-Stop from an
  unbound address). api containers compete only for `egress`. **AWS6a, branch
  `claude/aws-keywatch-on-server`** (stacked on #1726): the key watcher as a 5-minute systemd timer
  on the server whose `<env>.env` says `KEYWATCH=true` (production), running the release's own
  script from the app image. Secrets fetched at every pass: `/silvicom/production/keywatch/` holds
  only `SUPABASE_ACCESS_TOKEN` + `RELEASE_NOTIFY_EMAILS`/`_PHONES`, and Brevo/Telnyx are read from
  api's path, so a rotation is one value. Proven from the `10dad1c` production image locally (uid
  1000, Node 22 `--env-file` reads the single-quoted values literally, state written). **Owner
  step:** create the token and the three parameters; then Claude checks a pass in CloudWatch and
  removes the Mac's launchd job. **#1728** the release train treats AWS as production once the hosts
  say AWS serves it (gate, rollback, summary), and deploy-verify skips Railway's path filter on an
  AWS host. Rehearsal 39884757442 reads "served by railway" on both hosts, so nothing changes before
  DNS moves. Also #1727: two permission-PDF tests read the UTC day and failed every PR's CI from
  19:00 Central. §5 Cutover gained the variable list, the Med-Stop allowlist and the lease hand-over.
- **2026-10-23** — #1726–#1730 merged. Found on the way: the staging disk was FULL (30 of 30 GB,
  17 images, 18.6 GB reclaimable) and #1726's merge failed to deploy (`no space left on device`).
  `deploy.sh` pruned only dangling images, and each commit brings ~4 GB (app + console), so staging
  fills in about six deploys, production's 40 GB in about eight releases. #1730: the SSM bootstrap removes every unused image
  BEFORE pulling (it runs from the CI checkout, so a full disk cannot block its own fix) and
  `deploy.sh` prunes with `-a`. Staging healed by #1730's own deploy (`03a9ec3` healthy, no worker
  container: 0 copies while `RUN_SCHEDULERS=false`). The images being ~2 GB each (dev dependencies
  installed, `--prod=false`) is its own question, not a blocker.
- **2026-10-23 (03:50–04:22Z)** — **AWS0 step 1 done for PRODUCTION: the Supabase secret key is
  rotated.** Found first that it had never been: production's only secret key (`default`,
  `sb_secret_AWD7C…`) dated 06/30 — the value Railway held during the breach, and the one copied into
  Parameter Store. Holders measured: Railway production api/web/console, Parameter Store
  `/silvicom/production/{api,web,console}`, the laptop's `apps/api/.env`; not GitHub, the McLeod
  connector or OTA. Owner created `silvicom360_aws1` (`sb_secret_rgSBn…`) and ran a one-time script
  that fetched it by id from the Supabase CLI and set every holder without printing it (Claude may
  not move a secret value itself). Railway redeployed (api `7b6833ea`, web `d923ef4e`, console
  `8496f090`), the AWS server was redeployed (run 39898115556) and its api read schema `0509` with
  the new key. Supabase edge logs from 04:05Z: only the new prefix, from Railway (152.55.177.181)
  and the AWS server (44.236.127.194); the old prefix made no calls. Owner deleted `default` ~04:08Z.
  **Mishap:** the delete also removed the `default` PUBLISHABLE key (`sb_publishable_1YAJv1…`),
  which the office SPA and api/web builds inline as `VITE_SUPABASE_ANON_KEY` — Supabase answered it
  401, so browsers could not reach Supabase from ~04:08Z until web `738137ea` went live with the new
  publishable `silvicom360_aws` (`sb_publishable_C4UdQ3…`) ~04:17Z (api `646b9b0a` 04:21Z;
  `PRODUCTION_VITE_SUPABASE_ANON_KEY` updated for the AWS images; console already had it). Login
  page checked in a browser: loads, no errors. Installed driver apps use the LEGACY anon key,
  untouched. **Still open:** staging's secret key; disabling the legacy `service_role` JWT once
  nothing uses it; `SECRETS_ENCRYPTION_KEY` (AWS0a) and the other providers in §5.
- **2026-10-23** — Two outside parties done. **Med-Stop** has `44.236.127.194` on its allowlist
  (owner). **Samsara webhook** `Fleetguardweb` repointed by the owner from
  `fleetguardweb-production.up.railway.app/api/webhooks/samsara` to
  `https://360.silvicominc.com/api/webhooks/samsara` (secret unchanged): Railway's HTTP log shows the
  last delivery on the old host at 13:38:38Z and every delivery from 13:40:51Z on the new host, all
  200 (signature verified). `360.silvicominc.com` follows DNS, so cutover needs no second Samsara
  change. Still to rotate later: `SAMSARA_WEBHOOK_SECRET` (regenerate in Samsara and update Railway +
  Parameter Store together).
- **2026-10-23** — Released `v2026.10.23` = `3f517ed` (Railway production + the AWS production
  server). Merged since and waiting for the next release: #1731 (AWS containers are recreated when
  their settings change — label `silvicom.settings` = hash of the settings files; without it a rotated
  secret never reached a running container) and #1732 (key watcher counts Railway's new egress IPs
  `50.18.48.204` + `52.9.85.82` as ours). The key watcher runs on the AWS production server (timer,
  every 5 min; token in `/silvicom/production/keywatch/SUPABASE_ACCESS_TOKEN`, from the owner's
  Supabase CLI login, so `supabase logout` on the Mac would revoke it). The Mac launchd job stays on
  until the next release shows clean `pass:` lines in CloudWatch `/silvicom/production`.
- **2026-10-23** — **Staging Supabase rotated**: new secret `silvicom_360_staging_1` and publishable
  `silvicom_360_staging` set on Railway `uat` (api/web/console), `/silvicom/staging/*` and
  `STAGING_VITE_SUPABASE_ANON_KEY`; AWS staging containers verified on the new settings. Owner still
  deletes staging's `default` secret and `default` publishable. AWS staging's office image predates
  the new publishable and is fixed by the next merge to main.
- **2026-10-23** — **WEX allowlisted `44.236.127.194`** (owner). Supabase Auth Site URL: no app code
  reads it; owner sets `https://360.silvicominc.com` + redirect `https://360.silvicominc.com/**` for
  dashboard-sent emails only.
- **2026-10-23** — ⚠ **EFS SOAP login change — open.** WEX issued a new web-service login (user ID
  in "email 1 of 2", password in "email 2 of 2"). Owner saved it in Settings → EFS Integration at
  16:54:12Z and again at 17:54:00Z; both times WEX answered `Invalid login [login]`. The old login
  (prefix `wsS`, saved 08/03) ingested 310 rows at 16:53Z; the new one (prefix `SUF`, 10 chars, no
  spaces) has never logged in. Endpoint (`ws.efsllc.com/axis2/services/CardManagementWS/`),
  environment (production) and account id (none) are identical across the saves, so the pair itself
  is refused. Saving clears the in-memory breaker and failure count (`invalidateOrgSoapCaches`), so
  a re-save is retried at once; three refusals reopen the 30-min pause (4th window opened 17:58Z).
  Fuel feeds and card control are DOWN until a working login is saved. Owner emailed WEX: is the
  `SUF…` ID enabled for the Card Management web service, and do NOT delete the old login yet.
  Re-saving the old login restores the feeds meanwhile. **Done =** both `*_last_success_at` after the
  save with errors empty; only then the stale `EFS_SOAP_PASSWORD` fallback on Railway + SSM is
  replaced (owner-run script) and WEX deletes the old login.
- **2026-10-23** — **Settings step, inventory** (18:10Z). `api.360` and `console.360` still have NO
  DNS record (owner: GoDaddy); `staging.360` / `staging-api.360` none either. `360.silvicominc.com`
  serves `3f517ed`. Still on Railway hosts: GitHub `API_URL`, `WEB_URL`, `CONSOLE_URL`,
  `PRODUCTION_VITE_API_URL`, `STAGING_*_URL`; Railway web `VITE_API_URL`; `ALLOWED_ORIGINS` (api,
  web, Railway + SSM) still lists the Railway web host beside `360` — drop it only after cutover.
  SSM `api`/`web` `WEB_APP_URL` = `360` ✓, `console/ALLOWED_ORIGINS` = `console.360` ✓. **Storage
  backup (#1704) needs nothing**: all four `STORAGE_BACKUP_*` names exist in
  `/silvicom/production/api` (bucket `silvicom360-storage-backup-891568748437`, `us-east-2`), same as
  Railway; `STORAGE_BACKUP_HOUR`/`_TZ` default. **#1740**: console's customer-app link defaults to
  `https://360.silvicominc.com` and the AWS console images get `WEB_URL` / `STAGING_WEB_URL` as
  `VITE_CUSTOMER_APP_URL`. `scripts/efs.mjs` default and every `API_URL`-type switch wait for `api.360`.
- **2026-10-23 18:31Z** — **EFS SOAP login working.** Owner saved a third user ID (prefix `ws1`,
  neither the refused `SUF…` nor the old `wsS…`) at 18:27:50Z; rejected feed succeeded 18:27:56Z,
  posted 18:30:58Z (305 rows), both errors empty. #1740 merged (`917d157`). Remaining: owner confirms
  `ws1…` is WEX's new login, then asks WEX to delete `wsS…`; the env fallback
  `EFS_SOAP_USERNAME`/`EFS_SOAP_PASSWORD` (Railway + SSM) still holds the old pair — remove it.
- **2026-10-23 18:45Z** — **EFS login change closed.** Owner: WEX done (old `wsS…` login removed).
  Feeds still green on `ws1…` (posted 18:43:57Z, rejected 18:42:56Z, no errors). Deleted the old
  fallback `/silvicom/production/api/EFS_SOAP_{USERNAME,PASSWORD}` from Parameter Store (nothing in
  `infra/` names them). Left on Railway `@fleetguard/api` on purpose: a Railway variable delete
  cannot skip the redeploy, the values are dead at WEX, and the service is retired at cutover.
  Staging's `/silvicom/staging/api/EFS_SOAP_*` untouched (staging login, not production's).
- **2026-10-23 evening — production cutover started (owner: "switch to AWS completely", an
  interruption accepted and backfilled).** `360.silvicominc.com` was switched at GoDaddy to an A
  record → `44.236.127.194`. ⚠ **Outage 1:** Caddy had backed off its certificate attempts while the
  names pointed at Railway, so 360 failed TLS on AWS until `docker restart silvicom-caddy-1`
  (~20:47Z) got the certificate. ⚠ **Outage 2 (dashboard down):** `/silvicom/production/web` lacked
  `VITE_API_URL`, which the web container reads for CSP `connect-src` (env.ts), so every browser call
  to the api host was blocked ("violates … connect-src"). Owner ran `fix-aws-web-csp.sh` (sets it to
  the Railway api host, recreates web); 21:2xZ connect-src includes it and a browser fetch from the
  360 origin reaches the api (401 signed-out, not blocked). **Lesson: the Railway→SSM copy missed a
  variable that only the web service had — diff every service's variable NAMES before cutover.**
  Set: `PRODUCTION_VITE_API_URL` and `WEB_URL` → new hosts. Hotfix #1743 (`RUN_SCHEDULERS=true`, off
  `v2026.10.23`) CI green, waits for `api.360` → AWS. When the hotfix's image (VITE_API_URL =
  api.360) ships, `/silvicom/production/web/VITE_API_URL` must become `https://api.360.silvicominc.com`
  in the same step, or the dashboard breaks again.
- **2026-10-24** — **Server and account hardening (#1745), the D-AWS14 gaps measured on the staging
  host (production was built the same way by hand): `dnf-automatic` not installed, `sshd` on 22,
  every container `ReadonlyRootfs=false` with the default capabilities and no `no-new-privileges`,
  Caddy root inside its container; account: no CloudTrail, no account-level S3 Block Public Access,
  EBS encryption-by-default off, no alarms, `AccountMFAEnabled=0`.** `compose.yml` gains an
  `x-hardened` anchor (read-only root, `cap_drop ALL`, `no-new-privileges`) on all five services,
  `/tmp` tmpfs for tsx's cache (the only runtime write, measured with `docker diff`: api/web 25 MB,
  console 3 MB), the OCR model cache moved to a host directory (`/var/lib/silvicom/ocr-models`,
  `DOC_OCR_CACHE_DIR`) so 139 MB of models are disk, not RAM; Caddy runs as uid 10001 with
  `NET_BIND_SERVICE` only — `cap_drop ALL` alone crash-looped on `exec /usr/bin/caddy: operation not
  permitted` because the image's binary carries that file capability. New `infra/server/host.sh`,
  run by every `deploy.sh`: dnf-automatic (security only, no auto-reboot, 06:00 UTC), sshd disabled,
  Caddy volumes chowned to 10001. Rehearsed three times on staging through SSM; the final run is the
  PR's exact file, all four containers healthy. Port 80 stays (redirect + HTTP-01; reasoning in
  host.sh). Production gets all of it with the next release's deploy — nothing was run there.
  Account side is `infra/aws-account-hardening.sh`, OWNER-RUN: one multi-region management trail to a
  new private 90-day bucket, account-level Block Public Access, EBS encryption by default, four
  status-check alarms (system → recover, instance → reboot) to an SNS email topic, root MFA reminder.
  Declined for cost: GuardDuty, VPC Flow Logs, Config, Security Hub, Inspector.
- 2026-10-26 · **D-AWS17 built** (branch `claude/aws-api-same-origin`): `Caddyfile` routes `{$WEB_HOST}/api/*` to the api replicas (a shared `api_replicas` snippet, also used by `{$API_HOST}`); `deploy.sh` writes `CADDYFILE_HASH` into `release.env` and `compose.yml` labels caddy with it. Checked with `caddy validate` on `caddy:2.10-alpine`, and with Caddy in front of three stub backends: `/`, `/loads/1` and `/apiary` reach web; `/api/version` and `/api/chat?kinds=` reach api; the console host reaches console. Owner sets `PRODUCTION_VITE_API_URL=https://360.silvicominc.com` before tonight's release builds its image.
- 2026-10-27 · **AWS11 — DNS done, schedulers move.** Owner (10/24): WEX, Med-Stop, PSP and Supabase allowlists/keys all finished. D-AWS17 (#1764) live since `v2026.10.26`: `360.silvicominc.com/api/*` reaches the AWS api replicas. GoDaddy published on 10/27 (SOA `2026102702`) plain A records, not the Route 53 delegation (the owner's 10/26 change; zone `Z09534791F8GPY9THH5J1` is unused and can be deleted): `api.360`/`console.360` → `44.236.127.194`, `staging-api.360`/`staging-console.360` → `44.239.69.109`. Owner restarted Caddy on both servers; all four names serve with certificates, and `api.360/api/version` answers `95b3501` from AWS (`deploymentId` null). **`staging.360` is still NXDOMAIN at GoDaddy** — one row still owed. A POST to `/api/tms/ingest` without a token answers 401 on both `api.360` and the Railway api host, so the McLeod VM can move by changing one line (AWS2b). The ingest token was never rotated (`fgtms_1wx7-M`, issued 08/28); it is rotated on the VM in the same visit. `production.env` gets `RUN_SCHEDULERS=true` in this PR (it replaces hotfix #1743, cut from `v2026.10.23`), so the next release starts AWS's worker, and its api ×2, as standbys. Railway api's `RUN_SCHEDULERS_IN_PROCESS=false` then hands the leases over. Still open: GitHub `API_URL`/`CONSOLE_URL`/`PRODUCTION_VITE_API_URL` → the new names (owner; refused to Claude as a production deploy); the driver's last OTA (AWS2a); staging cutover (AWS10); and the 14-day warm Railway, then AWS12.
- 2026-10-27 · **First AWS11 release rolled itself back.** Owner chose to release at once, not tonight. The owner set `PRODUCTION_VITE_API_URL=https://360.silvicominc.com`, `API_URL=https://api.360…` and `CONSOLE_URL=https://console.360…`. Hotfix `v2026.10.27` = `079c52a` (#1780) was dispatched; its plan read production as **served by aws**. On the server every container came up healthy, the new worker included, but `docker compose up --wait` exited 1 with `container silvicom-worker-1 has no healthcheck configured`. The worker's `healthcheck: disable: true` gives Docker a `NONE` check, and Compose 2.40 (the servers') refuses that under `--wait` instead of falling back to "running". It had never run: before cutover the worker had 0 copies. Reproduced with the Compose 2.40 binary (exit 1, same message); a `process.kill(1, 0)` check under the hardened settings passes. Auto-rollback put both platforms back on `95b3501` and verify-rollback passed. Fix: the worker gets that real healthcheck (this PR).
