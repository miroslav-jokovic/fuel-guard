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
- **D-SPU4 — Prices are unit prices only, never totals of money.** Last price = the latest priced use;
  typical = the 12-month median. Credits (price ≤ 0) count in quantity, never in a price. A per-part
  spend total would be a FleetPal cost figure without its coverage bound, which D-FP4 forbids.
- **D-SPU5 — SQL measures, TypeScript judges.** `shop_part_history` returns the days since the same
  part went on the same unit; "came back within 30 days" is `REPEAT_WITHIN_DAYS` in
  `packages/shared/src/shopPartsUsage.ts`. A price "well above usual" is judged there too, and only
  when the typical price stands on at least `TYPICAL_PRICE_MIN_REPAIRS` repairs.
- **D-SPU6 — Columns that are always blank are removed** (manufacturer, category), and "From FleetPal"
  is said once, in the header. Only a hand-typed part (from before F12) is labelled, as "Added here".
- **D-SPU7 — Search covers the manufacturer's number** printed on the box, not only the shop's own
  part number; LIKE wildcards typed by a user are literal.
- **D-SPU8 — Not built (and why):** "bought from" (vendor names do not resolve, §1); barcode search
  from repair lines (no barcodes, §1); a "fix in FleetPal" list (the no-number lines are vendor quote
  lines nobody can renumber; the 7 duplicate numbers and 20 unmapped units are too few to need a
  screen); shelf counting stays off (Q-MX8 unchanged).
- **D-SPU9 — Prices are shown to whoever can open Shop parts** (`maintenance` view), the same gate as a
  truck's repair record, which already shows line prices. See Q-SPU1.

## 3. Steps

| Step | What | Merge |
|---|---|---|
| SP-U1 | Migration 0557: `shop_part_uses`, `shop_parts_list`, `shop_part_summary`, `shop_part_history` + matrix `shop-parts-usage.test.mjs` | 1st (alone — a function's reader is held behind it) |
| SP-U2 | API: `GET /inventory/parts` reads `shop_parts_list` (window, used-only, sort); `GET /inventory/parts/:id/usage` (summary + paged history). Shared contract + verdicts. Web: Shop parts list (filter, sortable columns, phone cards), part page "Use" card + "Where it went" table with repeat and price badges | 2nd, after migrate-staging applies 0557 |

## 4. Open questions

- **Q-SPU1 — Should mechanics see prices?** Today anyone who can open Shop parts can (D-SPU9).
  Candidates: (a) keep; (b) a separate surface for prices; (c) admin/fleet manager only.
  Recommendation (a) until the owner says otherwise — the truck page already shows them.
- **Q-SPU2 — Repeat window.** 30 days is a starting value. Tires legitimately go on the same trailer
  twice within 30 days (different wheel positions), so a "Again after 12 days" badge on a tire is a
  fact to look at, not an accusation; the wording says so.

## 5. Progress log

- 2026-11-03 — Plan written from production measurements; SP-U1 built (migration 0557, matrix 52
  checks, two mutations caught: dropping the CANCELED filter, unescaping LIKE). The list query took
  190 ms on production with a search (EXPLAIN ANALYZE, read-only).
