# Ship pipeline — setup and runbook

Everything in phases D0 and D1 of `SHIP-PIPELINE-PLAN.md` is written and typechecked. What follows
is the exact sequence to make it live. Steps marked **owner** need credentials or a Railway/GitHub
console; the rest is `pnpm`.

## 1. Land the code (Devon)

```bash
cd ~/Projects/FuelGuard
git switch main && git pull --ff-only

pnpm install
pnpm --filter @fuelguard/shared build:rn      # the driver bundle reads dist/, not src/

pnpm lint
pnpm lint:migrations
pnpm lint:boundaries
pnpm typecheck
pnpm test                                      # includes both RLS matrices

git add -A
git commit -m "Add deploy version truth and the Android build pipeline"
git push origin main
```

The push triggers three workflows: **CI**, **Apply Supabase migrations** (because `0140` is new), and
**Verify deployment**. The last one now fails loudly if Railway or Supabase does not catch up — that
is the entire point of it.

Note: the tests cannot run inside the Cowork Linux VM against this checkout, because `node_modules`
was installed for macOS and the native binaries (rolldown/vitest) do not load there. Run them on the
Mac or read the CI result; typecheck is platform-independent and already passes.

## 2. Confirm what is live

```bash
pnpm verify:live
```

Prints local vs deployed commit, branch, and migration version, and exits non-zero on drift. This is
the answer to "why don't I see my changes?" — five seconds instead of an hour.

You can also open `https://<api-host>/api/version` in a browser; it is public by design.

Expected first run after the push: schema `0140`, commit matching `HEAD`. If schema comes back
`behind`, the migrate workflow did not run or failed — check its run for this commit.

## 3. Android signing key (owner, once ever)

```bash
bash scripts/gen-android-keystore.sh
```

It prints the four values to add under **Settings → Secrets and variables → Actions**:
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

Back the keystore file up outside GitHub and outside this repository. If it is lost, no installed
copy of the app can ever be upgraded again — every device must uninstall first, discarding its
encrypted offline outbox.

## 4. The install-page service on Railway (owner)

1. New service in the same Railway project, from this repository.
2. **Root Directory: leave EMPTY.** Not `apps/driver-dist`. The build context has to be the repository
   root, because `railway.driver-dist.json` lives there and the Dockerfile's paths are repo-relative.
   Pointing the root directory at the service folder is what broke the first attempt: Railway then
   read `apps/driver-dist/package.json`, found no `engines`, chose Node 18, and Node 18's bundled
   corepack could not verify npm's current signing keys — `Cannot find matching keyid`. It also fell
   back to the default `railway.json`, so it was running the *web app's* build command.
3. **Config-as-code path: `railway.driver-dist.json`.** Without this the service silently uses
   `railway.json` and builds the API instead.
4. Attach a **volume** mounted at `/data`. Artifacts must survive a redeploy.
5. Set variables:
   - `TESTER_PASSWORD` — the passphrase you hand testers with the link
   - `UPLOAD_TOKEN` — generate with `openssl rand -hex 32`; CI holds this, nobody else
6. Deploy, then confirm `https://<dist-host>/healthz` reports `"status":"ok"`. It reports
   `misconfigured` until both variables are set, and refuses every request in that state.

The service builds from `apps/driver-dist/Dockerfile` — a pinned `node:22-alpine` that copies two
files. No package manager, no workspace install, seconds per build. It has zero dependencies, so
there is nothing for a builder to resolve, and nothing in the rest of the repository can affect it.

If the *API* service ever hits the same corepack error, set `NIXPACKS_NODE_VERSION=22` on it — the
root `package.json` already declares `engines.node >= 22`, so it should pick Node 22 on its own.

## 5. Remaining GitHub configuration (owner)

Repository **secrets**:

| Name | Value |
| --- | --- |
| `DRIVER_DIST_URL` | `https://<dist-host>` |
| `DRIVER_DIST_UPLOAD_TOKEN` | the `UPLOAD_TOKEN` from step 4 |
| `EXPO_PUBLIC_API_URL` | the Railway API origin |
| `EXPO_PUBLIC_SUPABASE_URL` | the Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | the publishable key (ships in the bundle by design) |
| `EXPO_PUBLIC_MAP_STYLE_URL`, `EXPO_PUBLIC_MAP_STYLE_URL_DARK`, `EXPO_PUBLIC_SENTRY_DSN` | optional |

Repository **variable** (not a secret — it is a public URL):

