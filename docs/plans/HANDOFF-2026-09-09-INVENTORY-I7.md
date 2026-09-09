# Handoff — shop inventory, 2026-09-09 (second)

For whoever picks up **I7**. Written at the end of the session that built I4 and the whole of I5,
and that ruled Q9.

The plan is `docs/plans/maintenance/INVENTORY-PLAN.md` and it is the memory between sessions — §8 is
a dated progress log with every deviation and every measurement in it. **Read §8's last five entries
before writing anything**; this file is the map, not a replacement for them. The earlier handoff,
`HANDOFF-2026-09-09-INVENTORY.md`, is the map as it stood before I4 and is kept as a record.

---

## Where it stands

**Everything through I5 is merged. Zero open PRs. Migrations through 0332, applied in production.**

| Step | State | PR |
|---|---|---|
| I0 governance · I1 contracts · I1b `@silvicom/qr` | merged | #684 / #685 / #686 |
| I9's prerequisite `listEquipmentIdentities` (out of order) | merged | #688 / #689 |
| I2 schema + service — migration 0331 | merged | #691 |
| I3 the API, mounted | merged | #692 |
| Review of I0–I3 — five defects | merged | #693 |
| A3 answered + the FleetPal path audited | merged | #694 |
| **I4** the shop home and Parts | merged | #696 |
| `FilterBar` count labels singular at one (not a plan step) | merged | #697 |
| **I5 PR 1** the count session — migration 0332 | merged | #698 |
| **I5 PR 2a** count-session routes + the four desk verbs | merged | #699 |
| **I5 PR 2b** the count on the phone | merged | #700 |
| **I7** assets schema and service | **proposed next** | — |

## Why I7 next, and not I6

I6 is the scanner and it is the more exciting step. It should nonetheless wait, for a reason that is
about scheduling rather than about the work:

