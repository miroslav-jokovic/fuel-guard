# Phase 2 — Offline-first Data Layer & Home

> Give the app a trustworthy data spine that works with no signal: a persisted read cache, a durable
> write **outbox** (the queue Phase 3 rides on), a background sync engine, connectivity UX, and a
> glanceable Home screen showing the driver's assigned vehicle and recent activity from cache.
> Status: **☐ not started** · Depends on: Phase 1 · Blocks: Phase 3 (Fuel Capture)
> Parent: [00-DRIVERS-APP-MASTER-PLAN.md](./00-DRIVERS-APP-MASTER-PLAN.md)

---

## Goal & demoable outcome

Put the phone in airplane mode. Open the app: it loads the signed-in driver, their assigned
vehicle(s), and their recent fills **from cache** — no spinner-of-death, no network error. A visible
**offline banner** and a **"pending sync" count** communicate state honestly. Re-enable signal: queued
work drains automatically and the banner clears. Nothing in this phase writes new domain data yet
(that's Phase 3) — but the outbox, sync engine, and cache it establishes are exercised by a seeded
test mutation to prove the machinery end-to-end.

---

## 1. Design decision (LOCKED)

**Decision D4 — Split the read cache from the write outbox; start lightweight; defer WatermelonDB.**

- **Reads → TanStack Query (React) + a persisted cache.** Query results (driver context, vehicles,
  recent fills) persist to disk so they survive relaunch and are available offline. This is a direct
  port of the web's Vue Query patterns (array keys, `invalidateQueries`, `keepPreviousData`) —
  `apps/web/src/features/**/use*.ts` — to React Query.
- **Writes → a durable SQLite "outbox".** A dedicated persisted queue of pending mutations (fill-ups
  and, later, hazmat photos / training progress). This is separate from the read cache because writes
  must survive crashes, carry attached files, and retry independently.
- **Why not WatermelonDB now (O2 resolved):** WatermelonDB is a full reactive local DB aimed at rich
  two-way sync of large datasets. v1's driver data is small and mostly read-cached; the only hard
  requirement is a **reliable offline write path**. A focused outbox is less machinery, easier to
  reason about, and easier to verify. Revisit WatermelonDB/PowerSync only if read-sync complexity
  grows (e.g. large offline history, cross-entity reactive queries). Recorded as the v1 choice.

**Libraries (v1):** `@tanstack/react-query` + `@tanstack/query-async-storage-persister` (or a SQLite
persister), `@react-native-community/netinfo` for connectivity, `expo-sqlite` for the outbox,
`expo-file-system` for staged receipt/photo files, `expo-crypto` for client UUIDs.

---

## 2. The read cache

### 2.1 Query client & persistence

- One `QueryClient` configured for field use: `networkMode: 'offlineFirst'`, generous `staleTime`
  (context changes rarely), `gcTime` long enough to survive a shift, retry with backoff.
- Persist the cache to disk (AsyncStorage/SQLite persister) and **restore on launch** so the first
  paint is cached data, not a spinner.
- `onlineManager` wired to NetInfo so React Query knows real connectivity (not just fetch failures),
  and `focusManager` wired to `AppState` so foregrounding triggers a background refresh.

### 2.2 Driver context queries (bootstrap)

The app's trusted bootstrap is `GET /api/me/driver` (built in Phase 1) — returns the caller's driver
row + assigned vehicle(s). Cache it under `['me','driver']`. Supplementary reads go **direct to
Supabase under RLS** (the web's dual-path model), scoped by the Phase-1 driver policies:

| Query key | Source | Notes |
|---|---|---|
| `['me','driver']` | `GET /api/me/driver` | driver + assigned vehicle(s); the bootstrap |
| `['vehicles','assigned']` | Supabase `vehicles` (RLS: `assigned_driver_id = auth_driver_id()`) | picker + capacity/odometer/fuel-type for capture warnings |
| `['fuel_transactions','mine', page]` | Supabase `fuel_transactions` (RLS: own rows) | recent fills for Home + Phase 4 |

Column allow-lists mirror the web hooks (`VEHICLE_COLS`, `FUEL_COLS`, `DRIVER_COLS` in
`apps/web/src/features/**` / `composables/useDrivers.ts`) so shapes match and `@fuelguard/shared`
types apply unchanged.

---

## 3. The write outbox (the core of this phase)

A persisted, ordered queue of pending mutations. Phase 3 enqueues fill-ups; the design is generic so
hazmat/training reuse it later.

### 3.1 Record shape (SQLite table `outbox`)

```
id            TEXT PRIMARY KEY   -- client UUID; for a fill-up this IS the fuel_transactions.id
kind          TEXT               -- 'fuel_fillup' (later: 'hazmat_doc', 'training_event', …)
payload       TEXT (JSON)        -- validated domain object (Zod-checked before enqueue)
file_uris     TEXT (JSON)        -- local expo-file-system paths for attached media (receipt)
status        TEXT               -- 'pending' | 'in_flight' | 'failed' | 'done'
attempts      INTEGER
next_attempt_at INTEGER          -- backoff schedule
created_at    INTEGER
last_error    TEXT
```

### 3.2 Idempotency (already solved by the schema)

Every record's `id` is a **client-generated UUID** created once at capture (`expo-crypto` `randomUUID`,
the RN equivalent of `apps/web/src/lib/uuid.ts`). Because that UUID is the row's primary key, replaying
a queued insert is safe: a duplicate insert collides on PK and no-ops instead of double-writing. The
sync engine leans on this — it can retry aggressively without dedup bookkeeping. This is the single
most important reason capture is reliable offline.

### 3.3 Sync engine

A single background processor (`src/data/sync.ts`):

1. Trigger on: connectivity regained (NetInfo), app foreground (`AppState`), successful enqueue, and a
   periodic tick while pending.
2. Take the oldest `pending`/eligible record → mark `in_flight`.
3. Execute by `kind` via a registered handler (Phase 3 registers `fuel_fillup`): upload attached files
   to Storage first, then the DB insert, then any server side-effect (e.g. scoring) — the exact
   sequence the web uses in `useCreateFillUp` (`apps/web/src/features/fuel/useFuelLog.ts`).
4. On success → `done`, invalidate the relevant React Query keys, delete staged files.
5. On failure → `failed` with `last_error`, exponential backoff into `next_attempt_at`; surface a
   badge, never a data-loss. Permanent-failure policy (e.g. validation rejected server-side) marks the
   record for manual review rather than infinite retry.
6. Concurrency: process serially (or a small pool) to keep ordering and avoid thundering herds on
   reconnect.

### 3.4 Optimistic reads

When a record is enqueued, the corresponding React Query cache is optimistically updated (a
`fuel_transactions` insert shows immediately in "recent fills") via `onMutate`, rolled back only on
*permanent* failure — so the driver sees their action instantly, online or off.

---

## 4. Connectivity & sync UX

Honest, glanceable state (never a silent failure):

- **Offline banner:** a slim, token-colored bar (`warning`/`ink-muted`) when NetInfo reports offline —
  "Offline — your entries are saved and will sync."
- **Pending badge:** a count of outbox records not yet `done`, shown on Home and near the sync control.
- **Sync status:** subtle "Syncing…/All synced" affordance; tap to force a sync attempt.
- **Failure surfacing:** a `failed` record shows a non-alarming "Couldn't sync yet — will retry" with a
  manual retry; permanent failures route to a small "Needs attention" list.

All copy is plain-language and reassuring — the driver's data is never at risk.

---

## 5. Home screen

The daily landing surface. Glanceable, thumb-zone, one clear primary action.

- **Header:** greeting + driver name (from `['me','driver']`), org/context, sync/offline indicators.
- **Assigned vehicle card:** unit number + make/model, current odometer, tank capacity, fuel type — the
  facts capture needs, shown as a `Card` with big legible values (`StatTile` styling). If multiple
  vehicles are assigned, a compact selector.
- **Primary CTA:** a large (≥56pt) **"Log fill-up"** button in the bottom thumb zone. In Phase 2 it's
  wired to a placeholder; Phase 3 replaces the target with the capture flow.
- **Recent activity:** the driver's last few fills from cache (date, gallons, odometer, MPG/status via
  `@fuelguard/shared` `fuelTxnStatus`/derivations) — read-only preview, full list in Phase 4.
