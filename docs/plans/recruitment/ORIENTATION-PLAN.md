# Orientation and the handbook (D3) — plan and queue

**Created 2026-09-25.** Execution-grade. Every "today" fact in §2 was read at the call site on `main`
`0e714e1` or off the carrier's own workbook (`docs/plans/recruitment/APPLICATION.xlsx`, extracted by
parsing `sheet1.xml` against `sharedStrings.xml`, never retyped). This is `HIRING-MODULE-PLAN.md`'s
**D3** (Q-HM7, D-HM10, R8's orientation half), and its §0 protocol applies unchanged: one step, one
PR, branch off `origin/main`, append to §8 of THIS file, prove a test can fail, a migration and its
first reader in two merges.

⚠ **Nothing is built until §7 is answered.** The measurement in §2.3 contradicts the step as the
hiring plan wrote it, and the contradiction is the owner's to settle, not the code's.

---

## 1. What the rulings say

- **Q-HM7** (2026-09-17): *"orientation is done by sections and it is full day process, but with videos
  and application and other things we can finish it in half day and assign a truck if driver is in
  the office in the morning."*
- **D-HM10** (2026-09-17): *"we will have signing handbook as part of signing process and when driver
  is in the office, and that is part of application but separate process and document."* The plan
  read that as a new `handbook` purpose in 0215's CHECK, in neither `APPLICATION_RELEASE_ORDER` nor
  `SCREENING_PREREQUISITES`.
- **§5.2** (HIRING-MODULE-PLAN): the §382.601 drug-and-alcohol policy receipt gets **its own signature
  block**, never an omnibus "I received orientation".

---

## 2. What exists today (verified 2026-09-25)

### 2.1 The carrier's own orientation record — packet page 24, `DRIVER SAFETY TRAINING`

It was taken out of the packet on 2026-08-23 (D-PKT10) because an applicant cannot affirm training
they have not had. `packetStatic.ts` records why, and that R7/R8 own it. Its content, verbatim:

- *"This is to affirm that the driver ____ has received, and has had training in the areas of company
  and DOT rules and regulations …"*
- **Handbooks** (a tick box each): `FMCR Handbook` · `North American Response Book` · `Company Rules
  and Regulations`.
- **Training was in areas of** (numbered): 1 `Vehicle inspections` · 2 `Driver Guide to the Daily
  Logs` · 3 `Safety Techniques` · 4 `Emergency maneuvers` · 5 `Speed and Space management` · 6 `Air
  Brake Training` · 7 `Accident and Breakdown`.
- *"On this day, ____________, 20___, I have completed training of log preparation … (395.8) …"* and
  the fines clause.
- `DRIVER -PRINT` · `Driver signatrure | Date` · `Instructor's signatrure`.

⚠ **This is the carrier's answer to "what are the sections" (Q-HM7)**: seven named areas, one
instructor, one date. It is a record of an ACT, and it is signed by two people.

### 2.2 The two receipts are ALREADY in the packet, as separate marks

`packages/shared/src/packetPlacements.ts`:

| Mark | Page | Carrier's heading | `what` |
|---|---|---|---|
| `p25` | 25 | *The Interstate Truck Driver's Handbook … & DRIVER/CONTRACTOR HANDBOOK — Acknowledgement of receipt* | "Receipt of the driver handbooks" |
| `p28` | 28 | *ALCOHOL AND DRUG ABUSE POLICY* (a receipt: name, signature, date) | "The alcohol and drug abuse policy" |

Both are driver signatures, each on its own page. Since AF5 (D-AF3) the packet is signed **in the
office, on the day**, after the office opens signing. So the handbook is already *signed in the office
as part of the signing process*, and the §382.601 receipt already has *its own signature block*.

### 2.3 The contradiction ⚠

Built as D3's row says, a `handbook` authorization would ask the driver to acknowledge the handbook
**twice on the same morning**, once at p25 and once as the new instrument. The two would be versioned
separately and could disagree. That is the "second source of truth" the no-workarounds rule names.
**Either p25 is the handbook evidence, or p25 leaves the packet.** Q-OR1.

### 2.4 What the receipts point at, and what is not on file

- **Page 28 carries no policy text.** Its only prose is a vendor's *"This information is provided as a
  sample only … Legal advice … should be obtained"*. §382.601(a)–(b) requires the carrier to **provide
  the educational materials and its policy**, and (d) requires the signed receipt. We hold the
  receipt and have never seen the policy. Q-OR3.
- **Page 25 names two handbooks:** the FMCSR "Interstate Truck Driver's Handbook" (a published book)
  and the carrier's DRIVER/CONTRACTOR HANDBOOK. Neither is in the repository. The *Company Rules and
  Regulations* are already packet pages 7–8 (`packetStatic.ts`), with their fines schedule.
- `docs/Kowlage-Base/` holds the road-test form and two knowledge-base specs, and no handbook.

### 2.5 The product today

- `hiringSteps.ts`: `live_orientation` (step 14) and `handbook` (step 15) are `office`, `orientation`
  phase, `requires: ["office_approved"]`, `evidence: null`. `hiringChecklist.ts` emits neither
  (no evidence table, D-HM1's corollary). Neither is a federal gate. Under Q-HM5 they **warn and
  never block** the hire.
- `hiringStepDrawers.ts`: both are `"unbuilt"`.
- `qualification_records.kind` (0217) admits no `orientation`, and neither does `documents.kind`'s
  CHECK (33 values, ending in `other`). A filed page 24 needs BOTH widened, or it files as `other`,
  which no fold or binder can tell apart from anything else.
- 0215's `purpose` CHECK: `fcra_disclosure, psp, previous_employer, clearinghouse, drug_alcohol`.
  `drug_alcohol` is the **testing consent** (`AUTHORIZATION_PURPOSE_LABELS`), not the §382.601
  receipt.
- `AUTHORIZATION_PURPOSES` feeds `carrierWording.ts` (`PUBLISHABLE_INSTRUMENTS`),
  `applicationIntake.ts`, `hiringChecklist.ts`, `packetWording.ts`, `defaultWording.ts`,
  `applicationPermissionInstrument.ts`, `employerInquiryContract.ts` and the web's
  `AuthorizationsPanel.vue`. ⚠ **Adding a purpose there is not local.** Every one of those would have
  to be taught to leave it out.
- `org_disclosures` (0338) has **no** instrument CHECK. A new instrument's wording needs no migration.
- D2 built the pattern this wants: `road_test_examiners` (0372), a person with no account whose
  signature the office adds once. The page-24 instructor is the same kind of person.

---

## 3. The target (proposed, pending §7)

The office records the orientation **on screen in the applicant's drawer**, on the carrier's page 24:
which of the seven areas were covered, which handbooks were issued, the date, and the instructor. The
driver signs it at the desk. The product files the carrier's page as a PDF, and `live_orientation`
turns green. The handbook step reads the p25 mark the driver already made (Q-OR1 (a)). No second
receipt exists anywhere.

---

## 4. Steps (proposed; waiting on §7)

### OR0 · Schema · one migration, alone
Depends on Q-OR2. Recommended: add `orientation` to both `qualification_records.kind` and
`documents.kind`, and generalise nothing else. Matrix + mutants, as RT0.

### OR1 · The form as a contract · shared · no migration
`orientationContract.ts`: the seven areas and the three handbooks **verbatim** (D-PKT11, including
`familirize`), a tick per area, the date, instructor, remarks. `orientationComplete` = every area the
owner rules required (Q-OR4) is ticked.

### OR2 · The renderer · api · no migration
`applicationPdf/orientation.ts`: page 24 on the letterhead, via `newDrawing` (names as typed). The
instructor's signature is applied by the office, and the page says so (the Q-RT2 pattern). The
driver's signature is taken at the desk the way the packet's are (Q-OR5). Rasterised and looked at.

### OR3 · Recording it · api + web
`POST /api/recruitment/applicants/:id/orientation`: validates, renders, files, audits, and writes the
`qualification_records` row. The step-14 drawer opens a panel instead of "unbuilt". The `handbook`
step derives from the p25 mark (fold change, `hiringChecklist.ts`).

---

## 5. Order
Q-OR1…Q-OR5 → OR0 → (0 in production) → OR1–OR3 in one merge, as RT1–RT3 were.

---

## 6. Deliberately not in this plan
- The orientation **videos** (step 12): D4, `DRIVER-TRAINING-PLAN.md`.
- Assigning missed sessions to a recording: D5.
- Session scheduling and capacity (R8's `orientation_sessions`): the owner described one half-day per
  arriving driver, not a class. Nothing in Q-HM7 asks for a calendar (Q-OR2).

---

## 7. Open questions

- **Q-OR1 · The handbook is already signed at p25. Is that the handbook signature?**
  *Candidates:* (a) **yes**: p25 is the handbook receipt, and the `handbook` step turns green when
  the p25 mark exists; no 0215 widening, no new instrument. (b) p25 leaves the packet, and a separate
  handbook document with its own signature replaces it (0215 widening + wording + a ceremony screen,
  and a packet change the counsel memo would have to note). (c) Both, which signs the same thing
  twice. *Recommendation:* **(a)**. It is already a separate page with its own signature, signed in
  the office on the day, which is what D-HM10 asked for. (b) costs two merges and a packet edit to
  arrive at the same fact. ⚠ Under (a) the driver still has to be HANDED the handbooks. See Q-OR3.
- **Q-OR2 · Where does the orientation record live?**
  *Candidates:* (a) a `qualification_records` row of a new kind `orientation`, citing the filed page
  24, the way the road test does (two CHECK widenings, `qualification_records.kind` and
  `documents.kind`, in one migration); (b) R8's `orientation_sessions`
  + `orientation_attendance` tables (two new tables, a scheduling model nobody has asked for);
  (c) a `documents` row only (no fold input, so the step could not turn green without a second rule).
  *Recommendation:* **(a)**. ⚠ Orientation is not a §391.51 DQF item, so the kind must stay out of
  `dqCatalogue.ts`'s requirement list (verify at build time).
- **Q-OR3 · Where are the handbooks and the drug-and-alcohol policy?** p25 and p28 are receipts for
  documents we have never seen, and §382.601(a)–(b) requires the policy itself to be provided.
  *Ask:* the carrier's DRIVER/CONTRACTOR HANDBOOK and its alcohol and drug policy (PDF or Word), and
  whether the FMCSR handbook and the ERG ("North American Response Book") are physical books in each
  truck. *Recommendation:* the office uploads the two carrier documents once. The applicant's link
  offers them (RT4's pattern) before the office day, so the p25 and p28 receipts are true when signed.
- **Q-OR4 · Must all seven areas be covered for the step to be green?** Page 24 lists seven, and Q-HM7
  says the day can be halved. *Candidates:* (a) all seven every time; (b) the office ticks what was
  covered, and the step is green when all seven are ticked across one or more sessions (a half day
  now, the rest later); (c) the owner names a required subset. *Recommendation:* **(b)**. It matches
  "by sections", and a partial day files a true record instead of a false complete one.
- **Q-OR5 · Who is the instructor, and how does the driver sign page 24?** *Candidates for the
  instructor:* (a) Arvidera Gakhal, reusing `road_test_examiners` renamed as the carrier's
  examiners/instructors; (b) a separate instructors list. *For the driver's signature:* (a) the
  driver's adopted packet signature, applied by the office at the desk with the driver present, the
  page saying so; (b) a signing ceremony screen of its own. *Recommendation:* ask who teaches. If it is
  the same person, reuse 0372's table **without** renaming it (a rename is the four-step dance) and
  let its title field carry "Maintenance manager". Driver signature (a), because the packet's
  adoption already exists and page 24 is signed at the same desk the same morning.

---

## 8. Progress log

- **2026-09-25** — Plan written. Nothing built: Q-OR1 contradicts D3's row in HIRING-MODULE-PLAN §9
  (a `handbook` 0215 purpose would duplicate the packet's p25 receipt), and Q-OR3 finds the §382.601
  policy text has never been in the product. Five questions to the owner.
