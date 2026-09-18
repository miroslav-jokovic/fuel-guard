# The hiring module — surfaces

**Date:** 2026-09-17 · **Owner:** Miki · **Status:** RESEARCH + DECISIONS PROPOSED, NOTHING BUILT.

The UI companion to `HIRING-MODULE-PLAN.md`, which owns the process, the regulation and the queue.
This document owns **what a person sees and touches**. The split follows this repo's own precedent —
`RECRUITING-UI-SURFACE-PLAN.md` is the same companion to `RECRUITING-SYSTEM-PLAN.md`.

**`HIRING-MOCKUP.html` renders every screen below.** Open it in a browser — nothing needs to be
running. ⚠ It `<link>`s the real `packages/ui/src/tokens.generated.css`, so its colours, radii,
shadows and typeface are the product's rather than a mockup author's, and it contains no hex value.

It exists because the owner's words on 2026-09-17 were *"our application pages and flow and other
pages in recruitment are confusing, not really user friendly"*, and then *"make this checklist/wizard
modern and advanced"*. Those are two different asks — one is a repair, one is a new object — and §3
rules that they are also two different **objects**.

⚠ **Nothing here invents a design system.** This product has one (`docs/DESIGN-SYSTEM-CONTRACT.md`,
`packages/ui`, `tokens.css`), it is mid-refresh (`docs/plans/design-system/DESIGN-REFRESH-2026-09.md`),
and the refresh's own lesson is that the gap was one hue and a radius ladder, not a redesign. §1 is
what is already settled, so that no step below re-derives it.

---

## 1. What is already settled, and must not be re-decided

Read `apps/web/CLAUDE.md` before touching anything. The rules most relevant here:

**Primitives.** `@silvicom/ui` for `AppButton`/`AppCard`/`AppInput`/`AppTabs`/`AppSegmentedControl`/
`AppCombobox`/`AppBadge`; `@/components/ui/` for the web composites — `DataTable`, `PageHeader`,
`FilterBar`, `FilterSelect`, `DataWorkspace`, `StatCard`, `ExplainerPanel`, `FileDropzone`,
`TimelineRail`. ⚠ **`SlideOver.vue` and `TablePagination.vue` are one level up, in
`apps/web/src/components/`** — verified 2026-09-17, and the plan had both in `ui/` (§1a C6 of the
parent). ⚠ **A local clone of a shared primitive fails `lint:ui-adoption`**, and
a raw `<button>` in pages or features fails it with zero tolerance.

**Tokens.** Semantic only. `pnpm --filter web lint:tokens` fails a raw palette utility, a hex, an
inline colour style, and any text size outside the seven. ⚠ It is an `apps/web` script, **not a root
one** — a bare root call fails and misleads.

**Page skeleton.** `<div class="space-y-6">` → `PageHeader` (no `title` prop; it comes from
`route.meta.title`) → `FilterBar` → `DataTable` with `TablePagination` in `#footer`. `lint:ui-adoption`
requires a `PageHeader` on every routed page unless `meta.fullBleed` exempts it.

**Badges.** `[BADGE_BASE, toneClass(...)]` from `@/lib/badges`. No local tone maps, no status string
literals in templates.

**Feedback.** Mutation feedback is a toast (`useToastStore`), never an inline banner.

**Copy voice.** Sentence case. Buttons and toast titles take no terminal period; full sentences do.
State the fact, then the next action.

⚠ **The non-native-speaker rule applies here, and more strongly than it does in Finance.** The
2026-08-29 ruling was for owners reading reports. The audience here is **an applicant on a phone at a
truck stop** and **a recruiter who is not a compliance lawyer**. Plain word leads, the regulatory term
survives as the hover, the method goes behind `ExplainerPanel`. ⚠ And D-UI9 already bans CFR citations
on any screen — they stay in the printed PDF and in code comments. *"We need your driving record from
every state you have been licensed in"*, with `§391.23(a)(1)` in the `title` attribute and nowhere
else.

**What you can actually see.** `pnpm --filter @silvicom/web preview:local` builds and serves on
:4173 with the design lab on, so `/__design-system` renders real primitives without a login. ⚠ `pnpm
dev` crashes on this machine inside vite's dependency optimiser — environmental, not your change.

---

## 2. Research — wizard or checklist?

### 2.1 What NN/g says

A **wizard** is a step-by-step process in a *prescribed order*, where later steps may depend on
earlier ones. Their recommendations are specific and all four apply to us:

