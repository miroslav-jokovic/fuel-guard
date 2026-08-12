-- 0180 — Phase 2 of the card-control hardening: org-scoped write counters, idempotency
-- fingerprints, and an optional reason.
--
-- ── card_write_counters: the org belongs in the key (audit finding, Part 2 P1-5) ────────────────
-- The 0178 primary key was (user_id, bucket, day): a user with memberships in two orgs shared ONE
-- daily cap across both — refused in org B because of writes made in org A — and every increment
-- after the first landed on whichever org_id the row was created with, so per-org reporting and
-- purging attributed org B's activity to org A. The key gains org_id; the RPC's conflict target
-- follows. Existing rows keep their counts (they expire daily by design).

alter table public.card_write_counters drop constraint card_write_counters_pkey;
alter table public.card_write_counters add primary key (org_id, user_id, bucket, day);

create or replace function public.bump_card_write_counter(
  p_org uuid, p_user uuid, p_bucket text, p_limit int
) returns table (allowed boolean, used int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used int;
begin
  insert into public.card_write_counters (org_id, user_id, bucket, day, count)
  values (p_org, p_user, p_bucket, (now() at time zone 'utc')::date, 1)
  on conflict (org_id, user_id, bucket, day) do update
    set count = public.card_write_counters.count + 1,
        updated_at = now()
  returning public.card_write_counters.count into v_used;

  return query select (v_used <= p_limit), v_used;
end;
$$;

comment on function public.bump_card_write_counter(uuid, uuid, text, int) is
  'Atomically increment a user''s PER-ORG daily card-write counter and report whether it is within
   cap. Increments before judging so over-cap attempts stay visible (0178); org-scoped key (0180).';

-- ── efs_card_mutations.request_fingerprint (idempotency done fully — audit P1-2 / Stripe canon) ─
-- The idempotency index replays on the KEY alone. A client bug that reuses a key with a DIFFERENT
-- request (the drawer navigating card A → card B was a live example) would be answered with card
-- A''s recorded outcome presented as card B''s. The fingerprint is a hash of (intent, card, sanitized
-- body — reason and expectedVersion excluded, since neither changes WHAT is being asked); on a key
-- collision with a different fingerprint the API refuses 409 idempotency_key_reused instead of
-- replaying an unrelated outcome. Nullable: rows predating 0180 have no fingerprint, and a missing
-- one simply skips the comparison — the key-only behaviour they were written under.

alter table efs_card_mutations add column if not exists request_fingerprint text;

comment on column efs_card_mutations.request_fingerprint is
  'sha256 over (intent, efs_card_id, sanitized request body). Guards the idempotency replay against
   a reused key carrying a different request. Null on pre-0180 rows.';

-- ── reason becomes optional (product decision B1, 2026-08-12) ───────────────────────────────────
-- The operator-entered reason is no longer required by the product. The column stays — the audit
-- trail keeps actor, intent, step-up flag and both documents, and any org that wants reasons back
-- gets them without a migration — but empty is now a legal value and the default.

alter table efs_card_mutations alter column reason set default '';
alter table efs_card_mutations alter column reason drop not null;
