-- 0566 — a campaign names the brand kit its creatives are made with (Track S, S1a; plan Q-AD28).
--
-- ── WHY ─────────────────────────────────────────────────────────────────────────────────────────────
-- 0537 lets an org keep several brand kits (`ad_brand_kits`, each versioned in `ad_brand_kit_versions`),
-- and every creative records the kit VERSION it was made with (`ads_creatives.brand_kit_version_id`).
-- Nothing records which KIT a campaign uses, so compose (C5b2, `compose/composeCampaign.ts`) refuses
-- whenever an org has more than one: "which one this campaign uses is not chosen". Every alternative to a
-- column — the newest kit, one kit per org by rule — is a guess the row could not explain afterwards
-- (ADS-AGENT-PLAN.md §9 Q-AD28 has the candidates and the measurement).
--
-- The kit, not a version: correcting a phone number in the kit saves its next version, and the campaign
-- should make its next creative with it rather than need rebuilding. The version a creative actually used
-- stays on the creative, so "what did this ad show?" is still answered from the row that showed it.
--
-- ── SHAPE ───────────────────────────────────────────────────────────────────────────────────────────
-- Nullable. The create door (S1b, `orchestrator/transitions.ts` `createCampaign`) always sets it; NOT NULL
-- would add nothing the door does not already hold, and would refuse every test world that inserts a
-- campaign directly. No production row exists: 0537's table has had no writer until S1b.
-- `on delete restrict` with the composite (org_id, id) key, like every other ads reference in 0537: a kit
-- a campaign names is archived (`archived_at`), never deleted, and the FK keeps a campaign from naming
-- another org's kit.
--
-- ── DEPLOY WINDOW ───────────────────────────────────────────────────────────────────────────────────
-- A new column on an existing table: its first reader (the create door and the campaign read) ships in
-- the NEXT merge (`lint:migration-ordering`; docs/MIGRATION-DISCIPLINE.md §the-deploy-window).

alter table public.ads_campaigns
  add column if not exists brand_kit_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ads_campaigns_brand_kit_fkey' and conrelid = 'public.ads_campaigns'::regclass
  ) then
    alter table public.ads_campaigns
      add constraint ads_campaigns_brand_kit_fkey
      foreign key (org_id, brand_kit_id) references public.ad_brand_kits (org_id, id) on delete restrict;
  end if;
end $$;

-- The FK's lookup in the restrict direction (a kit's archival check, "which campaigns use this kit").
create index if not exists ads_campaigns_brand_kit_idx on public.ads_campaigns (org_id, brand_kit_id)
  where brand_kit_id is not null;

comment on column public.ads_campaigns.brand_kit_id is
  'The brand kit this campaign''s creatives are made with (Q-AD28); each creative records the kit version it used.';
