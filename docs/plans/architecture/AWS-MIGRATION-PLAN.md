# AWS migration — the app tier leaves Railway (2026-10-21)

Opened 2026-10-21 at the owner's request, after Railway published that an attacker had obtained
users' environment variables: *"we have some variables there that are connected to finance and I
can't risk this … tell me what we have to do to migrate app and web to AWS."*

This is a decision log. Decisions are `D-AWS*`, questions for the owner `Q-AWS*`, work items `AWS*`.
The progress log is at the END (append there, never into the tables).

It continues `PLATFORM-RELIABILITY-PLAN.md`: D-RLY9 already chose the target (ECS Fargate in
us-west-2, one NAT gateway, keep Supabase); D-RLY13 deferred it "until a move is decided". This plan
is that move, and it **re-opens D-RLY13** pending the owner's answer to Q-AWS1. Nothing here is built
yet; no code, no infrastructure, no variable has changed.

**Two separate jobs, and the first does not wait for the second.** Moving hosts does not un-leak a
key: a value copied off Railway works from anywhere until the vendor revokes it. So rotation (§4
AWS0) starts now, on Railway, and the migration (AWS1 onward) follows on its own schedule. Railway's
announcement was not verified by us; Q-AWS2 asks Railway whether our project was in scope, but
rotation does not wait for the answer.

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
| **D-AWS1** | **Rotation first, on Railway, independent of the move (AWS0).** Every secret in §1 is reissued at its vendor and the old one revoked, in the §5 order. New values go into AWS Secrets Manager (AWS1 builds it first, an hour's work) and are copied onto Railway only for as long as Railway still runs the app. | A leaked key stays valid on every host until revoked; the move protects only values created after it. Keeping the master copy off Railway means a second Railway incident leaks only what is still running there. |
| **D-AWS2** | **App tier only; Supabase stays.** Database, Auth, Storage and PostgREST do not move. The OTA server's Postgres moves (Q-AWS5). | All three Supabase projects are already in AWS us-west-2, so the app tier lands next to its database. Moving off Supabase is 29 `supabase.auth` sites, 35 `storage.from` sites, RLS keyed on Supabase JWTs and the Management API in two workflows — weeks of work that answers a different question (hosting-cost estimate 2026-10-20). |
| **D-AWS3** | **us-west-2, ECS Fargate on ARM, behind one ALB per environment, with ACM certificates.** Single-EC2 and App Runner rejected. | Same region as Supabase (our slowness is serial round trips, PLATFORM-RELIABILITY §1). Fargate keeps "no servers to patch", which is what Railway gave us; App Runner has no fixed outbound IP without the same NAT anyway. Estimate from D-RLY9 / 2026-10-21: ~$170–250/mo total with Supabase, vs ~$105 today. |
| **D-AWS4** | **Outbound through one NAT gateway with one Elastic IP per environment; WEX allowlists the production IP beside the Railway ones before cutover.** | WEX IP-gates card management (D-RLY2). Adding beside, not replacing, lets both hosts work during cutover and keeps rollback possible. This is the slowest external step, so it is asked the day Q-AWS1 is answered. |
| **D-AWS5** | **Our own domain names for every client-facing host, attached to Railway FIRST (AWS2), before anything moves.** Proposed: `360.silvicominc.com` (web, already ours), `api.360…`, `ota.360…`, `drivers.360…`, `console.360…`, and `staging-*` twins (Q-AWS4). Every client in the §1 host table is repointed to these while Railway still serves them. | Then the cutover is a DNS change, rollback is a DNS change, and the two steps we cannot control — a native driver build on every phone, Alex's VM — happen on their own timeline with nothing broken in between. A provider hostname in a client is how we got locked in; never again. |
| **D-AWS6** | **One container image for api, web and the worker**, built by a `Dockerfile` that reproduces `railway.json`'s build and start commands exactly (`node --import tsx apps/api/src/index.ts`, Node 22). Role comes from environment variables, as today. The console gets its own image. | Same artefact in staging and production, by digest. Node 22, not 24.10: the 24.10 worker drops the tsx loader (known production-only failure). |
| **D-AWS7** | **Each ECS service gets only the secrets it reads**, through its own task role. The list per service is derived from what the code under that role reads, not copied from Railway (Q-AWS8 decides how it is derived). | Today web holds the EFS Graph secret, the service role and the sealing key though it runs no schedulers — every copy is one more place to leak. |
| **D-AWS8** | **Topology carries D-RLY2/D-RLY8 unchanged**: api ×2 (lane `egress`, behind the NAT IP), worker ×1 (lane `general`), web ×1. If RLY6/RLY7 are not yet done on Railway, they are done on AWS directly instead. | The lease already enforces "one scheduler per lane per database", so two hosts running at once during cutover cannot double-poll WEX or double-send. |
| **D-AWS9** | **Health and draining carry over**: the ALB checks `/healthz` (must stay 200, DEPLOYMENT.md); the external monitor (Q-RLY1) watches `/api/version/ready`; ECS `stopTimeout` matches today's Railway draining seconds. | These are load-bearing on Railway; a new host must not quietly drop them. |
| **D-AWS10** | **Deploys from GitHub through OIDC — no long-lived AWS keys in GitHub.** Merge to `main` → build image → deploy to staging. `release.yml` keeps its order (migrations, then code) but its "code" step becomes "deploy the image built from the approved commit to production" instead of fast-forwarding `production` for Railway. `RELEASE_TRAIN`, `require-ci-green`, `ci/tested-tree` and the path filter that replaces `watchPatterns` keep their meaning. | The release train is the contract the owner approves against; only its last hop changes. |
| **D-AWS11** | **Logs to CloudWatch, 30-day retention**; the `[metrics]` line and `railway logs` recipes in DEPLOYMENT.md are rewritten as CloudWatch Logs Insights queries. | Our only request telemetry is that log line (memory: api has no request logging). |
| **D-AWS12** | **driver-dist becomes static files on S3 behind CloudFront**, with uploads by the CI role instead of `UPLOAD_TOKEN`. | It is a file shelf; a volume-backed container is the wrong shape for it. Removes one secret. |
| **D-AWS13** | **Cutover per environment, staging first, in the release window; Railway kept warm for 14 days with schedulers off** (`RUN_SCHEDULERS_IN_PROCESS=false`, lanes empty), then deleted (AWS12). | Rollback is DNS back to a host that still has the code. 14 days covers a full release cycle plus slow phones. |

## 3. Target topology

| Piece | Production | Staging |
|---|---|---|
| Network | VPC, 2 AZs, public subnets (ALB, NAT) + private subnets (tasks); 1 NAT gateway + 1 Elastic IP | Same, its own NAT IP (staging never reaches WEX, but uses the same shape) |
| `api` | ECS service, 2 tasks, lane `egress`, `api.360…` | 1 task |
| `worker` | ECS service, 1 task, lane `general`, no public route | 1 task |
| `web` | ECS service, 1 task, `360.silvicominc.com` | 1 task |
| `console` | ECS service, 1 task, `console.360…`, restricted (Q-AWS9) | 1 task |
| `ota` | ECS service, 1 task + its database (Q-AWS5), `ota.360…` | 1 task |
| Driver install page | S3 + CloudFront, `drivers.360…` | Same |
| Secrets | Secrets Manager, one secret per service, task-role scoped | Separate secrets |
| Images | ECR, tagged by commit, deployed by digest | Same repo |
| Database | Supabase (unchanged) | Supabase staging (unchanged) |

## 4. Work queue

| Item | What | Waits on | Who |
|---|---|---|---|
| **AWS0** | Rotate every secret in §1, in the §5 order; check each vendor for use we did not make | Nothing — **now** | Owner in vendor consoles; Claude for Railway/GitHub/Supabase and the reseal script |
| AWS0a | `SECRETS_ENCRYPTION_KEY` rotation needs code first: secretBox holds ONE key, and `efsCardRef.ts` derives card lookup handles from it, so a new key changes every handle. Build an old+new key read path, reseal every sealed row, recompute every card ref, then drop the old key | Q-AWS3 | Claude (PR + migration if refs are stored) |
| **AWS1** | AWS account(s), root MFA, Identity Center logins, budget alarms, Secrets Manager | Q-AWS1, Q-AWS6 | Owner creates the account; Claude the rest |
| **AWS2** | Custom domains on Railway (D-AWS5); repoint web SPA, console, CI, Supabase Auth, Samsara webhook | Q-AWS4 (names, DNS access) | Claude + owner (DNS) |
| AWS2a | Driver OTA with `EXPO_PUBLIC_API_URL` = `api.360…`; then a native build with `UPDATES_URL` = `ota.360…` through the normal release lanes | AWS2 | Claude; owner approves lanes |
| AWS2b | Alex changes `FUELGUARD_INGEST_URL` on the VM to `api.360…` | AWS2 | Owner asks Alex |
| **AWS3** | Ask WEX to allowlist the production Elastic IP beside the Railway IPs | AWS4 (the IP exists), Q-AWS1 | Owner |
| AWS4 | Network: VPC, subnets, NAT + Elastic IP, ALB, ACM certificates, security groups — as infrastructure-as-code (Q-AWS7) | AWS1 | Claude |
| AWS5 | `Dockerfile` + ECR + GitHub OIDC role; image builds in CI next to `typecheck-build` | AWS1 | Claude |
| AWS6 | ECS services for staging (api, worker, web, console, ota) with per-service secrets (D-AWS7) | AWS4, AWS5 | Claude |
| AWS7 | Workflows: staging deploy on merge; `release.yml` code step; `deploy-verify.yml`, `smoke.yml`, `STAGING_*`/production URL variables, `pnpm verify:live` | AWS6 | Claude |
| AWS8 | OTA server + its database to AWS; move the signing keys | Q-AWS5, AWS6 | Claude |
| AWS9 | driver-dist to S3 + CloudFront | AWS4 | Claude |
| **AWS10** | Staging cutover: DNS `staging-*` → AWS; browser pass with the three fixtures; scheduler lanes `held` by AWS tasks | AWS6–AWS9 | Claude |
| **AWS11** | Production cutover in the release window: DNS → AWS; confirm EFS card management works from the new IP; lanes held; Railway schedulers off | AWS3 confirmed, AWS10 green for 1 week, AWS2a/2b adopted (Q-AWS10) | Claude runs; owner approves the night |
| AWS12 | After 14 days: delete Railway variables and services, remove its GitHub app, cancel; ask WEX to drop the Railway IPs; rewrite `docs/DEPLOYMENT.md`, `docs/WORKER-DEPLOYMENT.md`, root `CLAUDE.md` | AWS11 + 14 days | Claude; owner cancels billing |

Rough calendar if nothing waits on a third party: AWS0 1–2 days (AWS0a ~2 days of it), AWS1–AWS10
about one week, AWS11 the week after. WEX (AWS3), Alex (AWS2b) and driver phones taking the native
build (AWS2a) are what the calendar actually depends on.

## 5. Runbooks (outline — expanded as each item is built)

### Rotation order (AWS0)

Each line: reissue at the vendor → put the new value in Secrets Manager → set it on every Railway
service and environment that holds it → redeploy → confirm the feature works → revoke the old value.
Check the vendor's own log for use since 2026-10-01 before revoking, so evidence is not lost.

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

Lower DNS TTLs to 60 s a day ahead → AWS tasks running and `/api/version/ready` 200 → set Railway
`RUN_SCHEDULERS_IN_PROCESS=false` and redeploy → AWS tasks take the lanes (`/api/version`
`schedulers` all `held`) → switch DNS → watch `[metrics]` in CloudWatch, the EFS feed age, the
McLeod ingest, Samsara webhook arrivals, a driver check-in → raise TTLs after 24 h.

### Rollback

DNS back to Railway's custom-domain targets; set `RUN_SCHEDULERS_IN_PROCESS=true` on Railway api;
scale AWS services to 0 so the lease moves back. Valid until AWS12.

## 6. Open questions

- **Q-AWS1 — is the move decided?** D-RLY13 (2026-10-21, morning) said stay on Railway and do not ask
  WEX. The breach report the same day is the owner's reason to reconsider. Recommendation: **yes,
  decide now**, because AWS2 (own domains) and AWS3 (WEX) are slow and harmless to start, and AWS0
  happens either way. Answering yes supersedes D-RLY13.
- **Q-AWS2 — was our project in Railway's incident?** Ask Railway support for the scope (which
  projects, which time window, whether variable reads are in their audit log). Recommendation: ask,
  but treat every variable as leaked until they answer in writing.
