# Devin — get the driver app onto phones (fix the failing Railway build, then ship an APK)

Repo: `~/Projects/FuelGuard`, branch `main`. Background: `docs/plans/ship-pipeline/SHIP-PIPELINE-PLAN.md`
and `SETUP.md`.

**Why this exists.** The driver app has no route from the repository to a phone. There is no CI build
and no install link, so every driver-app change since Phase 4 is sitting in a bundle no device has
ever loaded. The pipeline to fix that is written; the Railway service that serves the APK has been
failing to build.

**What was wrong with the build** — two stacked misconfigurations, both in the Railway service
settings, neither in the code:

1. **Config-as-code path was not set**, so Railway fell back to `railway.json` and ran the *web app's*
   build command (`pnpm --filter @fuelguard/web build`) with the *API's* start command, inside a
   folder containing two files.
2. **Root Directory was set to `apps/driver-dist`**, so nixpacks read that folder's `package.json`,
   found no `engines` field, and chose Node 18. Node 18's bundled corepack cannot verify npm's current
   registry signing keys, which is the crash you saw: `Error: Cannot find matching keyid`.

The code fix already in the tree replaces nixpacks with a Dockerfile for this service — pinned
`node:22-alpine`, two files copied, no package manager, no workspace install. The service has zero
dependencies by design, so there was never anything for a builder to resolve.

Work the steps in order.

---

## Step 1 — Land the code

There are uncommitted changes in the tree: the driver-dist Dockerfile and Railway config, plus the
platform-console audit docs. Review `git status` and include all of it.

```bash
cd ~/Projects/FuelGuard
git switch main && git pull --ff-only
rm -rf apps/driver/modules/capture-native/android/.gradle   # untracked build litter

pnpm install
pnpm --filter @fuelguard/shared build:rn                     # the driver bundle reads dist/, not src/

pnpm lint
pnpm lint:filesize && pnpm lint:funcsize && pnpm lint:migrations
pnpm lint:boundaries && pnpm lint:tokens-parity
pnpm typecheck
pnpm test                                                    # includes both RLS matrices

git add -A
git commit -m "Build driver-dist from a Dockerfile instead of nixpacks"
git push origin main
```

CI must be green before you touch Railway.

---

## Step 2 — Repair the Railway service settings

Whether you fix the existing service or delete and recreate it, these four things must be true. The
first two are what broke it.

| Setting | Value | Why |
| --- | --- | --- |
| **Root Directory** | **empty** | It prunes the build context. Set to `apps/driver-dist` it broke the build twice — once via nixpacks/Node 18, once via a Docker `COPY` that could no longer resolve. The Dockerfile now handles either setting, but empty is correct. |
| **Config-as-code path** | `railway.driver-dist.json` | Without it Railway uses `railway.json` and builds the API. |
| **Volume** | mounted at `/data` | APKs must survive a redeploy. Railway mounts volumes at runtime only, which is why CI uploads finished artifacts rather than building into it. |
| **Builder** | comes from the config file (`DOCKERFILE`, `apps/driver-dist/Dockerfile`) | Do not override it in the dashboard. |

Root Directory and the config path are service settings — set them in the Railway dashboard under
Settings → Source and Settings → Config-as-code. Variables, volumes and deploys can go through the
CLI; confirm flag names with `railway <command> --help` first, the syntax has changed between versions.

```bash
npm i -g @railway/cli
railway login
cd ~/Projects/FuelGuard && railway link              # select the FuelGuard project

railway volume add --mount-path /data --service driver-dist

railway variables --service driver-dist \
  --set "TESTER_PASSWORD=<pick a passphrase and give it to Miki>" \
  --set "UPLOAD_TOKEN=$(openssl rand -hex 32)"

railway up --service driver-dist --detach
railway logs --service driver-dist
```

Keep the `UPLOAD_TOKEN` value — Step 4 needs it as a GitHub secret.

**Verify:**

```bash
curl -s https://<dist-host>/healthz
# {"status":"ok","service":"FuelGuard driver-dist"}
```

`"status":"misconfigured"` means one of the two variables is missing; the service refuses every
request in that state rather than defaulting open. Any other response, or a build failure, → read the
troubleshooting table at the end of this document before retrying.

---

## Step 3 — Generate the Android signing key (once, ever)

```bash
bash scripts/gen-android-keystore.sh
```

It prints four values. **Back the keystore file up somewhere that is not GitHub and not this
repository** — a password manager attachment is fine. Android identifies an app by its signing key: if
this one is lost, no installed copy can ever be upgraded again and every device must uninstall first,
discarding its encrypted offline outbox.

---

## Step 4 — GitHub configuration

Repository **secrets** (Settings → Secrets and variables → Actions):

| Name | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | from Step 3 |
| `DRIVER_DIST_URL` | `https://<dist-host>` |
| `DRIVER_DIST_UPLOAD_TOKEN` | the `UPLOAD_TOKEN` from Step 2 |
| `EXPO_PUBLIC_API_URL` | the Railway API origin |
| `EXPO_PUBLIC_SUPABASE_URL` | the Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | the publishable key — it ships in the bundle by design |
| `EXPO_PUBLIC_MAP_STYLE_URL`, `EXPO_PUBLIC_MAP_STYLE_URL_DARK`, `EXPO_PUBLIC_SENTRY_DSN` | optional |

