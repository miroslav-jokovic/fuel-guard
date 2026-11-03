# Handoff · 2026-11-03 (evening) · Recruiting ads — the audit track, and the leads-first path

**Paste this whole file into a fresh chat.** It continues the 2026-11-03 read-only audit of the ads and lead
plan and code, and the twelve fix PRs that followed it. It is a SECOND track beside the ads agent's own
(`HANDOFF-2026-11-03-ADS-STAGE1-B5.md`, the monitor). **That chat owns B5** — `modules/ads/monitor*`,
`ads_spend_hourly`, insights, reconcile. Do not build in its lane; coordinate through the progress log.
The earlier handoffs' traps and process (B2 §4–§5, D0 §4, B4b §4, B5 §4) and the 11/01 owner rulings
**still hold**.

## 0. Read first, in this order

1. `CLAUDE.md` (root): hard rules, the release train, "No workarounds", the two-merge rule.
2. This file's §1–§2, then `ADS-AGENT-BUILD-WORKFLOW.md`'s **progress log** from "2026-11-03, audit fixes A"
   onward, and its rows **D2** (line ~232) and **E4** (line ~243).
3. `RECRUITER-AUTOMATION-PLAN.md` §3 (D-RA2 *ruled*: nothing automated reaches a person who has not applied;
   D-RA12: contacts are evidence, a lead is not) and its open questions Q-RA6 (counsel) and Q-RA8 (retention).
4. The code the next steps build on:
   - `apps/api/src/modules/recruiting/routes/leads.ts` + `leads/leadQueue.ts` — queue, manual add, convert
     (now claimed first, 0561), do-not-contact (`leads/doNotContact.ts`).
   - `apps/api/src/modules/recruiting/routes/purge.ts` + `leads/leadPurge.ts` — admin deletion (0558).
   - `apps/api/src/modules/ads/leads/backfill.ts` (`catchUpSince`) + `backfillTick.ts`, and B4b's
     `ads_lead_fetch` (webhook) — every lead enters through `recruitingLeadSink` (`leads/leadSink.ts`).
   - `packages/shared/src/notificationsContract.ts` — `lead_new` and `lead_uncontacted` are in the CHECK
     since 0537 and NOTHING SENDS THEM; `modules/ads/alerts/adsAlerts.ts` is the recipient pattern
     (configured list → else active admins; never an alert addressed to nobody).

## 1. Done in this track (all merged to main unless marked)

| Fix | PR | Merge | What |
|---|---|---|---|
| A — the brake | #1967 | `6b95bfd` | A launch failed at the platform → `pause`, confirmed (not `paused` on the failure); `ADS_ENABLED=false` = pause-only brake (`orchestrator/brake.ts`); unreadable settings = killed, per org |
| B1 — alert category | #1968 | `71057fd` | 0559 (renumbered from 0556): `ads_pause_failed` in the bell's CHECK |
| B2 — alert sender | #1970 | `a56d951` | 3 failed pauses in a row → critical `ads_pause_failed`, hourly; `token_invalid`/`no_platform` → connection `failing` + `ads_token_expiring` daily (`alerts/`) |
| C — live spend | #1972 | `260918c` | Guard forecasts from max(our fold, Meta's account insights this month); unreadable → `month_spend_unknown` |
| D — keys, reconnect | #1973 | `9465763` | `SECRETS_ENCRYPTION_KEY_PREVIOUS` (platform-wide); reconnect to another account/Page refused while delivering |
| backfill | #1976 | `5ae41ea` | `failing` connections are read; disconnected-with-forms is a failure; each run reaches back to the last `done` run (`catchUpSince`, org's `lastDoneJobByKey`) |
| do-not-contact | #1978 | `7f15ce1` | `POST/DELETE /recruitment/leads/:id/do-not-contact` → `manual` hold in `sms_suppressions`; queue rows carry `do_not_contact` by number |
| lead deletion (db) | #1979 | `ab78eff` | 0558 `purge_lead`: empties an unconverted lead → anonymous tombstone (backfill sees a duplicate; contacts and the DNC hold stay) |
| lead deletion (route) | #1980 | `0d6960a` | `POST /recruitment/leads/:id/purge` (admin + fresh sign-in; `same_person`) |
| progress log | #1983 | `4e4ae3d` | entries for all of the above |
| M1 — headroom | #1986 | `b511a1b` | Account-limit fence reads `spend_cap − amount_spent` (`readAccountHeadroomCents`); 0 → `account_limit_reached` |
| M5 — phones | #1988 | `5db33b9` | 0560: a number written with `+` keeps its country (never `+1`-defaulted), in `normalisePhone` and `phone_e164` alike |
| M1 — convert once (db) | #1989 | `f5db30c` | 0561 `claim_lead_conversion` / `release_lead_conversion` (claim lapses after 2 min) |
| M1 — convert once (api) | #1990 | `3af17dd` | `convertLead` claims before the create; the loser gets 409 `conversion_in_progress` |

