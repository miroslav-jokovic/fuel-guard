-- 0467 — what each outside source last said a driver's medical card expires (MEDSTOP-PLAN.md §7A.10,
-- D-MSUX4a/b, Q-MSUX7 answered 2026-10-13).
--
-- ── WHY ─────────────────────────────────────────────────────────────────────────────────────────
-- The medical card in the qualification file (`certifications.medical_card`) is filed by McLeod's
-- nightly roster sweep through evidence's `recordSyncedCredentials`, which writes only when the date
-- CHANGES — in either direction. The owner asked for Med-Stop's `medexpiration` to file the same card
-- (D-MSUX4a). Through that door as it stood, two sources that disagree would take turns: Med-Stop
-- files B, McLeod files A that night, Med-Stop files B an hour later — ~24 rows a day per driver, for
-- the 37 drivers the MS1 dry run found disagreeing, in an append-only table nothing may prune.
--
-- So each source's date is recorded HERE, per driver, and the filing is decided from all of them at
-- once by one rule (`resolveMedicalExpiry` in shared; owner ruling Q-MSUX7): the card on file wins
-- when a scan backs it; otherwise the EARLIEST date any source gives, flagged when they disagree.
-- Both sweeps compute the same answer from the same rows, so neither can undo the other.
--
-- ── WHY NOT READ THE OTHER SOURCES WHERE THEY ALREADY LIVE ──────────────────────────────────────
-- McLeod's date is also `drivers.medical_card_expires_at` and Med-Stop's is in `medstop_employees`.
-- Reading those from evidence would make evidence know two collectors' tables and their match rules
-- (D-ARC3: the collector holds the vendor fetch, the owner holds the invariant). A collector reports
-- "my source says X" through evidence's interface; Samba becomes one more `source` value (Q-MSUX6).
--
-- ── NOT EVIDENCE ────────────────────────────────────────────────────────────────────────────────
-- A row is a source's CURRENT claim, overwritten when the source changes its mind — the evidence is
-- the `certifications` row filed from it. So: mutable, one row per (driver, kind, source), and a
-- merged-away driver's rows cascade (re-observed for the canonical driver on the next sweep;
-- `check-driver-references.mjs` EXEMPT carries the argument).
create table if not exists public.credential_source_dates (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  driver_id   uuid not null references public.drivers(id) on delete cascade,
  kind        text not null check (kind in ('medical_card')),
  source      text not null check (source in ('mcleod', 'medstop')),
  expires_on  date not null,
  changed_at  timestamptz not null default now(),
  primary key (org_id, driver_id, kind, source)
);

alter table public.credential_source_dates enable row level security;
-- No policies: service-role only. The browser reads the cross-check through the API.

-- Write-only-on-change, for the same reason `recordSyncedCredentials` is: an hourly sweep that
-- rewrote 170 unchanged rows would be pure churn on a database already swapping. Returns whether the
-- stored date moved, so the caller knows to re-resolve.
create or replace function public.record_credential_source_date(
  p_org uuid, p_driver uuid, p_kind text, p_source text, p_expires_on date
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_rows int;
begin
  insert into public.credential_source_dates as c (org_id, driver_id, kind, source, expires_on)
  values (p_org, p_driver, p_kind, p_source, p_expires_on)
  on conflict (org_id, driver_id, kind, source) do update
    set expires_on = excluded.expires_on, changed_at = now()
    where c.expires_on is distinct from excluded.expires_on;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;

revoke all on function public.record_credential_source_date(uuid, uuid, text, text, date) from public, anon, authenticated;

-- Backfill McLeod's claim from what its sweep already filed: a current medical card carrying the
-- sync's note was written by that sweep with McLeod's date (`SYNC_NOTE`, syncedCredentials.ts). Without
-- this, Med-Stop's first sweep would resolve against itself alone and file a row McLeod's next night
-- would move back — one avoidable supersede per disagreeing driver.
insert into public.credential_source_dates (org_id, driver_id, kind, source, expires_on, changed_at)
select c.org_id, c.subject_id, 'medical_card', 'mcleod', c.expires_at, c.created_at
  from public.certifications c
  join public.drivers d on d.id = c.subject_id and d.org_id = c.org_id
 where c.subject_type = 'driver'
   and c.kind = 'medical_card'
   and c.superseded_by is null
   and c.expires_at is not null
   and c.notes = 'Recorded from the carrier''s TMS (McLeod) roster sync — no scan filed by the sync.'
on conflict do nothing;
