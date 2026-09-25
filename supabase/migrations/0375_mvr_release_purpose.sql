-- 0375: the MVR release becomes a sixth permission (MVR-RELEASE-AND-TEMPLATES-PLAN.md MV0; D-MVR1,
-- owner's ruling 2026-09-25).
--
-- ── THE GAP ──────────────────────────────────────────────────────────────────────────────────────
-- The applicant signs five permissions on their link (0215, 0228) and none of them is a release to
-- check their driving record. The MVR step has been gated on the FCRA consumer-report permission
-- since A4, which is the wrong instrument when the office pulls the record from a state portal
-- rather than through a consumer reporting agency. The carrier's own lawyers wrote the right one —
-- packet page 19, `AUTHORIZATION FOR DRIVING RECORD CHECK` — and the driver does sign it, but on a
-- page of the application, AFTER the permissions, as a packet mark the MVR step cannot see
-- (WORDING-REVIEW-2026-09-13.md §2 recorded it as "an MVR authorization with nowhere to go").
--
-- The owner ruled (D-MVR1) that it moves out of the application and is signed the same way as the
-- other permissions. So `driver_authorizations.purpose` gains `mvr`. That is the whole of the schema
-- change; the instrument's text, its place in the order and the gate it opens are TypeScript
-- (`authorizationContract.ts`, `applicationIntake.ts`), as 0228's header says they should be.
--
-- ── WHY ONLY THE CONSTRAINT, AND WHY IN ITS OWN MERGE ────────────────────────────────────────────
-- `lint:migration-ordering`: a merge is served ~3 minutes before its migration is applied. Code that
-- inserts `purpose = 'mvr'` against the old constraint fails with a check violation on the
-- applicant's phone, mid-ceremony. So the constraint widens here and the first writer ships in the
-- next merge — the same split 0374 and #1053 made.
--
-- ⚠ `record_driver_release` is deliberately NOT touched. It counts rows against a
-- `p_expected_count` the API passes in (0228), so a sixth instrument is a longer array, not a new
-- function. Its DR022 refusal — "the ceremony is already closed" — also stays: the two applicants
-- whose releases were complete before this ruling sign the MVR release on paper through the office
-- (MV3), which is the capability the paper fallback needs anyway, rather than reopening a closed
-- ceremony whose stamp later phases (0336, 0365) already rely on.
--
-- ⚠ Widening only. Every existing row satisfies the new constraint, so `validate` has nothing to
-- reject; the drop and re-add run in one transaction, so no insert can land between them unchecked.

alter table public.driver_authorizations
  drop constraint if exists driver_authorizations_purpose_check;

alter table public.driver_authorizations
  add constraint driver_authorizations_purpose_check check (purpose in (
    'fcra_disclosure',      -- §604(b)(2) consumer report, standalone
    'psp',                  -- FMCSA PSP §5.4.1 / Errors 17, 31
    'previous_employer',    -- §391.23(a)(2); §40.25(g) for D&A history
    'clearinghouse',        -- §382.701(a) full query
    'drug_alcohol',         -- §382 testing programme
    'mvr'));                -- §391.23(a)(1) driving record; the carrier's packet page 19 (D-MVR1)

comment on constraint driver_authorizations_purpose_check on public.driver_authorizations is
  'The six permissions (AUTHORIZATION_PURPOSES in packages/shared/src/authorizationContract.ts). mvr added by 0375 (D-MVR1): the carrier''s AUTHORIZATION FOR DRIVING RECORD CHECK, moved out of the application packet.';
