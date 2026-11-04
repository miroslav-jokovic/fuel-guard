# Handoff · 2026-11-04 · After the leads screen — owner-made campaigns

**Paste this whole file into a fresh chat.** It continues `HANDOFF-2026-11-04-LEADS-E4B3.md`, whose steps 1–3 are done
and merged. This is still the SECOND track beside the ads agent's own (`HANDOFF-2026-11-04-ADS-STAGE1-TRACKS.md`).
**That chat owns `modules/ads/`, the monitor and reconcile, and `features/ads/`.** Coordinate through the progress log.
The earlier handoffs' traps and process, and the 11/01 owner rulings, **still hold**.

This file is untracked in the `FuelGuard-ads-safety` worktree. It lands in this track's next docs PR.

## 0. Read first, in this order

1. `CLAUDE.md` (root): hard rules, the release train, "No workarounds", the two-merge rule.
2. This file, then `HANDOFF-2026-11-04-LEADS-E4B3.md` §2 (rulings) and §5 (traps), and the E4 handoff's §4 (traps).
3. `ADS-AGENT-BUILD-WORKFLOW.md`: the progress log's entries "E4" and "B2c split + B2c1". `ADS-AGENT-PLAN.md` §9: Q-AD30, Q-AD31.
4. The code step 2 sits on:
   - `apps/api/src/modules/ads/leads/backfill.ts` (forms come only from `platform_refs.meta_form_id`), `leadFetch.ts`
     (`fetchWebhookLead` answers `not_ours` for any other form), `leadgenWebhook.ts`.
   - `packages/shared/src/ads/adsReconcile.ts` (`not_ours`, severity), `modules/ads/monitor/reconcile.ts`.
   - `packages/shared/src/ads/contracts.ts` (`platformLeadSchema`: `campaign_id` nullable).
   - `platforms/simulator/fakeMetaForms.ts` (`GET /{page}/leadgen_forms` is already served).

## 1. Done in this track (all merged to main)

| Step | PR | Merge | What |
|---|---|---|---|
| E4a–E4b2 | #2015, #2019, #2020 | `4decc9b`, `f126b77`, `4306819` | Contacts read, one lead by id, the Leads tab reading only |
| E4b3, working a lead | #2026 | `3f30e30` | Log a contact, make an applicant, hold or lift do-not-contact |
| E4b4, delete and add | #2028 | `19cd96f` | Delete details (admin, password), add a lead by hand |
| Docs | #2031 | `d65015f` | Progress log, Q-AD30, Q-AD31, both handoffs. #2014 closed, its file carried |

### 1a. Position at handoff
- **Main:** `3c87eda`, CI green. `19cd96f` and `d65015f` also passed on main.
- **Newest migration on main: `0567_recruiting_carrier_questions.sql`.** Other chats merge all day, so confirm by NAME.
- **Scorecard (`pnpm ads:readiness`, run on `3c87eda`):** Orchestrator L3, Budget guard L3, Copywriter L2, Art director L2,
  Checker L2, Renderer L2, Monitor L1, Lead intake L1, Security L1, Publisher / Outcome feed / Analyst L0.
- **Open from the ads chat:** #2033 (campaign moves). B2c2 has no PR yet, and it matters here (§3 step 1).
- **Nobody has used the Leads tab on staging as a recruiter.** Every browser pass was an admin on stubbed data. The real
  password check on Delete details has never run: the step-up route was stubbed.
- **The worktree is detached at `3c87eda`.** `../FuelGuard-ads-safety` is this track's, so build there. `../FuelGuard-ads-d1`
  is the ads chat's: do not switch its branch. Remove `FuelGuard-ads-safety` only when this track ends.
- **Merged branches not yet deleted:** `claude/leads-e4b3-work-a-lead`, `claude/leads-e4b4-delete-add`,
  `claude/leads-docs-e4`, `claude/leads-handoff-e4`. Delete them only if the owner asks.

## 2. Rulings and open questions

- **Update, same day: §3 step 1 is answered by the owner.** B2c2 (#2034) lands first. Reconcile: leave it, then a mark of
  the owner's own (Q-AD33). Consent: a blocker until counsel answers (Q-AD32), so **§3 step 2 does not start**. An
  unknown form is dropped in `receiveLeadgenDelivery`, before `fetchWebhookLead`, so step 2 also needs the carrier found
  by `page_ref`. The list below is as written before those answers.
- **Owner to decide:** Q-AD31, whether the queue sorts by match (recommended: leave it newest first for now).
- **Counsel:** Q-AD30, whether a purged lead's notes stay withheld (withheld meanwhile, by the owner's ruling).
- **Unchanged:** `BACKFILL_STALE_HOURS`; lead retention (Q-LS6 / Q-RA8); the launch gate (**do not build the upload path
  until ruled**); Q-AD23 / Q-AD24; counsel's Q-RA6, Q-AD8 / G12; confirming the 2026-09-24 memo was ever SENT; the consent
  checkbox staying unbuilt until (c) is ruled.
