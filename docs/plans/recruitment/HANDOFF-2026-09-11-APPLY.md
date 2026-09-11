# Handoff — the driver application, 2026-09-11

**Read this before touching the apply flow, the signing ceremony or the applicant's record page.**
The plan is `APPLY-EXPERIENCE-PLAN.md`; its §6 progress log is the running record and its §7 holds the
owner's feedback and the decisions it produced. This document is the state of play in one place.

---

## 0. ⚠ THE ONE THING THAT MATTERS: a driver still cannot send an application

Reported by the owner with a screenshot on 2026-09-11, and it is the finding the whole programme
opened with. On the last screen the driver sees:

> **You cannot sign these yet, and the application cannot be sent until the carrier publishes the
> final wording.** Ask the person who invited you when that will be.

and a disabled **Not ready to send yet** button.

**This is working as designed, and the design is right.** Every instrument in
`packages/shared/src/authorizationContract.ts` carries `version: "v0-draft"` — five `DISCLOSURES`
plus `ESIGN_CONSENT` — and `isDraftDisclosure()` reads that string. Downstream, in order:

| What refuses | Where |
|---|---|
| every submission | `applicationIntake.ts` → `applicationWordingIsDraft()` → `WORDING_NOT_FINAL` |
| every signature | `recordRelease()` → `disclosure_not_final` |
| the 7001(c) consent | `esignConsentRequired()` returns false, so the gate never fires |
| every PSP order, §40.25 letter and Clearinghouse query | `SCREENING_PREREQUISITES` gates each on an authorization that cannot exist |

⚠ **No amount of UI work moves this.** Nine steps of X-work and three of F-work are behind that
button. The refusal disappears **by itself** the moment the versions stop being drafts — nothing to
turn on, nothing to remember. That was deliberate (`COUNSEL-REVIEW-PACKAGE.md` §1.2).

### What actually unblocks it

The wording lives **in code**, not per-org. There is no `org_disclosures` table; `releasesForApplicant()`
returns `DISCLOSURES[purpose]` for every carrier. So publishing today means an engineer editing
`authorizationContract.ts` and deploying.

Two routes, and **the owner has to choose, because only they know whether counsel-approved text
exists**:

- **(a) They have the text.** Paste it into `DISCLOSURES`, bump each `version` from `v0-draft` to
  `v1`, deploy. Half an hour. Everything above opens at once. ⚠ The text that ships is then the text
  drivers sign — it must be counsel's, not ours. The strings in the file today are **placeholders we
  wrote** and must never be published as they stand.
- **(b) They do not, or want to change it without an engineer.** Build carrier-owned wording: a
  table holding the published text per org and purpose, an office screen to paste and publish it,
  and `releasesForApplicant()` reading the org's published rows with the code's text as the unpublished
  default. Larger — a migration, a contract change, an API and a screen — and it removes the
  engineer from every future wording change, which is where this ends up anyway.

### ⚠ Can `APPLICATION.xlsx` settle the wording? Measured 2026-09-11 — it settles two of four

The owner asked whether the carrier's own workbook can determine the instruments precisely. It was
parsed again against the four the ceremony collects. **It cannot**, and the two it cannot settle are
exactly the two that gate screening.

| Instrument | In the workbook | Verdict |
|---|---|---|
| `previous_employer` | **p15** "PAST EMPLOYMENT VERIFICATION" | **Usable.** The carrier's own §391.23 / 49 CFR Part 40 release, substantively complete — three numbered paragraphs, the Part 40 testing history, the due-process rights. |
| `drug_alcohol` | **p3** (orientation + drug test) and **p22** (urinalysis notification) | **Usable.** The carrier asserting its own policy, which is theirs to assert. |
| `fcra_disclosure` | **p4 AND p20 — two different consumer-report disclosures in one packet** | **Not usable as written.** p4 bundles the disclosure with a blanket liability release — *"I AUTHORIZE, WITHOUT RESERVATION ANY PARTY OR AGENCY CONTACTED BY SILVICOM INC"* — and FCRA §604(b)(2) requires the disclosure to be *in a document that consists solely of the disclosure*. It also names **DOT Service, Chicago, IL** as the consumer-reporting agency, which is not who we query. |
| `psp` | **ABSENT.** `PSP` and `Pre-Employment Screening` appear **nowhere** in the workbook's 1,327 rows. | **Cannot come from the workbook at all.** PSP is FMCSA's programme, its account agreement requires a signed driver authorization in advance of **each** request (`APPLICATION-SYSTEM-PLAN` §4), and the disclosure language is not the carrier's to write. The packet predates the carrier using PSP. |

