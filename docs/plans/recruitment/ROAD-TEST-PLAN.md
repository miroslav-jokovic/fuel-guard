# The road test (D2) — plan and queue

**Created 2026-09-25.** Execution-grade. Every "today" fact in §2 was read at the call site on `main`
`f9f67c7`, measured on production the same day, or read off the carrier's own form. This is
`HIRING-MODULE-PLAN.md`'s **D2** (D-HM7, R8's road-test half), and its §0 protocol applies unchanged:
one step, one PR, branch off `origin/main`, append to §8 of THIS file, prove a test can fail, a
migration and its first reader in two merges.

---

## 1. What the owner gave us (2026-09-25)

- **The carrier's form**: `docs/Kowlage-Base/Road Test Examination.docx` (untracked; 46 paragraphs,
  no tables). Three sections on the carrier's letterhead: **Driver's Road Test Examination**,
  **Evaluation of Road Test**, **Certificate of Road Test**. §2.1 has its text.
- **The examiner**: *"Arvidera Gakhal … is doing road tests."* One named person.

---

## 2. What exists today (verified 2026-09-25)

### 2.1 The carrier's form, section by section

| Section | Fields | Pre-printed values |
|---|---|---|
| Examination | Driver's name, address, city/state/zip, phone, driver's signature · the §391.31(b) paragraph · *"The road test given includes:"* six items, each with a blank to mark · type of equipment · examiner's signature, date | `2021 FRHT #___` |
| Evaluation | General performance: Satisfactory / Needs Training / Unsatisfactory · remarks (two lines) · qualified for · examiner's signature, date | — |
| Certificate | Driver's name · licence no. and state · type of power unit · type of trailer · date · approximate miles · the §391.31(f) opinion sentence · examiner's signature, title · organization | `2021 FRHT`, `DRY VAN/REEFER`, `…2021`, `15` miles, `SILVICOM` |

The six items, verbatim: *Operating the vehicle in street traffic and while passing other vehicles.* ·
*Operating the vehicle in HWY traffic and while passing other vehicles.* · *Use of vehicle's controls
and emergency equipment.* · *Turning the vehicle.* · *Braking and slowing the vehicle by means other
than breaking.* · *Backing and parking the vehicles.*

### 2.2 What §391.31 requires (read on LII, 2026-09-25)

- **(c)** the test covers AT LEAST eight items: (1) the §392.7 pretrip inspection, (2) coupling and
  uncoupling of combination units if the driver may drive them, (3) placing the CMV in operation,
  (4) controls and emergency equipment, (5) operating in traffic and passing, (6) turning,
  (7) braking and slowing by means other than braking, (8) backing and parking.
- **(d)** the examiner **rates performance on each item** and signs the form.
- **(e)/(f)** on pass, a certificate substantially in the (f) form: driver's name, power unit and
  trailer types, date, approximate miles, the opinion sentence, and the examiner's **signature, title,
  organization and address**.
- **(g)** the driver gets a copy of the certificate; the DQF keeps the **original signed form** and the
  original certificate or a copy.

### 2.3 The gap between the two ⚠

**The carrier's form lists six items; §391.31(c) requires eight.** Missing: **(1) pretrip inspection**,
**(2) coupling and uncoupling** (every unit this carrier hires onto pulls a trailer), and **(3) placing
the vehicle in operation**. The carrier's list splits (5) into street and highway. Two smaller points:
the item form has one blank per item (a mark, not a rating) where (d) asks for a rating; and the
certificate's examiner address is the letterhead, which is on the same page — sufficient if the
letterhead prints above it, as it does. See Q-RT1.

### 2.4 The product today
- `hiringSteps.ts`: `road_test` is step 13, `office_day`, `federalGate: true`, `requires: ["drug_test"]`,
  evidence `qualification_records.road_test`. The fold counts `road_test` **or** `cdl_equivalency`.
- `hiringStepDrawers.ts`: `road_test: "recorded_act"` — a signpost to the DQF page, which only
  `admin`/`safety_manager` can write. A recruiter cannot record it from the hire.
- `qualification_records.kind` already admits `road_test` (0217). `documents.kind` does too. **No
  migration is needed for the certificate itself.**
- **The examiner has no Silvicom 360 account** (searched `auth.users` and `invites`, 2026-09-25).
- Fleet: 185 active Silvicom Inc units, Freightliner (FRHT) and International, model years 2020–2027.
  The pre-printed `2021 FRHT` does not describe most of them.
- The carrier's paper has no address field in `organizations`; `packetDraw.ts` prints *"(no legal
  address on file)"* for the same reason. The letterhead is the carrier's own text.
- `lib/pdfFonts.ts` (Q-AF2): new documents print applicant names as typed.

---

## 3. The target

The office records the road test **on screen in the applicant's drawer**, the examiner signs it, and
the product files two PDFs on the carrier's letterhead — the signed **examination + evaluation** and
the **certificate** — as `documents` + one `qualification_records` row of kind `road_test`. The driver
gets their copy of the certificate (§391.31(g)). A test that is not passed files the form and no
certificate, and the step stays open.

---

## 4. Steps (proposed; waiting on §7)