Repository **variable** (not a secret — it is a public URL):

| Name | Value |
| --- | --- |
| `API_URL` | the Railway API origin, used by the *Verify deployment* workflow |

The workflow asserts every required secret up front and fails with the missing names rather than
producing a half-working build.

---

## Step 5 — First build and install

Actions → **Driver app — Android build** → Run workflow. Roughly 15 minutes cold.

The job deliberately fails if the finished APK turns out to be signed with Android's debug key. A
debug-signed APK installs perfectly well, which is exactly what makes it dangerous: the fleet would be
running builds signed with a publicly known key, and the first correctly signed release would then
refuse to install over them.

When it finishes:

1. Open `https://<dist-host>` on an Android phone and sign in with `TESTER_PASSWORD` (any username).
2. Install. Android will ask permission to install apps from your browser — a one-time setting per
   device. A Play Protect notice may appear for any app not from the Play Store; choose Install anyway.
3. Sign in with a driver login and check **Settings → About this build**. It should show the app
   version, which JavaScript bundle is running, the server's commit, and the database version.

Screenshot that card — it is what we ask for whenever a driver says something looks wrong.

---

## Step 6 — Over-the-air updates (only after Step 5 works)

This is what makes JavaScript-only changes reach installed phones without a rebuild. Full detail in
`docs/plans/ship-pipeline/SETUP.md` §8. In short:

1. Deploy the **xprem** Railway template into the same project (provisions the service, Postgres and a
   bucket, and generates its own secrets). Health check `/hc`.
2. **Back up `DB_KEYS_MASTER_KEY_B64` outside Railway.** It seals the app's update-signing key; losing
   it permanently destroys the app's ability to sign updates.
3. In `https://<xprem-host>/dashboard`: create an app, note its **UUID**, create an **API token**
   (`EOO_TOKEN`, shown once), download the certificate and commit it as
   `apps/driver/certs/certificate.pem`.
4. Add secrets `UPDATES_URL`, `UPDATES_APP_ID`, `EOO_TOKEN`.
5. **Run the Android build again.** A build made before step 4 has no update URL compiled into it and
   never will — the URL, app id and certificate are baked into the native binary.
6. Push a JavaScript-only change and watch **Driver app — publish JS update**. It compares its native
   fingerprint against the one recorded for that APK: matching means it publishes and testers get it on
   next launch; differing means the change is native, so it publishes nothing and dispatches an APK
   build instead.

Do not edit `apps/driver/runtime-version.json`. It is bumped only when native code changes, and CI
tells you when that is.

---

## Troubleshooting — read the build log's first 20 lines

The Nixpacks/Docker banner at the top of a Railway build tells you which misconfiguration you have
before you read anything else:

| What the log shows | What it means | Fix |
| --- | --- | --- |
| `build │ ... pnpm --filter @fuelguard/web build` | The service is using `railway.json` | Set Config-as-code path to `railway.driver-dist.json` |
| `setup │ nodejs_18, npm-9_x` | Root Directory is pointed at a folder whose `package.json` has no `engines` | Clear Root Directory |
| `Error: Cannot find matching keyid` from corepack | Node 18's corepack cannot verify npm's signing keys | Symptom of the above two — fix those, not this |
| `Saved output to: snapshot-target-unpack/apps/driver-dist` | Root Directory is set | Clear it |
| `failed to calculate checksum ... "/apps/driver-dist/server.mjs": not found` | Root Directory is set, so the Docker build context is that folder and the repo-relative `COPY` paths do not resolve | Clear Root Directory. The current Dockerfile locates its sources either way, so seeing this means the service is on an older image build |
| `ERROR: driver-dist sources are not in this build context` + a directory listing | Neither expected layout matched — the context is something else entirely | Read the listing; it is printed for exactly this reason |
| Nixpacks running at all for this service | The config file is not being read | Both settings above |
| `SecretsUsedInArgOrEnv` warnings for `TESTER_PASSWORD` / `UPLOAD_TOKEN` | Railway injects service variables as build args | Harmless — ignore |

If the **API** service ever shows the same corepack error, set `NIXPACKS_NODE_VERSION=22` on it. The
root `package.json` already declares `engines.node >= 22`, so it should pick Node 22 on its own.

---

## Report back

1. The `/healthz` response from the driver-dist service.
2. The install page URL and the tester passphrase (to Miki, over a secure channel — not in a ticket).
3. A screenshot of **Settings → About this build** from a real Android phone.
4. `pnpm verify:live` output.
5. Anything that failed, with the failing step's log — not a blind retry.

Do not commit the keystore, `UPLOAD_TOKEN`, `EOO_TOKEN` or `DB_KEYS_MASTER_KEY_B64` to the repository.
The only credential that belongs in git is `apps/driver/certs/certificate.pem`, which is public by
design — the app verifies every update against it.
