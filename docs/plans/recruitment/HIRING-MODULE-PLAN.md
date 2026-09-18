# The hiring module — audit, market research, and the checklist model

**Date:** 2026-09-17 · **Owner:** Miki · **Status:** RESEARCH COMPLETE, NOTHING BUILT FROM IT YET.

This document does two jobs the owner asked for on 2026-09-17:

1. **Records the application audit** run that day against the shipped code — six defects the owner
   hit in a live walk, each traced to a call site rather than guessed at. That audit existed only in
   a chat transcript, which is not a place a blocker can be found again.
2. **Extends the scope from the application to the whole hire** — orientation video training,
   Clearinghouse, MVR review, PSP review, the road test, live orientation, and the signing — and
   asks how the industry solves the same problem before deciding how we will.

⚠ **It does not supersede `RECRUITING-SYSTEM-PLAN.md`.** That document already models R0–R9 including
orientation and the road test (R8), and `DRIVER-TRAINING-PLAN.md` already specifies the video-and-quiz
system in 1,396 lines. **The single most important finding in this document is that the owner's
request is largely already planned and unbuilt, not unplanned.** §7 says what that changes.

**Its UI companion is `HIRING-UI-PLAN.md`** — what a person sees and touches: D-HUI1–D-HUI8,
Q-HUI1–Q-HUI5, the HU1–HU7 queue. This document owns the process, the regulation and the order; that
one owns the surfaces. The split follows this repo's own precedent, `RECRUITING-SYSTEM-PLAN.md` /
`RECRUITING-UI-SURFACE-PLAN.md`.

Regulatory citations in §5 were verified against FMCSA and eCFR/Cornell in September 2026 and each
carries its source. Product claims in §4 are cited to the vendor or the trade press and are marked
where they are marketing copy rather than a measurement.

---

## 0. Picking this up in a new chat — read this first, it takes two minutes

This programme runs across several chats. Nothing below assumes you remember the previous one.

**The three documents, and which owns what.**

| Document | Owns |
|---|---|
| **this one** | the process, the regulation, the order, **and the single queue (§9)** |
| `HIRING-UI-PLAN.md` | the surfaces — D-HUI1–8, the anatomy, what not to build |
| `HIRING-MOCKUP.html` | what it looks like. Open it in a browser; it links the real token file |

**The protocol, and every line of it exists because something went wrong without it.**

1. **Read §9, find the first step with no `DONE` line in §10.** That is your step. The queue is the
   only ordering; do not infer one from the section headings.
2. **One step, one PR, one branch off `origin/main`.** ⚠ Several chats share this working tree, so
   `git branch --show-current` before every commit and push — and branch from `origin/main`, never
   from whatever is checked out.
3. ⚠ **Record progress by APPENDING a dated line to §10. Never edit a table row in §9.** Parallel
   PRs editing adjacent table rows conflict every single time; append-only lines never do.
4. **Steps marked ∥ may run in different chats at the same time.** Steps not marked ∥ touch a file an
   earlier step is also touching, and must wait.
5. **Run the gates before pushing**, not after: `pnpm lint`, `pnpm typecheck`, `pnpm test`. ⚠ For web
   changes also `pnpm --filter web lint:tokens` — it is an `apps/web` script and a bare root call
   fails misleadingly. ⚠ A migration must commit its regenerated `schema.generated.sql`; that check
   hides inside `lint:table-writers`.
6. **A migration and its first reader ship in two separate PRs** (`lint:migration-ordering`). New
   tables are exempt and may ship with their reader. The deploy window is ~2m44s and cannot be
   watched for — see `docs/MIGRATION-DISCIPLINE.md`.
7. **Prove a test can fail.** Mutate the line it covers and watch it go red. This repo has had ten
   green assertions that proved nothing in a single session; the cause each time was a fixture too
   uniform to discriminate.
8. **If the honest fix is out of scope, stop and say so.** Write the blocker into §8 with candidates
   and a recommendation. Do not ship the detour. `CLAUDE.md`'s *No workarounds* section is the
   standard, and §1.6 of this document is what the aggregate looks like.

**The four facts that will otherwise cost you an hour each.**

- ⚠ **A filed packet is frozen.** `ensureApplicationPdf` renders once, hashes, and returns storage
  bytes for ever. ⚠ The freeze is at **filing**, not at marking — production now holds **20** marks
  from one unfinished walk (§1a C2/C3) and **no** filed packet, so how the packet prints is still
  free to change. Any step that changes printing must land before C1.
- ⚠ **"Deployed" is a per-service question.** Two Railway services run `apps/api` and routinely sit at
  different commits. **Applicants reach `@fleetguard/web`; `pnpm verify:live` checks
  `@fleetguard/api`.** Curl the web host's `/api/version` when an applicant-facing change matters.
- ⚠ **The nav is generated from `NAV_SURFACES`** in `packages/shared/src/surfaces.ts`. Nav paths are
  not in `apps/web/src`, and looking for them there is the hour.
- ⚠ **`pnpm dev` crashes** on this machine inside vite's dependency optimiser. It is environmental and
  is not your change. Use `pnpm --filter @silvicom/web preview:local` (:4173) to see anything.

**Definition of done for every step below:** the gates are green, the PR is merged into `main` by a
merge commit, a `DONE` line is appended to §10, and **the done-when sentence is true of a person**,
not of an endpoint. ⚠ That last clause is not decoration — A11b was marked done while the first
invitation had no send path at all, because every test asserted what the route DID and nothing
asserted what it did not do.

---

## 1a. Verification pass, 2026-09-17 — what was checked, and the six things that were wrong

Everything in §1 and §2 was re-checked against the code, against production Railway variables and
against the production database before any of it was built on. ⚠ **This section is the record of that
pass. Read it before §1 — six claims below correct claims made above, and one of them changes which
step goes first.**

### Confirmed, unchanged

Two renderers and nothing comparing them · the ceremony showing no document · the four drawn-mark
defects · no authorizations PDF · three recruitment pages · `qualification_records.kind` already
carrying `road_test` / `mvr` / `clearinghouse_full` / `clearinghouse_limited` / `eldt` / `drug_test`
since 0217 · **zero** `training_*` or `orientation_*` tables in any migration · no `sign_token_hash`
column anywhere, so A5a is genuinely needed · `SlideOver`, `TablePagination`, `isFullBleed`,
`check-surfaces.mjs`, `preview:local` and `lint:tokens` all exist.

**The nudge sweep really does run.** `startDqAlertScheduler` is registered in `schedulers.ts` on a
~6h timer; `APPLICATION_NUDGE_ENABLED` and `DQ_ALERTS_ENABLED` are **not set** on `@fleetguard/api`
and both default `true`; `RUN_SCHEDULERS_IN_PROCESS` is `true` there. So the mechanism in §1.6 is
armed. What follows is that it has not yet gone off.

### ⚠ C1 — §1.6 is a LATENT defect, not live damage, and it is **not** the owner's bug

Measured on production `application_invitations` (8 rows): **`nudged_while_with_office = 0`**. Three
invitations have ever been nudged and none of them was with the office or approved at the time.

And the owner's own walk rules it out directly. Their invitation is `f2b142e4…`, created
**2026-09-17 22:14:15**, `nudged_at` **null**, `expires_at` **2026-10-01**. Neither the rotation nor
the expiry touched it.

⚠ **So the sentence "§1.6 is live and is costing you real applicants right now" was wrong, and the
claim that it explains the owner's expired link was wrong.** The mechanism is real and will fire the
first time an un-nudged applicant sits with the office for two days — which is every applicant, as
soon as there is more than a trickle — so **A1 still ships, and ships early, on that reasoning alone.**
It is cheap insurance against a certainty, not a repair of a wound.

### ⚠ C2 — what actually happened to the owner, located but not explained

**The ceremony ran for the first time in its life today and stopped two places short.**

| | |
|---|---|
| Marks recorded | **20 of 22** — and 20 is every `application_packet_marks` row in production |
| When | 2026-09-17 **22:20:45 → 22:21:08**, twenty marks in **23 seconds** |
| Missing | **`p31a` and `p31b`** — page 31, the owner-operator leased-driver agreement, signed once as driver and once as owner-operator. They are the LAST two in page order |
| Filed | **no** — `submitted_at` null, no `documents` row |
| Initials recorded | **`M`** on p05/p06/p09 — §1.4's defect, in production data |

Both missing stops are genuine driver placements, both have mark geometry, and the server's own
refusal list has nothing that should reject them. ⚠ **Why they did not record is NOT established, and
is deliberately not guessed at here.**