- **Set expectations up front** — say what the process looks like and how many steps, because showing
  one step at a time hides the length.
- **Label and highlight** — clear label per step, clear current-step indicator, next steps greyed.
- **Enforce sequence** — do not let users pick a step before completing its predecessors, *even when
  order does not logically matter*, because clear ordering reduces decision and memory load.
- **Show all steps from the start** — an overview builds the mental model, and visible progress
  motivates completion.

⚠ **And then NN/g contradicts itself deliberately, for exactly our case.** Their complex-application
guidance says to *avoid rigid, linear workflows that force users through start-to-finish with no
escape hatches* — provide skipping ahead, looping back, and an interactive sequence map that returns
to earlier steps without losing progress.

Both are right, about different users. That contradiction is what §3 resolves.

### 2.2 What the product-adoption market says

A **wizard/tour** is linear and controls the sequence; a **checklist** is a persistent, non-linear
widget of tasks completed at the user's own pace, re-enterable, and it works because people finish
what they have started — a bar at 40% motivates more than a blank slate.

⚠ **Their single named anti-pattern is the one that decides our architecture:** *a checklist that
makes users repeat actions they have already taken — if the user imported data before reaching the
"Import data" step, it must auto-check. Forcing users to redo work drives abandonment.*

That is **D-HM1 arrived at from the other direction.** The parent plan rules the checklist must be
derived from evidence rows for correctness reasons (a stored flag goes stale, and a hiring checklist
that disagrees with its own file is worse than none). The UX literature reaches the same rule from
abandonment data. When a correctness argument and a usability argument land on the same design, that
design is not a preference.

Other details worth taking: per-step **time estimates** ("2 min") lower resistance to starting;
progress is a **percentage**, not a vibe; the checklist is dismissible but recoverable from a
persistent entry point.

⚠ Their completion statistics are vendor-reported and are not cited as evidence here.

### 2.3 What this repo already worked out, and nobody should redo

**`ApplyProgress.vue` has already solved wizard navigation, with the argument written down** (X4,
Q-AX1). Three rulings in it are directly reusable and were hard-won:

1. **The bar INDICATES; a list NAVIGATES.** A nine-segment bar on a phone gives each step ~30px — a
   third of the minimum comfortable touch target — so *"a driver aiming for step 3 in a moving truck
   hits step 4"*. The bar is `aria-hidden` because it repeats a heading and counter that already say
   it in words; one control opens a list of full-height rows, each naming its screen and its state.
2. **Forward is fenced at the high-water mark, not at the current position.** `next()` validates the
   screen being left; jumping does not. Everything up to the furthest screen reached is open; beyond
   it is not — otherwise the list is a way around validation.
3. Everything navigable is a real button with a real label.

⚠ **`TimelineRail` is NOT the checklist and must not be bent into one.** Its own header says it is a
rail of *dated entries* about one entity, short and unfiltered, and *"do not grow filters here"*. A
checklist is undated future work. They look alike and are not alike.

⚠ **D-DS18 governs whether a new primitive may exist at all:** *"a primitive with one consumer is a
primitive API designed by guessing."* `TimelineRail` waited for a second consumer before promotion.
So the checklist is composed from existing primitives in `features/`, and is promoted to
`@/components/ui/` only when a second surface needs it — see D-HUI2.

---

## 3. The ruling — two objects, two audiences, one fold

### D-HUI1 — the applicant gets a WIZARD; the office gets a CHECKLIST

**Why.** The two users are in genuinely different situations, and the NN/g contradiction in §2.1 is
the tell:

| | The applicant | The office |
|---|---|---|
| Knows the domain? | no | yes |
| May the order change? | **no — it is law** (§5 of the parent plan) | yes, constantly; reality reorders it |
| Doing it how often? | once | every day |
| On what | a phone, possibly at a truck stop | a desktop |
| Right pattern | **wizard** — enforce sequence, one thing at a time | **checklist** — non-linear, self-paced, auto-checking |

So NN/g's *enforce sequence* is right for the applicant and wrong for the office, and their *escape
hatches* guidance is right for the office and wrong for the applicant. A single component trying to
be both is how the current product ended up with three confusing pages.

