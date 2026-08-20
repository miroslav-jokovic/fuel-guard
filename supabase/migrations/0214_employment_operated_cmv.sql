-- 0214 — `operated_cmv` on driver_employment_history: the discriminator §391.21(b)(11) turns on.
--
-- 0208 shipped this table against a single three-year window, which is §391.21(b)(10). The verified
-- regulation has TWO lists and they ask different questions (HIRING-PLAN.md D-HIRE1):
--
--   (b)(10) — employers during the 3 years preceding the application. ALL employment.
--   (b)(11) — employers during the 7-year period preceding those 3 years, "but only for which the
--             applicant was an operator of a COMMERCIAL MOTOR VEHICLE."
--
-- So a "10-year employment history" is not ten years of everything, and gap arithmetic must stop at
-- the three-year boundary. An applicant who spent year 5 in a warehouse owes no explanation, and a
-- product that reports a gap there is wrong in the direction that costs somebody a job.
--
-- WHY THIS IS NOT `dot_regulated`, which the table already has. They are near neighbours and come
-- apart in both directions: a dispatcher at a DOT-regulated carrier operated no CMV, and a driver on
-- a purely intrastate operation may have operated one for an employer outside the FMCSRs.
-- `dot_regulated` answers "does §391.23(a)(2) oblige us to write to them"; `operated_cmv` answers
-- "does §391.21(b)(11) oblige the applicant to have listed them". Two obligations, two columns.
--
-- NULLABLE, and that is the honest default rather than a lazy one. Every row that exists today was
-- entered by the office against a three-year window where the question was never asked, so `false`
-- would be a fact nobody supplied and `true` would be worse. Null reads as "not stated" and the
-- coverage calculation treats it as not-CMV for the (b)(11) list while never claiming the applicant
-- said so.
alter table public.driver_employment_history
  add column if not exists operated_cmv boolean;

comment on column public.driver_employment_history.operated_cmv is
  'Did the applicant operate a commercial motor vehicle in this job? The §391.21(b)(11) discriminator
   for years 3-10. Distinct from dot_regulated, which is the §391.23(a)(2) inquiry obligation. Null =
   not stated (every pre-0214 row).';
