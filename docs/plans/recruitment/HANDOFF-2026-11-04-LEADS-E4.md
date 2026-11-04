# Handoff · 2026-11-04 · Recruiting ads — the leads-first path, after D2

**Paste this whole file into a fresh chat.** It continues `HANDOFF-2026-11-03-LEADS-FIRST.md`, whose steps 1–4 (D2)
are done and merged. This is still the SECOND track beside the ads agent's own
(`HANDOFF-2026-11-04-ADS-STAGE1-C5.md`, the Checker and compose). **That chat owns `modules/ads/creative/`, the
monitor and reconcile.** Coordinate through the progress log. The earlier handoffs' traps and process, and the 11/01
owner rulings, **still hold**.

## 0. Read first, in this order

1. `CLAUDE.md` (root) and `apps/web/CLAUDE.md`: hard rules, the release train, "No workarounds", the two-merge rule.
2. This file, then `HANDOFF-2026-11-03-LEADS-FIRST.md` §2 (open questions) and §4 (traps).
3. `ADS-AGENT-BUILD-WORKFLOW.md`: the progress log's entry "2026-11-04, D2", and row **E4** (Phase E).
4. `docs/DESIGN-SYSTEM-CONTRACT.md` before any screen.
5. The code E4 sits on:
   - `apps/api/src/modules/recruiting/routes/leads.ts`: queue, manual add, convert, contacts, do-not-contact.
   - `apps/api/src/modules/recruiting/routes/purge.ts` (`POST /leads/:leadId/purge`: admin + fresh sign-in).
   - `apps/api/src/modules/recruiting/leads/leadQueue.ts`: `LeadQueueRow` is the screen's row.
   - `packages/shared/src/recruiting/leads/leadContract.ts`: `leadContactSchema`, `manualLeadSchema`, status lists.
   - `packages/shared/src/notificationsContract.ts`: `deepLinkFor` has no `lead_*` case yet.

## 1. Done in this track (all merged to main)

| Step | PR | Merge | What |
|---|---|---|---|
| D2a, log a contact | #1996 | `d969a1b` | `POST /recruitment/leads/:id/contacts`; contact first, then a conditional `new → contacted`; purged lead refused 409 `lead_purged`; audit never holds the note |
| D2b, `lead_new` | #2001 | `066e044` | Rings from `recruitingLeadSink.accept` on `stored === "new"`, so a typed-in lead rings nobody. Carrier's list, else `sectionManagers` (recruitment manage). `queue/handlers/leadSinkFor.ts` carries the ads setting across (D-AD17) |
| D2c, `lead_uncontacted` | #2004 (carried #2003, closed) | `66525f1` | Scheduler `lead-uncontacted`, general lane, 5 min, off unless `ADS_ENABLED`. `warning`, once per lead. Skips manual channels, leads with a contact row, numbers held from contact |
| D2d, category | #2004 | `66525f1` | 0563 `lead_intake_failing`, applied on staging |
| D2d, sender | #2007 | `b9d8a8b` | `alerts/intakeAlerts.ts`: a failed backfill with the last `done` run ≥ 3 h old or none; a webhook lead over 5 min. Once a day per connection. `latency_ms` on the `ads_lead_fetch` job's stats |
| Progress log | #2011 | `f0c4253` | The entry for all of the above |

### 1a. Position at handoff
- **Newest migration on main: `0563_lead_intake_failing_alert.sql`.** #2009 (`claude/idp1-role-permissions`) is open with
  `0564_org_role_permissions.sql`, and the ads chat merges all day. Confirm by NAME before using a number.
- **Scorecard (`pnpm ads:readiness`):** Orchestrator L3, Budget guard L3, Copywriter L2, Art director L2,
  Renderer / Higgsfield client L2, Monitor L1, Lead intake L1, Security L1, everything else L0.
- **D2's done-when is NOT met.** Latency is measured in code, not on staging, and the escalation has not fired there.
  Nothing in D2 has met a real Meta lead. Both wait for a live Meta connection (the owner track, §5).
- Worktree `../FuelGuard-ads-safety` is this track's, so build there. `../FuelGuard-ads-d1` is the ads chat's: do not
  switch its branch. Remove `FuelGuard-ads-safety` only when this track ends.

## 2. Rulings and open questions

- **Ruled by the owner, 2026-11-04:** `lead_uncontacted` rings at any hour. No business-hours rule; each person's quiet
  hours and mutes apply. This rules the alarm only, not the plans' "speed to first contact" report.
- **Owner, not ruled:** `BACKFILL_STALE_HOURS` = 3 is this track's default, one constant in `intakeAlerts.ts`.
- **Owner, unchanged:** lead retention (Q-LS6 / Q-RA8); the launch gate (L4 for Publisher and Guard only?). **Do not
  build the upload path until that is ruled.** Q-AD23 / Q-AD24.
- **Counsel, unchanged:** Q-RA6, Q-AD8 / G12; first confirm the 2026-09-24 memo was ever SENT. The consent checkbox is
  deliberately NOT built until (c) is ruled.
