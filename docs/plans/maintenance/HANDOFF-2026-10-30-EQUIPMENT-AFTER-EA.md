# Handoff — Equipment after assign-by-scan: invoices, release, the shop pass, truck labels (2026-10-30)

**Where this starts:** the owner's brief of 2026-10-30. Tablets belong to drivers and everything else to
trucks; equipment is assigned by scanning it from the truck's or driver's own page; Equipment lists
trucks and drivers in separate tabs; the QR labels are there so anything can be scanned, both to
assign it and to inspect it. All of that is **built and merged** (EA1–EA4). This file is what comes
next, in order.

Read first:
1. This file.
2. `docs/plans/maintenance/EQUIPMENT-ASSIGN-BY-SCAN-PROPOSAL.md`: §3 (design), §4 (decisions it overruled), §6 (Q-EA1..5, all ruled as recommended), §7 (progress log, at the END).
3. Memory `driver-equipment-unit-tags-position.md`, from its "2026-10-30" section.
4. `docs/plans/maintenance/HANDOFF-2026-10-29-MAINTENANCE-TABLETS.md` → "How to work". Its setup, gates, test and browser-pass traps all still hold.

## 1. What is on main (`b432820`, all on staging; production has NONE of it yet)

| PR | Step | What shipped |
|---|---|---|
| #1847 | EA1 | Truck, trailer and driver pages get `HolderEquipmentCard`: **Assign equipment** (drivers: **Give a tablet**) and **Return to shop**. The shop's truck page gets the same card. `AssignEquipmentDrawer` is a scan list. `assignLine.ts` (`judgeScan`, `holderPartner`) refuses the wrong holder and offers the right one: a tablet on a truck becomes "Give to <driver> instead". Confirm loops `POST /assets/move`, one movement id per line, minted when the line is scanned (D-INV27). |
| #1848 | EA2 | Equipment tabs are `?tab=trucks\|drivers\|shop`. M7's `on-trucks` and `inventory` redirect. API: `GET /assets?holder=shop\|driver`. **`KIT_RULES_SHOWN = false`** (`packages/shared/src/inventoryKitShown.ts`) hides all of "Should carry", including the shop worklist's "missing equipment" reason (`unitAttention.ts`). |
| #1849 | EA3 | The unit check takes the scanner (`useCheckScan.ts`): a scan ticks an item; a stray offers *Move it here* (`found`). **Close reports whatever was not ticked as `reported_missing`**, after a dialog that says how many. The card gets *Check equipment* (`useStartUnitCheck.ts`). |
| #1850 | EA4 | The Scan page's equipment card offers **Open <holder>** and **Return to shop** (`useReturnToShop.ts`, the one Return), plus Report. The old Move list is gone. |

**Data fix, production, 2026-10-30:** asset type *Tablet* (`a3bb2027-…`, org `86d6b3ea-…`) had
`default_kit_quantity = 200`, which is the fleet's tablet count typed into "how many a truck carries".
The owner asked for it to be reset, and it is now **0** (one `UPDATE`, scoped by id, org and old value).
**Staging was not touched**: the CLI is linked to production. Add one line to the proposal's §7 log
saying so in the first PR.

## 2. The work, in order

### Step 1 — Land M10b (equipment invoices) on top of EA

