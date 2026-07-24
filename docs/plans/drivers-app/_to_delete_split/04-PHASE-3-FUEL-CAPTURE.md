# Phase 3 — Fuel Capture (the daily job)

> The reason the app exists: let a driver log a fill-up in under 30 seconds, offline, with the same
> validation and anti-theft warnings the web uses — then queue → sync → score through the Phase-2
> outbox. This is the first real driver feature and the end-to-end proof of the whole pipeline.
> Status: **☐ not started** · Depends on: Phase 2 (outbox/sync) + Phase 1 (identity/RLS) · Blocks: Phase 4
> Parent: [00-DRIVERS-APP-MASTER-PLAN.md](./00-DRIVERS-APP-MASTER-PLAN.md)

---

## Goal & demoable outcome

In airplane mode, a driver taps **Log fill-up**, picks their vehicle, enters odometer + gallons +
cost (seeing the live `$/gal` and any warnings), snaps a receipt photo, and submits. It appears
instantly in "recent fills" (optimistic), sits in the outbox as `pending`, and — on reconnect —
uploads the receipt, inserts the `fuel_transactions` row, and gets **scored server-side**, then shows
up in the manager dashboard exactly like a web-entered fill. Over-capacity fills trigger a hard
confirm and are flagged for review, identical to web behavior.

---

## 1. Fidelity principle

This flow already exists on the web (`apps/web/src/features/fuel/FillUpForm.vue` +
`useFuelLog.ts`), and its rules live in `@fuelguard/shared`. **We reuse the brain and rebuild only
the skin** — same Zod schema, same warning function, same derivation, same idempotency — so a
mobile fill-up and a web fill-up are byte-equivalent domain objects. No domain logic is re-authored.

---

## 2. The form

