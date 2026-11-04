-- 0562 — the bucket the ads brand kit's files live in (ADS-AGENT-BUILD-WORKFLOW.md C1; ADS-AGENT-PLAN
-- D-AD10, D-AD13).
--
-- ── WHAT GAP ───────────────────────────────────────────────────────────────────────────────────
-- 0537's `ad_brand_kit_versions.kit` names its logo and equipment photos BY sha256 and says "the bytes
-- live in storage, C1" — but no bucket was made for them. The brand kit needs somewhere private to put
-- an uploaded logo or photo before a version can refer to it; C3 will copy Higgsfield's outputs (which
-- expire after seven days) into the same place.
--
-- ── THE SHAPE ──────────────────────────────────────────────────────────────────────────────────
-- Private, no storage.objects policy: deny-all to every client session, bytes only through the API
-- (a signed upload URL in, the API's own read back out) — `chat-files` (0540) is the pattern. Two kinds
-- of key, both written by the API only:
--   <org>/incoming/<upload id>   what the browser PUT; read once, sniffed, then removed
--   <org>/<sha256>.<ext>         what a version refers to — content-addressed, so the same file twice
--                                is one object and a stored object is never replaced by other bytes
-- 15 MB matches `AD_ASSET_MAX_BYTES` in `@silvicom/shared` (a full-resolution phone photo fits).
--
-- REJECTED: a table of assets. The hash already identifies the object and the version jsonb already
-- records which assets it used; a third copy of that fact would be a second source of truth with
-- nothing to add until assets need their own lifecycle (C3's provenance lives in `ad_generations`).
--
-- ⚠ DEPLOY WINDOW: a new bucket, nothing reshaped. Old code never names it; the C1 routes that do ship
-- in the same merge, and before the migration lands on staging they answer the upload with Storage's
-- own "bucket not found" — a refusal, not a wrong write (new objects are exempt from the two-merge
-- rule the way new tables are, docs/MIGRATION-DISCIPLINE.md §the-deploy-window).
--
-- Rollback: delete the bucket after moving its objects; the C1 routes refuse uploads without it.

insert into storage.buckets (id, name, public, file_size_limit)
values ('ad-assets', 'ad-assets', false, 15 * 1024 * 1024)
on conflict (id) do nothing;
