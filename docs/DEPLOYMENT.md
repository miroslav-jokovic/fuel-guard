# Deployment (Railway) — single source of truth

FuelGuard deploys to Railway as **three web-facing services**. Two of them —
`@fleetguard/api` and `@fleetguard/web` — run the SAME image from the SAME config file
(`railway.json`) and differ only in their environment. That is the single most confusing thing
about this deployment, so it is the first thing described here.

| Service | Config file | Public host | Role |
|---|---|---|---|
| **`@fleetguard/api`** | `railway.json` | `fleetguardapi-production.up.railway.app` | The **back end**. WEX-whitelisted, so the EFS pollers can only run here. Owns the background schedulers (`RUN_SCHEDULERS_IN_PROCESS=true`). Holds the EFS/WEX credentials. |
| **`@fleetguard/web`** | `railway.json` (same file) | `fleetguardweb-production.up.railway.app` | The **front door** — this is what users load. It is the value of `WEB_APP_URL` and the only origin in the API's `ALLOWED_ORIGINS`. Serves the SPA; runs NO schedulers. |
| **admin** | `railway.admin.json` | platform-console | `@silvicom/admin-api` + the admin SPA. |

`apps/driver` is an Expo app and is **not** a Railway service.

### The two are not same-origin, whatever the code's default says

`apps/web/src/lib/api.ts` defaults `VITE_API_URL` to `""`, which would make the browser call
`/api/...` on whatever host served the page. **Production does not use that default.**
`@fleetguard/web` sets `VITE_API_URL` to the api host, so the deployed SPA calls the API
**cross-origin**, and the API's `ALLOWED_ORIGINS` exists precisely to permit it. Both hosts do
serve a full API and a copy of the SPA — `apps/api/src/app.ts` serves `apps/web/dist` in both —
but only `fleetguardweb` is the one users are sent to.

### Do NOT delete `@fleetguard/web`

Until 2026-09-05 this document said the opposite. It described a third "old standalone web
service" with "no start command" that "served nothing", and told you to delete it. Every part of
that was false, and acting on it would have deleted the host your users load. What it was
describing may once have existed; what carries that name today is the front door.

The check that settles it, if you ever doubt which is which:

```
curl -s https://fleetguardweb-production.up.railway.app/api/version   # a full, live API
railway variables --service "@fleetguard/api" --environment production --json | grep ALLOWED_ORIGINS
```

The second command names `fleetguardweb` and nothing else. A host that is the sole permitted
origin of your own API is not a leftover.

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
already run on the same commit**. Removing it was worth **20 seconds on every deploy**, measured
on the change itself: build-to-image went from 99s (`bbb1bf5`, with the typecheck) to 79s
(`452ba2a`, without), and merge-to-both-hosts-serving from 173s to 150s.

Recorded because the prediction was wrong in a useful direction: the estimate beforehand was ~30s,
reasoned from `vue-tsc` costing 9.4s locally against `vite build`'s 1.7s and Railway's builder
running vite 3.5x slower than a laptop. The real figure is two thirds of that, so the builder is
relatively faster at the typecheck than at bundling. Extrapolating one phase's slowdown ratio onto
another phase is not a measurement; take the deploy timing from a deploy.

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

## Exactly one service runs the schedulers, and it is enforced by an env var only

`RUN_SCHEDULERS_IN_PROCESS` decides whether a process also runs the ~20 background schedulers.
`apps/api/src/env.ts` gives it `.default("true")`, so **a service that does not set it runs them.**
There is no gate for this: nothing in CI can see a Railway variable, and the code cannot tell how
many copies of itself are running.

That is not hypothetical. On 2026-09-05 both `@fleetguard/api` and `@fleetguard/web` were running
the full scheduler set simultaneously, because `web` had simply never been given the variable and
inherited the `true` default. Both services' logs for the same commit showed
`[digest] weekly digest scheduler enabled`, `[dq-alerts] …`, `[posted-prices] …`,
`[finance-freshness] …`. `apps/api/src/schedulers.ts` states the rule in its own header — *"Run
these in EXACTLY ONE process … never both"* — and names the specific casualty: `rebuild-on-boot`
carries no job-ledger guard, so it ran twice. `reclaimInterruptedJobs` is the other hazard, since
two booting processes can reclaim each other's in-flight jobs as "interrupted".

**The settled ownership:**

| Service | `RUN_SCHEDULERS_IN_PROCESS` | Why |
|---|---|---|
| `@fleetguard/api` | `true` | The only WEX-whitelisted host, and the only one holding EFS credentials. The EFS pollers cannot run anywhere else. |
| `@fleetguard/web` | **`false`** | Set 2026-09-05 to end the duplication. Serves users; owns no background work. |

**Any new service built from `railway.json` must be given `RUN_SCHEDULERS_IN_PROCESS=false`
before it is first deployed.** Forgetting is silent — the service comes up healthy, serves
traffic correctly, and quietly doubles every scheduled job in the system.

To check the live state at any time:

```
railway variables --service "@fleetguard/web" --environment production --json | grep RUN_SCHEDULERS
railway logs --service "@fleetguard/web" --environment production | grep -i scheduler
```

The second should print `in-process schedulers disabled`, and nothing else.

## One-time Railway setup (makes the files above authoritative)

`watchPatterns` in a config file only apply when the Railway service is pointed at that file.
Set this once per service (Railway → service → Settings):

1. **app service** → Config-as-code → **Config Path = `railway.json`**. Automatic Deploys **on**;
   deploy branch **`main`**.
2. **admin service** → Config-as-code → **Config Path = `railway.admin.json`**. Automatic Deploys
   **on**; branch **`main`**.
3. **Both `@fleetguard/api` and `@fleetguard/web` point at `railway.json`.** They are meant to.
   See the top of this file for which is which, and do not "tidy up" the second one.

To verify: push a web-only change to `main`. The **app service** should build and its log should
show `pnpm --filter ./apps/web exec vite build`. If it doesn't, the service isn't reading
`railway.json` — re-check step 1. (That line named `@silvicom/web build` until 2026-09-05, which
was already the wrong filter spelling and is now the wrong command as well; see the section above.)

## After setup — the contract

- Push anything under `apps/api`, `apps/web`, or `packages` → **app service** redeploys (web + API
  ship together).
- Push anything under `apps/admin`, `apps/admin-api`, or `packages` → **admin service** redeploys.
- `git push` to `main` always triggers the correct service(s). No manual redeploys.
