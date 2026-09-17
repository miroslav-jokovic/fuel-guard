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

## 8. Open questions — each with candidates and a recommendation

Nothing in §6 or §9 assumes an answer here.

- **Q-HM1 · Where does the road test go?** (counsel) §5.1's contradiction. Candidates: (a) after the
  verified negative and the full query — strict, matches industry practice in §4.2; (b) road test on
  arrival, query and test after — matches FMCSA's own Clearinghouse FAQ but relies on the §382.301
  half being wrong. **Recommendation (a)** until counsel rules, on D-REC7's principle: it can only be
  stricter than necessary. ⚠ This also finally gives **Q-REC5** somewhere to be answered.
- **Q-HM2 · MVR vendor.** (owner) Nothing exists; Samba was deferred on cost 2026-08-26. Candidates:
  revive Samba, a different vendor, or D-HM6's recorded act with a manually uploaded MVR.
  **Recommendation: D-HM6 now, vendor later** — the recorded act is needed either way, and it unblocks
  the checklist immediately.
- **Q-HM3 · Is orientation training pre-hire or post-hire?** (owner + counsel) This is `Q-REC6`
  restated and now load-bearing, because §4's entire economic argument is that training happens before
  the driver travels. The sub-question is whether pre-hire training is compensable time the carrier
  must track. **Recommendation: build it assignable pre-hire, auto-assign nothing pre-hire** until
  answered — R7's existing fallback, unchanged.
- **Q-HM4 · The drug-and-alcohol programme.** (owner) `Q-REC2`: who is the C/TPA or consortium, the
  collection network, the MRO, and is there electronic ordering? **Recommendation:** recorded process
  with manual result entry; no vendor integration.
- **Q-HM5 · Does the checklist BLOCK or only WARN?** (owner) Candidates: (a) advisory — show the order,
  let the office act out of order and record it; (b) blocking — refuse to mark a driver hireable until
  the federal gates are green. **Recommendation (b) for the six federal gates only**, advisory for
  everything else. A product that lets you hire past §382.301 is a liability, and a product that
  blocks the equipment handover because a handbook page is unsigned is one nobody uses.
- **Q-HM6 · One link or several for the applicant?** (owner) Directly from §1.6. **Recommendation:**
  one link for visits 1–2, a **new link minted and emailed at approval** for visit 3, both hashes
  valid. This is what the owner described, and Q-AX4's objection dissolves once the old hash stays
  live.
- **Q-HM7 · What is an orientation day, actually?** (owner) `Q-REC1`. Nothing about sessions,
  capacity or what happens in the room can be designed without it. **No fallback — this one blocks
  its step.**
- **Q-HM8 · Video hosting.** `DRIVER-TRAINING-PLAN.md` D1 chose Supabase Storage behind a provider
  abstraction and flagged egress as the top cost risk at 200+ drivers. Re-measure before Phase 0;
  the org's Supabase plan and driver count have both moved since 2026-07-23.