### 1a. Position at handoff
- Every PR of this track is merged; 0560 and 0561 are applied on staging (`migrate-staging` green for both).
- **Newest migration on main: `0561_lead_conversion_claim.sql`.** The ads chat is merging B5 (the monitor)
  today and may add more — confirm by NAME.
- **Scorecard (`pnpm ads:readiness`, unchanged by this track):** Orchestrator L3, Budget guard L3, Lead intake L1,
  Security L1, everything else L0.
- Worktree `../FuelGuard-ads-safety` holds this track's branches; all pushed. Remove it when done.

## 2. Open questions and blockers (do not route around them)

- **Owner — lead retention (Q-LS6 / Q-RA8):** how long an unconverted lead lives before `purge_lead` runs on
  its own. Fallback in force: nothing prunes automatically.
- **Owner — the launch gate.** Today a launch needs L4 for EVERY worker the campaign uses (§4R), so a hand-made
  creative can never launch. Proposed: L4 for the Publisher and the Guard only, so a human-uploaded creative
  can ship before the AI creative workers (C1–C5). **Do not build the upload path until this is ruled.**
- **Owner — Q-AD23 / Q-AD24**, unchanged (B2 handoff §2). Recommended answers are in the audit: a hard client
  deadline on launch below the lease, then read Meta back on a second delivery; get the app secret (also
  unblocks B4b live and `debug_token` expiry).
- **Counsel (Q-RA6, and Q-AD8 / G12):** first confirm the 2026-09-24 memo was ever SENT. Then: the Instant
  Form's SMS-consent wording (c) and the HB 3773 AI notice (a); whether a recruiter's contact `note` on a
  purged lead is redacted too. The consent checkbox is deliberately NOT built until (c) is ruled.
- **A flaky test that blocks deploys:** `document-reading/ocr/prepareOcrView.test.ts` failed on main's push CI
  for `ab78eff`, which made `migrate-staging` refuse to run (a later run applied 0558). Not ours — tell the
  hiring/OCR chat; re-run the failed job (`gh run rerun <id> --failed`) when it blocks a migration.

## 3. Next steps — the leads-first path (one PR each, ≤ ~500 lines; split above that)

