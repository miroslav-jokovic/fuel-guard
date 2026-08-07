# Devin — ship the FuelGuard delivery pipeline

Repo: `~/Projects/FuelGuard` (pnpm monorepo, branch `main`). Full context is in
`docs/plans/ship-pipeline/SHIP-PIPELINE-PLAN.md` and `SETUP.md`. Read `SETUP.md` before starting;
this is the short version.

Goal: the driver app currently has no way to reach a phone, and nothing in the system reports which
commit or migration is live. Phases D0–D2 are written and typechecked but not committed. Land them,
then stand up the Railway services and GitHub secrets so builds and updates ship automatically.

## 1. Land the code

There is uncommitted work in the tree from two efforts — the ship pipeline (new workflows,
`apps/driver-dist`, `apps/api/src/routes/version.ts`, migration `0140`) and some earlier dashboard
work (`BaseSwitch.vue`, `AppSelect.vue`, `DriverAppSettingsPage.vue`, `featureCatalog.ts`). Review
`git status` and include both; nothing there should be discarded.

```bash
cd ~/Projects/FuelGuard && git switch main && git pull --ff-only
rm -rf apps/driver/modules/capture-native/android/.gradle   # build litter, untracked

pnpm install
pnpm --filter @fuelguard/shared build:rn

pnpm lint && pnpm lint:filesize && pnpm lint:funcsize && pnpm lint:migrations
pnpm lint:boundaries && pnpm lint:tokens-parity && pnpm typecheck
pnpm test        # includes both RLS matrices

git add -A
git commit -m "Add deploy version truth, Android build pipeline, and self-hosted OTA updates"
git push origin main
```

The push runs CI, **Apply Supabase migrations** (0140 is new) and **Verify deployment**. All three
must be green. If *Verify deployment* fails, the repository variable `API_URL` is missing — set it
(step 3) and re-run it.

Then confirm what is actually live:

```bash
pnpm verify:live     # local commit + migration vs the deployed /api/version
```

Report the output. Migration `0139` (the module backfill for our org) applying is the thing to
confirm here — that is what makes the hazmat, messages and notification blocks appear in the app.

## 2. Android signing key (once, ever)

```bash
bash scripts/gen-android-keystore.sh
```

Add the four values it prints as GitHub Actions secrets. **Back the keystore file up outside GitHub
and outside the repo** — if it is lost, no installed copy of the app can ever be upgraded again.

## 3. Railway + GitHub setup

Use the Railway CLI or the dashboard, whichever is faster. Confirm CLI flag names with
`railway <command> --help` — the variables syntax differs between versions.

**a. `driver-dist`** — the internal install page. New service in the existing FuelGuard project, from
this repo, config file `railway.driver-dist.json`, with a **volume mounted at `/data`**. Variables:
`TESTER_PASSWORD` (a passphrase we hand testers) and `UPLOAD_TOKEN` (`openssl rand -hex 32`).
Verify `https://<dist-host>/healthz` reports `"status":"ok"` — it says `misconfigured` until both are
set, and refuses every request in that state.

**b. `xprem`** — the self-hosted update server. Deploy its Railway template into the same project
(provisions the service, Postgres and a bucket, and generates its own secrets). Health check `/hc`.
**Back up `DB_KEYS_MASTER_KEY_B64`** — losing it permanently destroys the app's ability to sign
updates. Then in `https://<xprem-host>/dashboard`: create an app, note its **UUID**, create an **API
token** (`EOO_TOKEN`, shown once), and download its certificate. Commit the certificate:

```bash
mkdir -p apps/driver/certs
mv ~/Downloads/app-<app-id>-certificate.txt apps/driver/certs/certificate.pem
git add apps/driver/certs/certificate.pem && git commit -m "Add update signing certificate" && git push
```

**c. GitHub** — repository **secrets**: `DRIVER_DIST_URL`, `DRIVER_DIST_UPLOAD_TOKEN`, `UPDATES_URL`
(the xprem origin), `UPDATES_APP_ID` (the UUID), `EOO_TOKEN`, `EXPO_PUBLIC_API_URL`,
`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and optionally
`EXPO_PUBLIC_MAP_STYLE_URL`, `EXPO_PUBLIC_MAP_STYLE_URL_DARK`, `EXPO_PUBLIC_SENTRY_DSN`.
Repository **variable**: `API_URL` (the API origin). Also confirm `SUPABASE_ACCESS_TOKEN`,
`SUPABASE_PROJECT_REF` and `SUPABASE_DB_PASSWORD` already exist — the migrate workflow now fails
explicitly without them instead of quietly applying nothing.

## 4. First build and first update

1. Actions → **Driver app — Android build** → Run workflow. ~15 minutes cold. It fails on purpose if
   the APK comes out debug-signed.
2. Open `https://<dist-host>`, sign in with `TESTER_PASSWORD`, install on a real Android phone.
3. In the app: Settings → **About this build**. Confirm it shows the app version, the server commit
   and the database version. Send a screenshot.
4. Push a JavaScript-only change and confirm **Driver app — publish JS update** publishes rather than
   dispatching a rebuild, and that the phone offers "An update is ready — Restart" on next launch.

## 5. Report back

The `pnpm verify:live` output, the install-page URL, the About-this-build screenshot, and anything
that failed. If a workflow fails, paste the failing step rather than retrying it blind.

Do not change `apps/driver/runtime-version.json` — that value is bumped only when native code
changes, and CI will tell you when that is.