**How.** One derived fold (D-HM1) feeds both. The applicant's surface renders their own steps and
hides ours; the office's renders all of them. ⚠ Because it is one computation, **the applicant can
never be told they are waiting on us while we are told we are waiting on them** — which is precisely
the defect that shipped twice already (F5, then #757).

### D-HUI2 — no new shared primitive until a second consumer (D-DS18)

The checklist is built in `features/recruitment/` first. It moves to `@/components/ui/` when a second
surface needs it — the likely candidate is the DQF page, which is the same shape for a hired driver.
⚠ Building it shared on day one means designing its API by guessing, which is the failure D-DS18 was
written about.

### D-HUI3 — a step row answers three questions and nothing else

**What it is** (plain words) · **who it is waiting on** · **the artifact that proves it**.

Not a description, not a regulation, not a history. Anything else goes in the drawer. This is the
rule that keeps a fourteen-row checklist readable, and it is the discipline `ApplyProgress`'s rows
already follow.

⚠ **The artifact column is load-bearing, not decoration.** It is the visible half of D-HM1's
corollary: *a step with no artifact cannot be a step.* If the column is empty for a row, that row
should not have shipped.

### D-HUI4 — state is never colour alone

Every step state is a badge from `@/lib/badges` carrying an **icon and a word**, not a coloured dot.
Required by the accessibility rule, and independently required here because the four states are not
ordered on a good/bad axis — *waiting on them* and *waiting on us* are equally "in progress" and
completely different actions.

The four states, and they are the whole vocabulary:

| State | Means | Who acts |
|---|---|---|
| `blocked` | a predecessor is not done | nobody yet — name the blocker |
| `waiting_on_them` | sent, not returned | chase |
| `waiting_on_us` | returned, not actioned | **you** |
| `done` | artifact exists | nobody |

⚠ **`waiting_on_us` is the only one that should ever be visually loud.** A board where everything
shouts is a board nobody reads, and the office's real question every morning is *"what is mine
today?"*.

### D-HUI5 — the checklist never asks for something already done

§2.2's anti-pattern, and free given D-HM1. It also has a second-order effect worth stating: because
steps auto-check from evidence, **a step completed outside the product still checks** — an MVR
uploaded by hand, a Clearinghouse query recorded from the FMCSA portal. That is what makes D-HM6's
"recorded acts, not integrations" liveable as a UI rather than a nag.

### D-HUI6 — the signing surface is full-bleed, not an `AppShell` page

A 31-page PDF with a page rail and a field stepper needs the viewport. `meta.fullBleed` +
`isFullBleed()` in `lib/layout.ts` is the mechanism that already exists (D-DR5 — ⚠ do **not** add a
`layout: "canvas"`; `meta.layout` already means *which shell entirely*, and the live map established
`fullBleed` as the right lever).

⚠ **Two measured traps apply directly.** `DataTable`'s scroll area is `max-h-[70vh]`, a **viewport**
measurement — put it in a shorter fixed-height box and rows past the box are silently clipped and
unreachable (DR5 added a `fill` prop for exactly this). And a banner plus a full-bleed page costs
28px of scroll, because `EnvironmentBanner`/`UpdateBanner` are siblings of the whole shell in
`App.vue`, so `calc(100dvh - 4rem)` is short by the banner's height.

### D-HUI7 — the office may act out of order and record why; the applicant may not

NN/g's escape hatches, bounded by law. The office can open any step at any time. For the six federal
gates (parent plan §5) the checklist **shows the violation it would be** rather than silently
allowing it, which is Q-HM5's recommendation rendered.

⚠ The applicant's wizard keeps `ApplyProgress`'s high-water-mark fence unchanged. It is not a UX
preference there — it is what stops the navigation being a route around validation.

### D-HUI9 — the page is the orientation, the sentence is the reading surface (Q-HUI2, measured)

**Measured 2026-09-17**, by rendering packet page 15 at the exact scale each viewport gives it —
`pdftoppm -r 46` is what a 390px phone shows at 1x, `-r 90` is a 765px tablet:

| Viewport | Body text renders at | Verdict |
|---|---|---|
| **390px** (phone) | **~6 CSS px** | the document is recognisable as a **shape** — heading, paragraphs, signature lines, page number — and the body text **cannot be read** |
| **765px** (tablet/desktop) | ~12 CSS px | **fully readable** |

⚠ **So none of Q-HUI2's three candidates was right.** (a) pinch-zoom alone makes reading the clause a
chore on the screen most drivers have; (b) cropping to the mark's neighbourhood throws away the
document, which is the entire point of the rebuild; (c) desktop-only strands the driver this product
is for.

**What ships instead: both, always.** The page renders at every width — that is what tells the driver
*where they are on the carrier's paper*, and at 390px it does that job perfectly well even though the
body text is 6px. Beside it, **the stop's own sentence in real type** — which the current ceremony
already serves as `stop.what` and is the one thing it got right. Pinch-zoom stays enabled for the
full clause. ⚠ Never `user-scalable=no`; disabling zoom is an accessibility failure and here it would
remove the only way to read the paragraph.

⚠ **And there is a fact that makes this safe rather than a compromise: six of the twenty-two stops sit
on pages whose instrument the driver has already read and signed in full, readable type on their
phone** — page 15's past-employment release, page 20's FCRA disclosure, page 22's urinalysis
notification. On those pages the packet line is a countersignature of something already read. The
other sixteen are where the sentence has to carry it, and it does.

### D-HUI8 — one recruitment page, not three

`/recruitment/screening` and `/recruitment/inquiries` stop being nav destinations and become panels
on the applicant record, where the work happens. ⚠ **The nav is generated from `NAV_SURFACES`**, so
this is a `packages/shared/src/surfaceCatalogue.ts` change plus route records — the paths are not in
`apps/web/src`, and looking for them there wastes an hour.

They are **not deleted**. Both are real work queues; a fleet-wide view of either earns a tab on the
board, not a sidebar item. This is `RECRUITING-UI-SURFACE-PLAN.md`'s U2 lesson: *the panel's CONTENT
was not rejected — only its address.*

---

## 4. The surfaces

### 4.1 `/recruitment` — the board

Replaces three pages. The repo's page skeleton applies unchanged: `PageHeader` → `FilterBar` →
`DataTable` → `TablePagination`.

- **Columns:** Applicant · Stage · **Next action** · Waiting on · Days in stage. ⚠ *Next action* is
  the column that makes this a board rather than a list, and it is the fold's own output, never a
  second rule.
- **One table per page** (the 2026-08-29 structural ruling). A second table earns an `AppTabs` tab —
  which is where fleet-wide screening-readiness and the inquiry queue land under D-HUI8.
- **Filter on state, not on stage alone**: *waiting on us* is the default view, because it is the
  question the office asks first.
- Empty state states the fact and the next action: *"No applicants yet. Invite one."*

⚠ Not a kanban. The repo has no board primitive, a kanban is a second layout to maintain, and the
sortable "days in stage" column answers the only question a kanban would — see Q-HUI4.

### 4.2 `/recruitment/:id` — the applicant record, which IS the checklist

The page becomes the checklist plus its drawer. Current structure — five sections stacked by
regulation (invite, disposition, employment history, employer inquiry, PSP) — is replaced by the
fold's steps in the order work happens.

- A **header summary**: name, stage, a percentage, and the one next action.
- The **step list**, D-HUI3's three questions per row.
- Clicking a row opens a **`SlideOver`** with that step's detail, its history, its artifact and its
  actions (actions in `#footer`, per the non-negotiables).
- `ExplainerPanel` carries the method and the caveats, collapsed, so the page never explains itself
  in front of the work.

⚠ The existing sections are not thrown away — each becomes a step's drawer body. `EmploymentHistorySection`,
`EmployerInquirySection`, `PspRecordsSection` and `DispositionSection` already exist and already work.

### 4.3 `/apply/:token` — the applicant's wizard

Already exists and already implements §2.3's rulings. What changes is scope, not pattern:

- **Set expectations up front** (NN/g): a first screen that says what the whole process is and roughly
  how long — currently the applicant discovers the length by walking it.
- **Per-step time estimates** (§2.2) on the navigation list.
- **The step-one artifact** appears here too: once the permissions are signed, the applicant can open
  and keep their own copy. HM6 in the parent plan builds it for the office; the applicant is owed it
  by the same act.
- ⚠ The 48-hour token rotation (parent plan §1.6) is a **correctness** fix, but it presents as a UI
  one — the applicant's experience of it is a dead link. It is HM1 and it comes first.

### 4.4 The signing surface — the one genuinely hard screen

The DocuSign model, from the earlier analysis: the packet renders, scrollable, page rail on the
right, a START tag jumping to the first mark, NEXT walking the rest, FINISH disabled until all 22
land. Full-bleed (D-HUI6).

⚠ **Mobile is the open question, not the desktop layout** — see Q-HUI2. A 31-page US-Letter PDF on a
390px viewport is 8pt type. Every driver-facing screen in this product is tested at 320 and 390, and
this one cannot pass by shrinking.

⚠ **The adoption dialog gets DocuSign's three tabs** — Choose a style / Draw / Upload — with signature
and initials adopted **separately**, and changeable while the envelope is open. That is the fix for
four shipped defects at once (parent plan §1.3), and the "changeable" half is what makes the initials
pin survivable.

### 4.5 The office's document viewer

There isn't one. `openPdf` hands the browser a URL and that is the whole of it. ⚠ **Every artifact
D-HM4 promises needs somewhere to be looked at**, and "the browser's PDF plugin in a new tab" is the
answer for *printing* and the wrong answer for *reviewing beside the data*. Scope this with 4.4 —
they are the same viewer, one read-only.

---

## 5. Anatomy of the checklist

Composed from existing primitives. Nothing below needs a new one.

```
┌─ BaseCard ────────────────────────────────────────────────────────────┐
│  Hiring · 6 of 14 done                              [43%  ▓▓▓▓░░░░░]  │  ← header + progress
│  Next: order the MVR                                                  │  ← the one action
├───────────────────────────────────────────────────────────────────────┤
│  ✓  Application signed              Done          Packet (31 pp) ↗    │  ← D-HUI3's three
│  ✓  Permissions signed              Done          4 authorizations ↗  │
│  ⏳ Orientation videos              Waiting on them   4 of 9 · 12 min │  ← time estimate
│  ●  PSP report                      Waiting on you    Report ↗        │  ← loud: yours
│  ⏳ Clearinghouse query             Waiting on you    —               │
│  ⊘  Road test                       Blocked           needs drug test │  ← names its blocker
└───────────────────────────────────────────────────────────────────────┘
```

**Rules that make it work, each with its reason:**

- **Progress is a percentage of steps, not of screens.** The applicant's wizard counts screens; the
  office's checklist counts steps. Mixing them produces a number that moves for the wrong reason.
- **The count never renumbers under somebody.** `usePacketCeremony` already learned this — *"the count
  a driver is watching must not move while they are watching it"* — so completed steps stay counted
  rather than being filtered out.
- **A blocked row names its blocker in words**, never a greyed row with no explanation. NN/g's
  *label and highlight*, and the difference between a checklist and a wall.
- **`text-2xs` for the artifact and the estimate** — glanced-at metadata (D-DS6). Anything meant to be
  READ starts at `text-xs`.
- **The progress element is `aria-hidden`** and the heading carries "6 of 14 done" in words —
  `ApplyProgress`'s ruling, unchanged.
- **Async state changes announce once, atomically** (`role="status"`, `aria-atomic`), e.g. *"6 of 14
  steps done"* — never a bare number, and never one live region per badge.

---

## 6. What not to build

Each of these is something this repo, or the research, has already paid for once.

- ❌ **A stored `step_completed` boolean.** D-HM1. It is also §2.2's abandonment anti-pattern.
- ❌ **A bespoke date picker, table, modal or button for this feature.** `lint:ui-adoption` fails it,
  and the 2026-08-25 `PeriodFilter` revert is the precedent: consistency across pages outranks a
  control that is better in isolation on one of them.
- ❌ **A shared `<HiringChecklist>` primitive on day one.** D-DS18 / D-HUI2.
- ❌ **CFR citations on screen.** D-UI9.
- ❌ **A kanban.** Q-HUI4.
- ❌ **An inline success banner.** Toasts.
- ❌ **A second dashboard row for hiring.** U2 was reverted by the owner with *"we don't need this data
  on the main dashboard"*. The board is the address.
- ❌ **Colour-only step states.** D-HUI4.
- ❌ **A progress bar as the navigation.** Q-AX1, measured: 30px targets.

---

## 7. Open questions

- **Q-HM9 · The §391.23(a)(2) previous-employer investigation is not one of D-HM9's fourteen steps.**
  Found by B6, which had to give `EmployerInquirySection` a home and discovered there is no row it
  belongs to: `grep -c inquir packages/shared/src/hiringSteps.ts` returns **0**. It is a federal
  §391.51 file requirement, this product already builds the whole of it (the inquiry queue, the
  30-day §391.23(c)(1) clock, `inquiryQueue.ts`, `employer_inquiries`), and the hiring checklist does
  not mention it — so a recruiter working from the checklist alone can reach "Hired" with the
  investigation undone. Candidates: (a) add it as a step after `application_filled`, evidence
  `employer_inquiries`, blocking `hired`; (b) leave it off, on the grounds that it is a file
  requirement rather than a step in the owner's process; (c) fold it into `application_filled`'s
  state. **Recommendation (a)** — it has an evidence table, so D-HM1's corollary admits it, and every
  other federal gate in the list is there for exactly this reason. ⚠ It is a CATALOGUE ruling and
  changes the fold, the board and the counts, so B6 did not take it: the inquiries live in the
  application drawer for now, labelled as being there because the step does not exist.
- **Q-HUI1 · Does the applicant see the carrier's steps at all?** Candidates: (a) only their own, with
  one line — *"We are reviewing your application. We will email you."*; (b) the full list with ours
  greyed. **Recommendation (a).** An applicant who can see "PSP report — waiting on you" learns the
  carrier is buying a report on them, before the carrier has decided anything, and can draw a
  conclusion from its timing. ⚠ This has an FCRA-adjacent flavour and should be confirmed, not
  assumed.
- **~~Q-HUI6 · Nothing in the office's product shows a signed authorization.~~ CLOSED 2026-09-18 by
  B6**, with recommendation (a): `AuthorizationsPanel` is the drawer behind the Permissions row. It
  lists the four releases in `APPLICATION_RELEASE_ORDER`, folds each with `liveAuthorization` so a
  revoked grant reads as outstanding (D-REC3), and leads each line with the **wording version** —
  which is the field a FCRA §604(b)(2) dispute turns on, and the reason a tick and a date would have
  looked complete and been useless. The original entry is kept below, because the shape of the gap is
  the useful part: an endpoint with no caller is invisible to every gate in this repo, and what found
  it was a checklist row asking *where do I go to see this*.

  Raised by B5, which is
  the first surface that had to answer *where do I go to see the artifact*. Eleven of the twelve
  artifacts resolve — nine to the driver's §391.51 file (the filed packet included: `file.ts` files
  it as a `documents` row of kind `employment_application` cited by a qualification record), two to
  cards already on the applicant record. `driver_authorizations` resolves to nothing: the read
  endpoint exists (`GET /api/recruitment/drivers/:driverId/authorizations`) and **no screen calls
  it**, so the office cannot see the four §604(b)(2)/§391.23 releases it is relying on. Candidates:
  (a) a drawer on the applicant record listing purpose, accepted-at and the wording version, opened
  from the checklist row — B6 is already building that drawer machinery; (b) a section on the
  §391.51 file, which is where an auditor would look; (c) leave it, and the checklist row states the
  artifact without a link. **Recommendation (a)** — the recruiter is the reader who acts on it, and
  the FCRA disclosure's *version* is the fact that matters in a dispute. ⚠ B5 ships (c) with the
  reason written into `features/recruitment/hiringArtifacts.ts` rather than pointing the row at the
  nearest page, which would open the wrong document under the right word.