> ⚠ **ANSWERED 2026-09-17 by A0, and the answer is above this module entirely — see §10.** `p31a` was
> refused with **HTTP 429** by the rate limiter on `/api/public/application` in `app.ts`: 20 requests
> per 60 seconds, and the walk's twenty marks were requests 1–20 of that window. It never reached
> `recordPacketMark`, which is why its refusal list had nothing to say. The sentence *"the server's
> own refusal list has nothing that should reject them"* was true and was the wrong list to read.

Two things about that are certain and both are worse than the unknown cause:

1. **A failed mark is a permanent dead end.** `usePacketCeremony.sign()` only advances `index` on a
   201; every other outcome sets `error` and leaves the driver on the same stop for ever, reading
   *"That did not go through."* There is no skip, no retry-later, no way past.
2. ⚠ **Nothing records a refused mark.** The one run of this ceremony that has ever mattered left no
   diagnosis anywhere — not a log line, not a row. That is why this section cannot say what happened.

**This is now A0, and it goes before everything.** See §9.

### ⚠ C3 — "production holds 0 packet marks" is out of date

It holds **20**. §0 and §2 both said 0 and both were true until 22:20 today.

⚠ **The freeze window is still open**, and the nuance matters: `ensureApplicationPdf` renders and
hashes at **filing**, not at marking, and this application was never filed. So how the packet prints
is still free to change. But there is now a half-signed ceremony in production that will file with
whatever the code says on the day it completes.

### ⚠ C4 — A2 conflated two different switches, and would have been built wrong

§9's A2 warned *"keep `render.ts` — an application with 0 marks must still render as the summary"*.
That is **D-PKT5's rule for the FILED document** and it is correct there. It is wrong for the
preview, and applying it there would have produced a step that could never do anything:

**a preview happens before signing, so a preview always has zero marks.** Under a marks-based switch
the office's preview would render the §391.21 summary for ever — exactly the defect A2 exists to fix.

**The preview renders `packetFieldFill` + `renderPacketOverlay` with `marks: []`**, banded DRAFT.
Blank signature lines on a draft-banded preview are correct: that is what the paper looks like before
anybody signs it. `render.ts` stays, untouched, for already-filed records only.

### ⚠ C5 — cite symbols, not line numbers

`preview.ts:105`, `file.ts:97` and `packetOverlay.ts:172` had all drifted by the time they were
re-checked, the same day they were written. Only `applicationNudge.ts:32` still landed.

**Every citation in these plans should name the function**, not the line — `preview.ts`'s
`applicationPreviewPdf`, `file.ts`'s `renderFiledDocument`, `packetOverlay.ts`'s `renderPacketOverlay`
mark loop. A line number in a document a fresh chat follows is a wrong answer with a short half-life.

### ⚠ C6 — two component paths in `HIRING-UI-PLAN.md` §1 were wrong

`SlideOver.vue` and `TablePagination.vue` live in **`apps/web/src/components/`**, not
`apps/web/src/components/ui/`. Corrected there.

### ⚠ C7 — the next migration is 0345

`0344_tms_dispatchers.sql` is on `origin/main` and applied in production. A checkout sitting on an
older branch shows `0343` as the head and would compute `0344` — which is taken. **Branch from
`origin/main`** (§0 rule 2) and re-check the head before numbering anything.

---

## 1. The application audit, 2026-09-17

The owner walked the live application and reported six problems. All six reproduce in the code. This
section is the evidence, so that none of it has to be rediscovered.

### 1.1 The office previews one document and the driver signs a different one

`preview.ts:105` calls `renderApplicationPdf` — our own §391.21-shaped summary, about eight pages.
`file.ts:97` calls `renderPacketDocument` — the carrier's own 31-page packet with the applicant's
answers drawn into its fields. They share no layout, no page count and no page numbering.

⚠ **The cause is a comment that was true when written and false a day later.** `preview.ts`'s header
argues at length that it is deliberately *"the same renderer"* as the filing, because a second
draft-shaped renderer would be a second source of truth. That was correct on 2026-09-13, when F6
shipped. The packet renderer landed on 2026-09-14 and changed what the filing renders; nothing
changed the preview, and nothing compares the two.

**No gate can see this** — both files typecheck, both are tested, and each test asserts its own
renderer. The assertion that does not exist is *"the office's preview and the driver's filing are the
same document"*.

### 1.2 The signing ceremony never shows the document

`PacketCeremony.vue:13–20` says so in its own words:

> *"The carrier's page number, the sentence that page asks the driver to agree to, the mark about to
> be applied, and one button. Nothing else — no summary of the twenty-two, no preview of the next, no
> application fields."*

The reasoning given is that the driver has already read the whole application on the screen before.
⚠ **But that screen is the HTML form's answers, not the packet.** There is no PDF viewer anywhere in
the applicant's path. Nobody — driver or office — sees the 31 pages before they are signed, hashed
and frozen.

This is a design decision to reverse, not a defect to repair. It is the one place where the
implementation and the owner's sentence (*"navigated precisely from place to place, similar to
DocuSign"*) were read differently: the walk was built, the document was not.

### 1.3 The drawn signature — four separate defects

The drawn mark **is** wired to the filed PDF (`packetOverlay.ts:136`), so the feature is not missing.
It fails in four ways that together read as *"custom signature cannot be applied"*:

| # | Defect | Site |
|---|---|---|
| a | The ceremony always previews the **typed** name, even in drawn mode — `markFor()` returns a string | `usePacketCeremony.ts:167`, `PacketCeremony.vue` `applying` |
| b | A failed PNG upload is **swallowed**; all 22 marks silently become typed and nobody is told | `usePacketCeremony.ts:158–165` |
| c | The drawn signature is stamped on the three **initials** lines too — `if (drawn) { …; continue; }` runs before `mark.signedName` is read | `packetOverlay.ts:172` |
| d | No upload option, no style choice, and no way to change a mark once adopted | — |

(b) deserves its own note. The swallow is deliberate and its reasoning is sound — A8b's rule that *"a
PNG that will not upload must not stand between a driver and twenty-two signatures"*. ⚠ The error is
not the swallow; it is that the swallow is **silent**. The driver is never told their drawing did not
survive, so the product appears to ignore them.

### 1.4 Initials pin on the first keystroke

`usePacketCeremony.ts:150–153` accepts `length >= 1`, and the comment defends it: a single initial is
what somebody with one legal name has, and `applicationPacketMarkSchema` accepts `min(1)`.

⚠ **What makes it a defect is not the minimum, it is the pin.** `record_packet_mark` (migration 0340)
fixes the initials at the first mark, and a different spelling at the next stop is refused with
`DR035` — *"advice the driver cannot act on"*, as the composable's own comment admits about the
resumed case. So one stray keystroke is permanent for a federal record, with no confirmation step and
no edit.

### 1.5 Nothing prints what the applicant signed at step one