- **Empty/loading/error states:** cached-first; skeletons only when there's truly nothing cached;
  errors are soft (offline is normal, not an error).

Everything token-styled; no color literals (token-lint enforced).

---

## 6. File & work breakdown

| Area | File(s) |
|---|---|
| Query client + persistence | `src/lib/queryClient.ts`, `src/lib/persist.ts` |
| Connectivity | `src/lib/connectivity.ts` (NetInfo → `onlineManager`/`focusManager`) |
| Outbox store | `src/data/outbox.ts` (expo-sqlite schema + CRUD), `src/data/fileStaging.ts` |
| Sync engine | `src/data/sync.ts` (handlers registry, backoff, triggers) |
| Context hooks | `src/features/home/useDriverContext.ts`, `useAssignedVehicles.ts`, `useMyRecentFills.ts` |
| Home UI | `app/(app)/index.tsx` (Home route), `src/features/home/*` components |
| Sync UX | `src/components/OfflineBanner.tsx`, `SyncStatus.tsx`, `PendingBadge.tsx` |
| Tests | outbox CRUD + backoff, idempotent-replay, sync-engine state machine, optimistic rollback |

---

## 7. Exit criteria

- ☐ Cold-start in airplane mode renders driver + assigned vehicle + recent fills from cache (no error).
- ☐ A seeded test mutation enqueues offline, survives an app relaunch, and syncs on reconnect.
- ☐ Replaying the same outbox record twice does **not** create a duplicate (idempotency proven by test).
- ☐ Offline banner + pending badge + sync status reflect real NetInfo state; force-sync works.
- ☐ Optimistic insert appears immediately and rolls back only on permanent failure.
- ☐ Home is token-only (lint:tokens green), ≥48pt targets, Dynamic-Type safe, light + dark.
- ☐ `pnpm -r typecheck && lint && test` green; unit tests for outbox/sync/backoff.
- ☐ Doc updated with the final persister choice and a verification tally (incl. "ran offline→online on
  iOS + Android dev build").

---

## 8. Risks & mitigations

- **Silent data loss** (the cardinal sin) → durable SQLite outbox written *before* any UI confirmation;
  files staged to `expo-file-system` and only deleted after a confirmed sync.
- **Duplicate writes on retry** → client-UUID PK makes replay idempotent (§3.2); a test asserts it.
- **Cache/RLS mismatch** → all direct reads go through the Phase-1 driver-scoped policies; cache holds
  only what the driver may see.
- **Backoff storms on reconnect** → serial processing + jittered exponential backoff.
- **Scope creep into a full sync DB** → v1 is outbox + read cache only; WatermelonDB explicitly deferred
  (D4) until a concrete need appears.

---

## Sources

`apps/web/src/features/fuel/useFuelLog.ts`, `apps/web/src/lib/{uuid.ts,api.ts,supabase.ts}`,
`apps/web/src/composables/useDrivers.ts`, `apps/web/src/features/**/use*.ts` (Vue Query patterns);
`packages/shared/src/fuel.ts` (status/derivations); Phase 1 `GET /api/me/driver` + driver-scoped RLS;
Expo SDK (sqlite, file-system, crypto), NetInfo, TanStack Query persistence + `networkMode` docs;
WatermelonDB / PowerSync offline-first references (deferred).
