# Database audit 2026-10-03 — decision log and open questions

Source: `docs/audits/2026-10-03-database/report.txt` (a second reviewer's audit, evidence beside it) and
this team's own audit of the same day. Every finding below was **re-checked against production or the
code before it was acted on**; where the report and the check disagreed, the check is what is recorded.
Production reads were `supabase db query --linked`, aggregate-only, and any role simulation ran inside a
`DO` block that raises, so nothing persisted.

## Status

| # | Finding | State | Where |
|---|---|---|---|
| — | Two SECURITY DEFINER RPCs callable with the anon key | **Fixed** | 0411, #1223 |
| — | No default-deny for new functions | **Fixed** | 0412, #1225 |
| C | `TRUNCATE`, `REFERENCES`, `TRIGGER`, `MAINTAIN` granted to client roles | **Fixed** | 0413, #1227 |
| 5 (part) | `revoke_push_tokens` missing on production; `notify_dedupe_key` unused | **Fixed** | 0414, #1231 |
| 2 | Receipts readable and deletable by any member | **Fixed** | 0415, #1235 |
| 1 | Denied sections still readable — `fuel_transactions` | **Fixed** | 0417 (restrictive `ftxn_section_read` on production, checked 2026-10-05); web halves #1239, #1240 |
| 1 | Denied sections still readable — `drivers` | Open | needs a name-only surface first (Q-DA3) |
| 3 | Stale JWTs after suspension | Open | design needed (Q-DA4) |
| 4 | Tenant identity across foreign keys | **First table built** | 0433 (#1314): `fuel_transactions` → `vehicles`/`drivers` composite keys. Measured 2026-10-05: 182 tenant FKs lack `org_id`, 0 cross-org links (see Q-DA5) |
| 5 (rest) | Nine production-only policies, five columns, ~20 indexes, two stale overloads, two FK differences | Open | the replay tests a database production is not |
| 6, 7 | SSL not enforced, network open, leaked-password protection off | Open (SSL off and `0.0.0.0/0` rechecked 2026-10-05) | dashboard/CLI settings, not migrations |
| — | `efs_soap_credentials.soap_password` plaintext beside `soap_password_sealed` | **Merge 1 of 2** | measured 2026-10-05: both rows `''` with a sealed copy; 0426 forbids any other value and the reader no longer falls back. Merge 2 drops the column once no deployed code writes `''` |

## What the report got right, and what this check changed

- **Finding 1 confirmed**: a role simulation as a `fleet_manager` with fuel, roster and loads all `none` read
  17,753 fuel rows and 292 driver rows; rows of another organisation: 0. Intra-organisation only.
- **Finding 2 confirmed** from the live policy text; the bucket held 0 objects, so nothing was exposed yet.
- **Finding C was undersold in my own first audit**: `TRUNCATE` bypasses RLS entirely.
- **Finding 4 not reproduced**: 0 existing cross-organisation links in `fuel_transactions` and
  `financial_entries`; no write probe was run. The report's "284 of 473 foreign keys" is unverified.
- **Q-REL6's "reconciling migration 0411"** (RELEASE-TRAIN-PLAN.md) was never merged and its number is now
  taken; the function half of it shipped as 0414.

## Decisions taken

- **D-DA1 (owner, 2026-10-03):** the Odometer screen is gated by the **fuel** section, not equipment — its
  rows are fuel fills with the driver's name. A technician loses it, an accountant gains it (#1240).
- **D-DA2 (owner, 2026-10-03, "follow your recommendations"):** drivers cannot delete a receipt, even their
  own upload — a receipt is evidence in a fuel-fraud case; deletion is for fuel `manage` (0415).
- **D-DA3:** the section gate is enforced **by the database**, not only by the API. Direct PostgREST access
  exists today and the API is bypassable, so a gate that lives only in the API is a gate for people who
  use the API.
- **D-DA4:** `notify_dedupe_key` is retired rather than restored — no caller exists (0414). Overrulable
  before it merged; restoring it is one statement.

## Open questions

- **Q-DA1 — Odometer in the sidebar.** The accountant now sees a `Fleet` group holding `Odometer` alone,
  because only the gate moved. Moving the item to the `Fuel` group removes that. Recommendation: move it,
  in a small follow-up with its own snapshot update.
- **Q-DA2 — Pages whose section need not imply fuel under an org override.** `/anomalies` and `/idling`
  (safety) and `/coverage` and `/reefer-coverage` (settings) read `fuel_transactions` directly. Under the
  shipped matrix every role that holds those sections also holds fuel view, so 0417 changes nothing for
  them; an organisation that grants safety or settings **without** fuel would see them empty, and empty
  reads as "nothing found". Candidate answers: (a) accept it, the org chose; (b) gate those queries on fuel
  in the page, as #1239 did; (c) move the reads behind the API, which owns its own gating.
  Recommendation: (b), when the first org does it — no org does today.
- **Q-DA3 — `drivers` rows.** Driver NAMES are needed by roles with no roster section (an accountant reads
  fuel lines by driver; idling and performance list names), so gating the row by roster would blank those
  screens. Candidate answers: (a) a name-only view and move the web's name reads onto it, then gate the
  table; (b) column privileges, which also break `select("*")` callers such as `ApplicantRecordPage`.
  Recommendation: (a). Also the home of the CDL-number and date-of-birth question from the first audit.
- **Q-DA4 — Stale tokens (finding 3).** `auth_org_id()` and `auth_role()` read JWT claims and never the
  membership, so a suspended or demoted user keeps direct database access until the token expires
  (`jwt_expiry` 3600 s on production, the live window not measured). `membershipCurrent.ts` fails open on a
  read error by SP7's decision. Candidate answers: (a) a membership check inside the policy helpers, with
  the per-row cost measured first; (b) move protected reads behind the API; (c) shorten the lifetime as a
  mitigation only. Needs the owner: it is a performance-versus-revocation trade.
- **Q-DA5 — Cross-tenant foreign keys (finding 4).** Composite `(org_id, id)` keys or invariant triggers,
  starting with `fuel_transactions` → `vehicles`/`drivers`. Nothing is wrong in the data today.

## Evidence update — 2026-10-05 (owner asked for the open questions resolved, measured, not assumed)

- **Q-DA5 measured and started.** Production catalog: 475 foreign keys; 189 join two tenant tables;
  **182 do not include `org_id`** (the report's "284 of 473" is wrong). All 180 with under 300k child
  rows joined in full under a 30 s statement timeout: **0 cross-org links**. The two largest sampled at
  1% (`scoring_attempts.transaction_id` 23,262 rows, `hos_duty_segments.driver_id` 4,950): **0**.
  Prevention, not repair. **0433 (#1314)** adds composite keys for `fuel_transactions` →
  `vehicles`/`drivers` (NOT VALID then VALIDATE; matrix fails 2/5 on main; both mutants killed; 126/126
  matrices pass). Next: the same pattern for the rest, core business tables first, one PR each, large
  tables validated in a quiet window.
- **Q-DA3 sized.** 5 web files read `drivers` directly (2 select `id, full_name`, 1 `select *`) plus 3
  embedded `drivers(...)` selects. Option (a) is therefore a small change. Its one real design question
  is the view's security: `security_invoker` would inherit the very roster gate it exists to avoid, so
  the name-only surface must be a definer view or function scoped by `auth_org_id()` and returning
  `id, full_name` only. **Recommendation unchanged: (a)**, built as: name-only function + matrix first,
  web reads moved second, roster gate on `drivers` third — three merges.
- **Q-DA4 measured.** Every policy calls `auth_org_id()` bare: **201 uses, 0 wrapped** as
  `(select auth_org_id())`. A bare STABLE call is evaluated per row, so a membership lookup placed inside
  the helper would cost one index probe **per row read**, not per query. That makes (a) unsafe as
  stated. **Recommendation: (a′)** in two steps — first wrap the helpers in every policy (Supabase's own
  RLS performance guidance; an initplan evaluated once per statement; a pure speed-up with no behaviour
  change, provable by the matrices), then add the membership check to the helper, which then costs one
  lookup per query. Until then (c), a shorter `jwt_expiry`, is the only mitigation; it is a dashboard
  setting and trades revocation delay against refresh traffic. Still the owner's call.