⚠ **Partial publication buys nothing.** `applicationWordingIsDraft()` is
`isDraft(ESIGN_CONSENT) || APPLICATION_RELEASE_ORDER.some(isDraft)` — all six or none. Transcribing
the two sound pages leaves the wall exactly where it is.

⚠ And this mapping is **not new work**: `COUNSEL-REVIEW-PACKAGE.md` §3 did it on 2026-08-23, page by
page, and §3.1 already recommends p4 is not adopted. The package has been waiting for an answer, not
for analysis.

**Nothing else in this handoff can be tested end to end until one of those happens**, including the
review flow in §3: an application nobody can submit is an application nobody can review.

---

## 1. What shipped — 13 PRs, all merged, main `582ed50`

### The programme (`APPLY-EXPERIENCE-PLAN.md` X1–X9)

| PR | Step | What it did |
|---|---|---|
| #736 | plan | the decision log, from an audit of the live flow |
| #737 | X1 | `AppMonthField`; `packages/shared/src/jurisdictions.ts`, which `samsara/location.ts` now **derives** from |
| #738 | X2 | errors in words, under the field, cursor in it |
| #739 | X3 | the review screen shows the application, not a count of it |
| #740 | X4 | the progress shell; the carrier's page-1 questions on page 1 |
| #741 | X5 | one job per panel instead of 107 controls; the coverage meter |
| #742 | X7 | a certificate of completion in the filed PDF |
| #743 | X8 | the signer can download their own copy |
| #744 | X9 | a required date of birth |
| #745 | X6 | the driver sees the photograph they just sent |

### The owner's feedback (§7, F1–F5)

| PR | Step | What it did |
|---|---|---|
| #746 | F1 | `ComboSelect` everywhere — the flow was the one surface using the browser's native `<select>` |
| #746 | F2 | the job panel asks for company, from, until; the rest behind `More about this job (optional)` |
| — | F3 | **measured clean, no fixes needed** — see §4 |
| #747 | F4 (1/n) | migration 0336: the five review/approval columns, nothing reading them yet |

---

## 2. Decisions on record

**D-AX11 · The four authorizations stay UP FRONT; only the §391.21(b)(12) certification moves behind
the review.** `SCREENING_PREREQUISITES` gates `psp_record` on `psp` + `fcra_disclosure`, `mvr_order`
on `fcra_disclosure`, `previous_employer_inquiry` on `previous_employer` — those signatures are
exactly what let the office screen before deciding, so moving them behind the review means reviewing
blind. ⚠ A deliberate reversal of **D-APP4** for the certification only.

**D-AX12 · An office edit is shown to the driver, marked, before they certify.** §391.21(b)(12) is
the applicant's own statement that the entries are true; an auditor will ask whether they saw the
carrier's changes.

**D-AX13 · An edit is a correction, never a silent overwrite.** Who changed what, and when.

**D-AX9 · The copy is served to the token holder** — not an escalation, because that token already
reads the draft. ⚠ **Amended by F5**: it is now gated on an office release as well.

---

## 3. What is left

**F4 (2/n) — `application_edits` + the office API.** The table lands *with* its writer: a table
nothing writes fails `lint:table-producers`. Reads the 0336 columns, which is legal now that they
have shipped in their own merge.

**F4 (3/n) — the review surface.** ⚠ **Open question put to the owner and not yet answered:**
`ApplicantRecordPage` already carries five sections. A sixth full application editor risks the
six-tab problem `DRIVER-ROSTER-PLAN.md` §2.3 measured. Recommendation: a full-width drawer opened
from that page, not another stacked section.

