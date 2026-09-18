# Handoff — 2026-09-18 evening, the record is built and Wave A is the debt

**Written after B6 merged (PR #875, `main` at `59b5b4f`).** For whoever picks up the hiring module
next. ⚠ **It recommends a step the queue does not point at**, and §3 is the argument for that.

⚠ **This document is a snapshot and goes stale; `HIRING-MODULE-PLAN.md` §10 does not.** The dated log
at the END of §10 says which steps are done — not §9's table, and not this file. If the two disagree,
the log wins.

---

## 0. Where the programme stands

| | |
|---|---|
| Merged | **A0** (#867) · **A0b** (#868) · **B1** (#869) · **B3** (#870) · **B4** (#871) · **B5** (#874) · **B6** (#875) · Q-HM8 (#873) |
| `main` | `59b5b4f` |
| Never started | **A1, A2, A3, A4, A5a, A5b** · **B2, B7, B8** · all of Wave C and Wave D |
| Recommended next | **A3, then A4** — see §3. Not B7/B8, and the reason is a deadline rather than a preference |

**What a person can do today that they could not on 2026-09-17:** open Recruitment and see who is
waiting on the office, oldest first; open one applicant and see every step of the hire with the
document that proves each; and click any row to do the work behind it — including reading the four
signed releases, which no screen in the office's half of this product had ever shown.

---

## 1. Why every step so far has been a `B`, which is worth understanding before choosing the next one

Nobody decided to skip Wave A. Three things compounded:

1. **A0 and A0b genuinely had to go first** and did. §9 says so in as many words.
2. **§9's sequencing insight pulled B1 forward on purpose** — *"`hiringChecklist.ts` is a pure
   function with no dependencies… build it first and the UI work has something to render against;
   build it last and four steps queue behind it."* That was right, and B3/B4/B5/B6 each consumed it.
3. **A1, A2, A3 and A5a are marked `∥`, which means "may run in a different chat AT THE SAME TIME".**
   That is not "may be done later" — it is an instruction to open a second chat. Nobody opened one.
   Each handoff then wrote *"Next: B5"*, *"Next: B6"*, because those were the steps with a sequential
   blocker, and the `∥` steps drifted for four consecutive sessions without ever being blocked,
   rejected or scheduled.

⚠ **The failure mode is worth naming, because it will recur on Wave D**, which parallelises almost
completely: **a `∥` step has no natural moment at which somebody notices it is late.** A blocked step
announces itself the moment its blocker lands. A parallel one never does. If a `∥` step is not going
to get its own chat, it needs a place in the sequential order instead — otherwise the queue silently
becomes "everything that was ever blocked, in order", which is what happened here.

---

## 2. What B5 and B6 built, in the terms the next step needs

| | |
|---|---|
| `packages/shared/src/hiringSteps.ts` | the catalogue. `evidence` is `{ table, label } \| null` where `table` is a **closed union**, so the web's artifact-address map and drawer map are exhaustive `Record`s and a new step fails typecheck until somebody says where its proof is read and what its drawer holds |
| `apps/web/src/features/recruitment/` | `HiringChecklistCard.vue` (rows are buttons, emits `open`), `HiringStepDrawer.vue` + `hiringStepDrawers.ts` (the switch), `AuthorizationsPanel.vue` + `useAuthorizations.ts` (Q-HUI6's answer), `hiringArtifacts.ts` (addresses) |
| `apps/web/src/lib/badges.recruiting.ts` | one `Record<HiringStepState, {tone, icon}>` read by the checklist AND by B4's board, so a state cannot wear two glyphs |
| `ApplicantRecordPage.vue` | header → checklist → `ExplainerPanel` → `DispositionSection` → one step drawer → the review drawer |

**Three rules established that the next UI step inherits:**

- **The catalogue owns the words; `apps/web` owns the dressing and the addresses.** Title and
  subtitle are `label` and `action`; never write a third string per step.
- **A map beside a catalogue must be keyed on a closed union**, or it is a copy with a delay fuse.
  Both maps B5/B6 added are `Record`s over one, and both were proved by deleting an entry.
- **`DispositionSection` is not behind a row on purpose.** Ending an application is not one of
  D-HM9's fourteen steps and must not become one.

---

## 3. ⚠ Why the next step is A3, not B7 or B8

**Because of the freeze, and because A0b removed the thing that was accidentally protecting us.**

§0 of the plan: *"A filed packet is frozen. `ensureApplicationPdf` renders once, hashes, and returns
storage bytes for ever. The freeze is at **filing**, not at marking."* Production holds **20 marks
from one unfinished walk and no filed packet** (measured 2026-09-17 — ⚠ re-measure before relying on
it), so how the packet prints is **still** free to change.

Now trace A3. Verified 2026-09-18 by reading the call sites:

```
file.ts  →  renderPacketDocument()  →  renderPacketOverlay()      ← A3's fix is HERE
preview.ts                                                        ← renders no packet at all (A2's defect)
```

So:

- **A3 changes what gets FILED.** Its defect is that `renderPacketOverlay`'s mark loop runs
  `if (drawn) … continue` **before** reading `mark.signedName`, so a driver who signs by drawing gets
  their drawing stamped on the three **initials** lines as well as the signature lines.
- **A driver who completes a ceremony today freezes that document for ever.**
- **Until A0b shipped, nobody could complete one** — the rate limiter refused the 21st of 22 marks
  (§10, A0). A0b fixed that. So the protection was accidental, it is gone, and the window is open.

⚠ **A4 has the same property by a different route**: an initial pinned on the first keystroke is
pinned into the document that gets frozen. It is sequenced *after A3* because they touch the same
files.

⚠ **A2 does NOT have this property** and the row says so: *"`render.ts` stays untouched, for
already-filed records only."* It fixes the **preview**, so it is a correctness fix without a
deadline. Still worth doing — the office previewing a different document from the one the driver
signs is how somebody approves text nobody read — but it does not have to be first.

**B7 and B8 have no deadline at all.** B8 gates C1; C1 is far off.

### If you disagree

The counter-argument is legitimate: **nobody is actually walking a ceremony right now**, so the
window is theoretical, and B7/B8 move the product forward for real users. If you take that view, say
so in §10 — *"A3 deferred on <date>, reason"* — rather than leaving it drifting for a fifth session.
That is the whole point of §1.

---

## 4. The traps, all measured, all still live

| | |
|---|---|
| **Rendering finds what tests cannot — five steps running** | B4 three defects · B5 the blocked-row copy · B6 an imperative under a finished step, and a comment claiming Q-HUI6 was still open after B6 closed it. ⚠ **Open the page.** `pnpm --filter @silvicom/web preview:local` (`pnpm dev` crashes here, environmentally); set `VITE_DEV_BYPASS=true` in the gitignored `apps/web/.env` and **restore it after** |
| **Playwright mocks are RAW bodies** | `route.fulfill` the endpoint's own object. `{ok:true,data:…}` makes every field undefined one level down and the error boundary swallows it |
| **Teleported panels outlive the assertion, not just the test** | B6's mutation run came back GREEN on a real defect because one `it` opened two drawers and both assertions read the FIRST panel. `afterEach` is not enough — unmount between opens. This is the trap B5's handoff named, met from the other side |
| **A mutation harness must not revert with `git checkout --`** | It is refused in a worktree-isolated session and does nothing, silently, cumulatively. Write the original bytes back |
| **`lint:ui-adoption` is a HARD ZERO on raw `<button>`** in pages and features. `BaseButton size="row"` is the list-row shape; a link inside a button is invalid markup, so keep it a sibling |
| **`pnpm lint` is not the gate set** | `lint:boundaries`, `lint:filesize`, `lint:funcsize`, `lint:comment-claims`, `lint:table-writers`, `lint:table-access`, `lint:surfaces` all pass/fail independently. Web changes also need `pnpm --filter web lint:tokens` (an `apps/web` script; a bare root call fails misleadingly) |
| **The nav is generated from `NAV_SURFACES`** in `packages/shared/src/surfaceCatalogue.ts` — **not** `surfaces.ts` any more (split at #873) |

---

## 5. Open questions this programme now carries

- **⚠ Q-HM9 (NEW, B6) — the §391.23(a)(2) previous-employer investigation is not one of D-HM9's
  fourteen steps.** `grep -c inquir packages/shared/src/hiringSteps.ts` = **0**, though it is a
  federal §391.51 requirement and this product already builds the whole of it. **A recruiter working
  from the checklist alone can reach "Hired" with the investigation undone.** Recommendation (a): add
  it as a step, evidence `employer_inquiries`, blocking `hired`. ⚠ It is a CATALOGUE ruling — it
  changes the fold, the board, the counts and the printed file — so B6 did not take it.
- **Q-HUI1 — does the applicant see the carrier's steps at all?** FCRA-adjacent. Recommendation (a),
  only their own. Unanswered; blocks nothing yet, but D-HM2 says both screens fold the same evidence.
- **~~Q-HUI6~~ CLOSED by B6.** Kept in §7 because the shape is the lesson: **an endpoint with no
  caller is invisible to every gate in this repo**, and what found it was a checklist row asking
  *where do I go to see this*.
- **`applicantStageBadge` and `APPLICANT_STAGES` have no UI consumer left.** Retiring them is a
  follow-up nobody owns.

---

## 6. The protocol, unchanged

One step, one PR, one branch off `origin/main`. ⚠ Several chats share this working tree — check
`git branch --show-current` before every commit. Record progress by **appending a dated line to
§10**; never tick a row in §9. Run the gates before pushing. **Prove a test can fail** by mutating
the line it covers — and if a mutation comes back green, suspect the test before the code.
