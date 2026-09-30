-- 0396 — the pre-0260 role-literal policies read their section, or say by name why not.
--
-- SETTINGS-PERMISSIONS-PLAN.md SP11, §4b.2 item 10; the owner's ruling Q-SET11 (a), 2026-09-30:
-- "the rest (duty sessions and segments, HOS segments, load events, external payloads, message
-- reports, AI ask) read their section", and the hazmat policy joins the admin-only list with the
-- other integration settings. `lint:section-policies` grandfathered every policy written before 0260
-- wholesale, so none of these had ever been checked against the matrix, and none of them followed an
-- org's answer: an admin who took Dispatch away from their dispatchers left them writing duty sessions
-- through PostgREST, and one who granted it left them refused.
--
-- ── WHAT PRODUCTION HOLDS, RE-READ 2026-09-30 (pg_policies) ────────────────────────────────────
-- Read before writing this, because three of the eleven policies §4b.2 lists are in NO migration:
--
--   driver_duty_sessions      duty_sessions_manager_write  ALL  [admin, fleet_manager, dispatcher]  (0086)
--                             duty_sessions_write          ALL  [admin, fleet_manager, dispatcher]  ⚠ no migration
--   duty_equipment_segments   duty_segments_manager_write  ALL  [admin, fleet_manager, dispatcher]  (0086)
--                             duty_segments_write          ALL  [admin, fleet_manager, dispatcher]  ⚠ no migration
--   hos_duty_segments         hos_duty_segments_write      ALL  [admin, fleet_manager]              (0109)
--   load_events               load_events_manager_insert   INSERT  dispatch/manage, wrapped         (0293)
--                             load_events_insert           INSERT  [admin, fleet_manager, dispatcher]  ⚠ no migration
--   load_external_payloads    load_external_payloads_select  SELECT [admin, fleet_manager, dispatcher, auditor] (0150)
--   message_reports           reports_admin_read           SELECT [admin, safety_manager] OR reported_by = self (0096)
--   hazmat_policies           hazmat_policies_admin_write  ALL  auth_role() = 'admin'               (0092)
--
-- The three unmigrated ones are DRIFT (MIGRATION-DISCIPLINE.md §1): `git log -S` finds no commit that
-- ever named them, and `supabase/schema.generated.sql`, built from the migrations, does not hold them.
-- Each is a byte-for-byte duplicate of a migrated twin on the same table — same command, same
-- predicate. Dropping a duplicate of a permissive policy changes nothing; KEEPING it would have made
-- this migration a no-op, because a permissive literal ORs with its wrapped twin and the literal keeps
-- admitting a dispatcher the org has taken Dispatch away from. So they are dropped here, `if exists`,
-- which is also how the local and production schemas stop differing.
--
-- ⚠ PRODUCTION MUST BE RE-READ BEFORE THIS MERGES. The predicates above are a 2026-09-30 reading; if
-- `pg_policies` on these seven tables no longer matches it, stop and re-derive — the argument for
-- every line below is "same predicate, now wrapped", and it holds only for the predicate it was read
-- from.
--
-- ── EACH LIST, AGAINST THE MATRIX (arithmetic, the way D-PERM9 and D-PERM11 were decided) ────────
--   duty sessions + segments  [admin, fleet_manager, dispatcher] = rolesThatManage('dispatch') exactly.
--                             The only human surface over them is the dispatch board (the `loads`
--                             module's dispatchLoads reads and ends shifts), so the section is
--                             dispatch; the driver writes through the RPCs, and the restrictive
--                             `*_driver_no_*` policies stay as they are.
--   hos_duty_segments         [admin, fleet_manager] equals THREE sections' manage sets — fuel,
--                             equipment and settings — so equality alone does not choose one, and the
--                             Ask AI list is the standing warning against letting a coincidence choose
--                             (Q-SURF7). D-PERM11 does choose: a table belongs to the section whose
--                             page edits it. Nothing in any client writes this table; it is filled by
--                             the Samsara HOS sync, whose only person-initiated door is
--                             `POST /api/integrations/samsara/sync-hos`, `requireSection("settings")`
--                             — Data & sync. → settings/manage.
--   load_external_payloads    [admin, fleet_manager, dispatcher, auditor] = rolesThatCanView('dispatch')
--                             exactly; read by the dispatch board beside the load it describes.
--   message_reports           [admin, safety_manager] equals NO section's set (safety manage adds
--                             fleet_manager), so wrapping it would have had to invent an answer
--                             (D-PERM9). The owner ruled Q-SET13 (c), 2026-09-30: the role half goes.
--                             Nothing reads the queue — no client selects `message_reports`, the API
--                             only inserts (`messaging/routes/messages.ts`), and the review queue
--                             0096's comment describes was never built — so it is a client read no
--                             product surface uses, the argument that closed `audit_select` (0391).
--                             When the queue is built it reads through the API behind a section gate
--                             (the SP4 pattern); choosing that section waits until the queue exists.
--                             The `reported_by = auth_user_id()` half stays: `reports_own` (0096) is
--                             an INSERT a client may ask `RETURNING` of, and under RLS the returned
--                             row must pass a SELECT policy too. Renamed `reports_own_read`, because a
--                             policy called `admin_read` that admits no admin is a lie the next reader
--                             has to see through; `lint:section-policies` honours the drop, so 0096's
--                             definition is not read as live.
--   hazmat_policies           admin only (Q-SET11 (a): the hazmat policy is on the admin-only list the
--                             API reads as `requireAdminOnly("hazmat.policy")`). Re-created in the
--                             `= any (array[...])` spelling, identical in meaning, so the gate READS it
--                             and the waiver below names the ruling instead of being dead text.
--
-- ── WHY APPLYING THIS IS SAFE IN THE DEPLOY WINDOW ─────────────────────────────────────────────
-- Policies only; no TypeScript reads anything new. The one read that NARROWS — an admin or safety
-- manager selecting other people's message reports — has no caller in any client or in the API, so
-- there is nothing for a merge served ahead of this migration to disagree with. With no override row, `auth_section_or_default`
-- answers exactly the role list it wraps (D-PERM4), so every claim-less token — every token until an
-- admin edits the matrix — gets the answer it had. `sp11-role-literal-policies.test.mjs` asserts that
-- for every role on every re-pointed policy, and that an org grant or revoke now moves each one.
--
-- cross-module-waiver: one ruling (Q-SET11) applied to policies on tables in six modules
-- (driver-app, samsara, loads, mcleod, messaging, hazmat); batching by module would be six migrations
-- performing the same mechanical edit, for the reason 0293 and 0300 gave.
--
-- Rollback: re-create each policy with the predicate it carried before (0086, 0109, 0150, 0096, 0092), and
-- re-create the three drift duplicates from the table above if anybody wants them back.

