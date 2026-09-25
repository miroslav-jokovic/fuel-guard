# The driver handbook, signed on screen (D3's handbook half) — plan and queue

**Created 2026-09-25.** Execution-grade. Every "today" fact in §2 was read at the call site on `main`
`f073188`, or off the carrier's own file `docs/Kowlage-Base/DRIVER HANDBOOK.docx` (committed with this
plan, at the owner's instruction). This supersedes `ORIENTATION-PLAN.md` Q-OR1/Q-OR6 (the handbook
half only; orientation's page 24 stays there). `HIRING-MODULE-PLAN.md` §0's protocol applies: one step,
one PR, append to §8 of THIS file, prove a test can fail, a migration and its first reader in two
merges.

---

## 1. The owner's rulings (2026-09-25)

- **D-HB1 · Digitised and signed on screen like the application, as its own step BETWEEN
  `application_signed` and `hired`.** Asked *"why we dont digitalize this Handbook same way as
  Application and create signing flow … and add it as separate step between Application Signed and
  Hired?"* That reverses D-HM9's order (the handbook was step 15, before the packet) and supersedes
  ORIENTATION-PLAN Q-OR6's paper recommendation.
- **D-HB2 · The receipt page's SSN prints as `•••1234`.** The last four only, from
  `driver_applications.ssn_last4`. D-HIRE6 (the full number is sealed, never printed) stands.
- **D-HB3 · The carrier's countersignature comes from a managed list of Representatives**, *"we can
  manage add or delete, same way as we did for Inspectors in Maintenance"*. The pattern is
  `maintenance_inspectors` (`inspections/inspectors.ts`): add, and delete, with deletion refused by
  the database once a signed document names them.
- **D-HB4 · The text is the carrier's, exactly, and laid out properly.** *"pull this text exactly,
  also make sure formatted properly in document laid out."* D-PKT11 applies: typos print as written
  (`COMPNAY`, `THA`, `TEMINATION`, `FLASIFICATION`, `forgoing`). The text is EXTRACTED from the
  committed `.docx` and a test re-reads it, never retyped. Layout (headings, lists, the fines schedule
  as a real two-column table) follows the document's own structure.
- **D-HB5 · It BLOCKS the hire.** *"block, he needs sign it before hiring."*

---

## 2. What exists today (verified 2026-09-25)

### 2.1 The carrier's handbook, as a Word document

258 paragraphs, no tables, no explicit page breaks. The fines schedule and the bonus list are laid out
with runs of spaces. Sections, in order: the title (`DRIVER HANDBOOK`, `SILVICOM INC`); **Passenger
Policy**; the memo **To: all drivers and owner operators** (OAI, truck upkeep, the nine fuel rules,
receipts, paperwork, cash advance) → **signature block 1** (`DRIVERS NAME` / `DRIVERS SIGNATURE` /
`DATE`); **Supplemental: Silvicom Inc Driver Policy and Driver Rules** (18 numbered rules); **Hours of
Service Policy** and **DISCIPLINARY PROGRAM FOR LOG VIOLATIONS**, personal conveyance; **Safety policy
and Fines** (a 27-row schedule), **Bonus**, the amendment clause → **block 2** (`Driver’s Name` /
`Driver’s signature` / `Date`); ELD charges, then *"By signing this, I agree to safety penalty
policy."* → **block 3** (`Driver/Owner operator` / `Date`); *"I, Driver, have read …"* → **block 4**
(`Date`, `Agreed:` **Driver** and **Silvicom Inc**); **SAFETY STANDARDS AND POLICIES RECEIPT** →
**block 5** (`Driver name`, `Driver signature`, `Date`, `SSN`).

So the driver signs **five** places, and the carrier countersigns **one** (block 4).

### 2.2 The machinery that exists

- The packet ceremony (C1/C2, AF5): the office opens signing (`open_packet_signing`, 0369), the driver
  adopts a signature and initials (`application_captures` `signature_mark`), and each place is a row in
  `application_packet_marks`. ⚠ `record_packet_mark` raises **DR033 `packet_already_filed`** once
  `submitted_at` is set, and that is right: the packet is closed. **The handbook cannot ride on it. It
  needs its own marks table.**
- Because the handbook comes AFTER the packet, **the driver's adopted signature already exists** when
  it is signed. No second adoption.
- `road_test_examiners` (0372) is the "a person the office adds, with a signature PNG" pattern.
  `maintenance_inspectors` (0280) is the "add or delete, delete refused once referenced" pattern.
- 0373 made `handbook` a `documents.kind` and a `qualification_records.kind`.

### 2.3 ⚠ Nothing refuses a hire today

`hireApplicant.ts`: *"HIRE IS A FACT, NOT A PERMISSION. Nothing here refuses to record a hire because
the file is incomplete."* `readyToHire` (`hiringChecklist.ts`) has **no caller** in the API or the web.
Q-HM5 ("`readyToHire` refuses the hire outright on all six", ruled 2026-09-17) was **never built**.

So D-HB5 cannot be built as "the handbook blocks" alone: that would make the handbook the one thing
that stops a hire while a missing drug test does not. **The honest build is Q-HM5's refusal, with the
handbook added to what `hired` requires.** Derived from the catalogue (`hiringSteps.ts`'s `hired`
step `requires`), never a second hand-written list. See HB5.

### 2.4 The packet's own countersignature lines are blank

`p18c`, `p19ac`, `p19bc`, `p22c` (`Silvicom Inc Representative:`, `Company reprsentative's signature`)
print blank: *"the applicant is not signing them"* (`packetSigningGeometry.ts`). D-HB3's
Representatives are exactly who signs those. Q-HB1.

