-- 0426: the plaintext EFS SOAP password column may hold nothing but an empty string.
--
-- DATABASE-AUDIT-2026-10-03-PLAN.md, the `soap_password` row; step one of retiring the column.
-- Since 0186 every save seals the password into `soap_password_sealed` and writes '' here, and the
-- reader preferred the sealed copy but fell back to this column when the sealed one was null.
--
-- ── MEASURED BEFORE WRITING (production, 2026-10-05) ───────────────────────────────────────────────
-- Two rows, one per organisation. Both have `soap_password_sealed` set and `length(soap_password)`
-- 0, and both polled successfully minutes before the read, which proves the sealed copy opens with
-- production's key. There is no plaintext secret to clear; the column is a place one could return to.
--
-- This constraint makes the database refuse one, whoever writes it. The same merge removes the
-- reader's fallback, so a row without a sealed password reads as "not connected" instead of as a
-- password. The column itself is dropped in a later merge, once no deployed code writes '' to it.
--
-- ── DEPLOY WINDOW (docs/MIGRATION-DISCIPLINE.md) ─────────────────────────────────────────────────
-- Old code against the new schema: it writes '' on save, which the constraint accepts. New code
-- against the old schema: it still writes '', and only stops reading the column. Both directions
-- hold, and every existing row satisfies the check, so it validates without rewriting anything.

alter table public.efs_soap_credentials
  add constraint efs_soap_credentials_password_plaintext_empty check (soap_password = '');

comment on column public.efs_soap_credentials.soap_password is
  'Retired. Always ''''; 0426 forbids any other value. The password lives only in soap_password_sealed.';
