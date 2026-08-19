-- 0210 — the `recruiter` user_role enum value, and NOTHING ELSE.
--
-- Isolated for the reason 0077 states in its own header: Postgres will not let a newly-added enum
-- value be USED in the transaction that adds it. Everything that references 'recruiter' lives in
-- 0211 and 0212.
--
-- As with 0077, the RLS policies that follow compare auth_role() as TEXT rather than as the enum, so
-- they do not depend on this value existing at all — but keeping the ADD VALUE isolated is the safe,
-- conventional pattern and it is the one this repo already follows.
--
-- The JWT hook (0006) injects membership.role::text verbatim, so the role flows into claims with no
-- hook change. What a recruiter may DO lives in the section-capability matrix
-- (packages/shared/src/auth.ts) — `recruitment: manage`, `fleet: view`, everything else none.
--
-- ONE-WAY DOOR: Postgres has no ALTER TYPE ... DROP VALUE. This value cannot be removed without
-- recreating the type and rewriting every column that uses it. The ACCESS it carries stays
-- adjustable; the value itself does not. See docs/plans/safety-dqf/RECRUITER-ROLE-SCOPE.md §1.

alter type user_role add value if not exists 'recruiter';