- **~~Q-HUI2 · Is the signing surface usable on a phone?~~ RULED 2026-09-17 by measurement — D-HUI9.**
- **~~Q-HUI3 · Where does the checklist live once the driver is hired?~~ RULED 2026-09-17: not yet.**
  The DQF page is the same shape for a §391.51 file and is therefore **the second consumer that
  promotes the checklist out of `features/` under D-DS18** — but promotion waits until the recruitment
  one has shipped and been used, because that is the whole of D-DS18's argument. Recorded as the
  named trigger rather than left open.
- **~~Q-HUI4 · Board: table or kanban?~~ RULED 2026-09-17: table.** Not a preference — the repo has no
  board primitive, the page skeleton *is* a table, one-table-per-page is a standing structural rule,
  and a sortable "days in stage" answers the only question a kanban asks. Columns, if ever wanted, are
  an `AppTabs` tab over the same data, never a second layout.
- **~~Q-HUI5 · Does the office need the applicant's live screen state?~~ RULED 2026-09-17: no, and not
  later either.** The data exists (`application_drafts.furthest_section` is already written), which is
  exactly why this needed a ruling rather than an omission. It is surveillance-shaped, its entire
  value is a phone call the recruiter can already make, and *"they are on screen 6 of 8"* is not a
  fact a carrier needs about a person who has not been hired.

