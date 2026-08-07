# FuelGuard — Ship Pipeline Plan (driver app delivery + deployment truth)

Created 2026-08-07. Owner: platform. Status: D0, D1 and D2 built (awaiting owner infrastructure); D3 blocked on the Apple Developer Program.

## 0. Why this document exists

On 2026-08-07 the report was "I don't see any changes after last updates." The investigation found:

| Layer | State | Evidence |
| --- | --- | --- |
| Repo | current | Phases 4–9 committed at `8595db5`, `main` pushed, no divergence from `origin/main` |
| Railway API | current | `/healthz` 200; `/api/driver-app/settings` and `/api/me/notifications` return **401**, not 404 — those routes exist only in Phase 6/8 code |
| Supabase | at least 0134 applied | `driver_app_features` and `org_modules` both answer over PostgREST |
| Driver app on device | **stale, unavoidably** | `apps/driver/app.config.ts` has no `updates` block and no EAS project id; there is no CI build and no install link. The only path from repo to phone is `expo run:*` on a Mac. |

So the server changes shipped and the app changes had nowhere to go.

The deeper problem is not the driver app specifically. It is that **nothing in this system can state its own version.** Nothing reports which commit the API is running, which migration the database is at, or which build a phone is on. Every "I don't see changes" therefore costs an hour of manual archaeology. This has now happened several times.

This plan fixes both: **version truth** (D0), then **delivery** (D1–D3), then **guardrails** (D4).

## 1. Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| D-S1 | Android is the fleet platform; the self-hosted pipeline targets Android first | Drivers use Android. Android needs no Apple account, no per-device registration, and no store review — a tester taps a link and installs. |
| D-S2 | Binaries are built in GitHub Actions and served from a Railway install page | Matches how the API and web app already ship, costs nothing, and keeps signing keys in our own secret store. Rejected EAS Build as the primary path because builds and the install page would live on Expo's infrastructure. |
| D-S3 | JavaScript updates ship over the air from a self-hosted `expo-open-ota` on Railway | Open source, production-grade, ships a Railway deploy template and S3-compatible storage. No monthly-active-user cap and no third party holding update manifests for an app that carries SQLCipher-encrypted driver data. Rejected EAS Update for the same hosting reason; its free tier (1,000 MAU) would otherwise have sufficed. |
| D-S4 | iOS is a separate, later track using EAS Build + TestFlight | iOS is for owner testing only, not the fleet. Any iPhone install requires the Apple Developer Program ($99/yr). TestFlight beats self-hosted ad-hoc distribution: no UDID bookkeeping, no 100-device annual cap, no manifest hosting, no iOS 18+ restart-to-trust step. Building iOS ourselves would additionally need macOS runners and certificate management for one tester — not worth it. |
| D-S5 **(revised)** | `runtimeVersion` is a fixed string in `apps/driver/runtime-version.json`; the fingerprint is a CI gate instead | The original decision here was `{ policy: 'fingerprint' }`, on the reasoning that a hash of the native dependency graph is the authoritative answer to "can this ship over the air?". Reading the upstream documentation before implementing reversed it. The fingerprint hashes the *resolved* dependency tree, and in a pnpm workspace a `--frozen-lockfile` CI install and a laptop install can hash differently for the same commit; the upstream project explicitly recommends against the policy for that reason. The failure mode is the worst kind — updates simply never arrive, with nothing logged. So the runtime version is a value a human bumps, and the safety it lost is bought back in CI: the Android build records the fingerprint of the APK it produced, and the update workflow refuses to publish when its own fingerprint differs, dispatching a rebuild instead. Both fingerprints are computed on the same runner image, which is what makes them comparable at all. |
| D-S6 | The driver bootstrap contract is tolerant on the client and strict on the server | Making `modules`/`features` required in `meDriverResponseSchema` was correct for catching a dropped API read, but it means one deploy of skew collapses the whole app to a red banner. The client now defaults them to `[]`; a separate strict schema guards the API in its own contract test. Skew should degrade, never brick. |
| D-S7 | Update manifests are code-signed | `expo-updates` supports manifest signing, and the signature transitively covers assets through their hashes. Without it, anyone who reaches the update server can push code to every driver phone in the fleet. |

## 2. Phase D0 — Version truth and drift detection

Goal: any person, at any moment, can answer "what is actually running?" in one command and one screen.

- **D0.1** `supabase/migrations/0140_schema_version.sql` — `public.applied_schema_version()`, SECURITY DEFINER, returns the highest version recorded in `supabase_migrations.schema_migrations`. Execute granted to `service_role` only. If the function itself is missing, the API reports the schema as `unknown`, which is itself a drift signal.
- **D0.2** `apps/api/src/buildInfo.ts` — reads Railway's injected deploy metadata (`RAILWAY_GIT_COMMIT_SHA`, `RAILWAY_GIT_BRANCH`, `RAILWAY_DEPLOYMENT_ID`) with a local-dev fallback, plus the expected schema version generated from `supabase/migrations` at build time.
- **D0.3** `GET /api/version` — public, rate-limited, no secrets: service, environment, commit, branch, deployed-at, expected vs applied schema version, and a `drift` boolean. Public on purpose: a version endpoint you need a token for is a version endpoint nobody checks.
- **D0.4** `/healthz` reports `degraded` when the database is behind the code. It still returns 200 so Railway does not crash-loop a deploy that is merely waiting on a migration.
- **D0.5** `pnpm verify:live` — compares local `HEAD` and the local highest migration against a deployed `/api/version`, prints a table, exits non-zero on drift. This is the command to run instead of guessing.
- **D0.6** Client tolerance per D-S6, plus an API contract test asserting the strict shape.
- **D0.7** Driver app: an "About this build" row in Settings showing app version, runtime version, update id, and the API's commit and schema state. When a driver says "it's not working", this is the first screenshot to ask for.

