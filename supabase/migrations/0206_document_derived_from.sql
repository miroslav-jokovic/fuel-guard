-- 0206: documents.derived_from — the machine-readable link from a derivative to its original
--       (DQF execution plan B2; the B1 spec reserved this and mis-guessed the number as 0204)
--
-- The gap B1 found while shipping the pure spec: `documents.variant` was designed for derivatives
-- (0146:63 constrains original/normalized/thumb) but NOTHING LINKS a derivative row back to the
-- original it was made from. Encoding the link in the storage path would make an object name a
-- foreign key — which is how the next person ends up regex-matching bucket listings.
--
-- Why a plain nullable FK and not ON DELETE CASCADE: `documents` is append-only with no client
-- DELETE at all; removal is a service-role retention act, and a retention pass that deletes an
-- original must DECIDE what happens to its derivatives, not have the database decide silently.
-- RESTRICT makes that decision mandatory.

alter table public.documents
  add column if not exists derived_from uuid references public.documents(id) on delete restrict;

create index if not exists idx_documents_derived_from
  on public.documents (derived_from) where derived_from is not null;

comment on column public.documents.derived_from is
  'The original this row was derived from (thumb/normalized, plan B2). Null on originals. The storage path infix (.thumb/.normalized) is for humans; THIS is the link.';