`GET /api/recruitment/drivers/:driverId/authorizations` returns **JSON rows**. The Certificate of
Completion (`certificate.ts:41`) is a **page inside the final application PDF** — by deliberate
decision (D-AX8: *"§390.32(d) asks for one reproducible record; a separate certificate is a second
document to lose"*). `preview.pdf` requires a draft to exist and refuses once the application is
filed.

⚠ **So in the window between "permissions signed" and "application filed" there is no printable
artifact of anything at all.** That window is days or weeks long and is exactly the owner's step one.
D-AX8 is right about the **filed** record and was never asked about the **interim** one.

### 1.6 The link dies mid-flow — three causes stacked

This is the worst of the six and its mechanism is not in any plan document.

1. `STALE_DRAFT_HOURS = 48` — `packages/shared/src/applicationNudge.ts:32`.
2. `candidates()` selects every invitation with `submitted_at is null AND revoked_at is null AND
   nudged_at is null` — `applicationNudgeSweep.ts:71–80`. ⚠ **It does not exclude an invitation
   already handed to the office, and does not exclude one already approved.**
3. On a hit it **rotates the token** — mints a new one and overwrites the hash
   (`applicationNudgeSweep.ts:191–198`, migration 0232).

The two-visit flow *guarantees* the draft is more than 48 hours old by the time the office finishes
reviewing. **So the abandonment sweep classifies a driver who is waiting on us as abandoned and kills
the link they are holding — including one open on a signing screen.**

Compounding it: the approval notice deliberately carries **no link**
(`applicationApprovalNotice.ts:20–32`, Q-AX4) and tells the applicant to find the earlier email — whose
link the sweep may just have rotated. And `expires_at` is a flat 14 days from the *first* invite
(`INVITE_TTL_DAYS_DEFAULT = 14`) covering all three visits.

⚠ **Q-AX4's reasoning against rotating at approval is sound and is not what to overturn.** It says
rotating would break the promise *"keep this link, it is where you will sign"* at the moment the
applicant acts on it. The collision is that **the nudge rotates anyway**, without the approval path
knowing. Two features each made a defensible local choice about one token; the aggregate is a
lockout. This is precisely the failure mode `CLAUDE.md`'s *No workarounds* section describes.

### 1.7 Three recruitment pages, one of which is the flow

`/recruitment` (applicants), `/recruitment/screening` (*"How many drivers FMCSA PSP could actually be
asked about"*), `/recruitment/inquiries` (the §391.23 queue), plus `/recruitment/:id` with five
stacked sections. Two of the three top-level pages are internal metrics and work queues, sitting at
the same level as the one page that is a step in hiring somebody.

---

## 2. What exists today, measured

Read off the code and the production database, 2026-09-15/17. Not estimated.

| Piece | State |
|---|---|
| Application form, 8 screens | **Live.** 1 application filed, ever (2026-09-14) |
| E-sign consent + 4 authorizations | **Live.** Defaults serve; `org_disclosures` is empty and every gate is open |
| Office review + edit + approve | **Live** (F4), previewing the wrong document (§1.1) |
| 22-place packet ceremony | **Live, run once, stopped at 20 of 22** (§1a C2). Those 20 are every mark in production |
| Carrier packet renderer, 31 pages | **Live and never run** — nothing has been filed through it. Geometry measured by hand; template is a repo asset |
| Hire handoff, applicant → driver → DQF | **Live** (H8, `hireHandoff.ts`) |
| PSP order + record | **Live.** 1 `psp_requests` row in all of production |
| `qualification_records.kind` slots | `mvr`, `annual_mvr_review`, `road_test`, `cdl_equivalency`, `clearinghouse_full`, `clearinghouse_limited`, `eldt`, `drug_test`, `psp_report`, … **all exist since 0217** |
| MVR order | ❌ **Nothing.** `SCREENING_PREREQUISITES.mvr_order` has no caller in the repo; no vendor |
| Clearinghouse query | ❌ **Nothing.** Deliberately the carrier's act in FMCSA's portal |
| Drug & alcohol process | ❌ **Nothing.** The record kind exists; the process does not |
| Orientation sessions / attendance | ❌ **Nothing.** 0 migrations mention the tables R8 specifies |
| Road test | ❌ **Nothing.** The record kind exists; no form, no certificate |
| Training videos + quizzes | ❌ **Nothing.** 0 `training_*` tables. `DRIVER-TRAINING-PLAN.md` is 1,396 lines of complete design |
| A hiring checklist of any kind | ❌ **Nothing.** `applicantPipeline.ts` derives 7 stages and stops at `ready_to_screen` |

**The shape of the gap:** the two ends are built — an applicant can apply, and a qualified driver can
be hired into a DQF. Everything a carrier does *between* those two moments is unbuilt, and most of it
is already designed.

---

## 3. The owner's steps, and where each one stands

The owner's 2026-09-17 list, in his order, against §2.

| # | Step | Planned? | Built? | Blocker |
|---|---|---|---|---|
| 1 | Application (permissions, form, signing) | yes | **partly** | the six defects in §1 |
| 2 | Orientation videos + per-video quiz, fail ⇒ rewatch | **yes, fully** (`DRIVER-TRAINING-PLAN.md` R1–R8) | no | Q-HM3 (pre- or post-hire), plan is pre-re-founding |
| 3 | Clearinghouse | yes (R5, R8) | no | owner: buy a query plan, IDEMIA identity verification |
| 4 | MVR review | yes (R3/R4) | no | **no vendor**; Samba deferred on cost 2026-08-26 |
| 5 | PSP review | yes | **order + record live** | the cross-match panel and P12's three tables |
| 6 | Driving test in the office | yes (R8) | no | Q-HM1 (ordering), then a form + certificate |
| 7 | Other live orientations | yes (R8 sessions/attendance) | no | Q-REC1 (what an orientation day actually is) |
| 8 | Application signing ⇒ hire | yes | **partly** | §1.2's rebuild, then H8 already works |
| — | **The wizard checklist itself** | **no — this is genuinely new** | no | this document |

⚠ **Only one item on the owner's list has never been designed: the checklist.** Everything else is a
build queue. That is a much better position than it looked, and it changes the recommendation — the
job is to finish and connect, not to design.

---

## 4. Market research — how five products solve this

### 4.1 Tenstreet (which now also owns DriverReach)

The dominant driver-recruiting platform. DriverReach was acquired 31 March 2025, so the two product
lines are one vendor; anybody evaluating them should ask which line is supported long-term.

What they do that is directly relevant:

- **The checklist is the product's spine, not a view.** The *Driver Recruiter Checklist* is described
  as the thing that "connects recruiters and drivers, helping them stay on the same page as to what
  tasks remain", and checklist reporting shows what each driver has and has not responded to.
- **Assigning an orientation date is an event that fires a workflow** — the driver is automatically
  sent a welcome email and pre-orientation forms and is scheduled into default training. A single
  event triggers multiple actions: enrol in a course, notify the travel coordinator, tag the record
  for operations to plan equipment.
- **Conditional steps driven by form content** — e.g. an extra notification to safety if an annual
  certification of violations shows more than three, or auto-enrolment in backing training after a
  backing accident.
- **Forms are completed before the driver arrives.** Their pitch is explicitly that pre-hire document
  gathering *decreases orientation time*, with personal information imported from the application so
  it is not typed twice.
- **A drip campaign nudges stalled drivers**, and an onboarding widget tracks completion because
  drivers finish modules at different times.
- **DQF is framed as the handoff**: the checklist "ensures completion and a clean handoff to DQF
  (safety)".
- DriverReach shipped a **"DQ Checklist"** tool and "Magic Links" to recover drivers who abandoned an
  application.

⚠ Their ROI figures (20–40% savings) are marketing and should be read as such. The **structure** is
what is worth copying, and it matches the owner's sentence almost word for word.

### 4.2 Infinit-I / INFINITI — the video-and-quiz model

- Watch content → pass a quiz on it → a certificate is issued per item and stays downloadable.
- Content items average **three to seven minutes**. That is the single most useful number in this
  research: it sets the segment length `DRIVER-TRAINING-PLAN.md` should target.
- 850+ videos, an open API to HR/recruiting systems, and all results reported through BI dashboards.
- Pass thresholds are **carrier-configured, not published** — nobody in this market publishes a
  universal pass mark. Our plan's default of 80% is therefore a choice, not a standard.
- One carrier executive described **not doing the road test until candidates have completed all
  paperwork and passed all the tests**, with most hires doing that at home.

### 4.3 CarriersEdge

- Regulatory and general content is completed **before** formal orientation, so in-person time is
  company-specific only.
- Performance tracking shows each new hire's strengths and weaknesses **before orientation starts** —
  i.e. the quiz results are an input to the live day, not just a gate.
- Fleets can upload road-test documents, add a company video intro, append a standardised
  company-specific test at the end, and **auto-schedule post-orientation training**.
- Standardised pre-assessment tests identify which areas a driver needs training on.

### 4.4 Luma ("Brighter Learning")

- ~700 short modules ("eNuggets"); the LMS documents every training event including **time spent** and
  scores.
- Forward ran 1,000+ drivers through orientation on it and compressed the full programme to **eight
  hours**; Fort Transfer reported five hours saved per driver, ~$80/driver.
- **LumaLive** is a live meeting tool with attendance tracking, and **absentees are auto-assigned the
  recording**. That is the cleanest answer anybody has to the owner's "other live orientations" item.

### 4.5 The compliance-file vendors (Foley, J. J. Keller, DQM)

They sell the *file*, not the flow, and their published checklists agree on one thing worth adopting:
**create the DQF during onboarding**, so the file is assembled as the steps complete rather than
reconstructed afterwards. Their named failure modes are: incomplete DQFs, missing §391.23
investigations, documents stored in multiple locations, and expiry dates nobody monitors after
onboarding.

### 4.6 What the market agrees on, and what we should take

| Pattern | Universal? | Take it? |
|---|---|---|
| A checklist is the primary object, per applicant | yes | **yes** — §6 |
| Steps fire workflows (email, enrolment, notification) on completion | yes | **yes**, but derived — §6, D-HM1 |
| Training is short segments with a quiz gate and a certificate per item | yes | **yes** — already `DRIVER-TRAINING-PLAN.md` |
| Paperwork and training happen **before** the driver travels to orientation | yes | **yes** — it is the whole economic argument |
| Quiz results are visible to the trainer before the live day | CarriersEdge | **yes**, cheap and valuable |
| Live sessions track attendance and auto-assign the recording to absentees | Luma | **yes** — R8's `orientation_attendance` already models half of it |
| Published pass marks | **no** | configure per course, do not invent a standard |
| Recovering an abandoned application by link | Tenstreet/DriverReach ("Magic Links") | **yes** — and see §1.6, ours *is* the problem |

---

## 5. The regulatory ordering, verified

The checklist's order is not a UX preference; most of it is law. Verified September 2026.

**Before a driver first performs a safety-sensitive function, the carrier must hold:**

1. The application — §391.21
2. A **full** pre-employment Clearinghouse query, not prohibited — §382.701(a)
3. A **verified negative** pre-employment controlled-substances result — §382.301(a). ⚠ *Collection is
   not clearance*: allowing operation before the result arrives violates §382.301 even if the result
   is later negative.
4. An MVR from every state of licensure in the past 3 years — §391.23(a)(1)
5. Medical certificate verification — §391.41
6. A road test, or the §391.33 CDL equivalent — §391.31

**With a grace period:** the §391.23(d)(e) previous-employer safety-performance investigation — 30 days
from start date. Since 6 January 2023 the pre-employment Clearinghouse query also satisfies the old
three-year previous-employer drug-and-alcohol history check for FMCSA-regulated prior employers.

**FCRA sequencing:** disclosure and consent before any consumer report; adverse action last, and only
if a report is the reason. This is the one ordering our application already enforces correctly.

**Ongoing:** annual MVR review §391.25; annual limited Clearinghouse query.

**PSP is voluntary.** It is a tool, not a requirement, which is why it can sit anywhere in the order.

### 5.1 ⚠ The one genuine contradiction — where does the road test go?

This is `RECRUITING-SYSTEM-PLAN.md`'s **Q-REC5**, still open, and the research does not close it.

- **FMCSA's own Clearinghouse FAQ says the query may come after**: an employer *"is not required to
  conduct a pre-employment query of the Clearinghouse before administering a road test to a
  prospective driver"*, reasoning that §382.701(a) attaches to *hiring* and the road test precedes it.
- **The drug-test half points the other way**, but only through inference: §382.301(a) attaches to the
  first *safety-sensitive function*, §382.107 defines driving a CMV as one, and a §391.31 road test
  requires the prospective driver to operate the vehicle. Every commercial compliance source we found
  draws that conclusion. **None of them is FMCSA.**

So: FMCSA has answered the query half in writing, and the drug-test half is a third-party reading of
two regulations that do not mention each other.

⚠ **Do not resolve this from a search result.** It decides whether a driver can be road-tested on the
day they walk in or must wait days for an MRO. The repo's existing rule (D-REC7's principle — take the
answer that can only be stricter than necessary) is the right default until counsel rules, and that
default is what §8's Q-HM1 asks about. Note also that the industry practice quoted in §4.2 — road test
*after* all paperwork and tests — is the strict reading, so the strict default is also the common one.

### 5.2 Orientation and training records

- Company orientation is **not federally mandated** as such. What is mandated and lands in a file:
  the §382.601 drug-and-alcohol policy **signed certificate of receipt**, retained per §382.401.
- ⚠ **Use a separate signature block per instrument, never one "I received orientation" signature.**
  An omnibus acknowledgement does not prove the driver received the §382.601 materials specifically.
  This matches R8's existing design (one document per instrument) and is now externally corroborated.
- The §382.601 receipt is not a §391.51 DQF document — it belongs to the drug-and-alcohol programme
  file. Test **results** must stay in a separate restricted file and never enter the DQF.
- ELDT recordkeeping (§380.725, 3-year minimum) attaches to **training providers on the TPR**, not to
  carriers generally. It applies to us only if Silvicom is itself listed. D-REC6 already rules ELDT a
  licensing gate rather than a qualification item; this research agrees with it.

---

## 6. The model — a checklist that is derived, not stored

### D-HM1 — the checklist is DERIVED from evidence rows, never a stored "step done" flag

**Why.** This is not a new principle; it is `applicantPipeline.ts`'s, stated in its own header: *"A
stored stage is a second copy of facts the rows already carry, and it goes stale the moment somebody
records an authorization without remembering to advance it."* A checklist of booleans is that failure
at nine times the size, and a hiring file whose checklist disagrees with its evidence is worse than no
checklist — it is a document that will be produced in an audit and contradicted by the file beside it.

**How.** One pure fold in `packages/shared/`, over: invitation phases, `driver_authorizations`,
`application_packet_marks`, `driver_applications`, `qualification_records`, `documents`, PSP rows,
training completions, orientation attendance. Output per step: `blocked | waiting_on_them |
waiting_on_us | done`, the artifact that proves it, and — when blocked — the step that blocks it.

⚠ **The corollary is the hard part and it is what makes this real:** *a step with no artifact cannot
be a step.* If we cannot name the row that proves "MVR reviewed", then the checklist item is a
decoration and must not ship. That single rule is what stops this becoming nine checkboxes somebody
ticks.

### D-HM2 — the same fold serves the office board and the applicant's own screen

The applicant sees their own subset with the carrier's steps hidden. One computation, two audiences —
so the applicant can never be told they are waiting on us while we are told we are waiting on them.
That disagreement is what §1's board defects were, twice (F5, #757).

### D-HM3 — the federal order is fixed; the carrier may insert steps, never reorder those

§5's ordering is law. A configurable pipeline that lets a carrier put the road test before the drug
test is a product that helps somebody commit a violation. Carrier-specific steps (handbook, equipment
issue, live orientation day, a driving test on their own yard) are insertable anywhere; the six
federal gates are not movable.

### D-HM4 — every step produces a previewable, printable artifact the moment it completes

The generalisation of §1.5. Not at hire, not at filing — **at completion**. An office that cannot
print what an applicant just signed will keep a paper copy beside the system, and then the system is
not the file.

⚠ This does **not** overturn D-AX8 (one reproducible filed record). An interim artifact is clearly
banded as such, exactly the way `preview.pdf` already bands a draft application, and the filed record
stays single and hashed.

### D-HM5 — orientation training is `DRIVER-TRAINING-PLAN.md`, adopted, not redesigned

It already specifies sequential gating, fail ⇒ rewatch, 3 strikes ⇒ full reset, question pools,
server-side grading, watched-range tracking, certificates and ≥3-year retention. That is the owner's
step 2, in more detail than the owner described it.

⚠ **It needs a re-founding pass before it can be executed**, not a rewrite: it is dated 2026-07-23 and
cites `docs/01-ARCHITECTURE.md` / `docs/02-DATA-MODEL.md`, which still exist but were superseded as
canonical by `docs/ARCHITECTURE.md` on 2026-08-26. Its phase list also predates the current gate set,
the surface-entitlement catalogue and `lint:migration-ordering`.

### D-HM6 — Clearinghouse and MVR are RECORDED ACTS until a vendor exists

Neither can be performed from this product today: the Clearinghouse query is made in FMCSA's portal
and requires the carrier's own plan purchase plus IDEMIA identity verification, and there is no MVR
vendor at all. **Record the act and file the artifact**; do not model an integration that nobody can
call. A recorded act is a real DQF row; a disabled integration is a lie on a screen.

### D-HM7 — the road test is a form plus a §391.31(e) certificate

R8 already specifies it: the §391.31(c) eight-item checklist as the form, examiner identity, and on
pass the §391.31(e) certificate filed as `documents` + `qualification_records` kind `road_test`. No
schema widening — 0217 already carries the kind.

### D-HM8 — the signing ceremony is rebuilt on the DocuSign model

From §1.2, and detailed in the previous analysis: render the packet, scrollable, with a page rail;
START/NEXT tags walking the 22 marks; FINISH gated on all 22. ⚠ **The server half is entirely
reusable** — `packetTemplate`, `packetMarkGeometry`, `packetFieldGeometry`, `packetOverlay`,
`packetGrid`. The coordinates are measured. This is a client rewrite, not a programme restart.

### D-HM9 — the fourteen steps, in the owner's order (ruled 2026-09-17)

**Why this is a decision and not a list.** Until the owner answered Q-HM1/3/7 the ordering was
inferred from regulation alone, which gives a legal floor and not a working day. What it was missing
is the seam that organises everything: **which steps happen before the applicant travels, and which
happen while they are standing in the office.** The owner's words: *"these are done before applicant
even come to office, road test is when he comes to office"*, and *"hiring is concluded when applicant
is in the office and everything is done and signed and then we do hiring."*

| # | Step | Where | Artifact |
|---|---|---|---|
| 1 | Invitation sent | remote | `application_invitations` |
| 2 | Permissions signed — 4 authorizations + §7001(c) consent | remote, phone | the step-one PDF (B2) |
| 3 | Application filled in | remote, phone | `application_drafts` → `driver_applications` |
| 4 | Office reads, corrects, approves | office | `approved_at` + audit |
| 5 | **MVR** pulled outside this product and uploaded (Q-HM2) | office | `documents` + `qualification_records` kind `mvr` |
| 6 | **PSP** report | office | `psp_requests` + `psp_report` |
| 7 | **Clearinghouse** full query, run in FMCSA's portal, recorded here | office | `clearinghouse_full` |
| 8 | **Drug test** — collection at Medstop, then the verified negative | external | `drug_test` |
| 8b | ⚠ **Medical certificate checked against the National Registry** — the sixth federal gate, and it was **missing from this list until 2026-09-17** (see below) | office | `medical_registry_verification` |
| 9 | **Orientation videos + quizzes** (Q-HM3) | remote, before travel | training completion + certificate |
| 10 | **Road test** (Q-HM1) | **office, on arrival** | §391.31(e) certificate, kind `road_test` |
| 11 | **Live orientation, by section** (Q-HM7) | office, same day | attendance |
| 12 | **Handbook signed** (Q-HM5) | office, same day | its own signed document |
| 13 | **Application signed** — the 22-place packet ceremony | **office, same day** | the filed 31-page packet |
| 14 | **Hired** — DQF opens, truck assigned | office | `hireHandoff` |

⚠ **Steps 5–9 all precede arrival, and that is the product's job to enforce.** The applicant travels
once, and they travel only when 1–9 are done. Every one of the market's products in §4 is selling
exactly that compression, and the owner arrived at it independently: *"with videos and application
and other things we can finish it in half day and assign a truck if driver is in the office in the
morning."*

⚠ **So the checklist's most valuable single output is not a percentage — it is the answer to "can this
person travel yet?"** Steps 1–9 green is that answer.

⚠ **And it is TWO answers, not one** — the owner's Q-HM5 ruling split them. `hiringChecklist.ts` emits
both as named things, never as something a recruiter infers by reading nine rows:

- **`readyToTravel`** — steps 1–9 green. Five of the six federal gates (application, Clearinghouse,
  drug test, driving record, medical certificate) plus PSP and the videos. **This is the gate on the
  plane ticket**, and the owner is explicit that nothing else is: *"we will not even bring him if this
  not green."*
- **`readyToHire`** — that, plus the road test, the live orientation, the handbook and the 22 marks.
  The sixth federal gate, the **road test, is the only one that cannot be green before arrival**
  because it physically happens on arrival (step 10).

That split is the whole reason this is a checklist and not a wizard: the same fold answers two
different questions on two different days.

⚠ **The consequence for the signing surface (D-HUI9): step 13 happens IN THE OFFICE.** The phone
measurement still stands and the design still renders at every width — but the primary device is now
an office screen, not a truck-stop phone, which removes the risk from C1 rather than adding to it.

⚠ **A GAP THIS LIST HAD UNTIL 2026-09-17, found by the owner reciting the six gates back.** The
**medical certificate** is one of the six things federal law wants on file before anybody drives, and
it was **not a step here** — because the application already *captures* the card (`medical_card` is an
`APPLICATION_CAPTURE_SLOTS` entry) and capture had been silently mistaken for the gate. It is not:
checking the examiner against the **National Registry** is a separate act with its own record kind,
`medical_registry_verification`, already in `dqCatalogue.ts` and already a `qualification_records`
kind since 0217. It is step **8b** above. ⚠ The lesson generalises and is worth the sentence: **a
document being uploaded is not the same fact as a document being verified**, and a checklist that
conflates them reports a gate as green that nobody has checked.

⚠ **The consequence for orientation videos: they are assigned to an APPLICANT, before hire.** That
overrides `RECRUITING-SYSTEM-PLAN.md`'s Q-REC6 fallback (*"no assignment is auto-created pre-hire
until answered"*) — the owner has now answered. The compensable-time half of Q-REC6 is still
counsel's and does **not** block the build.

### 6.1 The window that is closing

⚠ `file.ts:140–146` renders a filed packet **once**, hashes it, and returns storage bytes for ever.
Production holds **0 packet marks**, so everything about how the packet prints is still changeable at
zero cost today — and becomes permanently frozen for the first driver who walks the ceremony. See
`docs/MIGRATION-DISCIPLINE.md`'s sibling rule and the `a-filed-document-is-frozen` note.

**Every decision in §6 that affects how a document prints must be made before the first real walk.**

---

## 7. What the research changes about the plan

1. **The owner's request is a build queue, not a design problem.** Seven of his eight steps are
   already designed somewhere in `docs/plans/`. The honest answer to *"can we make the hiring module
   precise and assumption-free"* is: yes, and mostly by executing documents that already exist.
2. **The checklist is the genuinely new thing**, and it is also the thing that makes the rest legible
   — Tenstreet's structure is the checklist, and everything else hangs off it. It should be built
   **early**, not last, against the steps that already exist, and extended by each later step. That
   reverses `RECRUITING-SYSTEM-PLAN.md`'s R9 ordering ("ships last by H6's rule"), and the reversal is
   deliberate: H6's rule was *every stage it shows must be derivable*, which is satisfied by showing
   only derivable steps and adding steps as they land — not by waiting.
3. **The application's six defects come first regardless.** A checklist whose first row is broken is a
   checklist nobody trusts. §1.6 in particular is live and is costing real applicants right now.
4. **Two of the owner's steps are purchases, not builds** — an MVR vendor and a Clearinghouse query
   plan. Neither can be started by writing code.

---

## 8. Questions — six ruled by the owner 2026-09-17, two still open

⚠ **Rulings are recorded here in the owner's own words where he gave them**, because a paraphrase of
a process decision is how a plan starts describing a business nobody runs.

### Ruled

- **~~Q-HM1 · Where does the road test go?~~ SETTLED, and it never needed counsel.** The owner:
  *"these are done before applicant even come to office, road test is when he comes to office."*
  The drug test, Clearinghouse query, MVR and PSP are **all in hand before the applicant travels**, so
  the strict reading — verified negative and full query before anyone drives — is not a constraint
  imposed on the carrier, it is **already what they do**. §5.1's contradiction is therefore moot for
  this build: we enforce the strict order, which is simultaneously the legal safe harbour and the
  real process. ⚠ Counsel is needed **only** if the carrier ever wants to road-test on arrival without
  results in hand, and until somebody asks for that, nothing is blocked. **D2 is unblocked.**
- **~~Q-HM2 · MVR vendor.~~ RULED: no integration.** The owner: *"we are handling this MVR pulls out
  of Silvicom 360 and uploading it"*, and then, on 2026-09-17: *"we pulling this instantly from
  **Samba** even before drivers arrive office."*
  So the vendor is **SambaSafety** and the carrier already has a working account that returns records
  instantly — it simply is not reached from this product. **Do not build an MVR integration.** Build
  the upload, the file and the annual-review clock. **D1 is unblocked** for MVR.
  ⚠ Recorded because it changes the price of a future decision, not this one: Samba was deferred on
  **cost** in August 2026, and the recon that would be needed if it is ever revisited already exists
  (`../safety-dqf/SAMBA-RECON.md`, `RECRUITING-SYSTEM-PLAN.md` R3/R4). A live account makes that
  cheaper than the deferral assumed. **It stays deferred; this is a note, not a reopening.**
- **~~Q-HM3 · Pre-hire or post-hire training?~~ RULED: pre-hire, and pre-arrival.** The owner:
  *"orientation videos are pre arriving and pre hiring process. Hiring is concluded when applicant is
  in the office and everything is done and signed and then we do hiring."* See D-HM9 steps 9 and 14.
  ⚠ This **overrides** `RECRUITING-SYSTEM-PLAN.md` Q-REC6's fallback. The compensable-time half stays
  counsel's and blocks nothing.
- **~~Q-HM6 · One link or several?~~ RULED: several**, as recommended — one link for visits 1–2, a new
  one minted and emailed at approval, both hashes valid. **A5a/A5b stand as written.**
- **~~Q-HM7 · What is an orientation day?~~ RULED.** The owner: *"orientation is done by sections and
  it is full day process, but with videos and application and other things we can finish it in half
  day and assign a truck if driver is in the office in the morning."*
  Three things follow and all three are buildable: orientation has **named sections**, so
  `orientation_sessions` models a day made of sections rather than one block; **the videos are what
  buys the half day**, which is the same economics every product in §4 sells; and **the day ends in a
  truck assignment**, so step 14 is a real end state and not a status. **D3 is unblocked.**
- **~~Q-HUI1 · Does the applicant see the carrier's steps?~~ RULED: no.** The owner:
  *"applicant dont see our steps."* Their surface shows their own steps only, plus one line saying we
  are working on it.

### Still open

- **~~Q-HM5 · Refuse or warn?~~ RULED 2026-09-17: REFUSE — and the carrier is already stricter than
  the product was going to be.** The owner, given the six by name: *"we pulling this instantly from
  Samba even before drivers arrive office … we even before he comes we will not even bring him if
  this not green."*

  ⚠ **That is a stronger answer than either candidate.** The question asked what happens when a
  recruiter presses Hire with something missing. The answer is that **the situation is not allowed to
  arise** — five of the six are green *before the applicant is asked to travel*, so the office never
  meets the dilemma at all.

  **What the product builds, therefore:**
  - `readyToTravel` is a **hard gate on the invitation to come in**, not a warning beside it. It is
    the earliest place a refusal costs nothing and prevents the most — a wasted journey rather than
    an unlawful hire.
  - `readyToHire` refuses the hire outright on all six. There is no "hire anyway and record who
    decided", because the carrier has said the scenario does not happen; building an override for a
    situation the owner has ruled out would be inventing a way around his own process.
  - Everything that is **not** one of the six — handbook, a section of orientation, a photo — warns
    and never blocks.

  ⚠ **The road test is the only gate that is green after arrival**, so it is the last thing between a
  driver in the office and a truck. That is step 10, and it is why the half-day works.

### D-HM10 — the handbook is a separate instrument, signed in the office (ruled 2026-09-17)

The owner: *"we will have signing handbook as part of signing process and when driver is in the
office, and that is part of application but separate process and document."*

So it is **step 12** in D-HM9: its own document, its own signature, in the office, on the same day as
the road test and the packet — and **not** a page of the 31-page packet.

**What that means mechanically**, because this is the pattern R8 already specified and it has a trap:
widen **0215's `purpose` CHECK** by next-numbered migration for a `handbook` purpose, and add it to
**neither `APPLICATION_RELEASE_ORDER`** — the applicant's remote flow presents that exact list, and a
handbook leaking into it would put it on the phone two weeks early — **nor `SCREENING_PREREQUISITES`**,
because it authorises no vendor call.

⚠ **And the §382.601 rule from §5.2 applies to it directly: give the drug-and-alcohol policy receipt
its own signature block, separate from the handbook's.** An omnibus *"I received the handbook"* does
not prove the driver received the §382.601 materials, and that is the specific thing an auditor
rejects.

## 9. The queue

**One queue. `HIRING-UI-PLAN.md` holds the design reasoning for the `U`-prefixed steps but no
separate ordering — this is the ordering.**

Each step is one PR. `∥` means it may run in a different chat at the same time as its neighbours,
because it touches no file an unfinished neighbour touches. Sizes are a rough half-day / day / more.

⚠ **Read §0 before starting any of them**, then **§1a**, which corrects seven claims made earlier in
this document. Append to §10; never tick a row here.

### The sequencing insight, which is what makes this fast

**`hiringChecklist.ts` (B1) is a pure function in `packages/shared` with no dependencies, no schema
and no network.** It can be written on day one, in its own chat, in parallel with every repair in
Wave A — and everything in Waves B and C consumes it. Build it first and the UI work has something
to render against; build it last and four steps queue behind it.

The second-order effect is the one worth planning around: **each step in Wave D extends that one fold
and nothing else.** So Wave D parallelises almost completely, which is the pattern
`RECRUITING-SYSTEM-PLAN.md` §1 established for the requirement list and the reason no cross-PR type
coupling accumulates.

---

### Wave A · repair the application

⚠ **A0 goes first and everything else waits behind it**, because it is the only step that can tell us
why the owner's walk stopped — and every later step in this wave changes files that walk touches.

| | Step | Build | Verify | Done when |
|---|---|---|---|---|
| **A0** | **Find out why the ceremony stopped at 20 of 22** · half day. **FIRST** | Two halves, both small. (a) **Telemetry**: log the refusal in `recordPacketMark` — code, placement, invitation — so a refused mark leaves a trace; today it leaves none (§1a C2). (b) **Reproduce**: walk a fresh invitation in the **QA org** to `p31a` and read the response. ⚠ Do not walk it in Silvicom — a second half-signed ceremony helps nobody | the QA walk itself; then `grep` the Railway logs for the refusal line | **The reason `p31a` did not record is written into §10 as a sentence, with the response code.** If it reproduces, the fix is a second PR; if it does not, that is also an answer and gets recorded |
| **A0b** | **Size the applicant's bucket for a ceremony** · half day. ⚠ **This blocks every applicant, not just the owner** | A0 measured the cause (§10): `/api/public/application` allows **20 requests / 60 s** and the packet takes **22 POSTs** by design, so nobody can finish a walk. Three parts, and the third is not optional: (i) a limit sized to a ceremony rather than to an attacker's replay — recommend a dedicated bucket on `POST /:token/mark` and leaving the intake's 20 alone, so the tighter number still guards the surface that takes a date of birth; (ii) the 429 answers in the API's own `apiError` envelope with a code, because express-rate-limit's plain text is what `publicFetch` cannot parse and reports as `invalid_link`; (iii) `usePacketCeremony.sign()` retries or lets the driver retry — today any non-201 is a permanent dead end (§1a C2) | a test that walks all 22 marks through the limiter and files; `pnpm --filter @silvicom/api test` | **A driver can sign all twenty-two places in one sitting, and a refusal that does happen says what it was** · *after A0* |
| **A1** ∥ | **Stop the nudge rotating a link that is with the office** · half day | `applicationNudgeSweep.ts` `candidates()` — exclude `review_requested_at`/`approved_at`. ⚠ The rule belongs in `packages/shared/src/applicationNudge.ts`'s `planApplicationNudges`, beside `STALE_DRAFT_HOURS`, not in the query, so it is testable without a database. ⚠ **This is insurance, not a repair** (§1a C1): measured, it has never fired — and it becomes a certainty the moment more than a trickle of applicants sit with the office for two days | `pnpm --filter @silvicom/shared test`; mutate the new predicate and watch a test go red | **An applicant whose application has been with the office for a week still has a working link.** Pin it with a candidate whose `draft_updated_at` is 10 days old and `approved_at` set |
| **A2** ∥ | **One document, not two** · half day | `applicationPreviewPdf` renders `packetFieldFill` + `renderPacketOverlay` with **`marks: []`**, banded DRAFT. ⚠ **Do NOT reuse `renderFiledDocument`'s marks-based switch** (§1a C4): a preview happens before signing, so it always has zero marks, and a marks-based switch would render the summary for ever — the exact defect this step exists to fix. Blank signature lines on a draft-banded preview are correct. `render.ts` stays untouched, for already-filed records only | `pnpm --filter @silvicom/api test`; then render both and `pdftoppm -r 110 -png` — **look at them** | **The office's preview and the driver's filing are the same document.** Pinned by a test that renders both paths from one payload and compares page counts |
| **A3** ∥ | **The drawn mark's four defects** · day | `renderPacketOverlay`'s mark loop — read `mark.signedName` for `mark === "initials"` **before** the `if (drawn)` branch; `usePacketCeremony.adopt()` — surface the staging failure instead of swallowing it; `PacketCeremony.vue` — preview the drawing in drawn mode | `pnpm --filter @silvicom/web test`; rasterise a packet signed by drawing and look at p05/p06/p09 | **A driver who draws gets their drawing on the signature lines and their typed initials on the initials lines, and is told if the drawing did not upload** |
| **A4** | **Initials stop pinning on one keystroke** · half day | `usePacketCeremony.ts` — confirm step before the first mark, editable until it lands. ⚠ Do not raise the contract's `min(1)`: somebody with one legal name has one initial. The defect is the **pin**, not the minimum | web tests; mutate the confirm gate | **A driver can correct a mistyped initial before it is fixed for the document** · *after A3 — same files* |
| **A5a** ∥ | **Migration: a second sign-token hash** · half day | Next-numbered migration — ⚠ **0345**, not 0344 (§1a C7) — adding `sign_token_hash` to `application_invitations`. ⚠ Column only — **no reader in this PR** (`lint:migration-ordering`). Commit the regenerated `schema.generated.sql` | `pnpm lint`; the PGlite matrix | **The column exists in production and nothing reads it** |
| **A5b** | **A fresh link in the approval email** · day | `applicationApprovalNotice.ts` mints a new token into `sign_token_hash` and sends it; `applicationIntake.ts` `resolveInvitation` accepts **either** hash. ⚠ Q-AX4's objection dissolves here — the old link keeps working, so nothing is stranded | api tests; a refused-send test asserting the approval still commits | **An approved applicant gets an email with a link that opens the signing screen, and their old link still works** · *after A5a, separate merge* |

### Wave B · the fold, the artifact, the surface

| | Step | Build | Verify | Done when |
|---|---|---|---|---|
| **B1** ∥ | **`hiringChecklist.ts` — the fold** · day. **START THIS FIRST** | `packages/shared/src/hiringChecklist.ts`. Pure. In: invitation phases, authorizations, packet marks, applications, qualification records, documents, PSP rows. Out per step: `blocked \| waiting_on_them \| waiting_on_us \| done`, the artifact, and the blocker's name. ⚠ **The step list is D-HM9's fourteen and their order is ruled** — write all fourteen, and emit only those whose evidence table exists today. ⚠ Also emit **`readyToTravel`** (steps 1–9 green): D-HM9 makes that the single most valuable thing this fold says, and a recruiter should not have to infer it from nine rows. A step with no artifact cannot be a step (D-HM1) | shared tests; a fixture per state, and one asserting a step is **not** emitted when its evidence table is empty | **The fold answers "where is this applicant" for the five steps that have evidence today, and refuses to invent a sixth** |
| **B2** ∥ | **The step-one permissions PDF** · day | The four instruments + the e-sign consent + the certificate of completion, as one banded interim document. ⚠ It does **not** touch D-AX8: the filed record stays single and hashed; this is banded exactly as `preview.pdf` bands a draft | api tests; rasterise it and read it | **The office can print what an applicant signed on the day they signed it, without waiting for the application to be filed** |
| **B3** | **Serve the fold** · half day | `GET /api/recruitment/applicants/:driverId/checklist`. ⚠ Service role bypasses RLS — org-filter every read and assert it with `supabaseRecorder`'s `expectOrgScoped` | api tests | **The endpoint returns the same answer the fold returns for the same rows** · *after B1* |
| **B4** | **The board** · day | `/recruitment` per `HIRING-UI-PLAN.md` §4.1 and mockup screen 1. `surfaces.ts`: screening + inquiries become tabs, not nav items (D-HUI8) | `pnpm --filter web lint:tokens`, `lint:ui-adoption`, `check-surfaces.mjs`; `preview:local` and look | **A recruiter opening Recruitment sees who is waiting on them, first, without choosing a page** · *after B3* |
| **B5** | **The checklist component** · day | `features/recruitment/`, per §5 of the UI plan and mockup screen 2. ⚠ Not shared yet (D-DS18/D-HUI2). States are badges from `@/lib/badges` — icon **and** word, never colour alone | web tests; render at 1440 and 390 | **Every row states what it is, who owes the move, and the document that proves it** · *after B4* |
| **B6** | **The applicant record rebuilt** · day | `/recruitment/:id` = checklist + `SlideOver`. The five existing sections become drawer bodies — none is rewritten | web tests; walk it in `preview:local` | **A recruiter can do the next thing for an applicant without leaving the page** · *after B5* |
| **B7** ∥ | **The wizard's two additions** · half day | An expectations screen (NN/g: say how many steps and how long) and per-step time estimates on `ApplyProgress`'s list. ⚠ Do not touch the bar or the high-water fence — Q-AX1 settled both | web tests at 390px | **An applicant knows what the whole thing involves before they start it** |
| **B8** ∥ | **The document viewer** · day | Read-only, beside the data rather than a new browser tab. Shared with C1 — same viewer, one of them read-only | render at 1440 and 390 | **An office reviewer can read a filed PDF without losing the record they are reading it against** |

### Wave C · signing — ⚠ before any real ceremony walk

| | Step | Build | Verify | Done when |
|---|---|---|---|---|
| **C1** | **The signing surface** · more than a day | Mockup screen 5. PDF + page rail + START/NEXT, FINISH gated on all 22. `meta.fullBleed` (D-HUI6) — ⚠ **not** a new `meta.layout`. Server half is entirely reusable: `packetTemplate`, `packetMarkGeometry`, `packetFieldGeometry`, `packetOverlay`, `packetGrid` | render at 1440; **and at 390 to answer Q-HUI2 with a measurement** | **A driver can read the page they are about to sign, on the page they are about to sign it** · *after B8, **Q-HUI2*** |
| **C2** | **The adoption dialog** · day | Choose a style / Draw / Upload; signature and initials adopted **separately**; changeable while the envelope is open | web tests; rasterise a packet signed each way | **A driver can adopt a signature, see it, and change it before it is on 22 pages** · *after C1* |

### Wave D · the designed-and-unbuilt steps — each extends B1's fold and nothing else

| | Step | Gated on | Done when |
|---|---|---|---|
| **D1** ∥ | Recorded acts + artifacts for MVR, Clearinghouse and the drug test (D-HM6, D-HM9 steps 5–8). ⚠ **No MVR integration — Q-HM2 ruled there will never be one.** Build the upload, the file, the annual-review clock | **unblocked** | **An MVR pulled anywhere uploads, files, and turns its step green** |
| **D2** ∥ | Road test — §391.31(c) form, examiner, §391.31(e) certificate (D-HM7 / R8). ⚠ No schema widening: 0217 already carries `road_test`. It is an **in-office, on-arrival** act (D-HM9 step 10) | **unblocked** (Q-HM1 settled) | **A passed road test produces a certificate in the driver's file** |
| **D3** ∥ | Orientation as **named sections** within a day (Q-HM7), attendance, and the **handbook** as its own instrument (D-HM10). ⚠ Widen 0215's `purpose` CHECK; add `handbook` to **neither** `APPLICATION_RELEASE_ORDER` **nor** `SCREENING_PREREQUISITES`. ⚠ Separate §382.601 signature block | **unblocked** | **A half-day orientation is schedulable by section, attendance is auditable, and the handbook is signed and filed on the day** |
| **D4** | Re-found `DRIVER-TRAINING-PLAN.md` against the current gate set, then its Phases 0–3. ⚠ Assigned to an **applicant, before they travel** (Q-HM3 ruled) — this is what buys the half-day orientation | **unblocked** | **An applicant watches the videos before they travel, answers the questions, and fails back to the video when they get them wrong** |
| **D5** | Live sessions with auto-assignment of the recording to absentees (§4.4) | D3, D4 | **Somebody who missed the live session is assigned the recording without anybody remembering to do it** |

### Not in the queue, because they are not builds

Send the counsel package · buy a Clearinghouse query plan + IDEMIA verification · three Railway
variables for Resend · point `silvicom360.silvicominc.com` at Railway.
⚠ **"Choose an MVR vendor" is struck** — Q-HM2 ruled there will not be one.

---

## 10. Progress log

Append dated lines here. Never edit a table row above — parallel PRs marking adjacent rows conflict
every time.

- **2026-09-17** — Document created. Application audit recorded (§1, six defects, all reproduced
  against call sites). Market research on Tenstreet/DriverReach, Infinit-I, CarriersEdge, Luma and
  the compliance-file vendors (§4). Regulatory ordering verified against FMCSA and eCFR (§5),
  including the road-test contradiction now carried as Q-HM1. D-HM1–D-HM8 proposed, none ruled.
  **Nothing built.**
- **2026-09-17, later** — `HIRING-UI-PLAN.md` added as the surface companion. ⚠ Its §2.2 is worth
  reading from here: the product-adoption literature's single named anti-pattern is *a checklist that
  makes users repeat what they have already done*, which is **D-HM1 arrived at from the usability
  side** — a correctness argument and an abandonment measurement landing on the same design. Its §2.3
  also recovers three rulings already written into `ApplyProgress.vue` (Q-AX1) that nobody should
  re-derive: the bar indicates and a list navigates, forward is fenced at the high-water mark, and a
  30px step target is what a phone actually gives you.
- **2026-09-17, evening** — §0 (chat-continuity protocol) and §9 (the single execution-grade queue,
  A1–D5) written. `HIRING-MOCKUP.html` added, rendered and corrected twice from the render. The
  sequencing decision worth keeping: **`hiringChecklist.ts` is a pure function with no dependencies,
  so it is buildable on day one in its own chat**, in parallel with every repair in Wave A, and
  everything in Waves B–C consumes it. Wave D then parallelises almost completely because each of
  its steps extends that one fold and nothing else. **Nothing built.**
- **2026-09-17, verification pass** — §1a added: every claim in §1 and §2 re-checked against the code,
  the production Railway variables and the production database. **Seven corrections, C1–C7.** The two
  that change work: **C1** — the nudge/office collision has never fired (`nudged_while_with_office =
  0`) and is **not** the owner's bug, so A1 is insurance rather than a repair; **C2** — the ceremony
  ran for the first time today, recorded **20 of 22** marks in 23 seconds, stopped at `p31a`/`p31b`,
  and **left no trace of why**, which is now **A0** and goes first. **C4** caught a step that would
  have been built wrong: a preview always has zero marks, so the filing's marks-based switch cannot
  be reused there. **Nothing built.**

- **2026-09-17, A0 — DONE. `p31a` was refused with HTTP 429 by the rate limiter, not by anything in
  the packet.** The one sentence the step asked for: **the twenty-first request of the ceremony
  exceeded `/api/public/application`'s bucket of 20 requests per 60 seconds, so `p31a` never reached
  `recordPacketMark` at all.**

  How it was established, because none of it should be re-walked:

  | | |
  |---|---|
  | The bucket | `app.ts` `mountPublic` — `rateLimit({ windowMs: 60_000, limit: 20 })` on the whole `/api/public/application` prefix |
  | The ceremony's cost | **22 requests**, one per place. `publicApplication.ts` says why in as many words: *"twenty-two marks made by one request would be one act"* |
  | The walk, from production | `p03` … `p28` — twenty marks, **22:20:44.85 → 22:21:08.05**, in perfect page order with no gap. The cadence accelerates from 6.6 s to **0.50 s** and then stops dead, which is what a screen changing under somebody looks like, not what quitting looks like |
  | The arithmetic | marks 1–20 are requests 1–20 of a window that opened with mark 1 (nothing else in the 60 s before it — he was typing his name). `p31a` is request **21** |
  | Confirmed live | `curl` the applicants' host: `ratelimit-policy: 20;w=60`. Twenty-one requests **on one reused connection** → the twenty-first is `429` with the plain-text body `Too many requests, please try again later.` ⚠ Twenty-one requests on SEPARATE connections do **not** trip it — production runs two replicas with independent in-memory stores, and only a browser's single HTTP/2 connection lands them all on one. That is why this never showed up in casual testing |
  | What the driver saw | `publicFetch` cannot parse a plain-text body, so `body?.error?.code` is undefined and it throws the default: **`invalid_link`, "This application link is not valid. Ask for a new one."** |

  ⚠ **This is §1.6's "the link dies mid-flow", and §1.6 named the wrong cause.** The nudge sweep was
  the suspect; C1 had already measured that it has never fired. The link was never rotated, never
  expired and never revoked — it was refused for one minute by a limiter, and told the driver it was
  dead. **A1 remains worth shipping on C1's own reasoning; it is not this.**

  ⚠ **It would have happened to every applicant, every time.** Nobody can make 22 requests inside a
  60-second bucket of 20. The ceremony has only ever been walked once, so "every time" and "once" are
  the same number so far.

  **Built** (PR): the two traces a refusal now leaves — a `[public-application] rate limited` line at
  the limiter (which is the layer that refused, naming the step and never the token) and a
  `[packet-mark] refused` line in `recordPacketMark` for the six refusals that *are* that module's.
  ⚠ **The service-level log would not have caught this one**, and its comment says so rather than
  letting the next reader assume otherwise. **The limit is deliberately unchanged — sizing it is
  A0b**, now in §9, and it is the step that unblocks every applicant.

  **Found on the way, and fixed here because it was one line:** `/api/public/application` was
  **invisible to `routeAuth.test.ts` and `routeGates.test.ts`**. Both discover mounts by scanning
  `app.ts` source with a regex that cannot cross a newline, and this mount — the only unauthenticated
  surface that takes a date of birth, a licence number and possibly a Social Security number — was
  broken across four lines. The mount two lines above it carries a comment warning about exactly that
  hazard. It is one line again and now carries its argument in both ledgers, so it is public **by
  declaration** rather than by omission.

  **Not walked:** A0 asked for a fresh QA-org invitation walked to `p31a`. It was not needed — the
  refusal reproduces directly against the applicants' host, with the response code, and a walk would
  now only re-confirm it. Production's half-signed ceremony is untouched: 20 marks, unfiled, and its
  link is still good, so the owner can finish it in a fresh minute once A0b lands.

  ⚠ **A second, separate defect found while ruling out the alternative, and NOT fixed here.**
  `usePacketCeremony`'s `outstanding` is a `computed` over the `stops` prop, and its comment claims it
  is *"computed once per load rather than re-derived after each mark"*. It is not: `useApplyInvitationQuery`
  is a plain `useQuery` under a default `VueQueryPlugin`, so `refetchOnWindowFocus` is on and
  `staleTime` is 0. A driver who switches window mid-walk gets a refetch, `outstanding` shrinks by
  everything they have signed while `index` keeps counting up, and `current` falls off the end of the
  array — at which point `PacketCeremony.vue`'s final `v-else` tells them **"every place collected"**
  and emits nothing. Silent, unfileable, and it strands any walk past the eleventh mark. It is not
  what happened on 2026-09-17 (that needs a focus event inside one 0.5 s gap; the limiter needs no
  coincidence at all), but it is live. Belongs with A0b or C1.

---

## 11. Sources

**Regulatory** — [49 CFR §382.301](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-382/subpart-C/section-382.301) ·
[§382.601](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-382/subpart-F/section-382.601) ·
[§382.401](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-382/subpart-D/section-382.401) ·
[§380.725](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-380/subpart-G/section-380.725) ·
[FMCSA Clearinghouse FAQ — queries and consent](https://clearinghouse.fmcsa.dot.gov/FAQ/Topics/queries-and-consent-requests)

**Market** — [Tenstreet: a modern guide to driver onboarding](https://www.tenstreet.com/blog/onboarding/better-onboarding) ·
[Tenstreet: get your drivers to orientation](https://www.tenstreet.com/blog/onboarding/get-drivers-orientation-onboard-better) ·
[Tenstreet: automation tools](https://www.tenstreet.com/blog/driver-recruiting/best-automation-tools) ·
[Tenstreet acquires DriverReach (Transport Topics)](https://www.ttnews.com/articles/tenstreet-acquires-driverreach) ·
[CarriersEdge: driver onboarding](https://www.carriersedge.com/solutions/onboarding) ·
[Luma / Forward virtual orientation (CCJ)](https://ccjdigital.com/forward-driver-training-costs-improve-compliance-virtual-orientation) ·
[Luma LumaLive (CCJ)](https://www.ccjdigital.com/business/article/14939438/luma-announces-new-video-conferencing-tool-for-carriers) ·
[Infinit-I / INFINITI](https://infinitiworkforce.com/)

**Signing ceremony (previous analysis)** — [DocuSign basic signing](https://support.docusign.com/s/articles/How-do-I-sign-a-DocuSign-document-Basic-Signing?language=en_US) ·
[Adopt or change a signature](https://support.docusign.com/s/articles/How-do-I-change-my-signature-or-adopt-a-custom-signature-NDSE?language=en_US) ·
[Auto-navigation settings](https://www.guideflow.com/tutorial/how-to-set-auto-navigation-to-navigate-all-fields-in-docusign) ·
[Finish Later (ASU)](https://tech.asu.edu/docusign/finishlater)

**In-repo** — `RECRUITING-SYSTEM-PLAN.md` (R0–R9, D-REC1–7, Q-REC1–8) · `DRIVER-TRAINING-PLAN.md` ·
`APPLICATION-PACKET-PLAN.md` · `APPLY-EXPERIENCE-PLAN.md` · `HIRING-PLAN.md` (D-HIRE1–6) ·
`HANDOFF-2026-09-15.md` · `COUNSEL-REVIEW-PACKAGE.md`
