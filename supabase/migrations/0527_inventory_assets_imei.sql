-- 0527 — a tablet's IMEI (MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md §7a.6, step M9a; owner Q-MX11 (a),
-- 2026-10-28: "every tablet has an AT&T SIM and an IMEI, with a barcode sticker on the back").
-- Truck inventory only (DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md §0): nothing here touches a part.
--
-- ── WHY A COLUMN OF ITS OWN, AND NOT THE SERIAL ─────────────────────────────────────────────────
-- A tablet with a SIM carries two manufacturer identifiers on its sticker: the serial and the IMEI,
-- each its own Code 128 barcode. They answer different questions — the serial is the device, the
-- IMEI is what AT&T bills the line against — and a shop asked "which tablet is on this line" must
-- not have to guess which of the two somebody typed into one field. `serial_number` stays as it is.
--
-- ── THE SHAPE: 15 DIGITS, AND NOTHING ELSE AT THIS LAYER ────────────────────────────────────────
-- An IMEI is 14 digits and a Luhn check digit (3GPP TS 23.003). The CHECK holds the shape only;
-- the check digit is `isImei()` in `packages/shared`, run by the form and the scan screen before a
-- write (M9b), because a misread barcode should be refused with a sentence to the person holding
-- the scanner, not with a constraint name. Stored digits only — no spaces, no dashes — so the
-- unique index below compares like with like without a normalising expression.
--
-- ── ONE IMEI, ONE ASSET, PER ORG — 0522's serial rule, for the same reason ───────────────────────
-- Two records for one tablet are two labels and two histories, and a scan of either answers half
-- the truth (0522 §1, R8). A unique index is the only thing two concurrent inserts cannot both
-- pass; `assetsWrite.ts` will map its 23505 by this index's NAME (M9b), as it does the serial's.
-- Null is "no IMEI recorded" (a Wi-Fi-only device, or a load bar) and repeats freely.
--
-- Measured on production 2026-10-29: 0 assets, so the index builds clean.
--
-- ── THE COLUMN SHIPS ALONE (lint:migration-ordering) ────────────────────────────────────────────
-- No reader or writer in this merge. In a release the new schema serves the OLD code for the deploy
-- minutes (MIGRATION-DISCIPLINE.md §the-deploy-window); a nullable column nobody selects is harmless
-- to it. The field, the scan screen's answer and the label line are M9b, a later merge.
--
-- No RLS change: `inventory_assets`' policies are unchanged and the column is read under them.

alter table public.inventory_assets
  add column if not exists imei text check (imei ~ '^[0-9]{15}$');

comment on column public.inventory_assets.imei is
  'The device''s IMEI (M9a, Q-MX11): 15 digits, the last a Luhn check digit verified by isImei() before a write. Null when the device has none. Unique per org.';

create unique index if not exists idx_inventory_assets_imei_unique
  on public.inventory_assets (org_id, imei)
  where imei is not null;
