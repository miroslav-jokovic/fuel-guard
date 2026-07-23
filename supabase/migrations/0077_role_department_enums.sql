-- 0077: department roles — add the two new user_role enum values.
--
-- These are added in their OWN migration on purpose: Postgres will not let a newly-added enum value be
-- *used* in the same transaction that adds it, so anything referencing them (the RLS policy changes) lives
-- in 0078. Those policies compare auth_role() as TEXT (not the enum) so they don't depend on the enum at all,
-- but keeping the ADD VALUEs isolated is the safe, conventional pattern.
--
-- The JWT hook (0006) already injects membership.role::text verbatim, so these roles flow into claims with
-- no hook change. See the section-capability matrix in packages/shared/src/auth.ts for what each can do.

alter type user_role add value if not exists 'dispatcher';
alter type user_role add value if not exists 'safety_manager';
