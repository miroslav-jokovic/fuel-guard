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
- ⚠ **The nav is generated from `NAV_SURFACES`** in `packages/shared/src/surfaceCatalogue.ts`. Nav paths are
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

- **~~Q-HM8 · `packages/shared/src/surfaces.ts` is at 500 of 500 lines. Who splits it, and when?~~
  RULED AND DONE 2026-09-18 — candidate (a), as its own PR.** `surfaceCatalogue.ts` holds the data
  (348 lines) and `surfaces.ts` the types and gate logic (191), so a screen no longer competes for
  budget with the rules that govern it. `check-surfaces.mjs` moved with it. ⚠ **The split's own
  trap, kept because it will recur:** the new file's header quoted the `SURFACES` declaration
  verbatim, the gate's parser matched the COMMENT, read to the next `];` — the end of
  `SURFACE_GROUPS` — and reported nine surfaces where there are fifty-seven. The gate said *"parser
  or literal shape changed"* and was right. Prose about a parsed file must paraphrase what the
  parser matches. The question as originally raised is kept below.

  (raised by B4, 2026-09-18)

  B4 added one nav comment and two catalogue entries and took the file over its budget; the comments
  were cut back to fit. ⚠ **That is the wrong repair and it only worked once** — the file now has
  **zero** headroom, so the next person to add a surface faces the same choice with less context
  than this one had, and the cheap way out is a waiver, which `lint:filesize` names as a deliberate,
  reviewable act precisely because it is the workaround.

  **Candidates:**
  - **(a) Split along the seam `hiringSteps.ts` took at its own 450 warning** — `surfaceCatalogue.ts`
    holds `SURFACE_GROUPS` and the `SURFACES` array (the data), `surfaces.ts` keeps the types and the
    gate functions (`surfaceGateAllows`, `canReachSurface`, `surfaceAllowed`, `surfaceForPath`).
    ⚠ **`scripts/check-surfaces.mjs` PARSES the catalogue at a hard-coded path** rather than importing
    it — for the reason every gate in this repo does, that a gate needing the workspace built cannot
    run before the build — so the gate's `CATALOGUE` constant and its parser move in the same PR. Its
    `--self-test` covers nineteen detectors, so the split is verifiable rather than hopeful.
  - **(b) Waive the file.** Cheapest today, and it retires the only pressure that has kept a
    37-entry catalogue readable. The budget's own argument against squeezing back under applies
    doubly to switching it off.
  - **(c) Do nothing and let the next author decide.** Which is (b) with the decision made by
    whoever is in the most hurry.

  **Recommendation (a), as its own PR before the next surface is added, not bundled into one.** It
  touches a gate that three consumers depend on and nothing about it belongs in a feature step.

- **Q-PKT11 · `usePacketCeremony.ts` is at 481 of 500 lines, and the next author gets nineteen.**
  (raised by A4, 2026-09-18.) It was 248 before A3. A3 added the drawn-mark rule and its reasoning,
  A4 added the confirm state, the per-kind pin and the retired cursor's post-mortem — all of it the
  long-form WHY this repo's conventions ask for, and all of it load-bearing: the cursor comment is
  the only place the `refetchOnWindowFocus` hazard is written down.

  ⚠ **It passes `lint:filesize` and it is over the 450 warning**, which is exactly where
  `surfaces.ts` stood when Q-HM8 was raised — and Q-HM8's finding was that squeezing the comments
  back under *"is the wrong repair and it only worked once"*.

  **Candidates:**
  - **(a) Split along the seam the file already has.** The walk (`outstanding`, `current`,
    `position`, `sign`) and the ADOPTION (`adoptedName`, `adoptedInitials`, `style`, `markBlob`,
    `adopt`, `confirm`, `reopen`, `pinnedKinds`, `canChange`) are two cohesive halves that touch each
    other at exactly two points — `markFor` and `currentShowsDrawing`. `usePacketAdoption.ts` beside
    it, composed by `usePacketCeremony`, keeps the public surface the component reads unchanged.
  - **(b) Waive the file.** Retires the only pressure keeping it readable, on the file that has
    produced four defects in two days.
  - **(c) Trim the comments.** Cheapest, and it deletes the record of why the cursor was removed —
    which is the single thing most likely to be reintroduced by somebody optimising later.

  **Recommendation (a), as its own PR before C2** — which adds the adoption dialog and will land
  squarely in the half that is already full. ⚠ Not bundled into a feature step: the split is a
  refactor whose whole value is that nothing about it changes behaviour, and it wants a diff that
  says so.

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

- **2026-09-17, A0b — DONE. The applicant's link has two budgets now, and a third one that nobody
  had counted turned up on the way.** A0 measured the cause; this is the repair, and all three parts
  the step asked for are in it.

  **(i) The bucket is sized to the document, not to the adversary.** The intake keeps its 20 a
  minute — it is sized for a form that takes a date of birth and a licence number, and nothing there
  is asked for twenty times — and **loses the one route it was never sized for**. `POST /:token/mark`
  gets `PACKET_CEREMONY_LIMIT = 60`, which is the 22-place packet nearly three times over in a
  minute. ⚠ Deliberately not "22 plus a bit": a number sized to exactly one perfect walk refuses the
  first imperfect one, and the imperfect walk is what this step exists because of.

  ⚠ **Keyed by the LINK, not the address, and that is the load-bearing choice.** D-HM9 step 13 puts
  the signing *in the office* on the day the driver arrives, so several applicants on one address is
  the designed case — under an address key the second driver spends the first one's packet. This is
  `apiRateLimitKey`'s reasoning applied to applicants: *"every dispatcher in one office shares one
  address"*. The token is hashed for that module's reason (a rate-limit key outlives its request),
  and minting fresh buckets is still bounded by `apiAddressCeiling` over all of `/api`.

  ⚠ **A THIRD bucket was found while testing and it would also have stopped the ceremony** —
  `calcLimiter`, **60 a minute keyed by address, mounted on all of `/api/public`**. Its comment says
  what it is for: *"the public calculator is unauthenticated → its own tighter limiter on the abuse
  surface"*. It was argued and sized when the hazmat calculator was the only thing under that prefix;
  the application was mounted beside it later and silently inherited a number nobody had argued for
  it. **Three applicants signing in one office is 66 marks from one address**, so it fails the same
  way one step further out. The application prefix now opts out of it, with the argument recorded at
  the predicate. ⚠ This is the second time in one day that this surface was governed by a decision
  taken about something else — worth reading next to §1a C5: the citation drifts, and so does the
  reason.

  **(ii) The 429 answers in the API's own envelope.** `apiError("too_many_requests", …)` with a
  message that names the wait. express-rate-limit's default plain-text body is what `publicFetch`
  could not parse — that is the whole mechanism by which a perfectly good link was reported dead.

  **(iii) The ceremony tells a refusal from a fault.** `usePacketCeremony` carries `rateLimited`
  separately from `error`, and `PacketCeremony.vue` picks different words: the limiter's message says
  wait about a minute, press again, nothing is lost. ⚠ `index` still does not advance, so pressing
  again retries the **same place** — never skips it.

  ⚠ **§1a C2's "permanent dead end" was too strong, and correcting it matters for A0b's scope.** The
  Sign button is `:disabled="ceremony.working.value"` and nothing else, so a driver could always press
  it again; what they could not do was *know that was worth doing*, because every refusal — including
  one that would clear itself in forty seconds — told them to check their signal or get a new link.
  The dead end was in the words, not in the button. So no retry timer was built: with the bucket now
  three packets wide, an honest walk cannot reach it, and an automatic retry would be machinery in
  front of a case that should not occur.

  **Verified:** five mutations, five red — shrink the ceremony bucket, drop the link key, send a
  plain-text body, stop `calcLimiter` skipping, and stop the client flagging. Two applicants from one
  address are pinned as independent. `pnpm lint`, `typecheck`, `test` green.

  **Still open, and deliberately:** the `outstanding`/refetch stranding recorded under A0 is
  untouched. It is a separate defect with a separate mechanism and belongs with C1.

