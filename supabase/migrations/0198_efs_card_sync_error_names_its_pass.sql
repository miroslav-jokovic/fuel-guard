-- FuelGuard — 0198 `sync_error` says WHICH pass failed and WHEN (execution plan Step 7.5)
--
-- ── What 7.7 left behind ────────────────────────────────────────────────────────────────────────
-- Step 7.5 was filed because one column carried two unrelated meanings: a REFRESH failure and a
-- LINKING outcome, so a card that had refreshed perfectly displayed "Last refresh reported:
-- ambiguous_fuel_card_link". Migration 0195 took the linking half out into `fuel_card_link` and the
-- linker stopped writing here. This migration finishes the job on the half that remained.
--
-- ── The half that remained ──────────────────────────────────────────────────────────────────────
-- `sync_error` has exactly one WRITER — the detail pass, when `getCardv2` fails — and two CLEARERS.
-- The second clearer is the ROSTER pass, which sets it to null for every card on every sweep before
-- the detail pass has run (`upsertFromSummary`). So:
--
--   sweep N    detail read of card X fails      -> sync_error = 'timeout'
--   sweep N+1  roster pass clears it            -> sync_error = null
--              card X is past EFS_CARD_SYNC_MAX_DETAIL, so nothing re-reads it
--
-- and the page now says the card is clean while its document is however many days old it was. One
-- column, two passes, and the pass that did not set the value is the one that erases it. Same
-- disease as the linking half, one layer down — which is why the fix is the shape 7.5 named
-- (`{code, source, at}`) rather than another boolean.
--
-- The erasure needs `budget <= fleet` to bite, and production runs 199 cards against a budget of
-- 200. The same step raises that budget AND asserts `budget > fleetSize` as an invariant, so this is
-- the defect being closed before it starts firing rather than after.
--
-- ── Shape ───────────────────────────────────────────────────────────────────────────────────────
--   { "code": "<what failed, PAN-redacted by errorText()>",
--     "source": "roster" | "detail",       -- WHICH pass. Both write; see below
--     "at": "<iso8601>" }                  -- WHEN. `synced_at` is the roster clock and cannot say
--
-- `source` is two-valued because both passes now record their own failure. A roster-pass write
-- failure for one card used to exist only in the job's `errors[]` array — invisible on the row an
-- operator is looking at. It is a best-effort annotation: a FIRST sighting that fails has no row to
-- annotate, and that case stays in `errors[]` where it already was.
--
-- ── Who may clear it ────────────────────────────────────────────────────────────────────────────
-- Only a pass that has just read the card IN FULL. That is `upsertCardDetail`, which holds the whole
-- document. The roster pass no longer clears anything — it only records its own failures. That one
-- sentence is the entire behavioural fix, and `efsCardMirror.test.ts` breaks if it is reverted.
--
-- ── The conversion ──────────────────────────────────────────────────────────────────────────────
-- In place rather than a second column: two columns meaning "the last refresh failed" would be the
-- overload this step exists to remove. Existing text values are wrapped with source 'detail' because
-- the detail pass is the only thing that has ever written one, and `synced_at` is the closest clock
-- the old shape carried.

alter table efs_cards
  alter column sync_error type jsonb
  using (
    case
      when sync_error is null or btrim(sync_error) = '' then null
      else jsonb_build_object(
        'code', sync_error,
        'source', 'detail',
        'at', coalesce(synced_at, now())
      )
    end
  );

comment on column efs_cards.sync_error is
  'Step 7.5: the last MIRROR REFRESH failure for this card, as {code, source, at}. source names the pass that failed (roster = getCardSummaries upsert, detail = getCardv2), at is when it failed. Cleared ONLY by a successful full read (upsertCardDetail) — the roster pass must never clear an error it did not set, which is the defect this shape replaced. Distinct from fuel_card_link, which is the LINKING outcome (Step 7.7). Never contains a PAN: errorText() masks card numbers before they reach here.';

-- The shape is enforced rather than documented. A writer that reverts to a bare string, or invents a
-- third `source`, fails at the database instead of rendering as an empty error on the card page —
-- and the page's own reader (`toSummary`) would show `null` for a row that genuinely has a problem.
--
-- ⚠ `?&` FIRST, and `coalesce` around every `jsonb_typeof`. A CHECK passes on NULL, not just on TRUE,
-- and `jsonb_typeof(sync_error -> 'at')` is NULL when the key is ABSENT — so the obvious spelling of
-- this constraint accepts `{"code":"x","source":"detail"}` with no `at` at all, which is precisely
-- the field this migration exists to add. Caught by trying it in PGlite rather than by reading it.
alter table efs_cards
  drop constraint if exists efs_cards_sync_error_shape;

alter table efs_cards
  add constraint efs_cards_sync_error_shape
  check (
    sync_error is null
    or (
      jsonb_typeof(sync_error) = 'object'
      and sync_error ?& array['code', 'source', 'at']
      and coalesce(jsonb_typeof(sync_error -> 'code'), '') = 'string'
      and coalesce(jsonb_typeof(sync_error -> 'at'), '') = 'string'
      and coalesce(sync_error ->> 'source', '') in ('roster', 'detail')
    )
  );
