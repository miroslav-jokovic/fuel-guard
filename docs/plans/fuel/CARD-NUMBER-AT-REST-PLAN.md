# Card numbers at rest — plan

Status: step 1 (0486) built 2026-10-15. Steps 2–4 not started. Owner decisions owed: Q-CN1, Q-CN2.

Source: EFS security audit 2026-10-15, finding 1 (High). The audit's transport, credential and route
findings are recorded with the audit itself; this plan covers only where full card numbers are stored,
who can read them, and what the screens show.

## 1. What was measured (production, 2026-10-15)

| Table | Column | Rows carrying a full card number | Browser SELECT policy before 0486 |
|---|---|---|---|
| `fuel_cards` | `card_ref` | 194 of 194 | `org_id = auth_org_id()` |
| `efs_transactions` | `card_num` | 320 distinct cards | `org_id = auth_org_id()` |
| `declined_transactions` | `card_ref` | 3,985 rows | `org_id = auth_org_id()` |
| `efs_cards` | `card_number_sealed` | sealed (AES-256-GCM, org-bound AAD) | none (deny-all) |

So the one table that was designed for card numbers seals them (0171), and the three older ones keep them
in clear, readable by every member of the organisation with their own token. No other organisation's row
was readable.

The screens show full numbers too: the Fuel Log's EFS rows (`SourceRecordsTab.vue`, the `Card #` column),
the decline drawer (`DeclinesTab.vue`, `Card #`), and the anomaly detail (`AnomalyDetail.vue`). The card
roster already masks (`maskCardRef`).

## 2. Steps

Each step is its own merge, in this order, because a column and its first reader ship separately
(`lint:migration-ordering`, docs/MIGRATION-DISCIPLINE.md §the-deploy-window).

1. **0486 — the section gate (BUILT).** A RESTRICTIVE select policy on the three tables and
   `efs_processing_runs`: fuel `view` through `auth_section_or_default`; drivers refused. Matrix:
   `supabase/tests/card-tables-section-gate.test.mjs`. This closes the driver, technician and recruiter
   exposure. A fuel viewer still reads full numbers.
2. **Columns.** Add `card_last6` and `card_key` (a keyed HMAC of the normalised number) beside each clear
   column, and backfill them in the API, which holds the key. `card_key` is what matching needs. Every
   current use of the full number found so far is an equality or a suffix comparison
   (`cardRefsMatch`, `sameCardFill`, the card-fraud fold's `p_card_key`, the reconcile's last-six).
3. **Readers.** Matching moves to `card_key` / `card_last6`. The three screens show the masked form
   (`708305…NNNNNN`) through `maskCardRef`, and the browser selects stop naming the clear columns. The
   EFS SOAP paths keep reading the number they need from `efs_cards.card_number_sealed`, never from these
   columns.
4. **Empty the clear columns** a release after their last reader is gone, then a CHECK that keeps them
   empty, the way 0426 did for `soap_password`.

## 3. Open questions

**Q-CN1 — does anyone in the office need the full number on screen?** The WEX portal and EFS support
identify a card by its full number, and the decline drawer is where a dispatcher looks one up today.
- (a) No: the masked form plus truck and driver is enough, and the WEX portal shows the full number to
  someone signed in there. *Recommended*; it is what the card roster already does.
- (b) Yes, for fuel `manage` only: an audited API read that unseals one card on request.
- (c) Yes, for every fuel viewer: keeps today's exposure inside the office.

**Q-CN2 — the HMAC key.** `card_key` needs a key that is not `SECRETS_ENCRYPTION_KEY`, so rotating one
does not re-key the other.
- (a) A new `CARD_KEY_SECRET` on the api service. *Recommended.*
- (b) Derive it from `SECRETS_ENCRYPTION_KEY` with HKDF. One less variable, but rotating the encryption
  key then changes every `card_key`.

## 4. Progress log

- 2026-10-15 — step 1 written: 0486 and its matrix (73 cases; deleting one table's policy fails 7 of
  them). A separate driver clause was tried and removed: `auth_section_or_default` already pins `driver`
  to its shipped default, so the clause was a no-op mutant.