**F4 (4/n) — the driver's second visit.** The certify screen shows the corrected document with the
office's changes marked (D-AX12).

**F5 — the copy is released, not served.** X8's download answers "not yet" until `copy_released_at`
is set.

**Still deliberately open, recorded in plan §5 so they stay findable:** signer authentication beyond
the link (SMS is dark for want of a phone number) and decline-to-sign (its wording is counsel's).
And `APPLICATION-PACKET-PLAN.md` P5/P6 — the packet's 21 signature placements and the cutover to the
carrier's own document — remain blocked on the same counsel answer as §0.

---

## 4. Measurements, so nobody re-derives them

**Mobile (F3).** All nine screens plus the job panel, at **320 and 390**, against the built bundle:
no horizontal overflow, no clipped text, no colliding visible text. **No fixes were needed.**

⚠ The method matters more than the result, because the detector lied twice before it told the truth
and both lies looked like findings:

- comparing every element on the page flagged the drawer's contents against the page *behind the
  scrim* — an overlay is supposed to sit on top, so elements in different positioned contexts must
  not be compared at all;
- it then flagged the panel's own labels against its footer, because an element scrolled out of an
  `overflow-y-auto` container **still reports a rect** that intersects its siblings. Anything clipped
  by a scrolling ancestor has to be excluded first.

Both failed noisy, which is the safe direction. A third version of the same mistake could as easily
hide a real collision.

**The employment screen was 107 controls** for an ordinary six-employer ten-year history — fifteen per
employer, five per equipment row, two of its own.

**21 driver signature placements across 18 pages** in the carrier's packet; the ceremony collects
**four**. `packages/shared/src/packetPlacements.ts` is the measurement.

---

## 5. Traps found, each naming a blind spot

- **`AppFormField` camelised its ARIA slot props**, so **every field error in the product** was
  visible in red and announced by nothing. `AppCombobox` did the same by inheriting attributes onto a
  positioning div. Both fixed in `packages/ui`.
- **`proof_of_age`'s hint carried `§391.11(b)(1)`** since A9 — a D-UI9 violation. `strings.test.ts`
  walks `APPLY_COPY` and the carrier's questions are *not in it*. The gate walks the definition now.
- **The application took the roster's nullish date of birth**, so a blank one left the draft
  **ungated** — `draftIsLocked` withholds a body only once a date of birth is in it. Not
  "un-unlockable", which is what the plan first claimed.
- **`applicationPdf/file.ts` selected five of eight evidence columns** per signature. No test of the
  renderer could have caught it; the pin belongs on the query.
- **Zod runs a `superRefine` after a failed regex**, so a blank date of birth produced two issues for
  one mistake, the second phrased for whoever wrote the schema and arriving as `code: "custom"` — which
  every caller treats as human-written.

**Three tests passed while proving nothing**, each caught by mutation and each worth recognising again:
an org-scope assertion reading a *different query's* filter; a review walk satisfied by agreeing with
the implementation; and a panel-shape check that subtracted id lists instead of asking where a field
sits, so a field rendered in two places vanished from the comparison.

---

## 6. Harness facts that cost time

- **The api suite flakes on a full run**, and it is **not CI-only** — seen three times on
  2026-09-11 on `inventory/labelPdf`, `maintenance/routes/inspections` + `inventoryAssets`, and
  `org/routes/surfaceAccess`, each on a PR touching none of them, each green on re-run. See
  [[api-test-flake-is-not-timeouts]]. Re-run before investigating.
- **The apply flow can be seen in a browser**, which it could not before: build with the env loaded
  (`set -a; . apps/web/.env; set +a; npx vite build`), `npx vite preview`, then Playwright with
  `page.route("**/api/public/application/**")` returning the invitation as **raw JSON** — not
  `{ok,data}`.
- **A migration must commit its regenerated `supabase/schema.generated.sql`**; the check hides inside
  `lint:table-writers` as `lint:schema-snapshot`, and fails until the regenerated file is *committed*,
  not merely written.
- **A new column and its first reader ship in two merges**; **a new table must arrive with its
  writer** or `lint:table-producers` fails. Those two rules pull in opposite directions and are why
  0336 carries columns only.
