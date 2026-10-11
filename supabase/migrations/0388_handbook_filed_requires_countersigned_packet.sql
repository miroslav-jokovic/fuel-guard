-- 0388 — a filed handbook implies a countersigned packet (HANDBOOK-SIGNING-PLAN.md §6.6, QH2; D-HB10,
-- D-HB11).
--
-- ── WHY THIS IS ITS OWN MIGRATION ───────────────────────────────────────────────────────────────
-- QH1 made the handbook countersign sign the packet's carrier lines first and stamp `handbook_filed_at`
-- last, so today the order holds in the code. This makes it hold in the database. Shipped with 0387 it
-- would have refused every handbook the previously deployed code filed during the deploy window; it
-- follows QH1 once QH1 is live on both services. Production held 0 filed handbooks, 0 handbook marks and
-- 0 countersignatures when this was written (2026-09-29), so nothing already filed contradicts it.
--
-- ── 1. THE INVARIANT ────────────────────────────────────────────────────────────────────────────
-- `handbook_filed_at` may go from null to a value only when the invitation's countersignature exists
-- AND cites its document. An empty `placements` (the §391.21 summary) satisfies it: that row cites the
-- driver's own filing and says why nothing was stamped (D-HB10). PC030.
--
-- ── 2. D-HB11's RECORD, ONCE ────────────────────────────────────────────────────────────────────
-- The record citing the countersigned copy is found before it is written and made under the handbook's
-- filing claim, so the code already makes one. This is the database's backstop behind the claim, in
-- the shape 0376 gave the handbook's and the road test's one-record-per-invitation indexes.
--
-- cross-module-waiver: the invariant reads recruiting's countersignature when recruiting's invitation is
-- stamped; the index is on evidence's `qualification_records`, for a record recruiting files through
-- evidence's `insertQualificationRecord`.

create or replace function public.application_invitations_handbook_filed_guard()
returns trigger
language plpgsql
as $$
begin
  if old.handbook_filed_at is null and new.handbook_filed_at is not null
     and not exists (
       select 1 from public.application_packet_countersignatures c
        where c.invitation_id = new.id and c.org_id = new.org_id and c.document_id is not null)
  then
    raise exception 'handbook_filed_without_countersigned_packet: the packet''s carrier lines are countersigned before the handbook is filed'
      using errcode = 'PC030';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_application_invitations_handbook_filed_guard on public.application_invitations;
create trigger trg_application_invitations_handbook_filed_guard
  before update of handbook_filed_at on public.application_invitations
  for each row execute function public.application_invitations_handbook_filed_guard();

create unique index if not exists uq_qualification_records_packet_countersign
  on public.qualification_records (org_id, (detail ->> 'countersignature_id'))
  where kind = 'employment_application' and (detail ->> 'source') = 'packet_countersign';
