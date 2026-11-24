# Handoff: recruiting production readiness, the production walk (2026-11-09)

Paste this into a fresh chat. It continues the work "make recruiting 100% production ready" from the chat of 2026-11-09.

## Where things stand (verified 2026-11-09 ~11:25 CT)

- **Production serves `4ededa0`.** The release was dispatched on the approved release PR #2129, run of 17:16Z, success.
  - `GET https://360.silvicominc.com/api/version` returns commit 4ededa0, schema 0576 current, no drift, stepUp ready.
  - It contains both fixes:
    - **#2133** (merged b492e5e): "Close an application" is a per-role switch, `recruitment.close_application`, under Settings → Permissions → "Other permissions". It ships ON for the safety manager and is always held by the admin. `POST /api/recruitment/hire` is gated by `requireNamedPermission`, not by the roster section.
    - **#2135** (merged 899360e): with no road-test examiner on file, the road-test step offers the §391.33 licence equivalency (`cdl_equivalency`, licence scan required). The route is `RoadTestNoExaminer.vue` → qualification file → `RequirementDrawer`. The admin gets an optional "add an examiner" link.
- **AWS SSM `/silvicom/production/api` was set by the owner before the deploy, so the containers started at 17:24Z have it:**
  - `MAIL_FROM` = `Silvicom Inc <recruiting@silvicominc.com>`. This sender is verified in Brevo, and it is the sender for EVERY email the product sends.
  - `PSP_API_KEY_PRODUCTION`: token of 2026-10-13, which expires ~2026-12-12.
  - `PSP_ENVIRONMENT=production`, `PSP_PRODUCTION_ACKNOWLEDGED=true`, `PSP_ORDERS_ENABLED=true`, `PSP_UNIT_PRICE_USD=10`.
  - Already present: TELNYX_API_KEY, TELNYX_FROM, SMS_PROVIDER, BREVO_API_KEY, MAIL_PROVIDER, PSP_MOTOR_CARRIER_ID.
  - The assistant may NOT read SSM; the auto-mode classifier refuses it. If a setting needs changing, write a script and the owner runs it after `aws login --profile silvicom`.
- The plan log entries for both PRs are at the end of `docs/plans/recruitment/HIRING-WORKFLOW-AUDIT-2026-10-31.md` §7.

## Owner rulings (final, do not re-ask)

- **D1:** the countersigning representative is **Marija Varmeda, Safety Manager**.
- **D2:** the road-test examiner is optional; there may be several later. Until one is on file, use the §391.33 licence equivalency (Option 1, shipped in #2135).
- **D3:** the safety manager and the admin close applications; who else can is chosen in Settings (shipped in #2133).
- **D4:** invites come from recruiting@silvicominc.com (set).
- **D5:** Med-Stop ordering is on **now**.
- **D6:** PSP ordering is on **now** (set).
- **D7:** the policy text is correct and reviewed.
- **D8:** Curtis Hairston was a test driver; leave him alone.

## Open (in order)

1. **Check the owner's three in-app acts.** Use read-only `supabase db query --linked` against production; never write to it by hand. Find the table names in the migrations; don't guess. If any act is not done, tell the owner exactly what is left:
   - Settings → Recruiting → Representatives: Marija Varmeda, Safety Manager, added with her drawn signature, and the old "Miroslav Jokovic, Safety Assistent" deleted.
   - Settings → Recruiting → Road-test examiners: the misspelt "Maarija Varmeda" retired.
   - Settings → Med-Stop ordering: an order contact email and phone entered, and `orders_enabled=true`. At the last measurement it was false with no contact.
2. **Production walk with ONE test applicant.**
   - The owner supplies an email and phone they control that are not already in the system. Ask for them if they have not been given.
   - Walk it end to end: invite → SMS and email arrive from the new sender → applicant packet, documents and signatures → representative countersignature → PSP order → Med-Stop order → road step via the licence equivalency → "Close application" as the safety manager.
   - Also check that a recruiter sees the closed-row wording but cannot close.
   - Record every snag. Fix any real defect properly: worktree off origin/main, tests, mutation-check, PR, merge when green.
3. **Purge the test applicant** with the product's applicant purge, then confirm nothing is left of it.
4. **Report** finished vs remaining. Update memory (`hiring-module-position.md`), and close or update the claude-mem work_state list.

## Facts that cost time last chat

- In production before today: 2 invitations, 0 packet marks, 0 countersignatures, 0 filed applications.
- The October SMS failures were the retired Railway web service lacking TELNYX_API_KEY. On AWS, Caddy routes all `/api` to the API containers, and they hold the key.
- Orientation videos: none configured blocks nothing.
- The recruiter cannot see drug-test or Clearinghouse results. That is §382.401 and correct; do not "fix" it.
- `CEREMONY_OWNED_KINDS` (psp_report, handbook, road_test, employment_application) are refused on the generic compliance door, on purpose.
- Local test runs:
  - use `CI=true` for vitest;
  - `pnpm ci:local --job gates|typecheck|test-api|test-web|test-packages`; there is no job called `typecheck-build`.
- The test-api suites complianceDocuments and inventoryPurchases flake under load and pass alone.
- On macOS there is no `timeout`. Use `GIT_EDITOR=true git rebase --continue`, and check for conflict markers before continuing.
- Parallel chats share this tree. Always work in a worktree off origin/main, and append plan-log entries at the END of §7.