- **Known gaps, recorded and accepted for now:** a lost `lead_new` ring has only `lead_uncontacted` behind it; a backfill
  that never runs (dead worker, `ADS_ENABLED` off) cannot report itself; nothing writes `assigned_to`, so neither alert
  has an assignee tier; the first sweep after switch-on rings every old lead still waiting, once.

## 3. Next steps (one PR each, ≤ ~500 lines; split above that)

1. **E4 — the leads queue screen.** Nothing exists yet: no leads code in `apps/web`, and `features/ads/` does not
   exist. Split it:
   - **E4a, read a lead's contacts.** There is NO read route: `recruiting_contacts` has a writer and no reader, so the
     drawer cannot show who already called. `GET /recruitment/leads/:id/contacts` (recruitment view), org-scoped,
     newest first, purged leads included (contacts are evidence, D-RA12).
   - **E4b, the screen.** A new surface in `surfaceCatalogue.ts` and a route in `router/routes/recruitment`, with
     `deepLinkFor` gaining `lead_new` and `lead_uncontacted`. Queue + drawer: source beside each field, verdicts with their
     why, Contacted (D2a; **disable the button in flight**, a double press writes two append-only rows), Convert (409
     `conversion_in_progress` and `already_converted` in words), Do not contact, Delete details (admin; the step-up
     prompt), manual add. Browser pass on the three fixtures (fail / empty / staging).
   - **Decide first, and say so in one message:** workflow Phase E places screens in `apps/web/src/features/ads/`, but
     this page is the `recruitment` section's and its doors are recruitment's. Recommendation: `features/recruitment/`,
     with Phase E's line corrected in the same PR. `lint:boundaries` forbids reaching into another feature's internals.
2. **Owner-made campaigns (handoff §3 step 5).** The backfill reads only forms of campaigns WE created. List the Page's
   own forms (`GET /{page}/leadgen_forms`; FakeMeta serves it) and ingest with `campaign_id: null`. **Raise it with the
   ads chat first:** reconcile must not report a campaign we never created as `external_change` noise, and that is their
   file. Note `fetchWebhookLead` also answers `not_ours` for such a form, so the webhook needs the same answer.
3. **Only after the owner rules on the launch gate:** B2c with a human-uploaded creative.

Deferred on purpose, unchanged: CAPI/outcome feed, analyst narration, TikTok, X, Indeed, Tenstreet.

## 4. Traps hit in this track (add to the earlier lists)

- **Check a merge's exit code before `git add -A`.** A script carried on past conflicts and committed the markers. Only
  the gates caught it. Stop on a non-zero merge, and list the unmerged files you expect.
- **Job kinds collide at the end of a list.** A new kind goes in `org/jobs.ts`, `worker.ts` `KIND_CAPS` and
  `handlers/index.ts`, where every other chat also appends. Conflicts are append-vs-append: keep both.
- **A PR base of another open branch:** `gh pr edit --base main` before its base lands makes it mergeable too early.
  Retarget a sender only after its migration PR has merged, and keep it held until `migrate-staging` is green.
- **Stacks:** a later PR that resolved a conflict can land an earlier one. Prove it before closing: `git merge-tree
  --write-tree` of main and the branch must equal `origin/main^{tree}`. A merge commit pushed to the earlier branch
  stops GitHub marking it merged by itself.
- **`vi.mock` of `org/index.js` breaks any test importing `SCHEDULERS`** (every start function is read at import).
- **The shared recorder fixture does not apply `lte`.** A test about a cutoff needs a table function that does.
- **zsh does not split `$VAR`.** A mutation loop running `vitest run $T` ran no tests and printed nothing. Print the
  green base count first, and treat a mutant with no count as not run.
- **Migration numbers can collide across open PRs, not only with main.** List open PRs' migrations at merge time.
- **`build` is the required check and queues behind the slowest shard**, and auto-merge is not allowed here, so "merge when
  green" is one check per ask. Do not bypass it with an admin merge.

## 5. Owner track

Unchanged from the 11/03 handoff §5 (Meta setup incl. the app secret, verify token, `leadgen` subscription and the
Page's Moderate task; brand kit; the first opening; spending values; presets; counsel; Q-AD23/Q-AD24; the monthly Meta
spending limit), **plus**: approval of the next release, which now carries D2 and migration 0563; the retention and
launch-gate rulings; and whether 3 hours suits as the backfill alert's threshold.

## 6. First action in the new chat

1. Read §0.
2. Confirm main's HEAD and the newest migration **by name**; list open PRs and confirm none touches
   `modules/recruiting/leads/`, `routes/leads.ts`, `surfaceCatalogue.ts` or `apps/web/src/router/routes/recruitment`.
3. Run `pnpm ads:readiness`; it must match §1a (the ads chat's C5 may have moved a worker up, which is fine).
4. Work in `../FuelGuard-ads-safety` on a new branch from `origin/main`.
5. Propose E4a's shape and the `features/recruitment/` placement in one short message, then build E4a.