- **2026-09-17, B1 — DONE. `hiringChecklist.ts` folds D-HM9's fourteen steps out of evidence rows.**
  Pure, no clock, no network, no schema; `packages/shared/src/hiringSteps.ts` holds the catalogue and
  `hiringChecklist.ts` the fold. Everything in Waves B–C can consume it now.

  ⚠ **B1's own done-when said "the five steps that have evidence today" and the real number is
  TWELVE.** That sentence was written before §1a confirmed what 0217 already carries. Measured
  against the schema on 2026-09-17: `mvr`, `clearinghouse_full`, `drug_test`,
  `medical_registry_verification`, `road_test` and `cdl_equivalency` are all live
  `qualification_records` kinds; `psp_requests` is migration 0216; `application_invitations`,
  `driver_applications`, `driver_authorizations` and `application_packet_marks` all exist. **Exactly
  three steps have no evidence table**, and all three are the unbuilt ones D4/D3 already own:
  orientation videos (there is not one `training_*` table in any migration), the live orientation
  day, and the handbook (D-HM10 needs 0215's `purpose` CHECK widened). Built to the measurement, not
  to the sentence — and the sentence is what is corrected here.

  **The decisions the step forced, each one recorded at its call site:**

  | | |
  |---|---|
  | Emission | Only steps with an evidence table. D-HM1's corollary — *a step with no artifact cannot be a step* — is a `filter`, and the three unbuilt steps stay in the catalogue so D-HM3's order is written down once |
  | Prerequisites | Every edge is **law or a database constraint, never a preference** (D-HUI7 lets the office act out of order on everything else). So: MVR and PSP ← the signatures `SCREENING_PREREQUISITES` names · the packet ← `approved_at`, because `record_packet_mark` raises DR032 without it · **Clearinghouse ← nothing**, because its consent is given in FMCSA's portal and is deliberately absent from `APPLICATION_RELEASE_ORDER` |
  | The road test | Blocked on the **drug test only**, which is §5.1's strict reading under the open Q-HM1. FMCSA has said in writing the Clearinghouse query may follow a road test, so that half is explicitly **not** a blocker; the drug-test half is the inference every commercial source draws and no FMCSA document does, and D-REC7 says take the answer that can only be stricter |
  | Two evidences, one requirement | `cdl_equivalency` satisfies the road test — §391.51(b)(4), which `dqCatalogue.ts` already models |

  ⚠ **`readyToTravel` is NOT a boolean, and that is the most important line in the step.** Step 9 is
  inside its range and has no evidence table, so a boolean would answer *"yes, fly him out"* about
  somebody who has watched no videos. Both readiness answers return `{ ok, unmeasured, outstanding }`
  — `ok` is only ever true when `unmeasured` is empty. **This is the medical-certificate lesson
  applied one level up**: D-HM9 records that the gate was missing for weeks because *capture* had
  been read as *verification*, and a summary that treats "we have no way to check" as "checked" is
  the same mistake with a wider blast radius. It follows that `readyToTravel.ok` is **false for
  everybody until D4 ships** — correctly, and it says why by name.

  ⚠ **One defect the tests caught in the fold's own design, worth keeping written down.** `next` —
  the board's single "do this now" — was *"the first step the OFFICE owes"*. Because the Clearinghouse
  query has no in-product prerequisite, that nominated **run the Clearinghouse query** for an
  applicant who had been sent a link and had signed nothing: a query the carrier pays for, against a
  federal gate, on somebody who may never apply. It is now the first step in D-HM9's order that is
  neither done nor blocked, which cannot recommend spending money on a stranger. Pinned by *"does not
  send the office off to buy a Clearinghouse query for a stranger"*.

  **Verified:** seven mutations, seven red, each hitting a different assertion — emit unmeasurable
  steps · swallow `unmeasured` · read `AUTHORIZATION_PURPOSES` instead of `APPLICATION_RELEASE_ORDER`
  · unblock the road test · drop the licence equivalency · hard-code 22 marks · show the artifact
  before the step is done. Fixtures are built from `APPLICATION_RELEASE_ORDER` and
  `packetDriverMarkCount()` rather than from `4` and `22`, so they cannot pass through the change
  they exist to catch. `pnpm lint`, `typecheck`, `test` green.

  ⚠ **Split into two files at the 450-line warning, not at the 500 wall**, along the seam `app.ts`'s
  header argues for: `hiringSteps.ts` is the ruled process (which steps, what order, which are
  federal, what proves each) and `hiringChecklist.ts` is the computation over it. A new file landing
  22 lines from the wall leaves the next person — whoever builds one of the three unbuilt steps — with
  no headroom, which is the exact failure the budget exists to prevent.

- **2026-09-17, B3 — DONE. `GET /api/recruitment/applicants/:driverId/checklist` serves the fold.**
  `applicantChecklist.ts` gathers seven reads and hands them to B1; `routes/checklist.ts` is a gate,
  a 404 and an envelope. ⚠ **The service decides nothing** — if a question about hiring can be
  answered in it, it is in the wrong file, which is how the applicant comes to be told they are
  waiting on us while the office is told the opposite (D-HM2, and §1's board defects twice).

  **The three column-level decisions, each one a place a wrong read would have been invisible:**

  - **The live invitation is the NEWEST one.** A driver can have several — a re-sent link, or a
    rehire, which 0337 says must not merge — and folding an older row reports last spring's progress
    as this week's.
  - **Packet marks are counted against that invitation, never the driver.** 0339 scopes them to the
    invitation for the same rehire reason; a driver-keyed count adds last year's twenty-two to this
    year's none and reports a packet signed that nobody has opened.
  - ⚠ **PSP is done when the RECORD exists, not when an order settles.** Both paths file a
    `qualification_records` row of kind `psp_report` — `/psp-orders` on a settled order and
    `/psp-imports` from a report bought on FMCSA's portal — so a PSP obtained outside the product
    ticks the step exactly as an ordered one does. That is D-HM6's *"recorded acts, not
    integrations"* read from the evidence side, and it is what makes D-HUI5 liveable rather than a
    nag. B1's `evidence` string for that step is corrected here from `psp_requests` to
    `qualification_records.psp_report`; the request row is still what `requested` reads.

  **`view`, not `manage`, and the AUDITOR is what settles it** — the one role with
  `recruitment: "view"` and not `manage`. Gating a read-only summary on `manage` would refuse exactly
  the reader a §391.51 hiring file exists for, and every write it summarises is already gated by the
  route that performs it.

  ⚠ **The response carries no §391.21 answers, no date of birth and no licence number — by
  construction, not by filtering.** The fold reads the existence of rows and a set of record kinds,
  so there is nothing to redact; pinned by *"never selects the application's answers"*.

  ⚠ **Two mutations passed at first, and both were the TEST's fault rather than the code's** — worth
  recording because both are shapes that will recur:

  1. **`supabaseRecorder` applies no filters, no order, no limit, and no column projection.**
     Dropping `revokes` from the authorizations select changed nothing, because the fake handed whole
     rows back — so *"honours a revoked release"* passed against a service that never read the
     revocation. The fixture now applies the `eq` filters, the `order`, the `limit` **and the select
     list** the query actually made. Same family as
     [[supabase-recorder-does-not-filter]], one step further: projection matters too.
  2. **The role chosen to prove a gate has to be able to fail it.** `manage` instead of `view`
     refused nobody, because admin, safety_manager and recruiter all hold `manage`. The auditor is
     the discriminating case and is now in the list.

  **Verified:** seven mutations, seven red — unscoped read · oldest invitation · marks not keyed on
  the invitation · PSP read from the order · `revokes` not selected · membership check unscoped ·
  gated on `manage`. The headline assertion builds one state twice, as database rows and as fold
  inputs, and demands the whole objects match, so no rule is restated in the API to be got wrong
  separately.

  ⚠ **CI's `gates` job caught a real boundary violation that `pnpm lint` does not run**, and the
  right answer was not the one the gate offered. `psp_requests` belongs to the `psp` module (D-SEP1)
  and `lint:table-access` refused a raw `.from()` on it from recruitment — *"read it through the
  owner's interface, or grandfather with justification"*. **Grandfathering is the workaround**; the
  fix is `hasPspRequest()` on the psp module's own interface, which keeps the table's shape — the
  `status` CHECK, the billing stance, the monitoring flag — where they live. ⚠ It deliberately does
  **not** answer "is PSP done": the report is a `qualification_records` row, so completion is the
  evidence layer's answer and a helper that gave it would put half the checklist's rule in the
  collector. It went in a NEW `pspRequests.ts` rather than onto `pspOrder.ts`, which was already at
  495 of its 500 lines.

  ⚠ **`pnpm lint` is not the gate set.** `lint:boundaries` and `lint:filesize` both pass or fail
  independently of it, and both failed here after a green `pnpm lint`. §0 rule 5 says run the gates
  before pushing; what this adds is that *the gates* means the list in `package.json`, not the one
  script whose name suggests it. `pnpm lint && pnpm lint:boundaries && pnpm lint:filesize &&
  pnpm lint:funcsize && pnpm lint:table-writers && pnpm lint:comment-claims` is the cheap subset for
  a change that adds a file or reads a table.

- **2026-09-18, B4 — DONE. `/recruitment` is a board: five columns, one nav entry, three tabs.**
  The done-when, in a person's terms: a recruiter opening Recruitment now lands on *waiting on you*,
  sorted oldest-first, with the one action for each row in words — without choosing a page.

  **What was built, in three layers, and the seam between them is the point.**

  | | |
  |---|---|
  | shared | `hiringSteps.ts` gains `phase` (the Stage column's five words) and `action` (the Next-action column's instruction). `hiringStep(key)` resolves a spec, total over the union |
  | api | `applicantBoard.ts` folds EVERY applicant set-based — three `.in()` queries for the whole org, then B1's pure fold per row — and `/pipeline` returns the projection beside the row it already returned. `driversWithPspRequest` is the psp module's set-based half of B3's `hasPspRequest` |
  | web | `RecruitmentPage.vue` rebuilt to §4.1; `RecruitmentTabs.vue` is the strip; `surfaces.ts` makes screening and inquiries children of the board |

  ⚠ **Three queries at two applicants and three at two thousand, and that is deliberate rather than
  tidy.** A loop over B3's endpoint would have been seven round trips per row on the screen a
  recruiter leaves open all morning — the shape `LIVE-MAP-CONCURRENCY-PLAN.md` §7 measured as
  refusing a whole office, and which took #856–#858 to undo. It is pinned by a test that folds six
  applicants and counts the queries, because a one-applicant fixture cannot tell the two
  implementations apart.

  **⚠ THE THREE DEFECTS THAT ONLY LOOKING FOUND.** All three shipped green, all three were found by
  rendering the board in a browser, and none of them could have been caught by any test that existed
  at the time. This is §8's verification rule earning its place, twice over:

  1. **A declined applicant sat at the top of the default "waiting on you" view**, sixteen days
     stale, on a screen whose whole question is *what is mine today*. The page already refused to
     print a next action for them — the comment above that cell says a stale sentence beside a
     decline *"is what would send the next recruiter to chase them"* — and the filter and the counts
     had no such rule, so the row was simultaneously blank and counted. Fixed at the projection
     (`BoardApplicantInput.decided`) rather than in the page, so there is one answer: their
     checklist is untouched and still true, only the board's queue changes.
  2. **The Next-action column printed step LABELS**, so it read *"Next action: Office approved it"* —
     a completed fact where an instruction belongs. `label` names a step as a thing, which is what a
     checklist row is; the board was asking the catalogue a different question. `action` is that
     question's answer, and a catalogue test now asserts no step's action equals its label.
  3. ⚠ **A filter's ✕ blanked the board.** `FilterSelect.clear()` emits `""` unconditionally, so a
     filter whose "show everything" value is `"all"` has no value its own clear button can produce —
     pressing it sets a value nothing matches. TWO of the three filters inherited `"all"`/`"live"`
     from the previous board and had carried this the whole time. All three rest at `""` now, which
     makes the ✕ on the state filter mean exactly the right thing: *clear the "mine" filter, show me
     everybody.* `RecruitmentPage.test.ts` presses every clear button.

  **The decisions the step forced:**

  - **Stage is the phase of the step they are waiting on**, from the catalogue, and the older
    `ApplicantStage` no longer has a column. Two live answers to "what stage" on one screen is
    D-HM2's disagreement; `applicantPipeline.ts` is still correct about what it measures and stops
    where the application does, and the board now goes to the hire. ⚠ **`applicantStageBadge` and
    `APPLICANT_STAGES` have lost their last UI consumer** — retiring them is a follow-up, named here
    rather than left silent.
  - **There is no "Blocked" filter, and its absence is a measurement.** `next` is the first step
    neither done nor blocked, so a row can only lack a next step when everything measurable is done:
    a blocking step is always preceded by the unmet step that blocks it, which is unblocked and gets
    nominated first. The mockup's Blocked badge cannot arise from the fold, and a filter that always
    returns zero is worse than no filter. Blocked steps are real and belong on B5's checklist.
  - **"Days waiting", not §4.1's "days in stage".** What the evidence can date is when a step last
    COMPLETED; a stage boundary is one of those moments and not the only one, so "days in stage"
    would be a claim this data cannot make. It answers Q-HUI4's question — *what is going stale* —
    and it counts from the newest evidence of any kind, never from the invitation: an applicant
    invited in March whose drug test landed yesterday is not 180 days stale.
  - **The default view hides rows, which is a hazard, and the counts are its whole licence.** The
    option labels carry the count of every view they are not showing, so the closed trigger reads
    "Waiting on you (3)" with "Everyone (6)" one click away. The empty state was split in two for
    the same reason: *"nobody has applied"* and *"nothing is waiting on you"* are different facts
    and the second is good news.
  - ⚠ **B3's `applicantChecklist` read a REVOKED invitation as the live one, and that was a real
    divergence rather than a nicety.** `applicationIntake`'s `resolveInvitation` treats a revoked row
    as dead and `/pipeline` has always skipped them, so a recruiter who revoked a link and sent
    nothing else got the board describing one application and the record page describing another —
    D-HM2's failure by name. Both read "newest, not revoked" now, and the board passes the
    invitation it chose into the fold rather than letting a second query pick its own.

  **⚠ THE DEVIATION, stated rather than buried: the tabs NAVIGATE, they do not swap a panel.**
  D-HUI8 asks for tabs; the obvious reading is `v-if` over three panels on one route. Three things
  argued against it and none is preference — both siblings are routed pages with their own
  `PageHeader` (`lint:ui-adoption` allows one per page, so they would have to be rewritten into panel
  components first, which is a day on two files this step does not otherwise touch); both URLs are
  live and were registered in the 2026-08-20 P0b incident, so a notification can still link at
  either; and the repo already models "reached from another screen, same grant" as a `parent`
  surface. What a person sees is one sidebar entry and three tabs over one table. What the router
  sees is three routes. `RecruitmentTabs.vue` is the only thing that has to change if they are ever
  rebuilt as panels.

  **Measured before changing `surfaces.ts`, because the precedent demanded it.**
  `maintenance.repair-spend`'s comment records that a surface key is the primary key an override is
  stored against, and that renaming one silently resets every org's and every user's answer. So
  production was read first, 2026-09-18: `org_role_surface_access` and `user_surface_access` hold
  **zero** rows for any `recruitment.*` key. Nothing stored is reinterpreted by the two becoming
  children of the board. The keys are unchanged either way.

  **⚠ `navEquivalence.test.ts`'s nineteen snapshots were updated, and the diff is the evidence.**
  That file says in its own header that a passing run is the proof nothing moved, so an update needs
  a better reason than "it went red". Across all nineteen the whole change was the same two lines
  removed — `"Screening readiness → /recruitment/screening"` and
  `"Safety-history inquiries → /recruitment/inquiries"` — in no other role, group, gate or module
  set. The harness turned "I moved two nav items" into a proof that I moved two nav items and
  nothing else. `nav.test.ts`'s three-surface assertion was rewritten rather than deleted, and the
  P0b guarantee it carried moved to `RecruitmentTabs.test.ts`, where it got stronger: it now holds on
  the two sub-pages themselves, which is where somebody arriving from a notification actually lands.

  **Verified.** Seven mutations on the projection, six on the page, four on the tab strip —
  seventeen, all red, each against a green baseline. ⚠ The first mutation run was thrown away and
  re-done: `git checkout --` is refused in a worktree-isolated session, so every revert had silently
  failed and the six "results" were cumulative. A mutation harness that does not prove its own revert
  proves nothing. Two fixtures were also tightened after they passed for the wrong reason — the PSP
  case never reached PSP, because the MVR comes first in D-HM9's order and the nomination stopped
  there. `pnpm lint`, `typecheck`, `lint:surfaces`, `lint:boundaries`, `lint:filesize`,
  `lint:funcsize`, `lint:comment-claims`, `lint:table-writers`, `lint:table-access`, `lint:tests`,
  `lint:tokens` and all three suites green. Rendered at 1440 and 390; no horizontal overflow at 390
  (375 = 375), where `DataTable` gives its card layout and the strip wraps to three.

  **⚠ BLOCKER RECORDED, not routed around: `packages/shared/src/surfaces.ts` is at 500 of 500.**
  This step's comments took it over and they were cut back to fit — which is the wrong repair and is
  only defensible as a one-off, because the next person to add a surface has NO room and will face
  the same choice with less context. Adding a waiver is the workaround (`lint:filesize` says so in
  as many words). The honest fix is the split `hiringSteps.ts` took at its own 450 warning: the
  catalogue array in one file, the types and gate functions in another. ⚠ It is not a five-minute
  job — `check-surfaces.mjs` PARSES that exact path rather than importing it, so the gate's parser
  moves with the file and the two have to land together. Carried into §8 as Q-HM8.


- **2026-09-18, Q-HM8 — DONE. `surfaces.ts` split, so a screen stops competing for budget with the
  rules that govern it.** Not a queue step: B4 raised it as a blocker and this is the answer, shipped
  as its own PR exactly as §8 recommended rather than bundled into a feature step.

  | | |
  |---|---|
  | `surfaceCatalogue.ts` (new) | `SURFACE_GROUPS`, `SURFACES`, `NAV_SURFACES`, `surfaceForPath` — **the data**. 352 lines |
  | `surfaces.ts` | the types, the gate constructors and `surfaceGateAllows` / `canReachSurface` / `surfaceAllowed` / `isEditableSurface` — **the logic**. 198 lines |

  The dependency runs catalogue → surfaces, one way, so there is no cycle and the four gate functions
  can now be read without scrolling past 280 entries. It is the seam `hiringSteps.ts` /
  `hiringChecklist.ts` took at its own 450 warning, for the same reason.

  **Moved with it, because a gate that parses a path is bound to that path:**
  `scripts/check-surfaces.mjs`'s `CATALOGUE` constant and the error message that names the file;
  `apiContract.ts`'s import of `SURFACES`; the barrel export; and four live code citations
  (`router/index.ts`, `routeReachability.test.ts`, `routes/maintenance.ts`,
  `MaintenanceHomePage.vue`). ⚠ Dated statements in other plans were **left alone** — they are
  records of what was true on their date, and rewriting history to match a rename is how a decision
  log stops being one.

  ⚠ **THE TRAP THIS SPLIT HIT, and it is worth the paragraph because it will recur.** The new
  file's header explained the arrangement by quoting the declaration the gate's parser looks for.
  The parser matched **the comment**, read to the next `];` — the end of `SURFACE_GROUPS` above it —
  and reported **nine** surfaces where there are fifty-seven. The gate refused with *"parser or
  literal shape changed; fix together"*, which is exactly the sentence it exists to say, and the
  file now paraphrases instead. **Prose about a parsed file must not quote what the parser matches.**
  The comment says so, at the place it happened.

  **Verified:** three mutations, three red against a green baseline — the gate's path left pointing
  at `surfaces.ts` where the data no longer is (exits 1, naming `surfaceCatalogue.ts`); a surface
  dropped during the move (*"navIcons.ts has an icon for `fleet.drivers`, which is not a nav
  surface — the split has drifted"*); and the header quoting the declaration, which is the live bug
  above. `check-surfaces.mjs --self-test` still fires all nineteen detectors. `pnpm lint`,
  `typecheck`, `lint:filesize`, `lint:boundaries`, `lint:funcsize`, `lint:comment-claims`,
  `lint:shared-contracts`, `lint:table-access`, `lint:tests` and all three suites green —
  **57 surfaces, 33 in the sidebar, unchanged in both directions.**

  **Headroom restored:** 148 lines on the catalogue and 302 on the logic, against zero before.


- **2026-09-18, B5 — DONE. The applicant record leads with a checklist whose every row says what it
  is, who owes the move, and the document that proves it.** `features/recruitment/` per D-HUI2 —
  `HiringChecklistCard.vue`, `useApplicantChecklist.ts` (B3's endpoint had no reader until now) and
  `hiringArtifacts.ts`. Not shared, and Q-HUI3 already names the trigger that promotes it.

  **Two design questions were settled in the CATALOGUE, not in the component, and both were the same
  shape as the one B4 hit.**

  | | |
  |---|---|
  | The artifact column | `spec.evidence` was a bare table name, so *"qualification_records.mvr"* was what the third column rendered. It is now `{ table, label }` — one object, not a field beside a field, so **a step with an evidence table and no words for it is unrepresentable** rather than merely forbidden by D-HUI3. `table` still means exactly what it meant and is still what keeps a step out of the fold |
  | Reaching the document | A route, so it stays in `apps/web`. ⚠ `HiringEvidenceTable` became a CLOSED UNION for this: the map from artifact to address is a `Record` over it, so a new step with a new artifact is a **typecheck failure** in `hiringArtifacts.ts` until somebody says where it is reached. Proved by deleting one entry — `error TS2741`. Without it that map is a copy with a delay fuse, which is the failure mode `CLAUDE.md` names |
  | The badges | One `Record<HiringStepState, {tone, icon}>` in `badges.recruiting.ts`. B4's `hiringWaitingOnBadge` reads it too and keeps B4's tones, so the board's *You* and the checklist's *Waiting on you* now carry the same glyph. ⚠ `hiringPhaseBadge` was deliberately NOT given one: the stage is not one of D-HUI4's four states, and five phases with five icons is a second vocabulary and a louder board |

  ⚠ **`readyToTravel` is rendered as a sentence, never a tick.** `ok` is false for everybody until
  D4 ships, so the card says *"Not ready to travel — 2 steps outstanding, and orientation videos
  cannot be checked yet"*, naming what it could not measure. A green tick there would be the
  medical-certificate mistake at the summary level, and Q-HM5 makes travel a hard gate.

  **Where each artifact is reached, measured rather than assumed:** nine resolve to the driver's
  §391.51 file — including the signed packet, because `applicationPdf/file.ts` files it as a
  `documents` row of kind `employment_application` cited by a qualification record, so it is already
  listed and downloadable there. Two are cards on the applicant record itself. **One resolves to
  nothing: `driver_authorizations`.** The read endpoint exists and no screen in the office's half of
  the product calls it, so the row states the artifact and does not link it. ⚠ Recorded as **Q-HUI6**
  in `HIRING-UI-PLAN.md` §7 with three candidates and a recommendation, rather than pointed at the
  nearest page — a row that says "Authorizations" and opens the application is worse than one that
  does not open.

  **Verified:** ten mutations, ten red, each on a different assertion — artifact shown before the
  step is done · rendered as its table name · the loud state stops being loud · the state badge
  loses its icon · the travel sentence swallows `unmeasured` · the next action becomes the step's
  label · an unreachable artifact pointed at the nearest page · an artifact label restating its step
  · a blocked row that stops naming its blocker · completed steps filtered out of the count. Plus
  the typecheck fuse above. ⚠ The harness restores by writing the original bytes back, never
  `git checkout --`, which is refused in a worktree-isolated session and cost B4 a whole run.

  **And the one defect every test was green for**, found by rendering at 1440 and 390 with
  `preview:local` + `VITE_DEV_BYPASS`: the blocked rows read ***"needs office approved it"***. The
  step labels are not one grammatical form — "Permissions signed" is a past-tense fact, "Driving
  record" is a noun, "Office approved it" is a clause with its own object — so no preposition
  composes with all twelve. It ships as `Needs: <Label>`, where the colon does the work. Same lesson
  as B4's *"Next action: Office approved it"*, one field over.

  `pnpm lint`, `typecheck`, `test` (9,445 unit + 40 matrices), `lint:boundaries`, `lint:filesize`,
  `lint:funcsize`, `lint:comment-claims`, `lint:ui-adoption`, `lint:surfaces` and
  `--filter web lint:tokens` all green. No migration; no schema change.

- **2026-09-18, B6 — DONE. The applicant record is the checklist, and every row opens the work behind
  it.** `/recruitment/:id` = `PageHeader` → `HiringChecklistCard` (rows are buttons now) →
  `ExplainerPanel` → `HiringStepDrawer`. The lead action stopped being a sentence and became a button
  that opens the same drawer its row does, which is the difference the done-when is actually about:
  before B6 the card said what to do next and left the reader to find where.

  ⚠ **§4.2's sentence — *"the five existing sections become drawer bodies"* — describes a mapping
  that does not exist, and finding that out is most of what B6 was.** Measured against the fold:
  **five of the twelve emitted steps have a body today and seven do not** (D1, D2 and C1 are the
  steps that build six of the seven), and **three of the five sections are not steps at all** —
  employment history is the *content* of `application_filled`, the employer inquiries are the
  §391.23 investigation *of* that content, and a disposition is how the whole process EXITS. Both
  literal readings were refused: inventing a step per homeless section would put rows on a federal
  checklist D-HM9 never ruled, and seven rows opening onto nothing is worse than no drawer.

  | | |
  |---|---|
  | The switch | `hiringStepDrawers.ts`, a `Record<HiringStepKey, HiringDrawerBody>` over the closed union — a new step is a **typecheck failure** there until somebody says what its drawer holds. Same fuse as B5's artifact map; proved by deleting `road_test` (`error TS2741`) |
  | The seven | `recorded_act` and `packet` bodies: the state, the artifact **named**, and a link to the driver's §391.51 file where the act is performed today. A signpost that says it is one, not a workbench that is not |
  | Title and subtitle | the step's `label` and `action` from the catalogue. **No third string per step** — B4 and B5 each paid for one copy-with-a-delay-fuse already |
  | `DispositionSection` | **stays a section, deliberately.** Ending an application is not one of D-HM9's fourteen steps and must not become one; putting it behind a row would have meant inventing a fifteenth |
  | No nested drawer | `ApplicationReviewDrawer` is itself a `SlideOver` **and** lives in `features/apply`, which `features/recruitment` may not import. Both facts point one way: the step drawer emits `review` and the page swaps one for the other |

  ✅ **Q-HUI6 is CLOSED** (B5 raised it), with its own recommendation (a). `AuthorizationsPanel` is
  the Permissions row's drawer: the four releases from `APPLICATION_RELEASE_ORDER`, each folded with
  `liveAuthorization` so a revoked grant reads as outstanding (D-REC3), each leading with the
  **wording version** — the field an FCRA §604(b)(2) dispute turns on, and the reason a tick and a
  date would have looked complete and been useless. ⚠ `hiringArtifacts.ts`'s entry was corrected in
  the same PR rather than left describing a gap that had been filled; a stale comment about a gap is
  worse than none, because the next reader believes it.

  ⚠ **Q-HM9 RAISED, and not taken here.** Giving `EmployerInquirySection` a home turned up that the
  **§391.23(a)(2) previous-employer investigation is not one of D-HM9's fourteen steps** —
  `grep -c inquir hiringSteps.ts` is **0** — although it is a federal §391.51 requirement and this
  product already builds the whole of it. So a recruiter working from the checklist alone can reach
  "Hired" with the investigation undone. Recommendation (a): add it as a step with evidence
  `employer_inquiries`, blocking `hired`. ⚠ That is a catalogue ruling and changes the fold, the
  board and every count; the inquiries sit in the application drawer meanwhile, labelled as being
  there because the step does not exist.

  **Two more rules that came out of building it.** `liveApplicationInvitation` in
  `useApplicationInvites.ts` — the newest unrevoked — because the review drawer needs an invitation
  id and a `.find()` in a `.vue` file is how the server and the page came to describe two different
  applications for one driver before B4. It is a NAMED pair with the server's PostgREST filter, not
  a shared function: a fold cannot be handed to PostgREST. And the checklist row is a
  `BaseButton size="row"` with the artifact link kept OUTSIDE it — `lint:ui-adoption` fails on any
  raw `<button>` in a page or feature, and a link nested inside a button is invalid markup and a
  target a keyboard cannot reach separately.

  **Verified:** eleven mutations, eleven red, plus the typecheck fuse. ⚠ **One of them came back
  GREEN first time and the test was the thing at fault**, which is the result worth keeping: a test
  that opened two drawers in one `it` was reading the FIRST panel for both assertions, because
  `SlideOver` teleports and `afterEach` does not run between assertions. It passed whatever the map
  said. That is B5's handoff trap — *teleported panels outlive the test* — met from the other side,
  and the fix is in `openOn`, with the reason.

  **And two defects every test was green for, both found by opening the drawer at 1440:** the
  subtitle showed the step's imperative under a step already finished (*"Permissions signed / Sign
  the permissions / Done"* — an order to redo it), and `hiringArtifacts.ts` still told the next
  reader that Q-HUI6 was open after B6 had closed it. Fifth consecutive step where rendering found
  something the suite could not. **Render the page.**

  `pnpm lint`, `typecheck`, `test` (1,976 web + the rest), `lint:boundaries`, `lint:filesize`,
  `lint:funcsize`, `lint:comment-claims`, `lint:ui-adoption`, `lint:surfaces` and
  `--filter web lint:tokens` green. No migration; no schema change.
---

- **2026-09-18, evening — handoff written, and one queue problem named.**
  `HANDOFF-2026-09-18-RECORD.md`. ⚠ **Wave A's `∥` steps have drifted for four sessions**, and the
  reason is structural rather than anybody's oversight: `∥` means *open a second chat now*, nobody
  did, and a parallel step has no moment at which it announces itself as late — unlike a blocked one,
  which announces itself when its blocker lands. **If a `∥` step is not going to get its own chat it
  needs a place in the sequential order instead**, or the queue silently becomes "everything that was
  ever blocked, in order".

  ⚠ **And A0b changed the priority of A3 without anybody noticing.** Verified 2026-09-18 at the call
  sites: `file.ts` → `renderPacketDocument()` → `renderPacketOverlay()`, so **A3's fix is on the
  FILING path**, and §0's freeze means a filed packet is frozen for ever. Until A0b shipped, the rate
  limiter refused the 21st of 22 marks so **nobody could complete a ceremony at all** — the freeze was
  being held off by a bug. A0b removed it. So the next applicant who finishes freezes a document in
  which a drawn signature is stamped on the three initials lines. **A3, then A4, are recommended
  ahead of B7/B8**, which have no deadline. ⚠ A2 does NOT share this property — it fixes the
  PREVIEW, and its own row says `render.ts` stays untouched.

- **2026-09-18, after the handoff — A3 BUILT. The drawn mark's four defects, three fixed and a
  fourth found by rendering the screen.** PR #877, branch `claude/hiring-a3`. No migration; no schema change.

  **Why this went ahead of B7/B8:** the freeze. Verified again at the call sites —
  `file.ts`'s `renderFiledDocument` → `renderPacketDocument` → `renderPacketOverlay` — so A3's fix is
  on the FILING path, and `ensureApplicationPdf` renders once and returns stored bytes for ever.
  **Production re-measured 2026-09-18 before starting: 20 marks, one walk, 2026-09-17 22:20–22:21,
  three of them `initials`; no filed PACKET.** ⚠ There IS one filed `employment_application`
  document (hashed, 2026-09-14) — it pre-dates every mark, so it is `render.ts`'s §391.21 summary,
  which is what `renderFiledDocument`'s marks-based switch is supposed to produce. The window was
  open and is now used.

  **(c) — the drawn signature on the initials lines. The one that would have frozen.**
  `renderPacketOverlay`'s mark loop ran `if (drawn) { …; continue; }` before reading the placement,
  so a driver who drew got their full autograph stamped on `p05`, `p06` and `p09` — the three boxes
  the carrier captioned `Initials`. The kind now comes from `packetPlacementById()`, i.e. from
  `PACKET_PLACEMENTS`, the same table the ceremony reads: the paper, the screen and the print agree
  by construction rather than by three people remembering the same three page numbers. ⚠ An id the
  inventory does not carry falls back to the TYPED name, which is the safe direction (a typed
  signature is still the signature of record, D-APP8); the branch is unreachable today and the test
  file says so rather than faking a way in, because "carries exactly the driver's twenty-two places,
  and nothing else" keeps the two tables equal.

  ⚠ **Q-PKT8 closed half of this in 2026-09-14 and the file said so in one sentence covering both
  paths.** *"Nothing here changed: it draws `signed_name`"* was true of the TYPED path and false of
  the drawn branch three lines below it. The header now separates them.

  **(a) — the ceremony previewed the typed name in drawn mode.** The caption read `style` and the
  preview read `markFor()`, so the screen said *"We will put your signature on the page"* over the
  typed name, at every one of the twenty-two stops. Both now read ONE boolean,
  `currentShowsDrawing` — the client half of a NAMED PAIR with the renderer's mark loop, not a
  shared function, because the renderer looks at a PNG it was handed and this looks at a Blob that
  has not been filed. What they share is the RULE, and both derive the kind from
  `PacketPlacement.mark`.

  **(b) — the failed upload was swallowed in silence.** The swallow stays (A8b: a PNG that will not
  upload must not stand between a driver and twenty-two signatures) and is now recorded in
  `drawnMarkFailed`, which withdraws the promise as well as raising the notice — a stop whose
  drawing did not stage previews the typed name, because that is what will land. New copy
  `drawFailed` in the catalogue. ⚠ It offers no retry on purpose: changing a mark once adopted is
  C2, and a button that does not exist is worse than the sentence.

  **(d) is NOT in this PR and should not be.** *"No upload option, no style choice, no way to change
  a mark once adopted"* is C2's adoption dialog. A3's done-when does not include it.

  ⚠⚠ **THE FOURTH DEFECT, and it is the owner's actual complaint.** Found by driving `/apply/:token`
  in a browser — every test in the suite was green for it, and always would have been.
  `alreadyAdopted` was computed from `adoptedName`/`adoptedInitials`, **which are the refs the input
  boxes are bound to**. So for a FIRST-TIME applicant (`packetAdopted: null`) the question *"has this
  link already adopted a mark?"* answered YES the moment they finished typing their initials, and the
  component swapped itself for the RESUMED panel mid-form: the Type/Draw control disappeared, the
  signature pad was unmounted, **the drawing in it was destroyed**, `Use this and start` became
  `Carry on signing`, and they were told *"You adopted this when you started"* about a mark they were
  making right then. Measured, in that order: on arrival 1 style control / 0 canvases; after choosing
  Draw, 1 canvas; after the name, 1 canvas; **after the initials, 0 canvases and the resumed panel.**

  ⚠ For a driver who chose to DRAW this was fatal rather than cosmetic, and it is why it belongs to
  A3: the name field sits ABOVE the pad, so the natural order is type, type, draw — and the pad was
  gone before they reached it, with no error and nothing to press. The mark silently became the typed
  one. **That is *"custom signature cannot be applied"* from the driver's end.** The two facts were
  never the same thing: what the server pinned is a fact about the LINK, what is in the boxes is a
  fact about this minute's keystrokes, and `adoptedName` being SEEDED from the pin is where the
  relationship ends. `alreadyAdopted` now reads `options.adopted`.

  **Verified by looking, which is the only verification that counts here — sixth consecutive step.**
  Rasterised a packet signed by drawing, before and after, `pdftoppm -r 110 -png`: pages 5, 6 and 9
  carried a blue squiggle across the `Initials` rule and now carry `MV`; page 20's signature line
  still carries the drawing. Then the real `/apply/:token` at 420px against `preview:local`: stop 1
  (`p03`, signature) shows the drawing under *"We will put your signature on the page"*, stop 3
  (`p05`, initials) shows `MV` under *"We will put your initials on the page"*, and with the staging
  call refused the stop shows the typed name plus the `drawFailed` sentence.

  ⚠ **How to rebuild that browser harness in ten minutes** — it is worth it for A4 and C2, and the
  fixture is the expensive part. `preview:local` (it takes whatever port is free; three other
  sessions were holding 4173–4176), then Playwright with `route.fulfill` of RAW bodies — `publicFetch`
  returns the parsed body itself, so `{ok,data}` makes every field undefined one level down. To reach
  `SignOffScreen`, the bundle needs `phases.approvedAt` set and `submittedAt` null, plus
  `consentedAt` and `releasesCompletedAt` set, `releases: []` and `draft.locked: false` — otherwise
  `ApplyPage` stops at the consent gate, the release ceremony or the date-of-birth gate, in that
  order. `packet` is the 22 driver placements with `signedAt: null`, `packetAdopted: null`. Intercept
  `POST /:token/capture`, the signed `uploadUrl`, `PUT /:token/capture/:id` and `POST /:token/mark`.
  ⚠ `pnpm --filter @silvicom/web build` will NOT work for this — it needs the two `VITE_` vars as real
  env vars, not the `.env` file; `preview:local` handles it.

  **Mutations: six run, six red.** Renderer — `drawn && takesDrawing` → `drawn` reddened the initials
  test with the defect itself in the message (*page 5 … expected 'In compliance with Federal…' to
  contain 'QX'*); `=== "signature"` → a kind that never matches reddened the signature half, which is
  what stops the first test passing on a renderer that ignores the drawing entirely. Composable —
  dropping the kind check, forcing `drawnMarkFailed` false, inverting the style check, and restoring
  the old `alreadyAdopted` each reddened their own tests. ⚠ The reverts write the original BYTES back;
  `git checkout --` is refused in a worktree-isolated session and does nothing, silently.

  `pnpm lint`, `typecheck`, `test` (all suites + every matrix), `lint:boundaries`, `lint:filesize`,
  `lint:funcsize`, `lint:comment-claims`, `lint:ui-adoption` and `--filter web lint:tokens` green.

  **Next is A4** (initials stop pinning on one keystroke) — same files, same freeze exposure.

---

- **2026-09-18, evening — A4 BUILT, plus the stranding defect A0 recorded and nobody fixed.**
  PR #878, branch `claude/hiring-a4`. No migration; no schema change.

  **A4: the initials no longer pin on one keystroke.** A `confirming` state now sits between the last
  keystroke and the first mark, showing both marks in the face they will be printed in — the drawing
  itself when there is one — plus *"These go on pages 5, 6 and 9"*, derived from the stops rather than
  from the number three (the packet has gained a placement mid-array before, p17/D-PKT12). `Change`
  returns to the adoption form. ⚠ The contract's `min(1)` is untouched, per the row: the defect was
  the pin, not the minimum.

  ⚠ **§1.4 understates the opportunity, and reading 0340 is what showed it.** The pin is per
  `(invitation_id, mark)` — the first row OF A KIND fixes `signed_name` for that kind — so the two
  marks are fixed at two different moments: the signature at place 1 (`p03`), **the initials not
  until place 3 (`p05`)**. And place 3 is precisely where a driver is most likely to notice a
  mistyped initial, because it is the first time they see it in position, immediately above the
  button. So `pinnedKinds` derives from filed rows (served pin + served `signedAt` + this session's
  `filedHere`) and `canChange(kind)` offers a correction exactly when `record_packet_mark` would
  accept one, never when it would answer `DR035`. A resumed link skips the confirm screen entirely:
  both marks are already pinned, and asking somebody to approve a settled decision is consent theatre.

  ⚠⚠ **AND THE STRANDING DEFECT, which was recorded by A0 and left unfixed.** `current` was
  `outstanding[index]` with `index` a counter, under a comment claiming the list was *"computed once
  per load"* — it is a `computed`, so it was not, and `useApplyInvitationQuery` runs under
  `VueQueryPlugin` with **no `defaultOptions`**, so TanStack's `refetchOnWindowFocus: true` is live.
  A driver five marks in who switches apps to read a text comes back to a refetch: `outstanding`
  drops 22 → 17, `index` is still 5, and `current` becomes the ELEVENTH place. Five places are
  stepped over in silence, and at the end `current` goes null with stops unsigned while the template
  falls through to *"That is every place signed"*. **Measured by mutation: `expected 'p17' to be
  'p10'`, then `ran out of stops after 11` — which is the "strands any walk past the 11th mark" the
  A0 session wrote down.** A phone is where this walk happens; backgrounding the page is not an edge
  case. There is no cursor now: the current stop is the first nobody has filed, asked fresh, so a
  refetch is self-healing rather than survivable. ⚠ It shipped here rather than separately because
  A4's confirm step rewires the same state machine — fixing it apart would mean editing it twice.

  **Two defects found by RENDERING, the seventh and eighth consecutive step.**
  - ⚠ **The stop's `Change` button was gated on the CURRENT STOP's kind**, which looked right and was
    wrong: after place 1 the signature is pinned, so standing on place 2 (another signature) the
    button vanished — while the driver's initials were changeable for another place. Somebody who
    remembered their typo at place 2 had no way back until place 3, for no visible reason. It now
    matches `reopen()`'s own guard (either kind), and the form disables each pinned field with its
    reason, so the screen never hides a possible correction nor offers an impossible one.
  - ⚠ **"Your signature is already on 0 places of the form, so it cannot be changed now."** Measured
    on screen at place 2. The component counted `stops.filter(s => s.mark === kind && s.signedAt)` —
    its own second computation of a fact the composable owned — and a mark filed in THIS session has
    no `signedAt` until the next refetch. A sentence that refuses and disproves itself in one breath.
    `placesWithMark` now reads the same two sources `pinnedKinds` does. Same shape as every
    second-source-of-truth defect in this programme.
  - ⚠ And the reopened adoption form still said *"Give your signature once below"* while pointing at
    the disabled field. `changeIntro` is the reopened wording; B5 shipped the same class one field
    over.

  **The copy gate had a blind spot and now says so.** `strings.test.ts` guessed each copy function's
  arguments from its ARITY, and `confirmInitialsWhere(pages: number[])` has arity 1 exactly like
  `adoptIntro(carrier)` — so it threw `pages.slice(...).join is not a function`. The loud failure was
  the good case; the bad one is a shape that happens not to throw and returns something unlike the
  real sentence. It now TRIES candidate shapes and **throws by name** on a function it cannot call,
  rather than returning `[]` and walking past its own blind spot.

  **Mutations: twelve run, twelve red.** Restoring the cursor reddened both refetch tests with the
  defect in the message; `confirmed = true` killed the confirm step; pinning both kinds on any filed
  mark reddened all five per-kind tests; dropping `reopen()`'s guard reddened its refusal; and
  reverting the count to the component's version produced `expected 0 to be greater than 0` — the
  screen's own sentence.

  **Walked in a browser at 420px**: mistyped `QQ`, saw the confirm screen, pressed Change, corrected
  to `MV`, started signing, signed place 1, pressed Change at place 2 and measured
  `name disabled: true | initials disabled: false` with *"already on 1 place"*.

  `pnpm lint`, `typecheck`, `test` (all suites + every matrix, web 2,000), `lint:boundaries`,
  `lint:filesize`, `lint:funcsize`, `lint:comment-claims`, `lint:ui-adoption` and
  `--filter web lint:tokens` green.

  ⚠ **Raised, not absorbed: `usePacketCeremony.ts` is at 481 of 500 lines** (was 248 before A3). It
  passes `lint:filesize` and it is over the 450 warning. **Recorded as Q-PKT11 in §8** rather than
  fixed by trimming comments, which Q-HM8 named as the wrong repair that only works once.

---

- **2026-09-18, end of day — Wave A's deadline discharged; handoff written.**
  `HANDOFF-2026-09-18-WAVE-A.md`. A3 (#877) and A4 (#878) are both on the FILING path and both are
  merged, so **the freeze no longer sets the order** — it has stopped, not disappeared, and anything
  else that changes how the packet PRINTS still lands before the first filed packet. ⚠ A2 does not
  share the property: it fixes the PREVIEW and its row says `render.ts` stays untouched.

  ⚠ **Recommended next: Q-HM9, and the argument is that it is the only open item that can make the
  product report something FALSE about a federal obligation.** `grep -c inquir hiringSteps.ts` is 0,
  so a recruiter working from the checklist alone reaches "Hired" with the §391.23(a)(2) investigation
  undone — which is the thing the checklist exists to prevent. Then A2, then B7/B8.
  ⚠ **Q-PKT11 goes before C2 and not earlier**, because C2 lands in the half of
  `usePacketCeremony.ts` that is already full.

  ⚠ **Two process traps learned today and written into the handoff §4.** A PR with a merge conflict
  gets **no CI at all** — GitHub cannot build a merge ref, so `gh pr checks` reports *"no checks
  reported"* rather than a failure, and #877 looked stuck for twenty minutes while it was merely
  conflicted; check `mergeStateStatus` first. And a §10 conflict between two sessions is NORMAL: both
  append dated entries at the `## 11. Sources` boundary, and **the resolution is to keep BOTH**, never
  to take one side.

  ⚠ **Eight consecutive steps have now shipped a defect every test was green for** — B4 three, B5 one,
  B6 two, A3 one, A4 three. The browser recipe that finds them is in the A3 entry above. Budget for it.

- **2026-09-18, Q-HM9 — RULED AND BUILT. The §391.23(a)(2) previous-employer investigation is a step.**
  `employment_investigation`, ordinal **13b**, evidence `employer_inquiries`, blocking `hired`.
  Recommendation (a) taken as §8 and the Wave A handoff §3 both proposed. Before this, `grep -c inquir
  hiringSteps.ts` was **0**: the product built the whole investigation — 0223's §391.23(c)(2) written
  record, `inquiryQueue.ts`, the 30-day clock, a fleet queue page — and none of it was connected to
  the checklist a recruiter works from, so "Hired" was reachable with a §391.51(b)(3) requirement
  untouched. No migration; no schema change. The evidence table has existed since 0223.

  **Two rulings the one-line recommendation did not settle, taken here with reasons, because both
  change what the product asserts:**
  - ⚠ **`federalGate: false`, and the pinned six stay six.** `federalGate` does not mean "required by
    law" — it means one of §5's six things a carrier must hold BEFORE THE DRIVER FIRST DRIVES, which
    is why they are not reorderable. §391.23(c)(1) gives the carrier **30 days from the date
    employment begins** to hold either the replies or documented good-faith efforts, so this is
    lawfully still open on the driver's first day. A seventh gate would have shortened the law in the
    product's favour.
  - ⚠ **`beforeTravel: false`, which is why it is at 13b and not beside the MVR at 5.** §391.23(a)(1)
    and (a)(2) are the same regulation's two halves and 5b is where this first went. It was moved:
    a step inside 1–9 gates `readyToTravel`, the answer the owner leads with, and previous employers
    routinely take weeks on a clock that is **theirs**. Gating the plane ticket on it would either
    stall every hire for a third party's silence or push an office to document a non-response early
    to clear the row — which produces a **weaker** file than waiting. So it is positioned by its
    DEADLINE (complete before the hire) while `requires: ["application_filled"]` says the work starts
    as soon as a history is declared. ⚠ If the owner wants travel gated on it, that is a one-field
    change and a test.

  **The trap, and it is the one this step was most likely to ship.** `driverInquiryQueue.complete` is
  `outstanding.length === 0`, which is **vacuously true for a driver whose employment history nobody
  has typed yet** — no employers owed, nothing outstanding, "complete". A step reading that number
  alone goes green on the day the invitation is sent. That is D-HM9's own medical-certificate mistake
  in a third costume (capture read as verification), so `evidenceFor` requires the application to be
  FILED before zero is allowed to mean zero — and once it is filed, zero does mean zero, because a
  first-time driver with no DOT-regulated employer in the window genuinely has nobody to write to.
  Absent input is NOT done, fail-closed.

  **Mutations: eleven run, eleven red** — dropping the `historyDeclared` guard · removing fail-closed
  on absent input · `inFlight` forced false · removing `employment_investigation` from `hired.requires`
  · `beforeTravel: true` (reddened the travel-seam test too) · dropping the `application_filled`
  prerequisite · four org/driver-scope filters on the two new reads · pointing the drawer at the
  application body. ⚠ **One came back GREEN and the TEST was at fault**: deleting the
  `kind = 'safety_performance'` filter reddened nothing, because both fixtures held only
  safety-performance rows. A `drug_alcohol` row against the un-written-to employer now makes them
  discriminate — §40.25 applies to non-FMCSA DOT employment and §391.23(e) routes FMCSA carriers to
  the Clearinghouse, so counting it would close a step nobody has worked.

  ⚠ **And the defect every test was green for, found by rendering at 1440 — the NINTH consecutive
  step.** With two employers outstanding and one letter sent, the row read ***"Waiting on them"***
  while the office had not written to one of them at all: `inFlight` was `attempts > 0`, a count
  where a state was needed. `inquiryQueue.ts` has four open states and only **`awaiting`** is the
  employer's move — `not_sent` is a letter we owe, `overdue` is a chase or a documented non-response,
  `undeliverable` needs a different address. The input now carries `awaiting` rather than `attempts`,
  and the row is theirs only when every outstanding employer is `awaiting`. ⚠ No test could have seen
  it: every fixture was all-or-nothing, which is this repo's named *fixture too uniform to
  discriminate* failure, and the partial state is now pinned.

  **Walked in a browser** at 1440 and 390 (`preview:local` on :4178, Playwright, RAW `route.fulfill`
  bodies): the record page reads *"Hiring · 11 of 13 done · Next: Contact the previous employers"*,
  the row reads **Waiting on you** with no artifact, **Hired** reads **Blocked — Needs: Previous
  employers checked**, and the travel sentence still names only the orientation videos. The row opens
  `EmployerInquirySection`, which **moved out of the application drawer** — B6 had parked it there
  with a comment saying the step did not exist, and that label came out with this change. The board
  shows *"Contact the previous employers"* under Next action, Stage **Screening**, counted into
  *Waiting on you*. ⚠ `bodyOf` in `HiringStepDrawer.test.ts` read only the FIRST `[data-body]`, which
  is why the inquiry section sat in the application body unasserted for a whole step; a `bodies`
  helper that enumerates now pins that it is no longer there.

  ⚠ **`applicantChecklist` now takes `today`** and `boardChecklists` derives one date for the whole
  pass — the §391.23(a)(2) window is measured from the hire date or, for an applicant, from today,
  and two clock reads in one board would measure adjacent rows against different days. The board is
  still set-based: **five `.in()` queries whether it holds two applicants or two thousand**, and its
  test now says that the number must not move with the count rather than that the number is three.

  `pnpm lint`, `typecheck`, `test` (9,570 unit across every package + 71 matrices), `lint:boundaries`,
  `lint:filesize`, `lint:funcsize`, `lint:comment-claims`, `lint:table-writers`, `lint:table-access`,
  `lint:surfaces`, `lint:ui-adoption`, `lint:migrations`, `lint:migration-ordering`, `lint:upserts`
  and `--filter web lint:tokens` all green. ⚠ One `pnpm test` run showed `RecruitmentPage.test.ts`
  timing out at 5,036 ms under the full parallel load; it passed on the two full runs and three web
  runs either side, and the test touches nothing in this change. Recorded rather than dismissed — it
  is the same shape as the open api flake in `HANDOFF-2026-09-08`.


- **2026-09-18, A2 — DONE. The office previews the document the driver signs.**
  `applicationPreviewPdf` renders `renderPacketDocument` with **`marks: []`**, banded DRAFT, over
  `application_drafts.payload`. `render.ts` is untouched and stays for already-filed records, exactly
  as §1a C4 requires — **and C4 was right that this would have been built wrong**: the marks-based
  switch `file.ts` uses is correct for a FILED document and would have rendered the §391.21 summary
  for ever here, because a preview always has zero marks.

  **The defect was four days old and no gate could see it.** `preview.ts`'s own header argued at
  length that it was deliberately the same renderer as the filing — true on 2026-09-13 when F6
  shipped, false on 2026-09-14 when the packet renderer landed and changed what the filing renders.
  Both files typechecked, both were tested, and **each test asserted its own renderer**. The
  assertion that did not exist is the one that now does: one payload, both paths, page counts equal.

  ⚠ **The band is NEW MACHINERY on the filing path's renderer, and that needed pinning rather than
  arguing.** `renderPacketOverlay` is pdf-lib and `stamp.ts` is pdfkit — opposite y axes, and pdf-lib
  rotates each run about its own origin — so the band is a second implementation of one idea, which
  this repo normally refuses. What is shared is the WORDS and the opacity; what is not is the
  geometry. It is an OPTIONAL parameter the filing path never passes, and *"optional, so it cannot
  reach a filed packet"* is a claim about today's diff. **Two tests measure it instead**: *"draws no
  band when the filing path does not ask for one"* (the renderer obeys an absent band) and *"files a
  document with no draft band on it, ever"* (the caller does not supply one). A filed §391.51(b)(1)
  record saying DRAFT across every page would be permanent — evidence tables are append-only.

  ⚠ **Eight mutations run, eight red — but only after THREE came back green and three tests were at
  fault.** The green ones: the preview could have dated page 1 with a certification nobody made; it
  could have printed the applicant's own name on page 22's `Driver name Print`; and the filing path
  could have started banding its documents. Each now has a test that renders the same payload the
  OTHER way and compares — a date that appears when given, a name count that goes up by exactly one,
  a band the filing never carries.

  ⚠ **And one existing test had gone VACUOUS and still passed.** *"signs nothing: the certification
  block carries no name"* sliced the §391.21(b)(12) block out of the summary; the packet has no such
  block, so both `indexOf` calls returned -1, the slice returned `""`, and `""` contains nothing. It
  proved the absence of a string in an empty string. **A test that keeps passing while the document
  under it is replaced was never testing the document** — the same lesson as Q-HM9's uniform fixture,
  one day apart.

  ⚠ **What the preview STOPPED showing, recorded rather than dropped quietly:** the four releases,
  the e-sign consent, and the §391.21(b)(12) certification block with its progress line. The
  carrier's packet has no page for any of them. They are not lost facts, they are facts on the wrong
  document — **B2 is their home** (the four authorizations + the §7001(c) consent + the certificate
  of completion as one banded interim PDF), and until B2 the releases are on the applicant's record
  behind the Permissions row. The deleted test *"says where it has got to, and moves when the driver
  hands it over"* is named in `preview.test.ts` with that reasoning, so nobody re-adds the line to
  the wrong document.

  **Rendered both and looked at them** (`pdftoppm -r 100 -png`, pages 1 and 20). Page 1: the same
  carrier letterhead, the same `reisdency` typo, the same answers — the preview's `Date:` blank and
  banded, the filing's reading `2026-09-12` and unbanded. Page 20 (FCRA disclosure): `Driver
  signature:` blank on the preview, `Susan Godfrey` on the filing. Same paper, and the band is
  legible without obscuring the field labels underneath it.

  `pnpm lint`, `typecheck`, `test` (9,576 unit + 71 matrices), `lint:boundaries`, `lint:filesize`,
  `lint:funcsize`, `lint:comment-claims`, `lint:table-writers`, `lint:table-access`, `lint:surfaces`,
  `lint:ui-adoption` and `--filter web lint:tokens` green. No migration; no schema change.


- **2026-09-18, end of day — Q-HM9 and A2 merged; handoff written; next is B7.**
  `HANDOFF-2026-09-18-B7.md`. Two steps landed today after Wave A's freeze was discharged, and
  **neither needed a migration** — 0344 is still the head, so the next one is still 0345.

  ⚠ **Recommended next: B7, and the argument is that it is `∥` and half a day.** Wave A's recorded
  failure was that `∥` steps drifted for four sessions because *"a parallel step has no moment at
  which it announces itself as late"* — a blocked step announces itself when its blocker lands. B7
  wants its own chat now rather than a place in a queue. Then B8. ⚠ **Q-PKT11 still goes before C2**
  and not earlier.

  ⚠ **B2 stopped being optional polish.** A2 moved the preview onto the carrier's packet, which has
  no page for the four releases, the e-sign consent or the §391.21(b)(12) block — so those three
  facts now have no printable home until B2 builds one. They are not lost (the releases are behind
  B6's Permissions row) and they are not on the wrong document any more, which was the defect. The
  deleted progress-line test is named in `preview.test.ts` so nobody re-adds it to the packet.

  ⚠ **The lesson both steps share, and it is a new one: a mutation coming back GREEN usually means
  the TEST is at fault, not the code.** Four times this week — Q-HM9's `kind` filter, and A2's page-1
  date, printed name and filing-path band. Every time the cause was the same: a fixture too uniform
  to discriminate, with no partial state, one row kind, or an all-or-nothing input. **Write the
  partial case.** And A2 found the sharper version of it — *"signs nothing"* had gone VACUOUS and
  still passed, slicing a block out of a document that no longer had one, so it asserted the absence
  of a string in an empty string. **A test that keeps passing while the document under it is replaced
  was never testing the document.**

  ⚠ **Ten consecutive steps have now shipped a defect every test was green for** — B4 three, B5 one,
  B6 two, A3 one, A4 three, Q-HM9 one. Q-HM9's was found at 1440 in a browser; A2's would have been
  found by `pdftoppm` and was instead caught by a mutation, which is the cheaper end of the same
  discipline. **Open the page, or rasterise the document.**

- **2026-09-18, evening — B7 BUILT (#884), behind a split of `ApplyPage.vue` (#883).** The wizard's
  two additions: an expectations screen on an untouched link, and each screen's estimate on
  `ApplyProgress`'s list. No migration — 0344 is still the head and 0345 is still next.

  **The minutes are a property of the section**, `APPLICATION_SECTION_MINUTES` in
  `applicationSections.ts`, keyed by the union beside the labels and the citations. A screen cannot
  exist without an estimate, and `APPLICATION_FILLING_MINUTES` is their sum rather than a number
  anybody types. ⚠ They are judgements from the shape of each screen, not measurements — nothing
  times a driver today. `application_drafts.furthest_section` plus its timestamps is a measurement of
  exactly this, per screen, and A10's sweep is where these constants should eventually be checked
  against reality rather than defended.

  **The expectations screen sits AHEAD of the 7001(c) consent, and that does not disturb D-APP5.**
  A4's ruling is that nothing is ASKED and nothing is WRITTEN before the consent; this screen has no
  field on it and writes nothing, so the consent is still the first thing the driver DOES. Behind the
  consent and the four signatures it would have set expectations for the form only — and the
  permissions coming first is the part nobody expects. Nothing about having seen it is remembered:
  `linkHasBeenUsed` (in `useApplication.ts`, beside the payload it reads) derives it from a consent, a
  signed permission or a saved draft, so somebody who opens the link twice having done nothing is told
  the same thing twice, which is the right answer to having done nothing.

  ⚠ **Q-AX1's three rulings were left exactly as they were** — the bar still only INDICATES, the fence
  is still the high-water mark, and everything navigable is still a real button. The estimates hang
  off the list, and a test pins that the bar renders no text at all.

  ⚠ **`lint:filesize` is what made this two PRs.** `ApplyPage.vue` was at **496 of 500** — two lines
  under the ambush `check-file-size.mjs`'s own header describes — and B7's wiring does not fit in two
  lines however tersely it is written. #883 lifted the sending half into
  `features/apply/useApplicationSending.ts` first, as its own behaviour-preserving PR (same 2,001 web
  tests before and after), taking the page to 427; B7 then took it to 456. That is Q-PKT11's pattern
  applied without being asked: **a refactor's whole value is a diff that says nothing changed**, and
  bundled into a feature step nobody could have seen which lines were which. A waiver was the other
  option and is how gates die.

  **Verified by looking, at 390px and 1440px**, with the invitation `route.fulfill`ed: the expectations
  screen (~1,360px tall on a phone, the length sentence above the fold), the step list with its
  estimate column, and the walk through Start into the form. Eight mutations were run and all eight
  failed the right way — including two that only compile because the anchor was written to compile,
  since a mutation that merely breaks the build proves nothing about the assertion.

  ⚠ **Twelve of `ApplyPage.test.ts`'s tests failed on the first run, and nine of them were right to.**
  Their fixtures describe a link nobody has touched, which is now exactly the case that opens on the
  expectations screen. Three genuinely untouched ones press Start through a helper that ASSERTS the
  button is there; the rest passed again once `linkHasBeenUsed` read `draft.payload` — a draft with
  something typed into it is a driver who has started, whatever `updatedAt` says in a fixture.

- **2026-09-18, evening — handoff for the rest of Wave B.** `HANDOFF-2026-09-18-B2-B8.md`. **B2 and
  B8 are the last two steps of Wave B and both are `∥`** — two chats, not a queue; B8 first if only
  one gets run, because C1 is gated on it. Neither should need a migration; 0345 is still next.

  ⚠ **A measurement that changes B8's size, taken before the step starts:
  `apps/web/src/components/DocumentPreview.vue` is already the repo's sanctioned document viewer** —
  `BaseModal size="xl"`, `<iframe>` for PDFs, `<img>` for scans, print and download, already promoted
  out of `features/` for the `lint:boundaries` reason. What it cannot do is the actual gap: it takes a
  `DocumentRow` with URLs, and a document this API RENDERS ON DEMAND (`preview.pdf`, and B2's) has no
  row and no URL — those go through `documentDownload.ts`'s `openPdf`, which opens a NEW TAB, which is
  the thing B8's row exists to stop. So B8 is most likely *teach the sanctioned viewer to take a blob*,
  not *build a viewer*. ⚠ And **"shared with C1" is a claim to test, not to inherit**: an iframe cannot
  address a page or draw over it, so C1's rail needs canvas — `pdfjs-dist` is already a dependency and
  `lib/pdfWords.ts` already solves the worker URL.

  ⚠ **B2's ingredients are all in place and one of them is misremembered in conversation: the 7001(c)
  consent is `esign_consents` (0227), its own table with the six clauses and the version** —
  `driver_authorizations.esign_consent_at` is a timestamp on each row, not the instrument.
  `certificate.ts` is already a reusable function with a `preview` branch, and `stamp.ts` already
  bands a pdfkit document. **Open question recorded rather than assumed: driver-keyed or
  invitation-keyed?** Recommendation is invitation-keyed, beside `preview.pdf`, because B3 already
  ruled that marks key on the live invitation and a document spanning two invitations cannot be dated.

- **2026-09-18, night — B8 BUILT. The office reads a rendered PDF beside the record it belongs to.**
  No migration: 0344 is still the head and 0345 is still next. **B2 is now the last of Wave B.**

  **The handoff's measurement held, and the step was the small one it predicted.**
  `DocumentPreview.vue` was already the sanctioned viewer and no second one was built. The gap was
  exactly as written: it takes a `DocumentRow` with URLs, so `preview.pdf` — which the API composes
  on every request and never stores — could only reach a reviewer through `documentDownload.ts`'s
  `openPdf`, which opens a NEW TAB. `ApplicationReviewDrawer.vue:145` was the only caller in this
  programme's scope; the other three `openPdf` sites are maintenance's and were left alone.

  ⚠ **One fact the handoff did not carry, and it shaped the prop.** The viewer's footer prints
  `doc.kind`, `capturedAt`, `bytes` and `sha256.slice(0,12)` as §390.32(c) evidence — and a rendered
  document **has none of those**. So `rendered` is a second, deliberately asymmetric source: it
  claims no hash and says *"Rendered from the answers on file as they are now. It is not a stored
  copy, so it carries no file hash."* instead of printing a blank one. ⚠ The test that pins this
  asserts the hash **present** on the filed branch as well, because "shows no hash" passes just as
  well against a viewer that shows nobody a hash ever — A2's vacuous-assertion lesson in its other
  form. The viewer also OWNS the object URL and revokes it **on close**, where `openPdf` has to
  guess with a 60-second timer because it hands the URL to a tab it cannot observe.

  ⚠⚠ **The defect rendering found, which no test in this repo could have.** The viewer was first
  placed as a SIBLING of `SlideOver` — deliberately, so the drawer stayed mounted underneath. It
  rendered perfectly and was still wrong: **HeadlessUI decides which dialog owns Escape from the DOM
  TREE, so two sibling dialogs are both "topmost", and one Escape press closed the viewer AND the
  drawer behind it** — throwing the reviewer out of the record, which is the one thing this step
  exists to prevent. `ApplicantRecordPage.vue`'s header had warned about exactly this class of
  hazard (*"a focus trap inside a focus trap"*) for the drawer-in-drawer case. The fix is to nest
  the viewer inside the drawer's body, where HeadlessUI registers it as the child; both still portal
  to the body, so nesting costs nothing in layout. ⚠ **This cannot be unit-pinned** — HeadlessUI's
  `Dialog` throws under this repo's jsdom and is stubbed in every test that touches it — so it is
  held by the comment above it and by measurement, and by nothing else. Anybody who moves that
  component out of the drawer body will reintroduce it silently.

  A second, smaller one from the same look: the new caption pushed the panel past `max-h-[90vh]` at
  1440×900 and hid itself behind the footer. The rendered branch's frame is now sized to what the
  panel actually leaves rather than to `h-[70vh]`.

  **Verified by looking, in real Chrome at 1440×900 and 390×844**, against a three-page banded PDF
  through the whole chain (checklist → step drawer → review drawer → viewer), with the checklist
  fixture computed from `hiringChecklist()` itself rather than hand-written. ⚠ **Headless Chromium
  renders an empty frame for `application/pdf`** and says nothing about it — the first screenshot
  showed a blank viewer that was entirely an artifact of the runner. Use `channel: "chrome"`.

  **Nine mutations, all red for the right reason** — each written to compile so only the assertion
  could catch it, and each leaving the rest of its suite green (M9 added an import and a call and
  produced exactly one failure out of seventeen).

  ⚠ **`readyToTravel` and C1's inheritance: answered, and the answer is no.** B8 ships an
  `<iframe>`. C1 needs a page rail, START/NEXT and tap targets over 22 named places, and an iframe
  cannot address a page, draw over one, or report which one is on screen. **C1 must build the canvas
  path** — `pdfjs-dist` is already a dependency and `lib/pdfWords.ts` already imports it dynamically
  AND solves the worker URL, which is the fiddly half. This is written into `DocumentPreview.vue`'s
  header so C1 does not open expecting to inherit a signing surface. And the 390px look is the first
  honest input to **Q-HUI2**: a whole page is legible on a phone only *as a whole page*, so a
  signing surface at that width will need per-field zoom — more evidence for canvas, not less.

  ⚠ **`pnpm test` failed once on the api suite and passed on re-run with the same tree** — the known
  undiagnosed flake (6 of 23 runs, 2026-09-08), not this change.

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
