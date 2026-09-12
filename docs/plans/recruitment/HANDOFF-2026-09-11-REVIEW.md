# Handoff — the application's lifecycle, 2026-09-11 (evening)

**Read this before touching the apply flow, the review drawer, the applicant board or the packet.**

It continues `HANDOFF-2026-09-11-APPLY.md`, which is still true about X1–X9 and about the wording
blocker. Everything below happened after it: the carrier-owned wording landed, the office got a
review surface, the application became a two-visit document, and the owner audited the whole hiring
flow against what is actually built. **§3 is the important part** — it is the gap between the flow the
owner described and the flow that exists.

The plan is `APPLY-EXPERIENCE-PLAN.md`; its §6 progress log is the running record and its §4 holds
the open questions. `APPLICATION-PACKET-PLAN.md` owns the packet.

---

## 0. Where a driver's application actually gets to today

```
invite → [consent] → [4 authorizations] → 8 form screens → SEND TO THE OFFICE
                                                                  ↓
                                          office reads it, corrects answers, APPROVES
                                                                  ↓
                              driver reopens the same link → sees what changed → CERTIFIES → filed
```

The bracketed steps are skipped while the carrier's wording is `v0-draft`, which is still the state of
every instrument in production. **Until the carrier publishes, nothing can be signed and nothing can
be filed** — that has not changed, and `/settings/application-wording` is now where they fix it
without an engineer.

---

## 1. What shipped after the first handoff — 6 PRs, all merged, main `e455af5`

| PR | What it does |
| --- | --- |
| #750 | **Carrier-owned wording.** `org_disclosures` (0338), publish/history/outstanding service, versions assigned server-side, consent published as six statutory clauses. Fails closed to the code placeholders. |
| #751 | **`/settings/application-wording`.** Leads with the count of unpublished instruments, because until it is zero nothing an applicant does works. `manage("settings")`. |
| #752 | **The review drawer** on the applicant's record page, plus the two defects below. |
| #753 | **The hand-off endpoint** — `POST /:token/review`, all five phases served, and what the office corrected served back to the driver. |
| #754 | **The applicant's page becomes two visits.** |
| #755 | **The certification is refused** on anything the office has not approved. |

### ⚠ Two defects #752 found in code that every gate called green

1. **The edit path had never worked.** `editApplication` parsed the saved draft with
   `driverApplicationObject.partial()` — the CERTIFIED contract, which is `.strict()` — and a real
   autosaved payload carries `questionnaire`, which the certified document does not. Every correction
   to every real application came back *"That is not a valid answer for this field."* The tests passed
   because their fixture was a hand-written contract-shaped object rather than anything
   `toDraftPayload` has ever written. Fixed with `applicationDraftPayloadSchema`.
2. **§40.25(j)'s answer was never autosaved.** `prior_failed_pre_employment_test` was missing from
   `toDraftPayload` from the day P8 added it, so a driver who ticked it, closed the tab and came back
   had answered NO, silently. Now pinned by a TOTALITY test over every key of a maximal draft — the
   spot checks are exactly what let it through.

Both are the same shape: **a fixture that did not resemble production**, and a test that asked about
the fields somebody had remembered.

---

## 2. Decisions taken (see the plan §6 for the full reasoning)

- **D-AX11 · The certification moved to the end, the authorizations did not.** The four releases stay
  before the form — `SCREENING_PREREQUISITES` gates PSP and the employer inquiries on them, so behind
  the review they would mean reviewing blind. Only §391.21(b)(12) moves, because a certification of
  answers the office has since corrected certifies something else.
- **D-AX12 · Office edits are MARKED for the driver**, above the certification, in the driver's own
  words for the field. `edited_by` is deliberately not sent to the applicant.
- **Editing closes at APPROVAL, not at signing.** Approval is what tells the driver *this document,
  now, please sign it*; an answer moving underneath them between being asked and signing is the thing
  the flow exists to prevent.
- **The SSN moved to the signing screen.** Forced, not chosen: D-APP3 keeps it out of every saved
  draft, so a number typed on the first visit is gone by the second.
- **The server gate shipped THREE merges after the column and one after the page.** A gate landing
  first would have refused every submission from the client still in the field — the deploy-window
  rule applied to behaviour rather than to a column.

---

## 3. ⚠ The owner's flow, audited 2026-09-11 — what is real and what is not

The owner described the hiring flow and asked whether it is what we are building. It is. Three steps
are real, two differ in ways worth knowing, and the last one is not close.