## 3. Phase D1 — Android build and install page

- **D1.1** Upload keystore generated once and stored as GitHub Actions secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`). Losing this keystore means testers must uninstall before they can take a new build, so it is backed up outside CI as well.
- **D1.2** `.github/workflows/driver-android.yml` — on push to `main` touching `apps/driver/**`, `packages/**`, or the workflow itself: install, build shared, `expo prebuild --platform android`, `gradlew assembleRelease`, then upload the APK plus its metadata to the dist service.
- **D1.3** `apps/driver-dist` — a small **zero-dependency** Node service on Railway serving an install page (version, commit, changelog, unknown-sources instructions), `/download/latest.apk`, a JSON release feed, and a token-protected upload endpoint for CI. Tester access is a shared passphrase over HTTP Basic; this is an internal build, not a public download. No dependencies by design: this service holds the artifact that lands on every fleet phone, so each package added is a supply-chain path onto a driver's device. A QR code was dropped for the same reason — the install link is shared over chat in practice.
- **D1.4** Railway service + persistent volume for artifacts. Note: Railway volumes mount at runtime only, so CI pushes finished artifacts to the running service rather than building into the volume.

Tester friction to document, not engineer away: Android requires enabling "install unknown apps" for the browser doing the download, once per device, and Play Protect may show a warning on first install of a sideloaded app.

## 4. Phase D2 — Self-hosted over-the-air updates

The server is **xprem** (the project formerly published as `expo-open-ota`; v3 renamed it and rewrote
it in Go around a Postgres control plane). It ships a Railway template that provisions the service,
Postgres and an S3-compatible bucket, and generates `JWT_SECRET` and `DB_KEYS_MASTER_KEY_B64` itself.

- **D2.1** Deploy xprem from the Railway template. Health check is `GET /hc`; the container listens on
  3000. Pin the image tag — the CLI and server move together, and `latest` is explicitly discouraged.
- **D2.2** `app.config.ts` gains an `updates` block driven by `UPDATES_URL` and `UPDATES_APP_ID`, and
  omits it entirely when they are unset, so a laptop dev client is untouched. The URL, the app id and
  the certificate are compiled into the **native** build: changing any of them needs a new APK, never
  an update. `runtimeVersion` comes from `runtime-version.json` per the revised D-S5.
- **D2.3** Code signing: the certificate is public and committed at `apps/driver/certs/certificate.pem`;
  the private key never leaves the server, sealed in Postgres with `DB_KEYS_MASTER_KEY_B64`. Losing
  that master key permanently destroys the app's ability to sign updates — it is the one value to back
  up outside Railway.
- **D2.4** `.github/workflows/driver-ota.yml` publishes with `eoas publish --branch production` on
  every `main` push that touches the driver app, but only after proving the change is JavaScript-only:
  it compares its own native fingerprint against the one the install page recorded for the current
  APK. On a mismatch it publishes nothing and dispatches an Android build instead.
- **D2.5** In-app: `useAppUpdate` downloads silently and `UpdateReadyBanner` offers a restart on Home.
  The app never reloads itself — a reload mid check-in destroys a half-filled form. Queued offline work
  is safe either way; it lives in the encrypted outbox, not in memory. The hard path stays the existing
  `core.app` `minVersion` gate, which replaces the navigator outright when a fleet forces an upgrade.

What can ship over the air: all app JavaScript, screens, navigation, business logic, copy, styling,
Metro-bundled assets, and pure-JS dependency bumps. What cannot: anything touching the local native
capture module, SQLCipher, MapLibre, `expo-notifications` native config, permissions, entitlements,
config plugins, or `expo-updates` itself — plus the update URL, app id and certificate themselves.

## 5. Phase D3 — iOS (blocked on Apple Developer Program)

Requires the $99/yr membership before anything can be installed on an iPhone. Then: an EAS `ios` build profile, a build submitted to TestFlight, and owner-only internal testing (up to 100 internal testers, no App Review, builds expire after 90 days). Android remains the self-hosted primary path; this track exists so the owner can test on iOS.

## 6. Phase D4 — Guardrails

- A post-deploy CI step that polls `/api/version` and fails the run if the deployed commit does not match the pushed commit within a timeout, so a failed Railway deploy is loud rather than silent.
- The migrate workflow asserts its three secrets are present and fails explicitly if not, instead of "failing harmlessly".
- `RELEASE-GATE.md` gains a "how to tell what is live" section pointing at `pnpm verify:live` and the in-app build info row.

## 7. Prerequisites the owner must provide

| Needed for | Item |
| --- | --- |
| D1 | GitHub Actions secrets for the Android signing keystore (script provided; run once) |
| D1 | A Railway service for `apps/driver-dist` plus a volume, and a shared tester passphrase |
| D2 | The xprem Railway template deployed (service + Postgres + bucket), an app created in its dashboard, and an `EOO_TOKEN` |
| D2 | `apps/driver/certs/certificate.pem` downloaded from the xprem dashboard and committed |
| D3 | Apple Developer Program membership |
| verification | Confirmation that the migrate workflow's three Supabase secrets are set, and that the 0139 backfill actually granted this org every module |

## 8. Open questions

1. Should tester access to the install page be a shared passphrase or per-tester links with revocation? Passphrase is assumed for the pilot.
2. How long do we retain old APKs and update bundles? 90 days is assumed, matching TestFlight's build expiry.
3. Do we want a separate `staging` Railway API and Supabase project? Right now `main` deploys straight to the environment the pilot runs against, which is fine for one organisation and will not be fine at the second customer.
