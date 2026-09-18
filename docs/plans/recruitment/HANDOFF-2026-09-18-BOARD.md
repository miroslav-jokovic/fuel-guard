# Handoff — 2026-09-18, the hiring board is live and B5 is next

**Written after B4 merged (PR #871, `main` at `a2532f9`) and deployed.** For whoever picks up **B5**,
the checklist component.

⚠ **This document is a snapshot and goes stale; `HIRING-MODULE-PLAN.md` §10 does not.** The dated log
at the END of §10 is what says which steps are done — not §9's table, and not this file. If the two
ever disagree, the log wins. What is here is the part a fresh chat cannot derive from the plan: what
B4 left standing, and the four things that will cost B5 an hour each.

---

## 0. Where the programme stands, 2026-09-18

| | |
|---|---|
| Merged | **A0** (#867) · **A0b** (#868) · **B1** (#869) · **B3** (#870) · **B4** (#871) |
| `main` | `a2532f9`, deployed — the web host `fleetguardweb-production` is serving it, verified by curling its `/api/version` |
| Next | **B5**, the checklist component. It was gated on B4 and is now unblocked |
| Parallel (∥) | **B2**, **B7**, **B8** may run in other chats at the same time as B5 |
| Still open before any real ceremony walk | Wave A's **A1, A2, A3, A4, A5a, A5b** — none of them is gated on B5 |

**What a person can do today that they could not on 2026-09-17:** open Recruitment and see, first and
without choosing a page, who is waiting on the office — the one action for each of them, in words,
oldest first.

---

## 1. B5 — what it is, and what it already has to build on

> **B5 · The checklist component · day.** `features/recruitment/`, per §5 of `HIRING-UI-PLAN.md` and
> mockup screen 2. ⚠ Not shared yet (D-DS18/D-HUI2). States are badges from `@/lib/badges` — icon
> **and** word, never colour alone.
> **Done when: every row states what it is, who owes the move, and the document that proves it.**

### What exists and should be read first

| | |
|---|---|
| The fold | `packages/shared/src/hiringChecklist.ts` + `hiringSteps.ts`. Pure, no clock, no network |
| The endpoint | `GET /api/recruitment/applicants/:driverId/checklist` → `{ ok: true, checklist }`. Gated on `recruitment: "view"`, not `manage` — the AUDITOR is the reader a §391.51 file exists for |
| The shape | `HiringChecklist = { steps[], done, total, readyToTravel, readyToHire, next }`; each step is its catalogue spec plus `state`, `artifact`, `blockedBy` |
| The anatomy | `HIRING-UI-PLAN.md` §5 — header + progress, then D-HUI3's three questions a row. §6 is the list of what NOT to build |
| The page it lands on | `apps/web/src/pages/ApplicantRecordPage.vue`, 95 lines, five stacked sections. ⚠ **B6 rebuilds that page; B5 builds the component.** The five sections are not thrown away — they become drawer bodies at B6 |

**There is no `useApplicantChecklist` composable yet.** B3 shipped the endpoint and nothing reads it;
B5 is its first consumer. `features/recruitment/useEmployment.ts` is the idiom to copy.

**Twelve of the fifteen steps are emitted.** The three that are not — orientation videos, live
orientation, the handbook — have no evidence table in this schema and are deliberately absent rather
than shown as permanently outstanding (D-HM1's corollary: *a step with no artifact cannot be a step*).
D3 and D4 build them. B5 should not invent placeholder rows for them.

---

## 2. ⚠ The four things that will cost B5 an hour each

### 2.1 `artifact` is a TABLE NAME, not words — and D-HUI3's third column is load-bearing

`hiringChecklist.ts` sets `artifact: spec.evidence`, and `spec.evidence` is
`"qualification_records.mvr"`, `"application_packet_marks"`, `"application_invitations.approved_at"`.
Rendering that column as-is puts a **database identifier on a recruiter's screen**.

The mockup shows what it should say — *"Packet (31 pp) ↗"*, *"4 authorizations ↗"*, *"Report ↗"* — a
human noun and a link to the document. And D-HUI3 is explicit that this column is *"the visible half
of D-HM1's corollary… If the column is empty for a row, that row should not have shipped."*

⚠ **Do not map table names to labels in the component.** That is the copy-with-a-delay-fuse the
catalogue exists to prevent, and B4 hit the same shape and resolved it in the catalogue: the board's
Next-action column needed an instruction where `label` gave a completed fact, so `action` was added
to `HiringStepSpec` beside it. **The same answer fits here** — an `artifactLabel` (and, separately,
how to reach the document) belongs on the spec, where a step cannot exist without one.

⚠ `spec.evidence` must keep meaning what it means. It is read by the fold and by the plan as *which
row proves this*; it is not free to become a display string.

### 2.2 The badges are word-only today, and D-HUI4 asks for icon AND word

B4 shipped `hiringPhaseBadge` and `hiringWaitingOnBadge` in `apps/web/src/lib/badges.recruiting.ts`.
Both render `[BADGE_BASE, toneClass(...)]` with a **word and no icon**.

That is accessible — the meaning is in the word, not the colour — but it is **not what D-HUI4 asks
for**: *"a badge… carrying an icon and a word, not a coloured dot."* B5 renders the four step states
(`blocked`, `waiting_on_them`, `waiting_on_us`, `done`), which is exactly what D-HUI4 is about, so
**B5 is where the icon+word idiom gets established.**

`AppBadge` is `inline-flex items-center gap-1` with a slot, so an icon goes inside it; `BADGE_BASE`
is the same shape. ⚠ Never import from `@hugeicons/core-free-icons` directly — add to
`packages/ui/src/icons.ts` first.

⚠ **When B5 settles the idiom, the board's Waiting-on badge should adopt it**, or one screen will say
a state with an icon and the next will say it without. Small, and worth doing in B5's PR rather than
leaving two vocabularies.

### 2.3 `readyToTravel` and `readyToHire` are NOT booleans

Both are `{ ok, unmeasured, outstanding }`, and `ok` is only ever true when `unmeasured` is empty.
Step 9 (orientation videos) is inside the travel range and has no evidence table, so
**`readyToTravel.ok` is false for everybody until D4 ships** — correctly, and it says why by name.

⚠ A component that renders `ok` as a green tick would be reporting a gate nobody has checked — the
medical-certificate mistake (capture read as verification) one level up. If B5 shows a travel
summary at all, it has to show `unmeasured` too. Q-HM5's ruling makes `readyToTravel` a **hard gate
on the invitation to come in**, so this is not cosmetic.

### 2.4 Four test-harness traps, all measured in B4

| | |
|---|---|
| **`DataTable` picks its markup from a MEDIA QUERY** | `useMediaQuery("(min-width: 768px)")` chooses table vs cards. jsdom answers `false` to everything, so `tbody tr` finds nothing while the rows are plainly in the HTML. Stub `window.matchMedia` — `RecruitmentPage.test.ts` has the helper |
| **floating-ui loops on a detached mount** | Opening a `FilterSelect` in a test without `attachTo: document.body` gives *"Maximum recursive updates exceeded in `<FilterSelect>`"*, which reads like a page defect and is not. Attach to body and read the teleported panel off `document` |
| **Teleported panels outlive the test** | Unmount in `afterEach` and clear `document.body`, or the next test reads a listbox from two tests ago. B4's decided-application test passed alone and failed in the run, for exactly this |
| **`FilterSelect.clear()` emits `""`** | Any filter whose "show everything" value is `"all"` has no value its own ✕ can produce. Two filters on the old board carried this. **Resting value is always `""`** |

---

## 3. What B4 changed that B5 inherits

- **`HiringStepSpec` gained `phase` and `action`.** `phase` is the board's Stage word
  (`application` / `screening` / `orientation` / `office_day` / `hire`, labels in
  `HIRING_PHASE_LABELS`); `action` is the step as an instruction. `hiringStep(key)` resolves a spec
  and is total over the union — it throws rather than returning a placeholder.
- **`applicantBoard.ts`** folds every applicant set-based; `/api/recruitment/pipeline` returns a
  `checklist` projection beside each row. B5 does **not** use it — the per-applicant endpoint (B3) is
  the right read for one person's checklist.
- **`postgrestFixture.ts`** (`apps/api/src/testing/`) is the fake that applies filters, projection,
  order and limit. ⚠ `supabaseRecorder`'s flat array applies **none** of them, and two green
  assertions have proved nothing because of it. Any test whose property is about narrowing needs it.
- **`applicantChecklist.ts` now excludes REVOKED invitations.** The live invitation is the newest one
  that is not revoked, which is what `resolveInvitation` and `/pipeline` have always meant. Before
  B4 the record page and the board could describe two different applications for one person.
- **`surfaces.ts`**: screening and inquiries are non-nav children of `recruitment.applicants`, and
  `RecruitmentTabs.vue` is the strip. ⚠ The tabs NAVIGATE between three routes rather than swapping
  a panel — the argument is in that component's header, and it is the only file that changes if they
  are ever rebuilt as panels.

---

## 4. Open, and not B5's to fix quietly

- **Q-HM8 — `packages/shared/src/surfaces.ts` is at 500 of 500 lines.** B4 fitted by cutting its own
  comments back, which works once. The next person to add a surface has no room. Recommendation in
  §8: split the catalogue from the gate functions, **moving `check-surfaces.mjs`'s parser in the same
  PR** (it parses that path rather than importing it), as its own PR. A waiver is the workaround.
- **`applicantStageBadge` and `APPLICANT_STAGES` have lost their last UI consumer.** The board reads
  the catalogue's phase now. `applicantProgress` still feeds `/pipeline`'s other fields so nothing is
  dead yet, but the seven-stage vocabulary no longer appears anywhere a person can see. Retiring it
  is a follow-up, not B5's.
- **`/pipeline` still returns `employers`, `cmv_employers`, `gap_days`, `date_of_birth_recorded`**,
  which the board no longer renders. Left deliberately to keep B4's diff reviewable; the screening
  tab is the likely consumer.
- **Q-HUI1 is still open and is FCRA-adjacent**: does the applicant see the carrier's steps at all?
  Recommendation (a) — only their own. ⚠ It should be confirmed, not assumed. It does not block B5,
  which is the OFFICE's checklist, but D-HM2 says both screens fold the same evidence, so whoever
  builds the applicant's view will need the answer.

---

## 5. The protocol, in one paragraph

One step, one PR, one branch off `origin/main` — ⚠ several chats share this working tree, so check
`git branch --show-current` before every commit. Record progress by **appending a dated line to §10**;
never tick a row in §9. Run the gates before pushing, and ⚠ **`pnpm lint` is not the gate set** —
`lint:boundaries`, `lint:filesize`, `lint:funcsize`, `lint:comment-claims`, `lint:table-writers`,
`lint:table-access` and `lint:surfaces` all pass or fail independently of it. For web changes also
`pnpm --filter web lint:tokens` (an `apps/web` script; a bare root call fails misleadingly).
**Prove a test can fail** by mutating the line it covers. ⚠ `git checkout --` is refused inside a
worktree-isolated session, so a mutation harness that reverts with it silently does nothing and its
results are cumulative — B4 threw away a whole run to that. And ⚠ **none of this can be checked by
reading code**: `pnpm --filter @silvicom/web preview:local` serves :4173 (`pnpm dev` crashes on this
machine, environmentally), and B4's three real defects were all found by looking at the rendered page
after every test was green.