| The owner's step | Reality |
| --- | --- |
| We send the application | ✅ built |
| He fills it in and signs releases so we can pull PSP / MVR / Clearinghouse | ⚠️ releases come BEFORE the form (D-APP4). **PSP real. MVR does not exist. Clearinghouse not ours.** |
| He submits | ✅ — and since #754 it means "sends it to you" |
| We review and approve | ✅ built |
| He signs every place on the application | ⚠️ **one signature**, plus the four releases. The packet's 18 sign pages are unbuilt (P5). |
| Complete, cross-matched, ready to print or email | ❌ **the gap.** Our PDF is not the carrier's packet, and the cross-match runs nowhere. |

### The evidence, so nobody re-derives it

- **MVR: no vendor, no pull, not even a purpose.** `AUTHORIZATION_PURPOSES`
  (`authorizationContract.ts:19-25`) has no MVR entry — it rides on `fcra_disclosure`. SambaSafety was
  deprecated on cost before a line was written (`SAMBA-RECON.md:1-8`); R3/R4 are DEFERRED and say
  *"MVR acquisition stays manual"*. `SCREENING_PREREQUISITES.mvr_order` exists and **nothing ever
  calls it** — `missingAuthorizations` is only ever asked about `"psp_record"`
  (`pspOrder.ts:201`). What exists is two DQ checklist items expecting a manually filed PDF.
  Packet page 19 IS the driving-record authorization, and it is one of the 18 sign pages.
- **Clearinghouse: disclosure + two DQ items, no query, by design.** §382.701(a) consent is given
  inside the FMCSA portal, which is why `clearinghouse` is deliberately absent from
  `APPLICATION_RELEASE_ORDER` (`applicationIntake.ts:165-167`). The only mention in the whole API
  outside tests is that comment.
- **PSP: genuinely end to end.** `apps/api/src/modules/psp/` — client, order with four gates in the
  order legality → authority → budget → correctness, portal import, parse, routes, UI. ⚠ Production
  had a date of birth for **zero of 201 drivers** on 2026-08-20, so the DOB import path is what makes
  any of it reachable.
- **The PDF is ours, not the carrier's.** `applicationPdf/render.ts` prints §391.21(b)(1)–(b)(12) in
  the REGULATION's order. A packet renderer exists (`packet/renderPacket.ts`) and **its only caller is
  a test**; it renders **5 of 31 pages**. The workbook is **31 pages** (4 fill · 18 sign · 4 static ·
  5 not ours), not 24.
- **Cross-matching is written and wired to nothing.** `crossMatchEmployment`
  (`packages/shared/src/psp/employment.ts:114`) corroborates declared employment against PSP, finds
  DOT numbers the application never mentioned, and reconciles undeclared crashes over the 3-vs-5-year
  overlap. Its only callers are two tests. ⚠ **Twice deliberate**: the August handoff says *"Do not
  wire the cross-match into a UI that says 'unverified' about a driver"* (D-PSP5 — it corroborates and
  discovers, it can NEVER refute), and it has no data to run against because P12's derived tables
  (`psp_inspections`, `psp_violations`, `psp_crashes`) **do not exist in any migration**.
- **The repo already stamps signatures onto a template PDF** — the annual-inspection report does it
  (`maintenance/inspections/render/report.ts:298`). The capability for "your workbook, filled and
  signed" is in-house and was deliberately not used here yet.

---

## 4. The two defects the owner hit — **FIXED 2026-09-11 in #757**

The owner started an application themselves and reported: *"showing not started… and there is no
process showing or data that is already filled in."* Both were real, and both had the same cause:
**nothing staff-facing read the draft.** Kept here because the cause is worth recognising again — the
fix is `applicationProgress(phases, hasDraft)` in shared, read by all three surfaces.

1. **The applicant board says `not_started`.** `applicantProgress` computes the stage from
   `employerCount` (`applicantPipeline.ts:105`), which counts rows in `driver_employment_history` — a
   table written **only at submission**. Nine screens filled in, still "not started".
2. **The invitation row says "Open".** `inviteState`
   (`useApplicationInvites.ts:98-103`) reads only `submitted_at`, `revoked_at`, `expires_at` and
   `consented_at` — and while the wording is `v0-draft` the consent screen is skipped, so that stamp
   is **never** set. It also ignores `review_requested_at` and `approved_at` entirely, so an
   application waiting for the office, or already approved, still reads "Open".

The draft is the only evidence a driver has started, and no staff surface reads it.

**Already partly answered and not yet seen by the owner:** the review drawer renders the answers from
the draft in ANY state — open the applicant, press **Review** on the invitation row. What does not
exist is a printable preview before certification.

