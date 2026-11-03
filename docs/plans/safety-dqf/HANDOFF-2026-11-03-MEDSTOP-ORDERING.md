# Handoff — Med-Stop drug-test ordering, 2026-11-03

Paste this into a fresh chat. The owner has answered every question, so you build. Nothing below is built yet.

## Read first (in this order)

1. `docs/plans/safety-dqf/MEDSTOP-PLAN.md` **§7A.21**: the measurements, gaps G1–G6, proposal MSO1–MSO3 and the
   owner's rulings **D-MSO1–D-MSO4** (right under the questions). Then §7A.11 (UX3 as built, and the first-order
   runbook), §7A.12 (UX4, the hiring entry point) and §7A.14 (observed orders: the gender is read live and never
   stored).
2. `docs/plans/recruitment/HIRING-WORKFLOW-AUDIT-2026-10-31.md` **§14.1**: the owner's 16 hiring steps. This
   work is step 6 ("order the test from the applicant page, results there, upload if needed").
3. Med-Stop's spec is local only: `docs/Med-Stop/openapi.json` and `API-Key-access.md`. They are not in git
   (they are in the main checkout at `~/Projects/FuelGuard/docs/Med-Stop/`). **Never commit them, and never
   print the key.**

## Where things stand

- **Ordering is built but has never run in production.** The UX3–UX5d code is merged.
  - `medstop_credentials.orders_enabled` is false, and the office contact (e-mail and phone) is empty.
  - There are 0 `medstop.*` audit rows, and `medstop_applicant_creates` is empty.
  - The connection is healthy (hourly sweep). The key expires **2026-12-28**. The owner says the keys are fixed.
- How the office really orders, measured over 90 days: 126 pre-employment orders by hand in Med-Stop's portal,
  all drug tests.
  - One in three is cancelled, and 22 of 99 people needed a second or third order.
  - The "time" is a **4 pm deadline**: people are collected a median 2.2 h before it.
  - Applicants test near HOME (sites all over the US).

## The owner's rulings (D-MSO1–4). Build exactly these.

- **D-MSO1 — we text the applicant the site address ourselves.**
  - After **Place order**, read `GET /Request/{id}`: site name, address, city, zip, phone, requestdate/time,
    `code`, `registrationnumber`.
  - Write the step's drug-test appointment from it, through recruiting's existing writer `arrangeDrugTest`
    (`apps/api/src/modules/recruiting/applicantDrugTest.ts`; table of 0376, keyed on the invitation).
  - The office then presses one button that uses the EXISTING send: `POST …/drug-test-appointments/:id/send`
    → `sms_outbox`, English/Spanish.
  - Med-Stop still never texts anyone (D-MSUX5). `POST /Request/{id}/notify` stays off the allow-list. The
    client's own comment says why: it would text the driver.
- **D-MSO2 — "Go by" deadline.**
  - The drawer's "Collection day / Time" becomes "Go by", defaulting to the next business day at 16:00 in the
    carrier's zone. Today the drawer uses `DEFAULT_ORG_TIMEZONE`; read the carrier's (`carrierZone`).
  - The site-search ZIP is pre-filled from Part 1's home address.
  - When an order is open, the step shows a card for it (site, address, deadline, code, "Text it again")
    instead of **Order pre-employment test**.