| Name | Value |
| --- | --- |
| `API_URL` | the Railway API origin, used by *Verify deployment* |

Also confirm the three migration secrets already exist: `SUPABASE_ACCESS_TOKEN`,
`SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`. The workflow now fails explicitly if any is missing,
rather than passing while applying nothing.

## 6. First build

Actions → **Driver app — Android build** → *Run workflow*. About 15 minutes for a cold run. When it
finishes, open the install page, hand a tester the URL and the passphrase, and they install by
tapping one button.

The build fails on purpose if the APK turns out to be signed with Android's debug key — a
debug-signed APK installs perfectly well, which is exactly what makes it dangerous.

## 7. What testers see

The install page tells them to allow installs from their browser (a one-time Android setting) and to
tap through the Play Protect notice that appears for any app not from the Play Store. Inside the app,
**Settings → About this build** shows the app version, which JavaScript bundle is running, the
server's commit, and the database version. That card is the screenshot to ask for when something
looks wrong.

## 8. Over-the-air updates (owner + Devin)

This is what turns "push to main" into "the app on every test phone changes", without a rebuild, for
any change that is JavaScript-only.

The server is **xprem** (the project previously published as `expo-open-ota`; v3 renamed it). Its
Railway template provisions the service, a Postgres control plane and an S3-compatible bucket, and
generates `JWT_SECRET` and `DB_KEYS_MASTER_KEY_B64` for you.

1. Deploy the template into the same Railway project. The only inputs it asks for are `ADMIN_EMAIL`
   and `ADMIN_PASSWORD`. Health check is `GET /hc`.
2. **Back up `DB_KEYS_MASTER_KEY_B64` outside Railway.** It seals the app's update-signing key; if it
   is lost, the app can never sign an update again and every installed copy must be replaced.
3. Open `https://<xprem-host>/dashboard`, create an app, and note its **UUID**.
4. On the app page, create an **API token** — this is `EOO_TOKEN`, shown once.
5. Download the app's certificate from the same page and commit it:

   ```bash
   mkdir -p apps/driver/certs
   mv ~/Downloads/app-<app-id>-certificate.txt apps/driver/certs/certificate.pem
   git add apps/driver/certs/certificate.pem
   ```

   The certificate is public and belongs in the repository; the private key stays on the server.
6. Add the GitHub secrets: `UPDATES_URL` (`https://<xprem-host>`), `UPDATES_APP_ID` (the UUID) and
   `EOO_TOKEN`. Optionally set the repository variable `XPREM_VERSION` to the deployed server version
   so the CLI stays pinned to it.
7. Run **Driver app — Android build** once more. That APK is the first one that knows where to look
   for updates — a build made before step 6 has no update URL compiled into it and never will.
8. Push a JavaScript-only change and watch **Driver app — publish JS update**. It compares its native
   fingerprint against the one recorded for that APK; matching means it publishes, and testers get it
   on next launch. Differing means the change is native, so it publishes nothing and dispatches an
   APK build instead.

**Bumping the runtime version.** When you change anything native — the capture module, a native
dependency, a config plugin, a permission — bump `apps/driver/runtime-version.json` and build a new
APK. Forgetting is not silent: the update workflow refuses to publish and tells you why.

### Railway CLI (optional, instead of the dashboard)

Confirm flag names once with `railway <command> --help`; the CLI's variable syntax has changed
between versions and it is not worth guessing.

```bash
npm i -g @railway/cli
railway login
cd ~/Projects/FuelGuard && railway link          # select the FuelGuard project

# driver-dist (section 4)
railway add --repo <org>/FuelGuard --service driver-dist
railway volume add --mount-path /data --service driver-dist
railway variables --service driver-dist \
  --set "TESTER_PASSWORD=<passphrase>" \
  --set "UPLOAD_TOKEN=$(openssl rand -hex 32)"
railway up --service driver-dist --detach
railway logs --service driver-dist

# read back what a service is configured with
railway variables --service driver-dist
```

Set the driver-dist service's config file to `railway.driver-dist.json` in its settings — that is
what points Railway at `apps/driver-dist/server.mjs` and the `/healthz` check.

## 9. Still to come

- **D3** — iOS via EAS Build and TestFlight, so you can test on an iPhone. Blocked on an Apple
  Developer Program membership ($99/yr). Android remains the fleet platform and the self-hosted path.
- Decide the open questions in the plan's section 8: per-tester install links versus one shared
  passphrase, and whether a separate staging API and Supabase project is worth standing up before the
  second customer.