---

## 8. How to verify any of this

⚠ None of it can be checked by reading code. The repo has paid for this lesson repeatedly.

1. **`pnpm --filter @silvicom/web preview:local`** → :4173, design lab on, `/__design-system` renders
   real primitives without a login. `pnpm dev` crashes on this machine; that is environmental.
2. **Render at 320 and 390.** Every driver-facing screen in this product is checked at both.
   `break-words` does not reduce min-content width — **`min-w-0` is what lets a drawer fit a phone.**
3. **Playwright route mocks for dev-bypass.** ⚠ API mocks are **raw JSON** — `route.fulfill` the raw
   body, never `{ok, data}`, or the error boundary hides the mismatch. ⚠ Playwright matches the
   **last** registered route first, so catch-alls go first.
4. **Measure the DOM, not a screenshot** (`scrollWidth - clientWidth`): `truncate` fails silently.
5. **Rasterise any PDF change and look at it.** `pdftoppm -r 110 -png`. This is what found the
   orphaned-word defect in every PDF this repo draws, and it is the only check that works on the
   signing surface's output.
6. ⚠ **A comparison against `main` proves nothing once the change under test is in `main`.** Rebuild at
   the commit before it.

---

## 9. Queue

⚠ **There is no queue here. `HIRING-MODULE-PLAN.md` §9 is the single ordering**, and it already
carries these steps as **B4–B8** (board, checklist, record page, wizard additions, viewer) and
**C1–C2** (signing surface, adoption dialog).

