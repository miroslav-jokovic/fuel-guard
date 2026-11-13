-- 0595 — a person chooses the words of an ad (ADS-AD-LOOK-PLAN Q-ADL7, the owner 2026-11-12: "we should in settings
-- have texts to choose, or ads page"; "word choice first").
--
-- ── WHAT GAP ─────────────────────────────────────────────────────────────────────────────────────
-- The copywriter offers several copies, the craft judge ranks them, and the first the overlay can draw becomes the ad
-- (CQ4, D-AD26). A reviewer can SEE the others (`ads_creatives.candidates`) but cannot pick one, or change a word:
-- the only answers were approve, reject, or regenerate everything — words AND picture, paid for again.
--
-- ── THE SHAPE ────────────────────────────────────────────────────────────────────────────────────
-- 0537 freezes a creative's content once it leaves the workers ("what a person approved is what runs"), so the words of
-- a `ready` creative are never edited in place. A choice is its OWN row here, naming the creative it replaces; the
-- door then rejects that creative and moves the campaign through `regenerate`, and compose builds the successor
-- (`supersedes_id` = the replaced creative) from these words, replaying the replaced creative's picture from its
-- ledger rows — no new image is paid for. The row says:
--   · `copy` — every slot in both languages, exactly as the ad will carry them (checked by the door against the
--     brief's claims, the slots' limits and the overlay's fit before it is written);
--   · `from_candidate` — which offered copy it started from (its index in the replaced creative's ranked set), null
--     when the person started from the copy the ad already had;
--   · `edited_slots` — the slots the person changed from that copy, so the craft judge's calibration (R7) can tell a
--     pick from a rewrite.
-- One choice per replaced creative (unique): a second press on the same creative is the same choice, read back.
--
-- Append-only, like `ads_approvals`, by the same guard (0537's `ads_refuse_change`, AX010): a choice is a person's act on record. Corrections are a new choice on the
-- successor creative. Row level security on, no client policies: the API reads and writes with the service role, and
-- every query is org-scoped (`campaigns/copyChoice.ts`, this table's one writer; `compose/` reads it).
--
-- ⚠ DEPLOY WINDOW: a new table, exempt from the two-merge rule; nothing reads it until the code in the same merge.

create table if not exists public.ads_copy_choices (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  campaign_id          uuid not null,
  replaces_creative_id uuid not null,
  copy                 jsonb not null check (jsonb_typeof(copy) = 'object'),
  from_candidate       integer check (from_candidate is null or from_candidate >= 0),
  edited_slots         text[] not null default '{}',
  chosen_by            uuid not null,
  chosen_by_name       text not null check (length(btrim(chosen_by_name)) between 1 and 200),
  created_at           timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, replaces_creative_id),
  foreign key (org_id, campaign_id) references public.ads_campaigns (org_id, id) on delete restrict,
  foreign key (org_id, replaces_creative_id) references public.ads_creatives (org_id, id) on delete restrict
);
alter table public.ads_copy_choices enable row level security;

drop trigger if exists trg_ads_copy_choices_append_only on public.ads_copy_choices;
create trigger trg_ads_copy_choices_append_only before update or delete on public.ads_copy_choices
  for each row execute function public.ads_refuse_change('ledger');