**I6 opens with a spike on real phones and cannot be finished without one.** Its done-when requires a
printed `SIL1:BIN:…` decoded on one iPhone in Safari, the same iPhone installed to the home screen,
and one Android Chrome, with permission-prompt counts recorded per device (A1, and A2's phone half).
Nobody has been to the shop. Starting I6 means building to a spike's result that does not exist.

**And the same visit closes two other things.** I5's usability sentence — a 20-bin count on a phone
with one thumb, blind, signed by a named person — is still open, and A2's phone-and-wifi half is
still unmeasured. One trip settles the I6 spike, I5's signature and A2 together. Arranging that trip
is worth more than starting I6 blind.

**I7 is unblocked, and it is the last big schema step.** I8, I9 and I10 all queue behind it: assets
have no API without it, units have no kit without assets, and labels have nothing to print. It needs
nothing from the shop and nothing from the owner. Doing it while the visit is arranged is the only
sequencing that does not idle.

⚠ **I7 carries a migration**, so the deploy-window rule applies: a merged migration IS a deployed
migration, and a merge is SERVED about three minutes before its schema is APPLIED. New TABLES are
exempt (`lint:migration-ordering`), which is what I7 is — four of them.

## What I7 is, in one paragraph

`asset_types`, `inventory_assets`, `asset_movements`, `kit_expectations`, the `move_asset` RPC and
`rebuild_asset_holders`, plus the service. §5's I7 has the column lists and the four SQLSTATEs
(`IV020`–`IV023`). It is the ASSET half of §2.1's seam: a case of filters is stock and eleven of them
are interchangeable; a tablet is A-0412, in truck 654 and in 611 before that, and when it goes missing
the question is which one and from where.

**Two things I5's migration teaches it, and they are not in the step text:**

1. **A holder FK does not carry the org.** 0332's own matrix found that a session in org A could name
   org B's bay: the three holder columns reference `id` alone, because `stock_locations`, `vehicles`
   and `trailers` carry no `(id, org_id)` unique constraint to point a composite key at. Every CHECK
   and every FK passed. `inventory_assets` has the SAME three holder columns and needs the same
   guard — a `security definer` trigger with an empty `search_path`, on `record_part_movement`'s
   model. **This is the third time in this programme that a guarantee assumed to come from a foreign
   key had to be written explicitly.**
2. **A BEFORE trigger runs ahead of the CHECK constraints.** 0332's holder guard first answered "is
   this null trailer ours" for a row whose actual fault was naming no place at all, and reported
   `IV012` for it. Let the CHECK own "exactly one"; the trigger only answers "does the named thing
   belong to us".

## What exists to build on

- **Four tables** (0331) and **`stock_count_sessions`** (0332). `record_part_movement` is the only
  writer of `part_stock.quantity_on_hand`; closing a walk is one-way (`IV017`).
- **The API**, mounted at `/api/maintenance/inventory/…`: parts, locations, stock, low-stock,
  movements, `PATCH /stock/:partId/:locationId`, the six verbs, and `count-sessions`
  (list · one · open · `:id/close`).
- **The web**: `/shop` (home), `/shop/inventory` (+ detail), `/shop/repair-spend`,
  `/shop/count/:sessionId`. `ShopLayout` exists for the phone screens — I6's `/shop/scan` uses it
  as-is.
- **`@silvicom/qr`** — encoding and label geometry, still unused until I10.
- **`components/ui/QuantityStepper.vue`**, **`composables/useWakeLock.ts`**, and
  **`features/inventory/countQueue.ts`** (IndexedDB, tested against `fake-indexeddb`). I9's unit check
  is I5's session shape against a different holder and should reuse all three.

## The traps this programme has paid for

- **Three false-passing assertions, all found by mutation, all the same shape:** a fixture too uniform
  to discriminate between the code and its opposite. I1's zod key-stripping; 2a's two submits landing
  in the same millisecond; 2b's "written down before it was sent", which passed equally against a
  screen that wrote it down only when the send FAILED. **Mutate every assertion that describes an
  ORDER or an IDENTITY, and if it still passes, the assertion is the thing that is wrong.**
- **A comment claiming a hazard that measurement denies is worse than no comment.**
- **`supabaseRecorder` does not filter** — `.eq()` is recorded, not applied. Function fixtures or
  `pages`, or a flat array answers two questions with one set of rows.
- **zod STRIPS unknown keys.** To prove a field cannot reach the database, assert on what was WRITTEN.
- **`rls.test.mjs` FAILS on an unseedable table** — `inventory_assets` will need a `handSeed`, because
  its holder columns and its unique `tag_code` defeat the generic synthesiser exactly as
  `stock_count_sessions` did. Coverage is 135 tables, 0 unseedable, 0 leaking; keep it there.
- **A fresh worktree needs `pnpm install` + `build:rn` + two `.env` files**, or ~14 suites fail for
  reasons that are not your change.
- **Run all 38 `lint:*` scripts before pushing**, not the 28 CI names.
- **`git branch --show-current` before every commit.** This session wrote all of I5 PR 2b on a
  detached HEAD and caught it at the commit, not before.

## Open, and who owes them

| Item | Owed by | Blocks |
|---|---|---|
| I5's usability sentence — a 20-bin count, one thumb, blind, named person | a shop visit | I5 closing |
| **A1 / A2** — the decoder on real phones, the bay wifi | the same visit | **I6** |
| **A4** — three kit lists (tractor, dry van, reefer) | the owner | I9 |
| **A5** — the label printer and stock the shop owns | the owner | I10 |
| **A6** — confirm `work_order.completed` on the real FleetPal account | the owner | I14 depending on it |
| The driver release lanes, still `action_required` | outside this plan | I13 |

## Owed work recorded in §8, attached to no step

- **The repair-spend sum.** `/api/maintenance/spend` returns a page and a row count and no total, so
  the home card counts LINES. Adding the dollars up client-side would stop at fifty rows and be
  believed — the exact defect the I0–I3 review found in `/low-stock`. A sum belongs in that endpoint.
- **Photo upload on a part.** The route exists (`POST /parts/:id/photo`, a signed upload URL) and no
  screen calls it. Found at 2a while declining to put a photo control on the Receive drawer, which
  writes a different entity.
- **The CSV import escape hatch** (A3's manual path) needs a bulk endpoint the API does not have.
- **`work_order_ref` has no index** — owed at I14 and not before, because nothing reads it yet.
- **`listParts`' search interpolates into a PostgREST `.or()` without escaping.** The house pattern
  across four call sites; fixing one leaves three looking correct by comparison.
- **`AppBadge` carries `capitalize`**, so any two-word badge label title-cases on screen while reading
  correctly in the source. Use one word, or fix the primitive for all of its callers.
