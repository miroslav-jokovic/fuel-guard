# Devin — commit the design-system fixes and L4

Everything before this is on `main` and deployed (`b5a586b`, `applied 0148`). Two commits here.

```bash
cd ~/Projects/FuelGuard
git switch main && git pull --ff-only
```

If a stale `.git/index.lock` blocks you, delete it — one keeps reappearing from a concurrent git
process, and Cowork can only move files, not unlink them. Look in `_to_delete/`.

---

## Commit 1 — design-system corrections

```bash
git add docs/DESIGN-SYSTEM-CONTRACT.md \
        apps/web/src/features/compliance/DqFilePanel.vue \
        apps/web/src/features/hazmat/CertManager.vue \
        apps/web/src/pages/CompliancePage.vue \
        apps/web/src/pages/DriversPage.vue

git commit -m "Put the compliance surfaces back on the design system

The qualification drawer was built by hand instead of from the components:
a raw table where DataTable exists, status rendered as tinted words instead
of badges, a local badge map using rounded-full and the -100/-700 pair so it
sat next to StatusBadge looking like a different product, and a hidden file
input driven by a synthetic click where FileDropzone is the sanctioned
uploader. All corrected.

Two of these were bugs, not taste. DqFilePanel and CertManager had no error
state at all, so a failed fetch rendered as an empty checklist — a compliance
drawer silently claiming a driver holds no CDL. And CertManager wrapped
BaseCheckbox, which is itself a label, in another label: invalid HTML that
breaks click-to-toggle.

DriversPage used divide-border and border-border. There is no border token
(it is edge), so those classes compiled to nothing and the elements have been
rendering with no border at all. The token linter cannot see it because
'border' is not a banned hue.

Adds docs/DESIGN-SYSTEM-CONTRACT.md, measured from the code rather than from
docs/DESIGN-SYSTEM.md, which is stale in three places."
```

---

## Commit 2 — L4, D57 driver write limits

```bash
git add packages/shared/src/driverWriteLimits.ts \
        packages/shared/src/driverWriteLimits.test.ts \
        packages/shared/src/index.ts \
        supabase/migrations/0149_driver_write_counters.sql \
        apps/api/src/middleware/driverWriteLimit.ts \
        apps/api/src/routes/me.ts apps/api/src/routes/messages.ts \
        apps/driver/src/lib/api.ts apps/driver/src/data/handlers.ts \
        apps/driver/src/data/sync.ts apps/driver/src/data/policy.ts \
        apps/driver/src/data/policy.test.ts \
        supabase/tests/rls.test.mjs \
        docs/plans/dispatch-loads/LOADS-PLAN.md \
        docs/plans/DEVIN-COMMIT-2026-08-08.md

git commit -m "Add D57 driver write limits and daily caps

The plan's own switch-on blocker for Loads, and nothing existed: all of
/api/me sat behind one IP-keyed 120/15min limiter. Drivers share a carrier's
NAT, so that throttles a whole yard the moment one phone retries in a loop.

Per-minute windows are keyed on the JWT sub and held in memory, checked first
so a runaway loop never reaches the database. Daily caps are a Postgres
counter incremented and judged in one statement, because SELECT-then-UPDATE
is a lost-update bug under exactly the traffic a cap exists to survive. RLS
denies every client: a driver who could read their own counter could delete
it.

Two error codes, because they mean different things. rate_limited resets in
seconds; daily_cap_reached resets at midnight. Both 429 + Retry-After.

Mounted inside the routers after their own requireAuth — at app level it
would run before authentication and have nothing to key on but an IP.

The cap check fails open and logs. Refusing a driver's completed stop because
a bookkeeping table is down loses real work to protect a quota.

Fixes a client bug this exposed: the outbox treated 429 as transient, but the
backoff tops out at five minutes and MAX_ATTEMPTS is 8, so a daily-capped
record burned through every attempt in about twenty minutes and dead-lettered
— putting a driver's completed stop in Needs attention over a quota that
clears at midnight. A 429 now never dead-letters, and honours the server's
Retry-After over its own backoff."
```

---

## Gate, then push

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @fuelguard/shared build:rn

pnpm lint && pnpm lint:filesize && pnpm lint:funcsize && pnpm lint:migrations
pnpm lint:boundaries && pnpm lint:tokens-parity && pnpm --filter @fuelguard/web lint:tokens
pnpm typecheck
pnpm test
pnpm build

git push origin main
```

Expected matrix counts: **rls 184 · hazmat_rls 16 · load-lifecycle 54 · duty-sessions 20.**
`rls` moved 179 → 184 with the five assertions that no client can read, delete or forge a write
counter.

Two new suites get their first real execution here — `driverWriteLimits.test.ts` (30 assertions) and
the four added to `apps/driver/src/data/policy.test.ts`. The logic behind the 30 was verified by
compiling the module and asserting against plain node; that is not the same as running the suite. If
anything is red, report it rather than editing assertions.

`0149` applies on merge. Confirm:

```bash
pnpm verify:live      # schema.applied must read 0149
```

---

## Then check two things by hand

1. **The limiter actually limits.** With a driver token, POST `/api/me/shift/start` eleven times
   inside a minute. The eleventh must return `429`, `Retry-After`, and `code: "rate_limited"`.
2. **Two drivers behind one IP do not share a bucket** — the entire point of D57. Exhaust driver A's
   per-minute window, then immediately make one request as driver B from the same machine. B must
   succeed.

---

## Clean up

```bash
rm -rf _to_delete
git status --porcelain
```

## Report

1. Full `pnpm test`, especially the two new suites and the four matrix counts.
2. `pnpm verify:live` — `schema.applied` must be `0149`.
3. The results of the two manual checks, with the actual response bodies.