A second ordered list in this document would be a second answer to *"what do I do next"*, which is
the failure this repo names as a workaround: a copy is a workaround with a delay fuse. What lives
here is the **reasoning** each of those steps needs — §3's decisions, §5's anatomy, §6's list of what
not to build — and `HIRING-MOCKUP.html` is what they look like.

## 10. Progress log

Append dated lines. Never edit a table row above.

- **2026-09-17** — Created. NN/g wizard and complex-application guidance read (§2.1); product-adoption
  literature read (§2.2); `ApplyProgress.vue`'s three Q-AX1 rulings recovered from the code (§2.3).
  D-HUI1–D-HUI8 proposed, none ruled; Q-HUI1–Q-HUI5 open. **Nothing built.**
- **2026-09-17, later** — `HIRING-MOCKUP.html` added and rendered in a browser at 1440 and 390.
  ⚠ **Rendering it found two things reading it could not.** (a) `tokens.generated.css` has **two
  layers**: `:root` carries the primitives (`--surface`, `--ink*`, `--edge*`, `--ramp-*`, `--shape-*`,
  `--elevation-*`) and a `@theme` block carries the Tailwind aliases (`--radius-*`, `--color-*`,
  `--font-sans`, `--text-*`, `--shadow-*`) that only exist after a Tailwind build. Outside one,
  `getPropertyValue` returns empty and every `var()` **silently falls back** — measured: the whole
  document rendered in Times and nothing warned. Anything outside the app build must read the
  primitives. (b) A clock **emoji** had been used as a step marker, against the repo's own
  SVG-icons-no-emoji rule, and it was invisible in the source. §9's queue moved to the parent plan so
  there is one ordering.