-- ── driver_duty_sessions (dispatch) ─────────────────────────────────────────────────────────────
drop policy if exists duty_sessions_write on driver_duty_sessions;
drop policy if exists duty_sessions_manager_write on driver_duty_sessions;
create policy duty_sessions_manager_write on driver_duty_sessions for all
  using (org_id = auth_org_id() and auth_section_or_default('dispatch', 'manage',
    auth_role() = any (array['admin','fleet_manager','dispatcher'])))
  with check (org_id = auth_org_id() and auth_section_or_default('dispatch', 'manage',
    auth_role() = any (array['admin','fleet_manager','dispatcher'])));

-- ── duty_equipment_segments (dispatch) ──────────────────────────────────────────────────────────
drop policy if exists duty_segments_write on duty_equipment_segments;
drop policy if exists duty_segments_manager_write on duty_equipment_segments;
create policy duty_segments_manager_write on duty_equipment_segments for all
  using (org_id = auth_org_id() and auth_section_or_default('dispatch', 'manage',
    auth_role() = any (array['admin','fleet_manager','dispatcher'])))
  with check (org_id = auth_org_id() and auth_section_or_default('dispatch', 'manage',
    auth_role() = any (array['admin','fleet_manager','dispatcher'])));

-- ── hos_duty_segments (settings — Data & sync is the page that writes it) ───────────────────────
drop policy if exists hos_duty_segments_write on hos_duty_segments;
create policy hos_duty_segments_write on hos_duty_segments for all
  using (org_id = auth_org_id() and auth_section_or_default('settings', 'manage',
    auth_role() = any (array['admin','fleet_manager'])))
  with check (org_id = auth_org_id() and auth_section_or_default('settings', 'manage',
    auth_role() = any (array['admin','fleet_manager'])));

-- ── load_events: the drift duplicate goes; `load_events_manager_insert` (0293) already reads dispatch
drop policy if exists load_events_insert on load_events;

-- ── load_external_payloads (dispatch, view) ─────────────────────────────────────────────────────
drop policy if exists load_external_payloads_select on public.load_external_payloads;
create policy load_external_payloads_select on public.load_external_payloads for select using (
  org_id = public.auth_org_id()
  and public.auth_section_or_default('dispatch', 'view',
    public.auth_role() = any (array['admin','fleet_manager','dispatcher','auditor']))
);

-- ── message_reports: a reporter reads their own; nobody reads the queue by role (Q-SET13 (c)) ─────
drop policy if exists reports_admin_read on message_reports;
drop policy if exists reports_own_read on message_reports;
create policy reports_own_read on message_reports for select
  using (org_id = auth_org_id() and reported_by = auth_user_id());

-- ── hazmat_policies: admin only, by ruling ──────────────────────────────────────────────────────
drop policy if exists hazmat_policies_admin_write on hazmat_policies;
-- section-policy-waiver(hazmat_policies_admin_write): admin only by Q-SET11 (a) — the hazmat policy is an integration setting on ADMIN_ONLY_CAPABILITIES ("hazmat.policy"), not a section question; the admin role is not editable (D-PERM7), so no org answer may reach it
create policy hazmat_policies_admin_write on hazmat_policies for all
  using (org_id = auth_org_id() and auth_role() = any (array['admin']))
  with check (org_id = auth_org_id() and auth_role() = any (array['admin']));
