# Deployment (Railway) — single source of truth

FuelGuard deploys to Railway as **two web-facing services**, each driven by a committed
config-as-code file. There is no third "web" service — the app is built **same-origin,
single-service**: the API process builds the web SPA and serves it (`apps/api/src/app.ts`
serves `apps/web/dist`), and the browser calls the API at `/api/...` on the same origin
(`apps/web/src/lib/api.ts`: `VITE_API_URL` defaults to `""`).

| Service | Config file | Builds | Runs / serves | Redeploys when these change |
|---|---|---|---|---|
| **app** (a.k.a. "api") | `railway.json` (repo root) | `@silvicom/web` | `@silvicom/api` + the web SPA | `apps/api/**`, `apps/web/**`, `packages/**`, `package.json`, `pnpm-lock.yaml`, `railway.json` |
| **admin** | `railway.admin.json` | `@silvicom/admin` | `@silvicom/admin-api` + the admin SPA | `apps/admin/**`, `apps/admin-api/**`, `packages/**`, `package.json`, `pnpm-lock.yaml`, `railway.admin.json` |

`apps/driver` is an Expo app and is **not** a Railway service.

## Why a push must sometimes redeploy the app service for a *web-only* change

The app service is the only thing that serves the SPA. A change under `apps/web/**` (or a
shared `packages/**` change the web build consumes) does not reach users until the **app
service** rebuilds `apps/web/dist` and restarts. That is why `apps/web/**` and `packages/**`
are in the app service's `watchPatterns` — not just `apps/api/**`.

## Shared code (`packages/**`) — deliberately broad

Both services bundle shared packages, so **both** watch `packages/**`. A shared change may
rebuild a service that didn't strictly need it (e.g. an admin-only shared tweak still rebuilds
the app service) — that wasted rebuild is cheap and harmless. The failure mode we refuse to
risk is the opposite: a shared change that silently does **not** trigger a dependent service,
leaving a stale deploy. Reliability over micro-optimization. Do not narrow these to per-package
globs.

## The deploy build does NOT typecheck, on purpose

`railway.json` runs `pnpm --filter ./apps/web exec vite build` rather than the package's own
`build` script. The difference is that `apps/web`'s `build` is `vue-tsc -p tsconfig.json --noEmit
&& vite build`, so calling it made **every deploy re-run a full TypeScript check that CI had
already run on the same commit**. Measured 2026-09-05: `vue-tsc` is 9.4s locally against `vite
build`'s 1.7s, and Railway's builder ran vite 3.5x slower than a laptop, which puts the check at
roughly 30 seconds on the critical path of every single deploy.

This is safe because of a fact about `main`, not a fact about the build: branch protection has
`enforce_admins: true` with `build` as a required check, and CI's `typecheck-build` job runs
`pnpm typecheck`, which is `pnpm -r typecheck`, which includes that exact `vue-tsc`. Nothing
reaches `main` without it having passed — not a force-push (disabled), not an admin. The copy
inside the deploy was a second execution of a check that cannot fail by the time Railway sees the
commit.

Note what this does NOT change: `vite build` never typechecked anything in the first place, it
strips types. So the shipped bundle is byte-for-byte the same work; only the redundant gate is
gone.

**If you ever turn off `enforce_admins`, or drop `build` from the required checks, put the
typecheck back** — at that point Railway becomes the only thing standing between a bad commit and
production, because it is the one pipeline that does not wait for CI.

`railway.admin.json` still calls `pnpm --filter @silvicom/admin build`, which has the same
`vue-tsc &&` shape. It was left alone deliberately: the admin service is on its own watch patterns
and is not on the merge-to-live path this was measured against. The same reasoning would apply.

## One-time Railway setup (makes the files above authoritative)

`watchPatterns` in a config file only apply when the Railway service is pointed at that file.
Set this once per service (Railway → service → Settings):

1. **app service** → Config-as-code → **Config Path = `railway.json`**. Automatic Deploys **on**;
   deploy branch **`main`**.
2. **admin service** → Config-as-code → **Config Path = `railway.admin.json`**. Automatic Deploys
   **on**; branch **`main`**.
3. **Delete the old standalone "web" service** if it still exists. It had no start command, so it
   served nothing — it only made "web redeployed" look meaningful while the app service (which
   actually serves users) sat stale.

To verify: push a web-only change to `main`. The **app service** should build and its log should
show `pnpm --filter ./apps/web exec vite build`. If it doesn't, the service isn't reading
`railway.json` — re-check step 1. (That line named `@silvicom/web build` until 2026-09-05, which
was already the wrong filter spelling and is now the wrong command as well; see the section above.)

## After setup — the contract

- Push anything under `apps/api`, `apps/web`, or `packages` → **app service** redeploys (web + API
  ship together).
- Push anything under `apps/admin`, `apps/admin-api`, or `packages` → **admin service** redeploys.
- `git push` to `main` always triggers the correct service(s). No manual redeploys.