- **Where it is:** built by another session, **committed locally only**: branch
  `claude/equipment-invoices-m10b` at `3c0ebaf`, worktree `~/Projects/FuelGuard-m10b`, based on
  `2cd5f96`. **Not pushed, no PR.** Migration `0530` (M10a, #1839) is already on main.
- **What it adds:**
  - an **Invoices** tab on Equipment (`EquipmentInvoicesPanel`, `InvoiceDrawer`, `InvoiceDetailDrawer`, `usePurchases.ts`);
  - `inventoryPurchases.ts` routes;
  - `inventoryPurchaseContract.ts`;
  - an item's invoice line on its asset page.
- **The rebase will conflict where EA2 rewrote the same places:**
  - `apps/web/src/pages/AssetsPage.vue`: M10b adds `{ value: "invoices" }` beside M7's `on-trucks`/`inventory`. On main the tabs are `trucks`/`drivers`/`shop`. Keep EA2's three, add Invoices as the fourth, and keep M10b's tab-dependent verb (*Add invoice* on Invoices, *Add equipment* elsewhere). It touches `EquipmentInventoryPanel`'s old `v-else`: that panel is now the `shop` tab.
  - `apps/web/src/pages/EquipmentPage.test.ts`: main's version has 12 tests built around the three tabs and the live `KIT_RULES_SHOWN` getter; merge M10b's invoice tests into it.
  - Possibly `apps/api/.../routes/inventoryAssets.ts` (EA2 added `holder`) and `UnitDetailPage.test.ts`.
  - The proposal logs (`MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md` §8): keep both entries.
- **Rebase safely:**
  - `git rebase origin/main` in that worktree. Never `git stash pop`. Never push during a stopped rebase.
  - Commit hooks rebuild the code graph, so each commit in a rebase takes about a minute. Run the rebase in the background.
  - After resolving, `git grep -nE "^(<<<<<<<|>>>>>>>) "` must be empty.
- **Then the full gate list:**
  - typecheck, every `lint:*` in `ci.yml`, and web `lint:tokens`;
  - full web, api and shared suites, one at a time. **grep the log for `Errors|Unhandled`, not just `FAIL`**: CI fails on an unhandled error that a passing local summary hides (it cost EA1 one CI round);
  - a browser pass of the Invoices tab at 390 and 834 px.
- **Four tabs on a phone:** at 390 px the tab strip already scrolls (`AppTabs` always does), and with EA2's three the third was behind a swipe. With four, measure it. If two tabs are hidden, say so in the PR and offer the owner shorter labels (for example "Trucks", "Drivers", "Shop", "Invoices"). Don't rename without asking: the glossary is the owner's (`MAINTENANCE-SECTION-REDESIGN-PROPOSAL` §4.4).
- PR title, office register: "Equipment gets an Invoices tab …". Merge yourself when green.

### Step 2 — Release

Production has none of EA1–EA4 (nor M10b, M9 tablets #1834, or the hazmat PRs since `2cd5f96`).
Release candidate **#1846** is open (main → production). It goes out only on the **owner's** approval
in the console, then the owner dispatches it with `! gh workflow run release.yml --ref main -f mode=nightly`
(memory `release-on-owner-go.md`). Tell the owner what the release carries, in office words:

- assign by scan;
- three Equipment tabs, plus Invoices if Step 1 lands first;
- checks by scan, where closing a check reports the unscanned items missing;
- the Scan page card.

**Do not approve or dispatch it yourself.**

### Step 3 — M5: the owner's pass in the shop (the owner does it; you prepare it)

The owner runs it on the **real Android tablet and a phone**, with the **Tera Pro scanner** and the
**MUNBYN label printer**, on staging (or production after Step 2). Write a one-page checklist into
`MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md` §8 (M5 has waited for this since M8), with each line
something to do and what should happen:

1. *Types of equipment*: confirm *Tablet* is "A driver" and that straps, load bars and the like exist as types.
2. **Add equipment** (Equipment → *Add equipment*): scan the sticker on a tablet's back, then *Save and add another*; add two straps.
3. **Print labels**: Labels → roll stock → print each item's label and stick it on.
4. **Give a tablet**: a driver's page → *Give a tablet* → scan it → *Give 1*. It appears on the Drivers tab.
5. **Assign to a truck**: a truck's page → *Assign equipment* → scan two straps and the tablet. The tablet line offers "Give to <driver> instead". Press *Assign*.
6. **Check the truck**: the truck's page → *Check equipment* → scan one strap only → *Review* → *Close*. The dialog says 1 will be reported missing.
7. **Return**: the Scan page → scan a strap → *Return to shop*. It moves to the In the shop tab.
8. On each screen, note anything unclear, slow, or too small to tap with a glove.

Findings go in proposal §8. Fix them in small PRs. Each one gets a browser pass.

### Step 4 — Truck and trailer QR labels (DE3–DE4) — Q-DE2 ANSWERED 2026-10-30: cab labels on the roll we have

This completes the owner's "scan anything" idea: **scan the truck's label → its Assign list opens →
scan the items → Confirm**, with no screen navigation. It was parked on 2026-10-27 behind two things:

- **Q-DE2, what the label is made of.** Exterior plates were to be ordered later, and direct-thermal labels fade outdoors.
- **Q-DE3, the trailer page.** **Q-DE3 is now settled**: `/trailers/:id` exists and carries the equipment card.

**The owner answered on 2026-10-30: "yes, cab labels on the roll we have".** That is Q-DE2 option (a): a label
inside the cab (door jamb, out of the sun) on the 2"×2" direct-thermal roll (`roll-single`). Option (b),
exterior plates, stays the long-term answer and is ordered later. Record the ruling in
`DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md` §4 (the Q-DE2 row) and §6 (the log) in the DE3 PR. The label
must say where it goes ("Inside cab — driver door jamb"), because direct-thermal fades in the sun.
Trailers have no cab: **the owner answered on 2026-10-30, "trailer labels go inside the front wall"**. A
trailer's label says "Inside front wall"; a truck's says "Inside cab — driver door jamb".

Follow `DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md` §3, steps DE3–DE4:

- **DE3:** a new `unit_tags` table (vehicle or trailer; one live tag per unit). Use the next migration number, and check the number on main AND staging's applied maximum: `migrate.yml` refuses an older file (M10a had to become 0530).
  - Turn RLS on.
  - Add the table to `scripts/table-writers.json`.
  - Regenerate and **commit** `supabase/schema.generated.sql`.
  - Add a behavioural matrix.
  - Don't add columns to `vehicles` or `trailers` (memory `vehicles-status-is-restated-17-times`).
- **DE4:**
  - add `VEH` and `TRL` to `TAG_KINDS` (`tagContract.ts`), with resolvers in `apps/api/src/tags/`;
  - add label printing for units (Labels page);
  - scanning a unit tag on the Scan page opens that truck or trailer;
  - **DE5 — APPROVED by the owner 2026-10-30 ("yes, build DE5 too"):** scanning a unit tag inside the Assign list or a check switches the target to that unit. It is new and not in the DE plan; write it into the plan as DE5 (§3 step and §6 log) in its PR. Design notes:
    - lines already scanned keep the holder they were judged against;
    - a switch in the Assign list says so on screen ("Now assigning to Trailer 1203");
    - in a check, scanning a different unit's tag offers to start that unit's check rather than silently abandoning the open one (`useStartUnitCheck` resumes an open check, R9).

Q-DE2 is answered and DE5 is approved, so DE3 → DE4 → DE5 run right after Steps 1–3, each as its own PR.

## 3. Facts and traps that will bite

- **The "should carry" layer is hidden, not deleted.** Kit rules, the per-unit override drawer and the standard-kit button are still in the code and tested with a live getter mock of `KIT_RULES_SHOWN` (see `EquipmentPage.test.ts` and `UnitCheck.test.ts`). Any new screen that shows a shortfall must check the switch. EA3's browser pass found one EA2 had missed: the check page's "Not on the list".
- **One judgement for "can this go there":** `assignLine.ts` `judgeScan`, used by the Assign list and the check. The database rule is `IV025` (0524). Don't restate it on a new screen; call `judgeScan`.
- **One Return** (`useReturnToShop`) and **one check starter** (`useStartUnitCheck`). Reuse them.
- `HolderEquipmentCard` reads `vehicles.assigned_driver_id` (`holderPartner`) to show the driver's tablet on a truck. A trailer has no driver.
- **Test traps learned this session:**
  - A page test's shared `STUBS` map stubbed the card for a describe that needed it real. CI then failed on unhandled router errors that local `FAIL`-grep didn't show.
  - A test that flips a module switch must reset it in `beforeEach`, or one failure cascades into the next test.
  - A mutant that **survives** means a missing test. EA3's surviving mutant exposed the untested driver's-tablet scan.
- The Scan page has no `<main>` element (it uses `ShopLayout`), so browser scripts must read `body`. The fleet pages are not phone-first, which is why `AssignEquipmentDrawer` provides its own touch floor (`provideTouchTargets(useTouchedWindow())`).
- Production data on 2026-10-30:
  - 1 type (Tablet, driver-held, default now 0);
  - 2 items, 0 assigned, 0 kit rules, 0 movements;
  - 1 bay;
  - 211 active trucks.

## 4. Paste this into the new chat

```
Read docs/plans/maintenance/HANDOFF-2026-10-30-EQUIPMENT-AFTER-EA.md (on main) and the memory file
driver-equipment-unit-tags-position.md. Then do
§2 Step 1: rebase the local-only M10b invoices branch (~/Projects/FuelGuard-m10b) onto main, where
EA1–EA4 changed the Equipment tabs, and land it as a PR, merging it yourself when CI is green. Then
prepare Step 2's release note for me (do not approve or dispatch the release) and Step 3's shop-pass
checklist. Then Step 4: Q-DE2 is answered (cab labels on the roll we have), so build DE3 and DE4;
trailer labels go inside the front wall (answered). DE5 is approved: build it after DE4.
```
