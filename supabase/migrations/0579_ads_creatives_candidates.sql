-- 0579 — a creative keeps every copy the model offered, ranked (ADS-CREATIVE-QUALITY-PLAN CQ4; D-AD19, D-AD21).
--
-- ── WHAT GAP ─────────────────────────────────────────────────────────────────────────────────────
-- The copywriter writes ONE copy per creative and that copy becomes the ad (G-CQ6). D-AD19 asks for k candidates,
-- each through the claim and length checks, ranked by a craft judge (D-AD21), the best one rendered — and a person
-- on the review screen must be able to see what the others were and why the first was chosen, or the judge is a
-- black box nobody can calibrate (R7: the owner's ratings are its ground truth).
--
-- ── THE SHAPE ────────────────────────────────────────────────────────────────────────────────────
-- One jsonb object, nullable: null for every creative made before CQ4 and for one that stopped before copy. Its body
-- is the shared contract's (`adCandidatesSchema`, CQ4b): the ranked candidates, each with its copy, the judge's
-- per-criterion scores and reasons, and which index became `copy`. An OBJECT, not an array, so the chosen index and
-- the judge's prompt version sit beside the list.
--
-- ⚠ DEPLOY WINDOW: a nullable column with no default; nothing reads or writes it until the next merge (CQ4b), per
-- `lint:migration-ordering` — new schema serves old code for the deploy minutes, and old code never names it.

alter table public.ads_creatives
  add column if not exists candidates jsonb
  check (candidates is null or jsonb_typeof(candidates) = 'object');
