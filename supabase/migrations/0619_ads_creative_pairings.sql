-- 0619 — a creative keeps every picture-and-words pairing it was chosen from (ADS-PLATFORM-V2-PLAN V3 "make many,
-- show few"; Q-APX7, Q-APX9), and a person's choice can name the picture as well as the words.
--
-- ── WHAT IS THE GAP ──────────────────────────────────────────────────────────────────────────────
-- A creative is one picture under the best-ranked words that fit it (D-AD26). The words have rivals a reviewer can
-- read (`candidates`, 0579); the picture has none — one direction, one render, and whatever came back is the ad
-- (audit F-AG3, F-AG6; the owner, 2026-11-14: "looks like AI is in rush to create ad"). V3 makes several pictures
-- per creative, pairs each with the words that fit, and has the finished-ad judge rank the pairings. The reviewer
-- must see the winner WITH its rivals, or the ranking is a black box nobody can disagree with.
--
-- ── THE SHAPE ────────────────────────────────────────────────────────────────────────────────────
-- · `ads_creatives.pairings` — one jsonb object, nullable: null for every creative made before V3, for one that
--   stopped before a picture passed its check, and for one built from a person's choice. Its body is the shared
--   contract's (`adPairingsSchema`, the next merge): the pictures made, the ranked pairings — each naming its
--   picture and its words by their index in `candidates.ranked`, with the judge's scores — and which one became
--   the ad. An OBJECT, not an array, for the same reason as `candidates`: the chosen index, the judged frame and
--   the judge's prompt version sit beside the list.
-- · `ads_copy_choices.picture` — which of the replaced creative's pictures the person chose (1 = the first made),
--   null = the picture the ad already had, which is every choice written before V3 ("Use these words" kept the
--   picture). 1–5 because `pictures_per_creative` will be bounded as `candidates_per_creative` is (1–5).
--   The table is append-only (0595): the column is written on insert and never afterwards.
--
-- ⚠ DEPLOY WINDOW: two nullable columns with no default; nothing reads or writes either until the next merge, per
-- `lint:migration-ordering` — new schema serves old code for the deploy minutes, and old code never names them.

alter table public.ads_creatives
  add column if not exists pairings jsonb
  check (pairings is null or jsonb_typeof(pairings) = 'object');

alter table public.ads_copy_choices
  add column if not exists picture smallint
  check (picture is null or picture between 1 and 5);
