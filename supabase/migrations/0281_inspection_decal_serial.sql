-- 0281 — `vehicle_inspections.stock_serial` becomes `decal_serial`, and the reason matters.
--
-- 0280 guessed this column was a serial printed on the carbonless form and called it `stock_serial`,
-- recording the guess as the plan's §6 Q1. The owner answered in two parts on 2026-08-31, and only
-- the second part is the whole answer:
--
--   1. "They type it on a PDF editor, it is blank by default."   → so it is not printed on the FORM.
--   2. "That number we are getting from the sticker that comes with the form."
--
-- It is the serial of the **§396.17(c)(2) decal** — the sticker J.J. Keller ships with the report
-- set, which goes on the vehicle and which the office transcribes onto the report so the two can be
-- matched afterwards. So the number IS pre-printed; just not where 0280 looked.
--
-- ── WHY THIS IS THE MOST OPERATIONALLY IMPORTANT FIELD ON THE FORM ──────────────────────────────
-- §396.17(c) requires documentation of the inspection to be ON THE VEHICLE, as either a copy of the
-- report or a compliant decal. A carrier that uses the decal (which is what the sticker is for) has
-- put the ONLY on-vehicle proof of a §396.17 inspection on a sticker bearing this number. When an
-- officer at a roadside reads that decal and asks for the report behind it, this column is what
-- turns the number on the truck into the report in the file. It is not an index the office chose;
-- it is the join between a physical object on a tractor and the evidence §396.21(b) obliges the
-- carrier to produce.
--
-- That makes the uniqueness a real integrity rule rather than tidiness: one decal is one inspection,
-- and the same serial appearing on two reports means either a transcription error or a decal reused
-- on a second vehicle — the second of which would put a truck on the road wearing proof of an
-- inspection it never had.
--
-- ── STILL NULLABLE, AND DELIBERATELY ────────────────────────────────────────────────────────────
-- §396.21(a)'s six required contents do not include a decal serial, and a FAILED inspection gets no
-- decal at all — there is nothing to certify on the side of the truck. So the column is optional and
-- finalize does not demand one. Whether a PASS should require it is a live question (plan §6 Q7) and
-- is deliberately not decided by this migration.
--
-- Renamed rather than added-and-deprecated because the table is EMPTY — `select count(*) from
-- vehicle_inspections` in production on 2026-08-31 returned 0, measured before deciding, twice.
--
-- Rollback: alter table vehicle_inspections rename column decal_serial to stock_serial;
--           alter index vehicle_inspections_decal_serial_idx rename to vehicle_inspections_stock_serial_idx;

alter table vehicle_inspections rename column stock_serial to decal_serial;
alter index vehicle_inspections_stock_serial_idx rename to vehicle_inspections_decal_serial_idx;

comment on column vehicle_inspections.decal_serial is
  'The serial on the §396.17(c)(2) decal issued with this inspection — the sticker that goes on the
   vehicle and is often the only on-vehicle proof the inspection happened. Transcribed from the
   sticker by the office. Unique per org: one decal is one inspection, and a repeat means either a
   transcription error or a decal reused on a second truck. Nullable — a failed inspection gets no
   decal, and §396.21(a) does not require one.';
