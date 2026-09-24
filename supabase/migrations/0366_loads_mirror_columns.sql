-- 0366: the columns core needs to show a McLeod load as McLeod has it (LOADS-MIRROR-PLAN.md LR2).
--
-- ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────────────────────
-- `loads` / `load_stops` stay the only thing the harness reads (D-LMR3); 0364 gave the collector its
-- raw copy. What core cannot yet hold is most of what a dispatcher looks at: the real stop name
-- ("BATTERY SOLUTIONS", filled on 332 of 335 live stops — today we compose "CITY, ST" in its place),
-- McLeod's actual arrival and departure (123 / 115), the ETA (159), the stop contact (91), the PO
-- (59), and on the load the customer code (162 / 162), weight (72), pieces (31) and consignee
-- reference (63). Fill rates are the live board of 2026-09-24, §2 of the plan. LR4's projection
-- writes these from raw; LR7's page reads them.
--
-- ── SCHEMA ONLY, AND IN ITS OWN MERGE ────────────────────────────────────────────────────────────
-- These are new COLUMNS on tables pages read today, and Railway serves a merge ~2m44s before
-- `migrate.yml` applies its schema. So nothing names them in this merge (`lint:migration-ordering`);
-- the first writer (LR4) and reader (LR7) follow once production has them, checked from
-- `information_schema`, not assumed from the clock.
--
-- ── NULLABLE, NO DEFAULTS — A MISSING FACT IS NULL, NEVER ZERO ───────────────────────────────────
-- Every column is nullable with no default. A load McLeod has no weight for is not a weightless
-- load, and a stop with no ETA is not due at the epoch. Existing rows read null until the projection
-- runs, which is the truth: nobody has asked McLeod yet. ⚠ McLeod itself stores `orders.weight = 0`
-- on some orders (the open board's minimum on 2026-09-24 was 0 LB); whether a McLeod zero means
-- "none entered" is the projection's ruling to make in LR4, not a default to bake in here.
--
-- ── WHY THESE NAMES, AND NOT McLEOD'S ────────────────────────────────────────────────────────────
-- Raw (0364) keeps McLeod's names; core uses the product's. `weight_lbs` carries its unit because
-- 69 of 69 weighted orders on the open board were `weight_um = 'LB'` — the projection must convert
-- or refuse any other unit (LR4 owes that) rather than let this column mean two things. `loaded` is
-- a boolean here because core states the meaning; raw keeps McLeod's 'L'/'E' letter.
--
-- ── `load_stops.actual_arrival_at` IS NOT `arrived_at` ───────────────────────────────────────────
-- `arrived_at` exists and belongs to the DRIVER APP: it is the phone's own witness. McLeod's actual
-- is a different fact from a different witness — typed by a dispatcher, or stamped by McLeod's
-- tracking — so it gets its own column rather than overwriting the driver's. Which one a page shows
-- is Q-LMR2, open; keeping both is what lets it be ruled either way without losing a fact.
--
-- ── `external_closed_at` ─────────────────────────────────────────────────────────────────────────
-- When McLeod STATED the load done or voided (LR5's close read), never when it left the board —
-- inferring a close from absence is the reconcile that retired 33 vehicles and 120 drivers.
-- `completed_at` stays the driver's delivery; the two can disagree, and both are kept.
--
-- `loads.external_status` already exists (movement status verbatim); `load_stops` gets its own
-- (McLeod's stop `A` open / `D` done), which LR4 needs to tell "dispatched" from "in transit".

alter table loads
  add column if not exists customer_code      text,         -- orders.customer_id; name awaits a grant (Q-LMR5)
  add column if not exists weight_lbs         numeric,      -- orders.weight where weight_um = 'LB'
  add column if not exists pieces             integer,      -- orders.pieces
  add column if not exists pickup_number      text,         -- null until reference_number is granted (Q-LMR5)
  add column if not exists consignee_ref      text,         -- orders.consignee_refno
  add column if not exists loaded             boolean,      -- movement.loaded: 'L' true, 'E' false
  add column if not exists external_closed_at timestamptz;  -- McLeod stated D or V (LR5)

alter table load_stops
  add column if not exists location_name       text,        -- stop.location_name
  add column if not exists location_code       text,        -- stop.location_id — the shipper's own code
  add column if not exists external_status     text,        -- stop.status: A / D
  add column if not exists actual_arrival_at   timestamptz, -- McLeod's actual — NOT the driver's arrived_at
  add column if not exists actual_departure_at timestamptz,
  add column if not exists eta_at              timestamptz,
  add column if not exists contact_name        text,
  add column if not exists contact_phone       text,
  add column if not exists po_number           text;        -- stop.ponum