---

## 5. The queue, in the order recommended to the owner

1. ~~**Make the draft visible.**~~ **DONE — #757.** The board and the invitation row read the draft
   and the two review phases; the board gained `filling_in`, `awaiting_review` and
   `awaiting_signature`, and its "Waiting on" column answers WHO for those three. One shared function
   answers for all three surfaces.
2. ~~**A printable preview at any stage**~~ — **DONE, F6.** The same renderer over the draft,
   banded "DRAFT - NOT A SIGNED APPLICATION" on every sheet, opened from the review drawer. It
   **refuses once the application is filed** — that copy is hashed, cited by its §391.51(b)(1) record
   and already offered on the applicant's page, and a second uncited rendering of a federal record is
   not a thing to hand anybody. ⚠ It also found a defect older than the whole plan: `field()` in
   `lib/pdfDraw.ts` split a label from its value across a page break and left a sheet carrying one
   orphaned word, in every PDF this repo draws.
3. **P12 then the cross-match panel. Start here.** ⚠ Not cheap, and it was described as cheap once before this
   was measured: the three derived PSP tables have to exist first. Then a panel that says *"PSP saw
   this DOT number and the application does not mention it"* — never *"unverified"*.
4. **P5/P6 — the packet becomes the carrier's workbook**, filled and signed. The largest piece and
   the one that makes the owner's last step true. Less "from zero" than it reads: the text is
   transcribed, the geometry is measured (27 placements — 21 driver, 4 carrier, 2 witness), 5 pages
   render. What is missing is the signing interaction and the other 26 pages.
5. **Q-AX4 — nothing tells the applicant they have been approved.** The waiting screen therefore
   promises no email. Recommendation on record: send it from `approveApplication`.

**Not on the queue, and both procurement rather than build:** an MVR vendor, and a Clearinghouse
query surface.

---

## 6. Traps, each naming a blind spot

- **A fixture that does not resemble production makes a green suite meaningless.** Two of today's
  defects were invisible for exactly that reason. When a table stores a DRAFT, build the fixture from
  the writer's own output.
- **`.omit()` on a `.strict()` Zod object turns keys into UNRECOGNISED ones.**
  `applicationBeforeCertificationSchema` refused every hand-off with `Unrecognized keys: "certified",
  "signed_name"` until it became `.extend()`. Pinned by a test.
- **Nothing may sit between `TransitionChild` and `DialogPanel` — not even an HTML comment.**
  `as="template"` needs exactly one child node; a comment took every drawer in the app down.
- **`break-words` does not reduce min-content width.** A flex item will not shrink below its longest
  unbroken string, so one email address held a drawer wider than the phone it was open on. `min-w-0`
  on the panel is the fix; `overflow-wrap: anywhere` is the other one.
- **Two `shrink-0` buttons beside an unbounded paragraph cannot fold.** That held the applicant record
  page 439px wide at every viewport, and a page that scrolls sideways also pushes a fixed drawer off
  the screen. Measured at 320/390 in a real browser; nothing in the unit suite could see it.
- **Playwright matches the MOST RECENTLY registered route first.** Register catch-alls first and
  specific handlers last, or `**/api/**` answers everything and every list renders empty for a reason
  no console line mentions.
- **The api flake is not CI-only.** Three unrelated files failed locally on 2026-09-11, none touched
  by the work, all green on re-run. Re-run before investigating.

---

## 7. Where the files are

| Thing | Path |
| --- | --- |
| The office's review | `apps/web/src/features/apply/ApplicationReviewDrawer.vue`, `ApplicationAnswerList.vue`, `editableFields.ts`, `useApplicationReview.ts` |
| Its API | `apps/api/src/modules/recruiting/applicationReview.ts`, `routes/applicationReview.ts` |
| The hand-off | `apps/api/src/modules/recruiting/applicationHandoff.ts` |
| The state machine | `packages/shared/src/applicationReviewContract.ts` |
| The driver's second visit | `apps/web/src/features/apply/SignOffFields.vue` |
| Carrier wording | `packages/shared/src/carrierWording.ts`, `apps/api/src/modules/recruiting/carrierWording.ts`, `apps/web/src/pages/ApplicationWordingPage.vue` |
| The two stage calculations to fix | `packages/shared/src/applicantPipeline.ts`, `apps/web/src/features/recruitment/useApplicationInvites.ts` |
| The packet | `docs/plans/recruitment/APPLICATION-PACKET-PLAN.md`, `packages/shared/src/packetPlacements.ts`, `apps/api/src/modules/recruiting/applicationPdf/packet/` |
