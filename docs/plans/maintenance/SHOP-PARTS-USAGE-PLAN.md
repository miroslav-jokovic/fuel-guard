# Shop parts — from a catalogue to what the shop actually goes through

Status: **building** (owner, 2026-11-03: "analyze and plan this and let's start with implementation as
proposed … production ready, reliable and precise … easy to use without unnecessary complications").
Follows M8 (`MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md` §7a — Shop parts is FleetPal's, read-only).

## 1. What is wrong today (measured on production, 2026-11-03)

| Fact | Number |
|---|---|
| Catalogue parts (all from FleetPal, F12) | 3,560 |
| …with a manufacturer / category / last cost | **0 / 0 / 0** |
| …used on a repair in the last 90 days | 392 (11 %) |
| FleetPal PART lines on repairs (03/2025 → today) | 15,934 — every one has a job, a work order and a unit |
| …naming a part in our catalogue | 11,862 (the other 4,072 are vendor quote lines with no number — F12b skips them on purpose) |
| …whose work order is linked to one of our trucks/trailers | 15,558 |
| …with a manufacturer number different from the shop's part number | 10,193 |
| …with a barcode (`universal_product_code`) | 337, on 2 parts — **not a usable barcode source** |
| Purchase orders whose vendor resolves to a name | 153 of 4,311 — **not a usable "bought from"** |

So the page showed two blank columns, a "· From FleetPal" tag on every row the header already
explained, and 3,560 rows in part-number order, of which nine in ten are never used. It answered none of
the questions a shop asks: *what do we go through, what did we pay last time, which truck did it go on,
is this the same truck again?* The data to answer them was staged since F6 and read by nothing.

## 2. Decisions

- **D-SPU1 — Default view = parts used in the last 90 days, most used first.** "All parts" is one
  filter away. A mechanic searching finds the 392 parts the shop uses, not the 3,168 it never fitted.
- **D-SPU2 — One use = one (part, work order).** A PART line naming a FleetPal part, on a work order
  that is not CANCELED. `Repairs` counts distinct work orders (a brake job enters each shoe kit as its
  own line — 311 lines on 93 work orders). Quantity is the sum of the lines.
- **D-SPU3 — The date of a use is the repair's date**: work order `completed`, else `started`, else the
  line's creation.
- **D-SPU4 — SUPERSEDED by D-SPU10 (2026-11-03).** ~~No prices on screen until the owner rules (Q-SPU1).~~ D-FP4: "every surface printing
  FleetPal money also prints its coverage ratio; a page that cannot compute the ratio does not print
  the cost". A part's unit price is FleetPal money, and the truck page already declines to show any
  for the same reason (`UnitRepairsSection.vue`). So the API drops the prices 0557 measures, and the
  list offers no price sort. 0557 keeps measuring them (last price; 12-month median, low, high; credits
  ≤ 0 excluded), so showing them later is a DTO field and a column, not a new read.
- **D-SPU5 — SQL measures, TypeScript judges.** `shop_part_history` returns the days since the same
  part went on the same unit; "again within 30 days" is `REPEAT_WITHIN_DAYS` in
  `packages/shared/src/shopPartsUsage.ts`, and the badge sits beside the unit it is about.
- **D-SPU6 — Columns that are always blank are removed** (manufacturer, category), and "From FleetPal"
  is said once, in the header. Only a hand-typed part (from before F12) is labelled, as "Added here".
- **D-SPU7 — Search covers the manufacturer's number** printed on the box, not only the shop's own
  part number; LIKE wildcards typed by a user are literal.
- **D-SPU8 — Not built (and why):** "bought from" (vendor names do not resolve, §1); barcode search
  from repair lines (no barcodes, §1); a "fix in FleetPal" list (the no-number lines are vendor quote
  lines nobody can renumber; the 7 duplicate numbers and 20 unmapped units are too few to need a
  screen); shelf counting stays off (Q-MX8 unchanged).
- **D-SPU9 — Same gate as the catalogue** (`maintenance` view); nothing on these screens is more
  sensitive than a truck's repair record.

- **D-SPU10 — Unit prices are shown; money is never summed** (owner, 2026-11-03, answering Q-SPU1:
  "we can show everything"). To everyone who can open Shop parts. List: Last price (sortable). Part
  page: last price, typical (12-month median, only on ≥ 5 priced repairs), 12-month range; each repair's
  price each, and "Well above usual" at ≥ 1.5 × typical. Narrows D-FP4 for unit prices on this surface;
  D-FP4 still governs every FleetPal TOTAL.
- **D-SPU11 — Nothing drawn over nothing** (owner, 2026-11-03: "let's not have empty rows and columns
  if data does not exist"). A list column every row on the page leaves empty is not drawn (shared
  `columnsWithData` in `@silvicom/ui`; a usage count of 0 counts as empty); part number and
  description always are. A fact with no value is not listed (no "None", "Never", "0 in 12 months"); a
  part no repair order named gets one sentence and no "Where it went" table.

## 3. Steps

| Step | What | Merge |
|---|---|---|
| SP-U1 | Migration 0557: `shop_part_uses`, `shop_parts_list`, `shop_part_summary`, `shop_part_history` + matrix `shop-parts-usage.test.mjs` | 1st (alone — a function's reader is held behind it) |
| SP-U2 | API: `GET /inventory/part-usage` (its own mount — the pickers keep `GET /inventory/parts`) reads `shop_parts_list`; `GET /inventory/parts/:id/usage` (summary + paged history), both through fleetpal's index. Shared contract `shopPartsUsage.ts`. Web: Shop parts list (Show filter, server-sorted columns, phone cards), part page "How much the shop uses it" + "Where it went" with the repeat badge | 2nd, after migrate-staging applies 0557 |
| SP-U3 | Prices (D-SPU10) and no empty columns or facts (D-SPU11) — no migration, 0557 already returns prices | 3rd |

## 4. Open questions

- **Q-SPU1 — ANSWERED 2026-11-03: show everything → D-SPU10.** May a part's UNIT price show without the coverage ratio? D-FP4 was written against
  cost TOTALS ("FleetPal knows what the shop spent through FleetPal; a total read as the whole bill is
  the plausible-but-wrong number"). A unit price ("$43.12 per shoe kit, typical $43.10") cannot be read
  as the maintenance bill, and it is what an office orders by. Candidates: (a) allow unit prices
  (last, typical, low–high) and a "well above usual" badge on a repair (≥ 1.5 × a median standing on ≥ 5
  repairs), never a sum; (b) allow them only for admin and fleet manager; (c) keep D-FP4 literal.
  Recommendation (a). Until ruled, no price is sent or shown (D-SPU4).
- **Q-SPU2 — Repeat window.** 30 days is a starting value. Tires legitimately go on the same trailer
  twice within 30 days (different wheel positions), so a "Again after 12 days" badge on a tire is a
  fact to look at, not an accusation; the wording says so.

## 5. Progress log

- 2026-11-03 — Plan written from production measurements; SP-U1 built (migration 0557, matrix 52
  checks, two mutations caught: dropping the CANCELED filter, unescaping LIKE). The list query took
  190 ms on production with a search (EXPLAIN ANALYZE, read-only).
- 2026-11-03 — SP-U1 PR opened (migration 0557). SP-U2 built on a stacked branch. Prices taken OUT of
  SP-U2 on finding D-FP4 forbids FleetPal money without coverage (the truck page shows none for the
  same reason); recorded as Q-SPU1. Browser pass on a local build with production-shaped data at
  1280 and 390 px: the phone card read a bare "311", so a card-only " used" suffix was added, and an
  empty Note column drew a dash under every history card, so the repeat badge moved beside its unit.
  Pre-existing, not this step's: on a part's page the sidebar lights both Shop and Shop parts.
- 2026-11-03 — SP-U2 merged. Owner: "We can show everything, also let's not have empty rows and
  columns if data does not exist" → D-SPU10, D-SPU11, SP-U3 built. Browser pass at 1280 px: with Last
  price added, the list ran off the right edge — descriptions now wrap (`:nowrap="false"`), figures and
  dates do not. Mutations: a `columnsWithData` that keeps every column fails 2 tests; a well-above
  rule of "any price above typical" fails 1.
