-- 0625 — a creative may carry a motion ad beside its still (ADS-PLATFORM-V2-PLAN V4 "Video"; Q-APX13, ruled
-- 2026-11-16: a motion ad is the still's own words over a few seconds of motion, ending on the approved still).
--
-- ── WHAT IS THE GAP ──────────────────────────────────────────────────────────────────────────────
-- Since V4a–V4f the parts of a motion ad exist: the timeline, the layers, the clip from an image-to-video
-- model, the check of its frames, the join into one MP4. A creative has nowhere to keep the result.
-- `ads_creatives.assets` is a list of IMAGES — "one entry per format: { format, sha256, path, width, height }"
-- (0537) — and everything that reads it treats every entry as one: the publisher uploads each as an ad image,
-- the review screen draws each in an <img>. A video put in that list would be a file each of those readers
-- must learn to skip, and the day one forgets, an MP4 is sent to Meta as a picture.
--
-- ── THE SHAPE ────────────────────────────────────────────────────────────────────────────────────
-- · `ads_creatives.motion` — one jsonb object, nullable. Null for every creative that is a still only: all
--   of them today, and every one whose plan angle is not a motion ad. The body is the shared contract's (next
--   merge): the finished file per language, the model's clip it was made from, and the frame check's verdict.
--   An OBJECT, as `candidates` (0579) and `pairings` (0619) are.
-- · A motion ad never REPLACES the still: its last frame is the still, and the still is what a person approves
--   and every check was made on. So the table's own rule that a creative a person can approve has at least one
--   image (`jsonb_array_length(assets) > 0`) is untouched, and holds for a motion ad too.
-- · FROZEN with the rest of the content (AX030). `guard_ads_creatives` refuses a change to copy, assets, checks
--   or regenerations once a creative has left the workers — "what a person approved is what runs". A video
--   that could be swapped after approval would be the one part of an ad that rule did not cover, so `motion`
--   joins the list. The function below is 0537's, with that one comparison added.
--
-- NOT changed here, and said so it is not mistaken for covered: `candidates` and `pairings` are not in the
-- guard's list. They record how the content was chosen, not the content, and are outside this step.
--
-- ⚠ DEPLOY WINDOW: one nullable column with no default; nothing reads or writes it until the next merge
-- (`lint:migration-ordering`). The replaced function compares a column old code never sets — null to null —
-- so old code's updates pass exactly as before.
--
-- Rollback: `alter table public.ads_creatives drop column motion` after restoring 0537's function body.

alter table public.ads_creatives
  add column if not exists motion jsonb check (motion is null or jsonb_typeof(motion) = 'object');

create or replace function public.guard_ads_creatives()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.campaign_id <> old.campaign_id or new.preset_version_id <> old.preset_version_id
     or new.brand_kit_version_id is distinct from old.brand_kit_version_id
     or new.supersedes_id is distinct from old.supersedes_id or new.created_at <> old.created_at then
    raise exception 'ads_creatives: a creative''s campaign, preset, brand kit and lineage never change'
      using errcode = 'AX030';
  end if;
  if old.state not in ('generating', 'checking') then
    if new.state in ('generating', 'checking') then
      raise exception 'ads_creatives: a creative that left the workers is never reopened — regenerate as a new creative'
        using errcode = 'AX030';
    end if;
    if new.copy is distinct from old.copy or new.assets <> old.assets
       or new.checks is distinct from old.checks or new.regenerations <> old.regenerations
       or new.motion is distinct from old.motion then
      raise exception 'ads_creatives: content is frozen once it leaves the workers — what a person approved is what runs'
        using errcode = 'AX030';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_ads_creatives() from public, anon, authenticated;