### RT1 · The form as a contract · shared · no migration
`roadTestContract.ts`: the item list (§7 Q-RT1 decides six or eight), a rating per item, general
performance, remarks, qualified for, equipment (unit picked from `vehicles` + trailer type), date,
miles, examiner. The pass rule is derived, not typed: certificate only when general performance is
Satisfactory and every item is rated acceptable.

### RT2 · The renderer · api · no migration
`applicationPdf/roadTest.ts`: the carrier's three sections, their wording verbatim (D-PKT11, including
*"breaking"*), their letterhead, drawn through `newDrawing` (so names print as typed). Pre-printed
values become fields: the unit comes from the roster, the date is the test date — never `2021`.
Rendered with a long fixture, rasterised and looked at.

### RT3 · Recording it · api + web · migration only if Q-RT2 says (b)
`POST /api/recruitment/applicants/:id/road-test`: validates, renders, files, audits. The applicant
drawer's `road_test` row opens a form instead of the signpost. The examiner signs per Q-RT2.

### RT4 · The driver's copy · api + web
The certificate is offered on the applicant's link after filing, as the application copy is.

---

## 5. Order
RT1 → RT2 → RT3 → RT4. RT3 waits on Q-RT2; everything waits on Q-RT1.

---

## 6. Deliberately not in this plan
- §391.33 licence equivalency (`cdl_equivalency`): stays off (Q-REC3, D-REC7).
- Orientation and the handbook: D3.

---

## 7. Open questions

- **Q-RT1 · The form covers six of the eight items §391.31(c) requires.** *Candidates:* (a) add the
  three missing items (pretrip inspection, coupling/uncoupling, placing the vehicle in operation) to
  the carrier's list, keeping its six as written, and give every item a rating (Satisfactory / Needs
  training / Unsatisfactory, the words the evaluation section already uses). (b) Keep the paper as
  it is. A form that omits a required item is evidence the test did not cover it. *Recommendation:*
  **(a)**. It changes the carrier's paper, so it is the owner's call, not ours.
- **Q-RT2 · How does Arvidera Gakhal sign?** He has no account. *Candidates:* (a) he gets a Silvicom 360
  login with a role that may record road tests, and signs on his own session — the audit then says
  who examined, not who typed; (b) an **examiners** list (name, title) kept by the office, and he
  signs in person on the office screen, as the applicant signs the packet — needs a small migration;
  (c) the office prints the filled form, he signs on paper, and the scan is uploaded. *Recommendation:*
  **(a)** — one person, and the certificate is federal evidence of what HE judged.
- **Q-RT3 · His title** for the certificate (§391.31(f) asks for it): *Safety Manager*, *Driver
  Trainer*, other?
- **Q-RT4 · Trailer types.** The form pre-prints *DRY VAN/REEFER*. Are those the only two, or do
  flatbeds, tankers or doubles occur? Tankers and doubles matter to §391.33 and to the endorsement
  check.

---

## 8. Progress log

Append a dated line per step. Never edit §4.

- **2026-09-25** — Plan written from the carrier's form and §391.31 (LII). Nothing built. Waiting on
  Q-RT1 and Q-RT2.
- **2026-09-25** — **The owner ruled all four questions:**
  · **Q-RT1 → (a):** *"add the three missing items to form"*. The form gets nine items: pretrip
    inspection, placing the vehicle in operation and coupling/uncoupling (in §391.31(c)'s words),
    then the carrier's six exactly as written (D-PKT11, *"breaking"* included). Each item is rated
    Satisfactory / Needs Training / Unsatisfactory, the words the carrier's Evaluation section uses.
  · **Q-RT2 → the office adds his signature from the dashboard:** *"he was signing in manually on
    paper before."* So an examiner is kept once, with a signature image the office uploads, and
    printed on each road test he gives. ⚠ The signature is applied by whoever records the test, not
    by him in his own session, so every filed road test records BOTH the examiner and the office
    user who recorded it (`created_by` on the examiner, `recorded_by` on the record, and the audit
    row). That makes it provable afterwards who put his signature on which document.
  · **Q-RT3 → "Maintenance manager".** A column on the examiner, not a constant, so a second
    examiner or a new title is a new row.
  · **Q-RT4 → Dry van and reefer only**, *"what we have in fleet"*. The trailer type is those two.
    Tankers and doubles cannot be chosen, so the §391.33 tank/doubles question does not arise.
  · **The pass rule:** a certificate is issued only when general performance and every one of the
    nine items is Satisfactory. Anything else files the form, issues no certificate, and leaves the
    step open. §391.31(e) certifies a driver who "successfully completes" the test, so a Needs
    Training rating on a required item is not a pass.
- **2026-09-25** — **RT0 DONE in this PR: migration `0372_road_test_examiners.sql`**, schema only (its
  first reader cannot share the merge). Name, title, a signature file that can only sit in the
  row's own org folder (`<org>/examiners/…`), `created_by`, and retirement. Append-only except
  retirement once (RT010/RT011). RLS is on with no policy. Matrix `road-test-examiners.test.mjs`: 17
  assertions, 8 of 8 migration mutants killed. `rls.test.mjs` seeds it (552 pass). There is a producer
  waiver for one merge. **Next: RT1–RT3 in one merge** (contract, renderer, the examiner and
  record-test API, and the screen), after 0372 shows in production's `information_schema`.
