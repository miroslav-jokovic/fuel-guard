# Handoff — 2026-09-18 evening, Wave A's deadline is discharged

**Written after A3 (#877) and A4 (#878).** For whoever picks up the hiring module next.

⚠ **This document is a snapshot and goes stale; `HIRING-MODULE-PLAN.md` §10 does not.** The dated log
at the END of §10 says which steps are done — not §9's table, and not this file. If they disagree,
the log wins. Read §0 (the continuity protocol) and §1a (which corrects seven earlier claims) before
starting anything.

---

## 0. Where the programme stands

| | |
|---|---|
| Merged | **A0** (#867) · **A0b** (#868) · **A3** (#877) · **A4** (#878) · **B1** (#869) · **B3** (#870) · **B4** (#871) · **B5** (#874) · **B6** (#875) · Q-HM8 (#873) · handoff (#876) |
| Never started | **A1, A2, A5a, A5b** · **B2, B7, B8** · all of Wave C and Wave D |
| Recommended next | **Q-HM9 first** (see §3), then **A2**, then B7/B8. ⚠ **Q-PKT11 before C2**, not before then |
| Next migration | **0345** — `0344_tms_dispatchers.sql` is the head. Re-check from `origin/main`, not from a stale checkout |

**What changed today that a person can feel:** a driver who draws gets their drawing on the signature
lines and their typed initials on the three `Initials` boxes; they are told if the drawing did not
upload; they see both marks before either is permanent and can correct the one the server has not yet
fixed; and backgrounding the phone mid-walk no longer skips places or declares an unsigned packet
finished.

---

## 1. ⚠ The freeze deadline is DISCHARGED, and that changes what "next" means

The reason A3/A4 jumped the queue was `ensureApplicationPdf`: it renders once, hashes, and returns
those bytes for ever, and A0b had just removed the rate-limiter bug that was accidentally preventing
anyone from completing a ceremony. **Both printing defects on the filing path are now fixed**, so the
clock that made Wave A urgent has stopped ticking.

⚠ **It has stopped, not disappeared.** Anything else that changes how the packet PRINTS still has to
land before the first packet is filed. Production measured 2026-09-18: **20 marks from one unfinished
walk, no filed packet** — plus one filed `employment_application` (hashed, 2026-09-14) which pre-dates
every mark and is therefore `render.ts`'s §391.21 summary, exactly what the marks-based switch should
produce for an application with none. ⚠ **Re-measure before relying on this**:

```
supabase db query --linked "select count(*), min(created_at), max(created_at) from application_packet_marks;"
```

**A2 does not share the property** and its own row says so — `render.ts` stays untouched; it fixes the
PREVIEW. So A2 is correctness without a clock, and it is still worth doing: the office previewing a
different document from the one the driver signs is how somebody approves text nobody read.

---

## 2. What A3 and A4 established that the next step inherits

| | |
|---|---|
| `packetOverlay.ts` | the mark loop reads `packetPlacementById()` for the kind. **The drawing goes on signature lines only.** An id the inventory does not carry falls back to the typed name — unreachable today, and the test file says why rather than stubbing a way in |
| `usePacketCeremony.ts` | `pinnedKinds` (served pin + served `signedAt` + this session's `filedHere`), `canChange(kind)`, `placesWithMark(kind)`, `confirm()`, `reopen()`, `currentShowsDrawing`, `drawnMarkFailed`. **There is no cursor** — `current` is the first stop nobody has filed |
| `PacketCeremony.vue` | four states: `adopting` → `confirming` → `signing` → `done`, plus the resumed panel. The confirm screen and the stop both read ONE boolean for what the mark is |
| `strings.flow.ts` | `drawFailed`, `confirm*`, `changeMark`, `markLocked`, `changeIntro` |

**Four rules the next UI step inherits:**

- **The server's rows decide what may still be changed.** `record_packet_mark` (0340) pins per
  `(invitation_id, mark)`, so the signature fixes at place 1 and the initials not until place 3. Any
  screen offering a correction must read `pinnedKinds`, never a flag set at adoption.
- **A NAMED PAIR, not a shared function.** `currentShowsDrawing` and `renderPacketOverlay`'s mark loop
  state the same rule from two sides — one holds a PNG already filed, the other a Blob that is not.
  They must agree; both derive the kind from `PacketPlacement.mark`, never from a page number.
- **One boolean per question, read by every element that answers it.** A3's defect was a caption
  reading `style` over a preview reading `markFor()`.
- **Never a second count of a fact a composable owns.** A4's was `placesWith` in the component.

---

## 3. ⚠ Why the next step is Q-HM9, not A1/A2/B7

**Because it is the only open item that can make the product report something false about a federal
obligation**, and every other candidate is a repair or a convenience.

`grep -c inquir packages/shared/src/hiringSteps.ts` is **0**. The §391.23(a)(2) previous-employer
investigation is not one of D-HM9's fourteen steps — though it is a §391.51 file requirement and this
product already builds the whole of it: the inquiry queue, the 30-day §391.23(c)(1) clock,
`inquiryQueue.ts`, `employer_inquiries`. **A recruiter working from the checklist alone can reach
"Hired" with the investigation undone**, and the checklist exists precisely to stop that.

⚠ **It is a CATALOGUE ruling** — it changes the fold, the board, the counts and the printed file —
which is why B6 declined to take it in passing, and why it wants its own PR rather than being
attached to a UI step.

**Recommendation (a), as the plan already says:** add it after `application_filled`, evidence
`employer_inquiries`, blocking `hired`. Its evidence table exists, so D-HM1's corollary admits it, and
every other federal gate in the list is there for exactly this reason.

**What it touches, in order:** `hiringSteps.ts` (the catalogue and the closed union) →
`hiringChecklist.ts` (the fold) → `hiringArtifacts.ts` and `hiringStepDrawers.ts` (both `Record`s over
that union, so **both will fail typecheck until somebody says where the proof is read and what the
drawer holds** — that is the fuse working, not an obstacle) → the board's counts.
⚠ `EmployerInquirySection` currently sits in the application drawer **labelled as being there because
the step does not exist**; that label comes out with this change.

### If you disagree

The counter-argument is in the plan as candidate (b): it is a file requirement rather than a step in
the owner's process. If you take that view, **say so in §10 with a date and a reason** rather than
leaving it open a third session — the `∥` lesson from `HANDOFF-2026-09-18-RECORD.md` §1 is that an
item nobody schedules is never late, and therefore never done.

**After Q-HM9: A2** (one document, not two), then B7/B8. ⚠ **Q-PKT11 goes before C2 and not earlier** —
see §5.

---

## 4. The traps, all measured, all still live

| | |
|---|---|
| **Rendering finds what tests cannot — EIGHT steps running** | B4 three · B5 one · B6 two · A3 one (the big one) · A4 three. ⚠ **Open the page.** The full browser recipe is in §10's A3 entry: `preview:local` (it takes whatever port is free), Playwright, `route.fulfill` with **RAW** bodies, and a bundle with `phases.approvedAt` set + `submittedAt` null + `consentedAt` + `releasesCompletedAt` + `releases: []` + `draft.locked: false`, or `ApplyPage` stops at the consent gate, the release ceremony or the DOB gate in that order |
| **`pnpm --filter @silvicom/web build` fails for this** | it needs the two `VITE_` vars as REAL env vars, not the `.env` file. `preview:local` handles it |
| **A mutation harness must not revert with a checkout** | it is refused in a worktree-isolated session and does nothing, silently, cumulatively. Write the original BYTES back |
| **`git`-shaped words in a heredoc are refused** in a worktree-isolated session, including inside a PR body. Write the body to a file and pass `--body-file` |
| **Teleported panels outlive the assertion** | unmount between opens; `afterEach` is not enough |
| **`lint:ui-adoption` is a HARD ZERO on raw `<button>`** in pages and features |
| **`pnpm lint` is not the gate set** | `lint:boundaries`, `lint:filesize`, `lint:funcsize`, `lint:comment-claims`, `lint:table-writers`, `lint:table-access`, `lint:surfaces` all pass/fail independently, plus `--filter web lint:tokens` |
| **A plan-file conflict is NORMAL and the resolution is "keep both"** | two sessions appending dated §10 entries collide at the `## 11. Sources` boundary. #877 hit it against #876. Keep both entries in merge order; never take one side |
| **⚠ A conflicting PR gets NO CI at all** | GitHub cannot build a merge ref, so `gh pr checks` reports *"no checks reported"* rather than a failure. #877 sat for twenty minutes looking stuck when it was conflicted. If checks never appear, check `mergeStateStatus` before anything else |

---

## 5. Open questions this programme carries

- **⚠ Q-HM9 — the §391.23 investigation is not a step.** §3 above. **This is the recommended next
  build.**
- **⚠ Q-PKT11 (NEW, A4) — `usePacketCeremony.ts` is at 481 of 500 lines**, up from 248 before A3. It
  passes `lint:filesize` and is over the 450 warning — the position `surfaces.ts` was in when Q-HM8
  found that trimming comments to fit *"is the wrong repair and it only worked once"*.
  **Recommendation: split the adoption half into `usePacketAdoption.ts`, as its own
  behaviour-preserving PR, BEFORE C2** — C2 adds the adoption dialog and lands squarely in the half
  that is already full. ⚠ Not before then, and not bundled into a feature step: a refactor's whole
  value is a diff that says nothing changed.
- **Q-HUI1 — does the applicant see the carrier's steps at all?** Recommendation (a), only their own.
  ⚠ **This one is a product/legal call and should be CONFIRMED, not assumed.** The concrete harm is
  narrower than "FCRA": an applicant who sees *"PSP report — waiting on you"* learns the carrier is
  buying a report on them before any decision, and its timing leaks intent.
- **Q-PKT9's remaining half** — a resumed SIGNATURE has the same hazard the initials had, and
  `needsInitials` solves it only for initials. A4's `pinnedKinds` is the machinery to close it; nobody
  has.
- **`applicantStageBadge` and `APPLICANT_STAGES` have no UI consumer left.** Retiring them is a
  follow-up nobody owns.

---

## 6. The protocol, unchanged

One step, one PR, one branch off `origin/main`. ⚠ Several chats share this working tree — check
`git branch --show-current` before every commit. Record progress by **appending a dated line to §10**;
never tick a row in §9. Run the gates before pushing. **Prove a test can fail** by mutating the line
it covers — and if a mutation comes back green, suspect the test before the code.

⚠ And the one this wave kept proving: **the suite being green is not the verification.** Eight
consecutive steps have shipped a defect every test passed for, each found only by opening the page.
Budget for it.
