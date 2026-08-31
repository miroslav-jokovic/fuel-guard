-- 0282 — the carrier's address, because §396.21(a)(2) puts it on the report.
--
-- Plan step A6, docs/plans/maintenance/ANNUAL-INSPECTION-PLAN.md. Not scope creep: the annual
-- inspection report cannot be rendered without it, and a report missing it does not say what
-- §396.21(a) requires it to say.
--
-- ── WHAT WAS MISSING, AND HOW IT WENT UNNOTICED ─────────────────────────────────────────────────
-- `organizations` carries `name` and (since 0152) `dot_number`, and nothing else about who the
-- carrier is. On the paper form the MOTOR CARRIER OPERATOR / ADDRESS / CITY, STATE, ZIP block was
-- three AcroForm fields the office had typed once and saved into the PDF — so the address lived in
-- a file rather than in the product, and nobody noticed because nothing else had ever needed it.
-- The Illustrator round trip that produced our blank template dropped those fields, which is what
-- surfaced this.
--
-- ── WHY IT IS MORE THAN A PRINTED NICETY ────────────────────────────────────────────────────────
-- §396.21(a)(2) requires the report to identify the motor carrier. §396.17(c)(2) goes further: a
-- carrier using a DECAL as its on-vehicle documentation — which Silvicom does, see 0281 — must put
-- "the name and address of the motor carrier ... WHERE THE INSPECTION REPORT IS MAINTAINED" on it.
-- The address is the officer's route from a sticker to a filing cabinet.
--
-- ── PRECEDENT ───────────────────────────────────────────────────────────────────────────────────
-- Exactly 0152's move: it added `dot_number` here because the DQ binder's cover page needed the
-- carrier's identity on a document handed to an auditor. Same table, same reason, same shape.
--
-- Nullable, because an org that has not filled it in is a real state and a NOT NULL would have to
-- invent a value for every existing row. What is NOT tolerated is a report rendered without it:
-- finalize refuses and names the settings surface, rather than printing a blank carrier block on a
-- document that certifies a vehicle.
--
-- Rollback: alter table organizations drop column address_line1, drop column city,
--           drop column state, drop column postal_code;

alter table organizations add column if not exists address_line1 text;
alter table organizations add column if not exists city          text;
alter table organizations add column if not exists state         text;
alter table organizations add column if not exists postal_code   text;

comment on column public.organizations.address_line1 is
  'Street address of the motor carrier — §396.21(a)(2) on the annual inspection report, and
   §396.17(c)(2) on the decal, which must name where the report is maintained (0282).';