---

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
| **A1** ∥ | **Stop the nudge rotating a link that is with the office** · half day | `applicationNudgeSweep.ts` `candidates()` — exclude `review_requested_at`/`approved_at`. ⚠ The rule belongs in `packages/shared/src/applicationNudge.ts`'s `planApplicationNudges`, beside `STALE_DRAFT_HOURS`, not in the query, so it is testable without a database. ⚠ **This is insurance, not a repair** (§1a C1): measured, it has never fired — and it becomes a certainty the moment more than a trickle of applicants sit with the office for two days | `pnpm --filter @silvicom/shared test`; mutate the new predicate and watch a test go red | **An applicant whose application has been with the office for a week still has a working link.** Pin it with a candidate whose `draft_updated_at` is 10 days old and `approved_at` set |
| **A2** ∥ | **One document, not two** · half day | `applicationPreviewPdf` renders `packetFieldFill` + `renderPacketOverlay` with **`marks: []`**, banded DRAFT. ⚠ **Do NOT reuse `renderFiledDocument`'s marks-based switch** (§1a C4): a preview happens before signing, so it always has zero marks, and a marks-based switch would render the summary for ever — the exact defect this step exists to fix. Blank signature lines on a draft-banded preview are correct. `render.ts` stays untouched, for already-filed records only | `pnpm --filter @silvicom/api test`; then render both and `pdftoppm -r 110 -png` — **look at them** | **The office's preview and the driver's filing are the same document.** Pinned by a test that renders both paths from one payload and compares page counts |
| **A3** ∥ | **The drawn mark's four defects** · day | `renderPacketOverlay`'s mark loop — read `mark.signedName` for `mark === "initials"` **before** the `if (drawn)` branch; `usePacketCeremony.adopt()` — surface the staging failure instead of swallowing it; `PacketCeremony.vue` — preview the drawing in drawn mode | `pnpm --filter @silvicom/web test`; rasterise a packet signed by drawing and look at p05/p06/p09 | **A driver who draws gets their drawing on the signature lines and their typed initials on the initials lines, and is told if the drawing did not upload** |
| **A4** | **Initials stop pinning on one keystroke** · half day | `usePacketCeremony.ts` — confirm step before the first mark, editable until it lands. ⚠ Do not raise the contract's `min(1)`: somebody with one legal name has one initial. The defect is the **pin**, not the minimum | web tests; mutate the confirm gate | **A driver can correct a mistyped initial before it is fixed for the document** · *after A3 — same files* |
| **A5a** ∥ | **Migration: a second sign-token hash** · half day | Next-numbered migration — ⚠ **0345**, not 0344 (§1a C7) — adding `sign_token_hash` to `application_invitations`. ⚠ Column only — **no reader in this PR** (`lint:migration-ordering`). Commit the regenerated `schema.generated.sql` | `pnpm lint`; the PGlite matrix | **The column exists in production and nothing reads it** |
| **A5b** | **A fresh link in the approval email** · day | `applicationApprovalNotice.ts` mints a new token into `sign_token_hash` and sends it; `applicationIntake.ts` `resolveInvitation` accepts **either** hash. ⚠ Q-AX4's objection dissolves here — the old link keeps working, so nothing is stranded | api tests; a refused-send test asserting the approval still commits | **An approved applicant gets an email with a link that opens the signing screen, and their old link still works** · *after A5a, separate merge* |

### Wave B · the fold, the artifact, the surface

| | Step | Build | Verify | Done when |
|---|---|---|---|---|
| **B1** ∥ | **`hiringChecklist.ts` — the fold** · day. **START THIS FIRST** | `packages/shared/src/hiringChecklist.ts`. Pure. In: invitation phases, authorizations, packet marks, applications, qualification records, documents, PSP rows. Out per step: `blocked \| waiting_on_them \| waiting_on_us \| done`, the artifact, and the blocker's name. ⚠ **Only steps that exist today.** A step with no artifact cannot be a step (D-HM1) | shared tests; a fixture per state, and one asserting a step is **not** emitted when its evidence table is empty | **The fold answers "where is this applicant" for the five steps that have evidence today, and refuses to invent a sixth** |
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
| **D1** ∥ | Recorded acts + artifacts for MVR, Clearinghouse and the drug test (D-HM6) | Q-HM2, Q-HM4 | **An MVR obtained anywhere files the same way and turns its step green** |
| **D2** ∥ | Road test — §391.31(c) form, examiner, §391.31(e) certificate (D-HM7 / R8). ⚠ No schema widening: 0217 already carries `road_test` | **Q-HM1** | **A passed road test produces a certificate in the driver's file** |
| **D3** ∥ | Orientation sessions, attendance, per-instrument acknowledgements (R8, §5.2). ⚠ **Separate signature block per instrument** — an omnibus "I received orientation" does not prove §382.601 | **Q-HM7** | **An orientation day is schedulable and who attended is auditable** |
| **D4** | Re-found `DRIVER-TRAINING-PLAN.md` against the current gate set, then its Phases 0–3 | Q-HM3, Q-HM8 | **An applicant watches nine videos, answers the questions, and fails back to the video when they get them wrong** |
| **D5** | Live sessions with auto-assignment of the recording to absentees (§4.4) | D3, D4 | **Somebody who missed the live session is assigned the recording without anybody remembering to do it** |

### Not in the queue, because they are not builds

Send the counsel package · buy a Clearinghouse query plan + IDEMIA verification · choose an MVR
vendor · three Railway variables for Resend · point `silvicom360.silvicominc.com` at Railway.

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