---

## 3. The target

After the packet is filed, the office presses **Open handbook signing**. On the applicant's link the
driver reads the handbook, page by page as the carrier laid it out, and signs its five places with the
signature they already adopted. The office then chooses a Representative and countersigns block 4.
The product files the signed handbook as a PDF (`documents.kind = 'handbook'`) and one
`qualification_records` row of kind `handbook` citing it. The `handbook` step turns green, and only
then can the driver be hired.

---

## 4. Steps

### HB0 · Schema · migration 0374, alone
`carrier_representatives` (name, title, a signature PNG under `<org>/representatives/`, `created_by`;
never edited, deletable until a signed document names them). `handbook_marks` (one row per signed
place, driver or carrier, the version of the text signed, and for the carrier the Representative and
the office user; append-only). `application_invitations.handbook_signing_opened_at/_by` and
`handbook_filed_at`. A guard trigger refuses a mark unless the application is filed, handbook signing
is open, and the handbook is not yet filed. Matrix, mutants, `rls.test.mjs` seeds, and producer waivers
for one merge.

### HB1 · The text as data · shared
`handbookText.ts`, generated from the `.docx` by a script, with a test that re-extracts the file and
compares. It holds a structured document: headings, paragraphs, lists, the fines schedule as rows, and
the five signature blocks as placements (`h1`…`h5`, plus `h4c` for the carrier).
`HANDBOOK_VERSION` is a hash of the source text.

### HB2 · The renderer · api
`applicationPdf/handbook.ts`: the carrier's letterhead and layout, through `newDrawing` (names as
typed). The fines schedule is a ruled two-column table and the numbered rules are hanging-indented.
It draws the driver's adopted signature at each of h1–h5, the Representative's at h4c, `•••1234` for
the SSN, and on every page who applied the carrier's signature. Rasterised and looked at, with a long
non-ASCII name.

### HB3 · The API
- Office: `GET/POST/DELETE /api/recruitment/representatives` (delete answers 409 once the
  Representative has signed a handbook).
- Office: `POST /applicants/:driverId/handbook/open` and `…/handbook/countersign`, which files the
  PDF and the record once all six marks exist.
- Link: `GET /:token/handbook.pdf` (unsigned, on the ceremony bucket) and `POST /:token/handbook/mark`.
- The signed copy is offered to the driver on the link, in RT4's way.
- Every act is audited.

### HB4 · The screens
- Office: the `handbook` step drawer. If no Representative exists it asks for one, then offers Open
  signing, then Countersign.
- Driver: the handbook ceremony on the link after the filed card, reusing `PermissionDocumentView`
  and the packet's stop walk.

### HB5 · The step and the hire gate
- `hiringSteps.ts`: `handbook` moves between `application_signed` and `hired` (D-HB1), with evidence
  `qualification_records.handbook`, and `hired.requires` gains it.
- `hireApplicant.ts` refuses with `not_ready_to_hire`, naming the steps, while any step in
  `hired.requires` is not done (Q-HM5 + D-HB5). The web's Hire button says why.

HB1–HB5 ship in ONE merge after 0374 is visible in production, as RT1–RT3 did.

---

## 5. Deliberately not in this plan
- Orientation's page 24 (`ORIENTATION-PLAN.md`, Q-OR8).
- Re-signing when the carrier amends the handbook: a new version is a new `HANDBOOK_VERSION`, and
  drivers already hired are not asked again (Q-HB2).
- The drug-and-alcohol policy (ORIENTATION-PLAN Q-OR7), and counsel's review (Q-OR9).

---

## 7. Open questions

- **Q-HB1 · Should the Representatives also sign the packet's four blank carrier lines (`p18c`,
  `p19ac`, `p19bc`, `p22c`)?** They are the same act by the same people, and they print blank on every
  filed packet today. *Recommendation:* yes, as its own step after HB5 (it touches the filed packet's
  renderer, which is frozen per filing, so it needs its own design).
- **Q-HB2 · When the handbook is amended, must hired drivers re-sign?** Its own text says amendments
  *"shall become effective 5 calendar days after delivery"*. *Recommendation:* not in this build. A
  later step can offer the new version to the driver app.

---

## 8. Progress log

- **2026-09-25** — Plan written from the owner's four answers (D-HB1..D-HB5). The handbook `.docx` is
  committed as the source of the text. §2.3: Q-HM5's hire refusal was ruled and never built, so HB5
  builds it with the handbook in it rather than making the handbook the only gate.
- **2026-09-25** — **HB0 DONE (in PR): migration `0374_handbook_signing.sql`**, schema only.
  `carrier_representatives` (never edited, HB010; deletable until a mark names them, which Postgres
  refuses with **23001** `restrict_violation`, not 23503, so the API must map 23001 to 409).
  `handbook_marks` (append-only, HB011, including against a cascade from the invitation, so a
  `merge_driver` or invitation delete cannot take signatures in silence. `merge_driver` already refuses
  a driver with a filed application via MD010, and a mark cannot exist without one). The insert guard
  enforces the order: HB020 wrong org, HB021 dead link, HB022 application not filed, HB023 signing not
  opened, HB024 handbook already filed. The invitation gains `handbook_signing_opened_at/_by` and
  `handbook_filed_at`, with a CHECK keeping them in order. Matrix `handbook-signing.test.mjs`: 39
  assertions, 21 of 21 migration mutants killed (one survived the first run, the carrier check with no
  Representative, and the matrix gained the two cases that kill it). `rls.test.mjs` seeds both tables
  (556 pass). Producer waivers for this one merge. **Next: HB1–HB5 in one merge**, after 0374 shows in
  production.
