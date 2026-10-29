# Handoff — Tablets: DE2b (the screens), then release (2026-10-29)

**Goal of this chat: finish the tablet feature and release it.** The owner's words (2026-10-29): *"finish
everything related to tablets first"*, then *"proceed as proposed … we will push these PRs to release
immediately after we finish."* This file is untracked in the main tree; commit it with DE2b's PR.

## Read first
1. This file.
2. Memory `maintenance-section-redesign-position.md` (entries M9c and "DE2 split" at the end).
3. `docs/plans/maintenance/DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md`: D-DE1–D-DE8, §3 DE2, and the §6 log's
   last two entries (DE2a + the owner's ruling).
4. `docs/DESIGN-SYSTEM-CONTRACT.md` §9 (phone/tablet rules 1–9).

## Where we are
| PR | Step | State |
|---|---|---|
| #1825 | **M9c** camera fallback: Add equipment → *Use the camera*; Scan page camera button; UPC-A read as 12 digits; Scan page 48 px touch floor | **merged** (67a1052) |
| #1826 | **DE2a** API only: driver holder end to end, not-returned, Held-by write, D-DE4 kit, duplicate-IMEI 409 | merged if its CI went green — check `gh pr view 1826`; if still open and green, merge it (`gh pr merge 1826 --merge --delete-branch`), then `git worktree remove ../FuelGuard-de2` |

**Owner ruling (recorded in the plan):** the Tablet type IS driver-held (D-DE1). It is flipped **once, by the
owner, through DE2b's Held-by setting** — no migration, no catalogue change. `inventoryKitCatalogue.ts`'s
Tablet line stays a kit line; D-DE4 counts it through the truck's driver.

## What DE2a gives you (API, all on main after #1826)
- `AssetDto.holder.kind` can be `"driver"`: `id` = driver id, `label` = driver's full name,
  `notReturned: true` when that driver is `inactive`/`terminated` (`driverHasLeft`, `DRIVER_LEFT_STATUSES` in
  `packages/shared/src/inventoryDriverHeld.ts`). `inferredDriverName` stays the truck-inference only.
- `HOLDER_KINDS` / `HOLDER_KIND_LABELS` include `driver` ("Driver").
- `GET /api/maintenance/inventory/assets?driverId=<id>` → a driver's tablets.
  `?notReturned=true&limit=1` → `total` is the **Tablets not returned** count (made by the database).
- `POST /assets/move` with `toDriverId` = **Give to driver** (reason `assigned`); with `toLocationId` =
  **Return to shop** (reason `removed`). Refusals arrive as sentences: `IV025` (wrong kind of holder, 409),
  `IV012` (driver not active/on leave, 422).
- `PATCH /asset-types/:id` accepts `heldBy: "unit" | "driver"`; a switch while things sit with the other kind
  of holder → `held_by_conflict` 409 with "move them first" wording.
- Movement DTO ends can be `kind: "driver"` (label null — resolve names on the screen, like the others).
- `listUnitKits`/`getUnitKit` count a truck's assigned driver's tablet and name the driver; so M7's
  "Tablet (Dana Reyes)" wording and the M9b type prefill (needs exactly ONE driver-held type) come alive
  as soon as Tablet is flipped.

## DE2b — the screens (one PR, no migration)
Branch `claude/inventory-de2b-tablet-screens` from origin/main **after #1826 is merged**.
1. **Types of equipment** (`features/inventory/AssetTypesDrawer.vue`): a *Held by* choice per type —
   "A truck, trailer or the shop" / "A driver (tablets)" — through `useAssets.ts`'s update mutation.
   Show `held_by_conflict`'s message as the error. Read it from the type, never the name.
2. **Give / Return** (`AssetMoveDrawer.vue`, opened from the asset page and the Scan card):
   - a `heldBy: "driver"` type offers **Give to driver** (a driver picker: active + on_leave only) and,
     when a driver holds it, **Return to shop** (stock location picker, default the crib);
   - a `unit` type keeps today's truck/trailer/location choices and never offers a driver;
   - client-generated movement id per open (D-INV27) — the drawer already does this; keep it.
   - Find the existing driver picker/select component before writing one (memory `reuse-shared-ui-dont-replace-it`).
3. **Holder display everywhere it is read**: `ScanResultCard.vue` `holderLine` ("Dana Reyes's tablet"),
   `EquipmentInventoryPanel.vue`, `AssetDetailPage.vue` ("With Dana Reyes since 10/29/2026"), and a
   **Not returned** badge (`StatusBadge`/`BADGE_BASE + toneClass`, danger tone) where `holder.notReturned`.
4. **Scan page** (`/shop/scan`): a driver-held tablet's card names the driver and offers **Return to shop**.
5. **Equipment page**: a *Tablets not returned* count (from `?notReturned=true&limit=1` → `total`, never a
   page total) — a filter/count on the Inventory tab that lists them, matching how the page does counts.
6. **Driver page** (`pages/DriverDetailPage.vue`, gated by section `roster`): an **Equipment** card — the
   driver's tablets (display no., name, IMEI tail, since when) + *Not returned* badge.
   ⚠ The assets API needs `maintenance: view`. Show the card only when `session.can("maintenance")` —
   that reads the section matrix (not a workaround). Feature boundary: the driver page may not import
   `features/inventory` internals (`lint:boundaries`) — fetch through a small composable outside the
   inventory feature or a shared component, as M8 did with `lib/shelfCounting.ts`.
7. After merging: the **owner flips Tablet to "A driver"** in Types of equipment (staging first). Check the
   M9b prefill picks Tablet on an IMEI scan and On trucks reads "Tablet (driver)".

## Then release
- Order: #1825, #1826, DE2b all on main → release. Use memory `release-on-owner-go` (release-candidate →
  owner approves in the console → `release.yml` dispatch; check the AWS/Railway state in memory
  `aws-migration-position` first — production hosting moved; follow what it says). No migration in any of
  the three PRs (0527 already shipped with M9a — confirm with `pnpm verify:live`).