- **Q-AWS3 — rotation that signs people out or breaks lookups.** (a) If Supabase still uses the legacy
  JWT secret, rotating it signs out every office user and driver; the new API keys rotate without
  that. (b) A new `SECRETS_ENCRYPTION_KEY` changes every EFS card ref (AWS0a). Recommendation: do
  (a) at night with a notice to offices; do (b) through the two-key reseal, never a straight swap.
- **Q-AWS4 — domain names and DNS.** Who controls DNS for `silvicominc.com`, and are the D-AWS5 names
  right? Recommendation: the names as proposed; Route 53 only if the current DNS host cannot do
  60 s TTLs.
- **Q-AWS5 — where the OTA server's database goes.** (a) A small RDS Postgres (~$15/mo); (b) a schema
  in Supabase; (c) replace the self-hosted server with EAS Update. Recommendation: **(a)** — it keeps
  the signing keys out of the product database and changes nothing in the driver app's update code.
- **Q-AWS6 — AWS account shape and owner.** One account for both environments, or separate production
  and staging accounts under one organization; whose card pays. Recommendation: two accounts, so a
  staging credential can never touch production.
- **Q-AWS7 — infrastructure as code.** Terraform, AWS CDK (TypeScript, matches the repo), or console by
  hand. Recommendation: **CDK in `infra/`**, so the setup is reviewed in PRs like everything else.
- **Q-AWS8 — how the per-service secret list is derived (D-AWS7).** Candidates: from `env.ts` schema
  groups tagged by role, or from the Railway lists minus what each role never reads. Recommendation:
  tag `env.ts` groups by role and generate the list — a hand list beside the schema is a copy.
- **Q-AWS9 — who can reach the console.** Today it is a public Railway host. Recommendation: put it
  behind the ALB with an IP allowlist (office + owner) on top of its login.
- **Q-AWS10 — how many drivers must be on the new native build before production cutover?**
  Installed builds still check the old OTA host for updates. Recommendation: keep Railway's OTA
  service alive past AWS12 until the build-card telemetry shows ≥95% of active drivers on the new
  build; everything else can cut over before that.
- **Q-AWS11 — production size.** Multi-AZ NAT and two api tasks (~$300/mo) or one NAT (~$220–250).
  Recommendation: one NAT now (D-AWS4); a NAT outage stops only EFS card management and outbound
  calls, not the app.

## 7. Progress log

- **2026-10-21** — Plan opened from the owner's request after Railway's breach report. Inventory in §1
  measured from `railway service list` and `railway variables` (names only, no values read) and the
  hosts in code on `main`. Nothing built. AWS0 is the first item regardless of Q-AWS1.