Why this order (the audit's proposal, unchanged): leads are where the value is, and nothing below needs Meta
credentials, the monitor, or the AI creative pipeline. A campaign the owner builds by hand in Ads Manager
can feed this whole chain once B4b is live.

1. **D2a — log a contact.** `recruiting_contacts` (0553, append-only, evidence) has NO writer yet, and both
   "uncontacted" and the queue's "Contacted" need it. `POST /recruitment/leads/:id/contacts` (recruitment
   manage): method, direction, outcome (0553's list), note; `created_by` from the session; moves `new →
   contacted`. Register the writer in `scripts/table-writers.json`. Audit by lead id, never the note.
2. **D2b — `lead_new`.** When the sink stores a NEW lead (`leadSink.ts`, `stored === "new"`), ring the lead's
   assignee, else the configured recipients, else the people who hold recruitment manage — decide the
   fallback from the derived access matrix (`surfaceHolders`/`whoHasAccess`), never a hand-written role list.
   Dedupe per lead. A notification failure never fails the ingest (`notify()`'s rule).
3. **D2c — `lead_uncontacted`.** A scheduler (general lane, off unless `ADS_ENABLED`, one job per org with a
   `dedup_key`; check `docs/WORKER-DEPLOYMENT.md` first) rings when a lead is still `new` with no contact past
   `alerts.uncontacted_lead_minutes` (the setting exists, default 15). Business hours are an open question —
   ask before assuming.
4. **D2d — intake health.** The backfill's "failed for N hours" alert (#1976's "not done"): needs a lead
   category (migration first, its sender a merge later — the 0559/#1970 pattern), fed by `lastDoneJobByKey`.
   Plus D2's webhook-to-ledger latency metric.
5. **Owner-made campaigns.** Today the backfill reads only forms of campaigns WE created (`platform_refs
   .meta_form_id`). To take leads from a campaign the owner built by hand: list the Page's own forms
   (`GET /{page}/leadgen_forms`, Page token — FakeMeta already serves it) and ingest their leads with
   `campaign_id: null` (`platformLeadSchema` allows it). Raise the matching point with the ads chat: B5c's
   reconcile must not report a campaign we never created as `external_change` noise — that is THEIR file.
6. **E4 — the leads queue screen** (web, `apps/web` CLAUDE.md and `docs/DESIGN-SYSTEM-CONTRACT.md` first):
   queue + drawer — source beside each field, verdicts with their why, Contacted (D2a), Convert (handle 409
   `conversion_in_progress` and `already_converted` in words), Do not contact, Delete details (admin; the
   step-up prompt), manual add. Browser pass on the three fixtures (fail / empty / staging).
7. **Then, only after the owner rules on the launch gate (§2):** B2c with a human-uploaded creative, run
   through the pure claim and render checks — the first real ad without C1–C5.

Deferred on purpose (audit): Higgsfield + the Claude copywriter/art director/vision checker, preset
rotation, CAPI/outcome feed (wants ~200 leads/month and trains delivery on who was hired — an EEOC-shaped
risk), the analyst narration, TikTok, X, Indeed, Tenstreet.

## 4. Traps hit in this track (add to the earlier lists)

- **A migration number taken while yours is open breaks the deploy.** `supabase db push` refuses a migration
  older than the newest applied. Before merging, re-check main's newest by name; renumber yours above it
  (0556 → 0559 here), and fix every comment that names the number.
- **Two migration PRs always conflict on `supabase/schema.generated.sql`'s header line** ("Migrations
  applied: N (through …)"). Merge one, then merge main into the other, `node scripts/gen-schema-snapshot.mjs`,
  push — one more CI run. Plan for it.
- **Every PR appending to the workflow's progress log conflicts with every other.** This track moved all
  entries into one docs PR merged last. Keep doing that, or expect append-vs-append at each merge.
- **Rehearse the merge of everything pending before merging any of it**: a scratch branch from `origin/main`,
  merge each branch in order, `tsc` + the touched suites. It caught #1972's new required adapter method
  missing from #1970's test fake — both PRs were green alone.
- **A rehearsal worktree must not borrow another worktree's `node_modules`**: its `@silvicom/shared` resolves
  to the OTHER checkout's source and the failures are fake (`canPurgeLead is not a function`). Rehearse on a
  temp branch in a real checkout, then delete the branch.
- **The PGlite matrices import `packages/shared/dist`.** Build it for the branch you are on
  (`cd packages/shared && npx tsc -p tsconfig.build.json`); a dist from another branch fails the
  `phone_e164` parity check falsely.
- **GitHub said CONFLICTING where `git merge-tree` said clean** (a branch merged with main several times).
  Merge `origin/main` into the branch and push; GitHub then agrees.
- **A test fake that returns "no row" for a malformed id hides a missing UUID check**: Postgres answers 22P02,
  a 500. Make the fake refuse a non-uuid id (two mutants survived until it did).
- **The full api suite under load times out ~30 unrelated files.** Re-run the failing files alone before
  suspecting a change; re-run the whole suite when the machine is quiet.
- **GitHub auto-merge is OFF for this repository** and polling CI from a chat is not allowed: merge in rounds
  when the owner asks, checking each PR's `build` once per round.
- **A gate failing after a push is still a failed gate**: run every gate and read `$?` BEFORE pushing
  (`lint:ads-readiness` pins test titles literally — a retitled test needs its pin moved in the same PR).

## 5. Owner track

Unchanged from the B5 handoff §5 (Meta setup incl. the app secret, verify token, `leadgen` subscription and
the Page's Moderate task; Higgsfield, TikTok, X; brand kit; the first opening; spending values; presets;
counsel; Q-AD23/Q-AD24), **plus**: the retention ruling and the launch-gate ruling (§2); **each month,
setting the Meta account spending limit to the account's lifetime spend plus at most the monthly cap**
(#1986 — Meta's limit is lifetime, so a launch is refused when the room it leaves is above the cap or zero);
and approval of the next release, which now carries everything in §1.

## 6. First action in the new chat

1. Read §0.
2. Confirm main's HEAD and the newest migration **by name**; list open PRs and confirm none touches
   `modules/recruiting/leads/`, `recruiting_contacts` or `notificationsContract.ts` (the ads chat merges all day).
3. Run `pnpm ads:readiness`; it must match §1a (the ads chat's B5 may have moved Monitor up — that is fine).
4. Propose D2a's shape in one short message (route, body, status move, audit row, writer registration), then
   build it.