- After the release: `pnpm verify:live`; the owner's M5 pass in the shop (real tablet, Tera, printer, camera).

## How to work (traps from M9c / DE2a)
- Worktree: `git worktree add -b claude/<topic> ../FuelGuard-<name> origin/main`; `pnpm install
  --frozen-lockfile && pnpm --filter @silvicom/shared build:rn`; copy `apps/web/.env` + `apps/api/.env`.
- Gates: `git add` first, then `pnpm ci:local --job gates` (43 steps) and `--job bundle` (builds + e2e:apply);
  `pnpm typecheck`; check `$?`. Suites one at a time, never beside a build: `CI=true npx vitest run` in
  packages/shared, apps/api, apps/web.
- **File budget:** `inventoryContract.ts` (498) and `inventoryAssetContract.ts` (495) are at the 500 limit —
  new shared inventory code goes in a new file.
- Prove each new test fails by mutating the source (script pattern: copy → replace → run → `cp` back →
  hash check). A green mutant means the test is wrong.
- `supabaseRecorder` applies no filters — function fixtures that honour `.eq/.in/.is/.not`.
- Browser pass on the built app: `cd apps/web && VITE_DEV_BYPASS=true node scripts/preview-local.mjs --port 44xx`
  (background; port from the END of the log; restart it after any `pnpm build`, which overwrites its dist).
  Playwright with ONE `ctx.route` on `/\/(api|rest\/v1|auth\/v1|storage\/v1)\//` returning raw JSON —
  stub `/api/maintenance/inventory/units` (`{units:[],total:0}`), `kit-expectations` (`{expectations:[]}`),
  `/api/me/notifications`, `/rest/v1/*` (`[]`) or the Equipment page shows the error boundary.
  `hasTouch:true, isMobile:true` at 390×844 and 834×1194; listen on `console` + `pageerror`; Tera =
  `keyboard.type(code, {delay:5})` + Enter. Camera: Chromium `--use-fake-device-for-media-stream
  --use-file-for-fake-video-capture=<mjpeg>`. Commit screenshots in `docs/plans/maintenance/screenshots/`.
- An overlay opened from inside a drawer goes in the drawer's slot (Escape). A new Teleport into a layout
  target needs `defer`. HeadlessUI Dialog draws its panel a tick after mount.
- PR: title an office-reader sentence; body = the four template headings via `--body-file`; repo slug is
  `miroslav-jokovic/fuel-guard` (raw screenshot URLs). Append to the plan §6 and proposal §8 logs at the
  END. Merge yourself when green, remove the worktree, update memory + the `MEMORY.md` line.