- **New, found writing this handoff, none ruled:**
  - **Reconcile's `not_ours` is deliberate, not an oversight.** An owner-made campaign that is ACTIVE reports as
    `critical`, because it spends from the same account. Earlier handoffs call this "noise". Silencing it would hide real
    spend, so do not assume that is the answer. See §3 step 1.
  - **Consent on a form we did not write.** Our forms carry our wording; an owner-made form carries whatever the owner
    typed. Whether its leads may be worked the same way is a question for the owner and counsel (Q-AD8 / G12 is the
    nearest). Ask before ingesting.

## 3. Next steps (one PR each, ≤ ~500 lines of code; split above that)

1. **Settle the three questions first. No code until they are answered.** Say so in one message.
   - **With the ads chat, who changes the form lookup?** B2c2 teaches intake `meta_form_ids` in the same places this
     step touches (`backfill.ts`, `leadFetch.ts`, `leadgenWebhook.ts`). Recommendation: B2c2 lands first, and this builds
     on it. Two chats in those lines is the conflict to avoid.
   - **With the ads chat and the owner, what does reconcile do with a campaign the owner made on purpose?** Candidates:
     (a) leave it, one alert per campaign, and it is true; (b) the owner marks a campaign as theirs, which lowers the alert
     but keeps it counted, needing a new record; (c) the severity drops for all of them, which hides spend nobody here
     approved. **Recommendation: (a) until the owner actually runs one, then (b). Not (c).** It is their file.
   - **With the owner, is the consent question above a blocker?**
2. **Owner-made leads, once step 1 is settled.** Split it:
   - **Backfill:** list the Page's own forms (`GET /{page}/leadgen_forms`, Page token) and ingest with `campaign_id: null`.
     A form we made must not be read twice, so subtract ours by form id.
   - **Webhook:** `fetchWebhookLead` needs the same answer in place of `not_ours`. Check what its caller does with
     `not_ours` today before changing it.
   - **Expect:** no opening on such a lead, so no verdicts; answers outside `META_FORM_CATALOGUE` read as sent. Check the drawer
     shows that sensibly (§4 of the E4B3 handoff has the browser recipe, §5 here the step-up seed).
3. **A docs PR, merged last:** the progress-log entry, what step 1 ruled, and this file.
4. **Only after the owner rules on the launch gate:** B2c with a human-uploaded creative. Check with the ads chat what
   B2c1 and B2c2 have already covered before starting.

Deferred on purpose, unchanged: CAPI/outcome feed, analyst narration, TikTok, X, Indeed, Tenstreet.

## 4. Left out of the screen on purpose, and known limits

No search; no opening title on a row; a queue row cannot tell a purged lead from unreadable details; two matching applicants
read as "matching applicant 1" and "2"; manual add reports "phone or email" only once channel and name are valid. If staging
shows any of these hurts a recruiter, each is a small PR of its own.

## 5. Traps hit in this track (add to the earlier lists)

- **A mocked `useConfirm` hid a real bug.** Over a `SlideOver` it closes the drawer. Run the browser pass for every write,
  and assert the request itself: that is what showed `DELETE /leads//do-not-contact`.
- **`verifyStepUp` needs a Supabase session, which dev bypass lacks.** Seed `sb-example-auth-token` in `localStorage` with
  `addInitScript` and stub `/api/auth/step-up`, or the retry never runs and the prompt only says the password failed.
- **vue-query's `isPending` updates a tick late.** A guard against a double press needs a flag set at once.
- **The browser-pass harness:** `extname(".html")` is empty, so a fallback to `index.html` needs the name, or Playwright
  downloads the page.
- **A stacked PR's CI run tested its old base.** After retargeting, the run does not restart. Check that newer main shares
  no files with the PR, and `git merge-tree --write-tree`.
- **A plan-file PR will conflict with the ads chat's.** Both append to the progress log. Keep both, theirs first.
- **Merging:** the app's permission check refused "merge when CI is green" as unreviewed, and accepted the owner's plain
  "merge" and "merge #N". Do not route around a refusal. Auto-merge is off on this repo, and the app wakes a session on CI
  failure but not on green, so ask the owner to say when CI has finished. Polling CI is not allowed here.
- **A handoff's scorecard can be wrong.** E4B3's §1a was. Re-run it, and read the progress log before trusting a level.

## 6. Owner track

- Look at the Leads tab on staging as a recruiter, and try Delete details as an admin.
- Approve the next release, which carries the Leads tab and every action on it.
- Rule on Q-AD31, and on the three questions in §3 step 1 that are yours.
- Send Q-AD30 to counsel with the rest.
- Unchanged from the E4 handoff §5: Meta setup, brand kit, first opening, spending values, presets, retention, launch gate.

## 7. First action in the new chat

1. Read §0.
2. Confirm main's HEAD and the newest migration **by name**. List open PRs, and check whether B2c2 has appeared or merged.
3. Run `pnpm ads:readiness` and compare it with §1a. A level going down needs explaining; going up is fine.
4. Work in `../FuelGuard-ads-safety` on a new branch from `origin/main`. Keep this file untracked until the docs PR.
5. Put §3 step 1's three questions to the owner in one short message, with the recommendations, and wait for the answers.