Rendered as a **first-class full screen** (not the web's slide-over drawer) — thumb-zone layout,
large targets, numeric keyboards, minimal typing.

| Field | Control | Default / behavior | Source of truth |
|---|---|---|---|
| Vehicle | large picker | the driver's assigned vehicle (from `['vehicles','assigned']`); if one, pre-selected and shown as a card | Phase-2 cache |
| Date/time | native datetime picker | now (local) → ISO on submit | — |
| Odometer | decimal keypad | optional; drives odometer warnings | — |
| Gallons | decimal keypad | **required, > 0** | `fillUpInputSchema` |
| Total cost | decimal keypad | optional; drives live **`≈ $/gal`** via `derivePricePerGal` | `@fuelguard/shared` |
| Location | text | optional station/city | — |
| Payment method | picker | `PAYMENT_METHODS` (cash, efs_check, personal_card, fleet_card, fuel_voucher, other) | `@fuelguard/shared` |
| Receipt photo | camera/library | optional; single image | §4 |

**`driver_id` is not a field.** On the web it's derived from the vehicle's `assigned_driver_id`; in
the driver app it is simply the **logged-in driver** (`auth_driver_id()` — their own row from Phase 1).
Cleaner and correct: a driver's fill is attributed to that driver.

**Validation:** `fillUpInputSchema.safeParse` from `packages/shared/src/fuel.ts` — the *same* schema
the web and API use. First issue per field maps to inline errors. Reused verbatim: `gallons` positive,
`odometer` optional non-negative, uuid fields, etc. This gives offline validation with server parity
for free.

---

## 3. Live warnings (anti-theft, reused)

Computed reactively as the driver types, via `computeFillUpWarnings(input, vehicle)` from
`@fuelguard/shared` — identical to web:

- **odometerMissing** (amber/`warning`): "Add the odometer so we can track MPG."
- **odometerBelowLast** (red/`danger`): entered odometer < `vehicle.current_odometer` — "This is below
  the last recorded reading (X)."
- **exceedsCapacity** (red/`danger`): `gallons > vehicle.tank_capacity_gal` — "Exceeds tank capacity (X gal)."

**Over-capacity hard-confirm:** on submit, if `exceedsCapacity`, block with a native `Alert.alert`
(the RN equivalent of the web's `window.confirm`): *"Gallons exceed this vehicle's tank capacity. This
fill-up will be flagged for review. Submit anyway?"* Cancel aborts; confirm proceeds (and the row is
naturally flagged by the anomaly engine downstream). This is a deliberate anti-theft gate — preserve it.

---

## 4. Receipt capture (RN rewrite of the web's WebP path)

The web compresses via `createImageBitmap` + `<canvas>.toBlob` (`imageCompress.ts`) — **DOM-only, does
not exist in RN**. Rebuild with Expo:

- Capture: `expo-image-picker` / `expo-camera` (`capture="environment"` equivalent → rear camera).
- Compress/resize: `expo-image-manipulator` — resize longest edge to ~1600px, compress to ≤~200KB
  (JPEG/WebP), matching the web's `maxDim=1600 / maxBytes=200_000` targets.
- **Offline staging:** save the processed image to `expo-file-system` and record its URI on the outbox
  record (`file_uris`). The upload happens in the sync handler, not at capture time — so a photo taken
  with no signal is never lost.
- Upload target (unchanged): Supabase Storage `receipts` bucket, path `${orgId}/${vehicle_id}/${id}.webp`
  (`supabase/migrations/0005_storage.sql`). Requires a storage RLS policy allowing a driver to write to
  their own org/vehicle path — added here if not already covered (small additive policy; add to the
  offline matrix note).

---

## 5. Submit → outbox → sync → score

Capture does **not** write to the network directly. It builds the domain object and enqueues:

1. **Build** the `FillUpInput` (client UUID `id` generated once when the form mounts, via
   `expo-crypto` `randomUUID` — the RN port of `apps/web/src/lib/uuid.ts`; the same `id` is the row PK
   **and** the receipt path prefix).
2. **Validate** with `fillUpInputSchema` (reject → inline errors, never enqueue invalid data).
3. **Enqueue** an outbox record `{ kind: 'fuel_fillup', id, payload, file_uris }` (Phase 2) and
   **optimistically** insert into the `['fuel_transactions','mine']` cache so it shows immediately.
4. Close the screen → toast "Fill-up saved" (works identically offline; no "sent" language until synced).

**Sync handler** (registered for `kind:'fuel_fillup'` in `src/data/sync.ts`):

- **Decision D5 (LOCKED) — capture syncs via a driver-scoped server endpoint, not a raw client insert.**
  The web inserts client-direct then best-effort calls `POST /api/transactions/:id/score` — but that
  scoring route is **manager-only and 403s for a driver** (audit finding). So the handler:
  1. uploads the staged receipt file(s) to the `receipts` bucket (client-direct, RLS-scoped), then
  2. calls **`POST /api/me/fillups`** (new, driver-scoped; `requireRole('driver')`) with the validated
     row + `receipt_path`. The server verifies the driver is assigned the vehicle, inserts
     `fuel_transactions` (`source:'manual'`, `entered_by`, derived `price_per_gal`,
     `driver_id = auth_driver_id()`), and **runs `scoreWithCascade` server-side** (service role) so the
     fill is scored just like a web entry.
- Idempotent: the endpoint upserts on the client `id` PK; a retried sync no-ops instead of duplicating
  (the whole reason for the client-UUID design).
- On success → invalidate `['fuel_transactions','mine']` (+ anomalies if surfaced later), delete staged
  files. On failure → backoff/retry per Phase 2; the driver's data is never lost.

> Why a server endpoint rather than client insert + client scoring: it keeps scoring server-authoritative
> (drivers can't score), lets the server enforce driver-owns-vehicle, and centralizes the side effects —
> matching the team's API-first invariant. The row shape is otherwise identical to the web insert.

---

## 6. Backend additions (additive)

| Change | Where |
|---|---|
| `POST /api/me/fillups` — driver-scoped capture: validate (shared Zod) → verify vehicle assignment → insert `fuel_transactions` → `scoreWithCascade` | `apps/api/src/routes/` (new `meFillups.ts`), reuse `services/scoring/*` |
| Request/response Zod schema for the endpoint | `packages/shared/src/apiContract.ts` (or `fuel.ts`) — reused by the app |
| Storage RLS: driver may write receipts under their `${orgId}/${vehicle_id}/…` path | `supabase/migrations/0085_driver_receipt_storage.sql` (only if not covered by 0005); add to matrix |
| RLS: confirm driver `insert` on `fuel_transactions` stays scoped to own `driver_id` (Phase 1 `ftxn_insert` tightening) | verified in Phase 1 matrix |

No existing behavior changes; managers/web are unaffected.

---

## 7. File & work breakdown

| Area | File(s) |
|---|---|
| Capture screen | `app/(app)/fillup.tsx`, `src/features/fuel/FillUpScreen.tsx` |
| Form pieces | `src/features/fuel/{VehiclePicker,ReceiptCapture,WarningList,PriceHint}.tsx` |
| Capture logic | `src/features/fuel/useCaptureFillUp.ts` (build → validate → enqueue → optimistic) |
| Receipt | `src/features/fuel/receipt.ts` (expo-image-manipulator resize/compress + file staging) |
| Sync handler | `src/data/handlers/fuelFillup.ts` (upload → `POST /api/me/fillups`) registered in `sync.ts` |
| Shared reuse | import `fillUpInputSchema`, `computeFillUpWarnings`, `derivePricePerGal`, `PAYMENT_METHODS`, `FuelTransaction` from `@fuelguard/shared` |
| API | `apps/api/src/routes/meFillups.ts`; schema in `packages/shared` |
| Migration | `supabase/migrations/0085_driver_receipt_storage.sql` (if needed) + matrix cases |
| Tests | schema-parity (mobile input → same object as web), warning cases, over-capacity gate, idempotent replay, handler upload→post sequence |

---

## 8. Exit criteria

- ☐ Driver logs a complete fill-up **offline**; it appears in recent fills immediately (optimistic).
- ☐ Live `$/gal` and all three warnings fire correctly (same outputs as web for the same inputs — asserted by a shared-fixture test).
- ☐ Over-capacity submit triggers the hard-confirm; confirmed fills are flagged downstream.
- ☐ On reconnect: receipt uploads, `POST /api/me/fillups` inserts + scores, row appears in the manager dashboard with an anomaly score.
- ☐ Retried sync does not create a duplicate (idempotency test green).
- ☐ Receipt captured offline is never lost (staged file survives relaunch, uploads on sync).
- ☐ Screen is token-only (lint:tokens green), ≥48pt targets, decimal keypads, Dynamic-Type safe, light + dark.
- ☐ `pnpm -r typecheck && lint && test` green; new migration in the RLS/storage matrix; API tests for the endpoint.
- ☐ Doc updated with the storage-policy outcome and a verification tally (incl. offline→online capture on iOS + Android dev build, and a fill visible in the web dashboard).

---

## 9. Risks & mitigations

- **Scoring silently skipped for drivers** (the web's 403 trap) → capture goes through the new
  driver-scoped endpoint that scores server-side (D5); a test asserts the fill is scored.
- **Lost receipts offline** → file staged to `expo-file-system` before confirmation; deleted only after a confirmed upload.
- **Domain drift web↔mobile** → both consume the same `@fuelguard/shared` schema/warnings; a fixture test asserts identical outputs.
- **Duplicate fills on flaky networks** → client-UUID PK + upsert-on-id (idempotent); asserted.
- **Wrong-driver/vehicle attribution** → `driver_id` is server-resolved via `auth_driver_id()`; the endpoint verifies vehicle assignment; RLS backs it.

---

## Sources

`apps/web/src/features/fuel/{FillUpForm.vue,useFuelLog.ts,imageCompress.ts}`,
`apps/web/src/pages/FuelLogPage.vue`, `apps/web/src/lib/uuid.ts`; `packages/shared/src/fuel.ts`
(`fillUpInputSchema`, `computeFillUpWarnings`, `derivePricePerGal`, `PAYMENT_METHODS`);
`apps/api/src/routes/transactions.ts` + `services/scoring/*` (scoring, manager-gated today);
`supabase/migrations/0005_storage.sql`, `0004_rls.sql` (`ftxn_insert`); Phase 1 `auth_driver_id()` +
driver-scoped RLS; Phase 2 outbox/sync engine; Expo image-picker / image-manipulator / file-system / crypto.