---

## 11. Sources

**Pattern research** — [NN/g: Wizards — definition and design recommendations](https://www.nngroup.com/articles/wizards/) ·
[NN/g: 8 design guidelines for complex applications](https://www.nngroup.com/articles/complex-application-design/) ·
[NN/g: Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) ·
[NN/g: 4 principles to reduce cognitive load in forms](https://www.nngroup.com/articles/4-principles-reduce-cognitive-load/) ·
[Chameleon: onboarding UX patterns](https://www.chameleon.io/blog/onboarding-ux-patterns) ·
[Appcues: onboarding UI/UX patterns](https://www.appcues.com/blog/user-onboarding-ui-ux-patterns)

**In-repo canon** — `apps/web/CLAUDE.md` · `docs/DESIGN-SYSTEM-CONTRACT.md` ·
`docs/plans/design-system/DESIGN-REFRESH-2026-09.md` §7 · `docs/plans/design-system/DESIGN-SYSTEM-2026.md` (D-DS1, D-DS6, D-DS13, D-DS18) ·
`RECRUITING-UI-SURFACE-PLAN.md` (D-UI1–D-UI9, the U2 revert) ·
`APPLY-EXPERIENCE-PLAN.md` (X4, Q-AX1) · `HIRING-MODULE-PLAN.md` (D-HM1–D-HM8)