- **D-MSO3 — no-show and cancel from the step.**
  - Two actions: **"Didn't go — mark no-show"** and **"Cancel order"**.
  - Each one: read `GET /Request/{id}/status` (read-before-write, Med-Stop's own guide), show what will be
    sent, POST once to `POST /Request/{id}/status`, audit it.
  - `MEDSTOP_WRITES` (`apps/api/src/modules/medstop/client.ts:68`) grows from 2 writes to 3, and its test pins
    exactly 3.
  - Then **Order again** opens the drawer filled from the last order.
  - ⚠ The close-out status codes come from the list `STATUSREQUESTCLOSE`, and nobody has read it yet. Read
    `/List/STATUSREQUESTCLOSE` (GET) or take the values from the status form; never guess them. Reads from the
    workstation need its IP on the key. If it is refused, ask the owner. Do not use the TEST key, which has no
    rights.
- **D-MSO4 — diluted negatives: optional, and the office decides.**
  - A negative-dilute result never orders anything by itself and never blocks anything.
  - The DER (admin or safety manager, `canReadTestingRecords`) sees **"Order a recollection"** on it: in
    Safety › Drug & Alcohol › Results, and on the hiring step for those roles. The recruiter never sees the
    result.
  - The drawer gets an **"Observed collection"** switch, off by default. On, it uses UX5d's same-gender path
    (`siteObservedFor`, `medstopSiteObserved`) with `observedreason` citing §40.197(b)(1).
  - Today `medstopOrderIsObserved` is decided by the reason alone. Add the override without changing what the
    return-to-duty and follow-up reasons force.
  - No carrier-wide setting.

## Suggested PRs (each its own worktree off `origin/main`)

1. **MSO1:** D-MSO1 and D-MSO2, no migration.
   - The order fills the appointment and adds the "Text it" press.
   - "Go by" default, ZIP from Part 1, the open-order card.
2. **MSO2:** D-MSO3, after you have read the close-out codes. The third write, pinned by its test.
3. **MSO3:** D-MSO4, the recollection with the observed switch.
4. **Then the first real order with the owner watching** (§7A.11 runbook):
   - The owner enters the office e-mail and phone, then switches ordering on (password).
   - One real order. Record the six unanswered points of §7A.14 in §9.
   - Leave ordering on only if all six hold.

The branch `claude/medstop-order-fills-step` (worktree `../FuelGuard-mso`) already carries this handoff and the
plan's D-MSO1–4. Build MSO1 on it, so the plan lands with the first code PR. Do not open a docs-only PR.

## Code map

- api `modules/medstop/`:
  - `order.ts`: `orderClient`, `prepareOrder`, `placeOrder`, `findSites`, `siteObservedFor`.
  - `routes/order.ts`: `/order/context|sites|preview`, `/order`. Gated on `MEDSTOP_ORDER_ROLES` = admin,
    safety_manager, recruiter.
  - `client.ts`: `read`, `write` (single-shot), `MEDSTOP_WRITES`.
  - `personTests.ts`: the step's Med-Stop card data.
  - `outcomes.ts`: what a result does.
- shared:
  - `medstopOrder.ts`: input schema, `buildMedstopOrderPayload` (preview == sent), reasons, roster map,
    observed rule.
  - `medstopTests.ts`: `negative_dilute`.
- web:
  - `components/medstop/OrderTestDrawer.vue`: one drawer, three entry points. Seeds: selection, applicant.
  - `composables/useMedstopOrder.ts`.
  - `features/recruitment/MedstopTestCard.vue`: emits `order`. `ApplicantRecordPage` swaps drawers; never
    nest SlideOvers.
  - `features/recruitment/DrugTestPanel.vue`: the appointment and its Send.
- Boundaries:
  - recruiting owns the appointment and medstop owns the order. `lint:boundaries` forbids either reading the
    other's internals.
  - Pass through an exported function or join at the route or queue layer, as UX5c did
    (`partOneFactsForMedstop`). Check the existing arrows in `scripts/check-feature-boundaries.mjs` before
    adding one, and state why in its comment.

## How to work (each of these bit recent sessions)

- Fresh worktree: `pnpm install --frozen-lockfile && pnpm --filter @silvicom/shared build:rn`, then copy
  `apps/web/.env` and `apps/api/.env` from the main checkout.
- Gates: `CI=true pnpm ci:local --job gates,typecheck` (~2 min); check `$?`.
- Full suites per package with `CI=true`. Web vitest needs
  `VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=ci-test-anon-key`. Always pass
  `< /dev/null`.
- Rules from the gates:
  - API tests build env with `testEnv({...})`, never `{...} as Env` (`envCasts.test.ts` fails on a cast).
  - A hand-written `<dl>` fails `lint:ui-adoption`; use `FactList`.
  - Every service query `.eq("org_id", …)`, proven with `expectOrgScoped(rec, ORG)` (pass the recorder, not
    `rec.queries`).
- Mutation battery for every PR, from a **bash** script: break each rule with `perl -0pi`, judge by the
  `Tests … failed` line, restore from a `cp` backup and `cmp` it. A survivor means a missing test.
- Look in a browser before merging any UI: `VITE_DEV_BYPASS=true node scripts/preview-local.mjs --port 43xx`
  and Playwright with one `ctx.route` on `/(api|rest/v1|auth/v1|storage/v1)/` returning raw JSON. **Read the
  port from the END of the log**: the server moves to the next free port, and an earlier session's server
  answers the old one with its own build.
- Migration number, if one is needed: the next free is **0559** today (0556 is #1968's; 0551–0558 are on main).
  Re-check by name immediately before merging.
- `gh pr merge` can outlast 120 s: run it in the background. After a merge to main, a stacked or sibling PR
  that edits the plan log conflicts: rebase it. Then `git diff --name-only origin/main HEAD` must list only your
  files; a newer main commit shows up there as foreign files until you rebase again.
- PR: the title is a release-notes line for an office reader. The body has the template's four headings. Merge
  yourself when CI is green. Production moves only on the owner's approved release.

## Not this work

- Travel: the owner withdrew Ignev and is researching a vendor. Nothing to build.
- PSP goes live with four settings the owner sets (HIRING-WORKFLOW-AUDIT §7, OF4). The 10/13 token expires
  around 12/12.
- Samba stays an external link (ruled); it is done.
