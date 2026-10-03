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
| 1 | Denied sections still readable — `fuel_transactions` | **In review** | 0417; web halves #1239, #1240 merged |
| 1 | Denied sections still readable — `drivers` | Open | needs a name-only surface first (Q-DA3) |
| 3 | Stale JWTs after suspension | Open | design needed (Q-DA4) |
| 4 | Tenant identity across foreign keys | Open | 0 existing mismatches found in the two core tables checked |
| 5 (rest) | Nine production-only policies, five columns, ~20 indexes, two stale overloads, two FK differences | Open | the replay tests a database production is not |
| 6, 7 | SSL not enforced, network open, leaked-password protection off | Open | dashboard/CLI settings, not migrations |
| — | `efs_soap_credentials.soap_password` plaintext beside `soap_password_sealed` | Open | two-merge pattern |

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
